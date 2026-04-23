export type TransactionRow = {
  id: string;
  plaid_transaction_id: string;
  date: string;
  name: string;
  amount: number;
  direction: "incoming" | "outgoing";
};

export type InvoiceRow = {
  id: string;
  invoice_number: string;
  customer_name: string;
  invoice_date: string;
  due_date: string | null;
  amount: number;
  balance_due: number;
  status: string;
};

export type MatchCandidate = {
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  balance_due: number;
  status: string;
  score: number;
  name_score: number;
  amount_score: number;
  reason: string;
};

const LEGAL_ENTITY_TOKENS = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "llc",
  "limited",
  "ltd",
]);

const DESCRIPTOR_TOKENS = new Set(["service", "services"]);
const TRANSACTION_NOISE_TOKENS = new Set([
  "ach",
  "credit",
  "debit",
  "payment",
  "transfer",
]);

export function normalizeCustomerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\b(inc|llc|corp|corporation|company|co|ltd|limited)\b/g, " ")
    .replace(/\b(services|service)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForScoring(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForScoring(value: string): string[] {
  return normalizeForScoring(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function dedupeTokens(tokens: string[]): string[] {
  return [...new Set(tokens)];
}

function isIdentifierToken(token: string): boolean {
  return /\d/.test(token);
}

function isLowSignalToken(token: string): boolean {
  return (
    LEGAL_ENTITY_TOKENS.has(token) ||
    DESCRIPTOR_TOKENS.has(token) ||
    TRANSACTION_NOISE_TOKENS.has(token)
  );
}

function getTokenWeight(token: string): number {
  if (isIdentifierToken(token)) {
    return 1.75;
  }

  if (TRANSACTION_NOISE_TOKENS.has(token)) {
    return 0.5;
  }

  if (LEGAL_ENTITY_TOKENS.has(token) || DESCRIPTOR_TOKENS.has(token)) {
    return 0.5;
  }

  return 1;
}

function sumTokenWeights(tokens: string[]): number {
  return tokens.reduce((total, token) => total + getTokenWeight(token), 0);
}

function formatTokenList(tokens: string[]): string {
  return tokens.join(", ");
}

function buildNameSignalSummary(input: {
  sharedTokens: string[];
  sharedIdentifiers: string[];
  sharedCoreTokens: string[];
}): string {
  if (input.sharedIdentifiers.length > 0) {
    const specificTokenDetail =
      input.sharedCoreTokens.length > 0
        ? ` Shared specific token(s): ${formatTokenList(input.sharedCoreTokens)}.`
        : "";

    return `Shared identifier token(s): ${formatTokenList(input.sharedIdentifiers)}.${specificTokenDetail}`;
  }

  if (input.sharedCoreTokens.length >= 2) {
    return `Shared specific token(s): ${formatTokenList(input.sharedCoreTokens)}.`;
  }

  if (input.sharedCoreTokens.length === 1) {
    return `Only one shared specific token: ${input.sharedCoreTokens[0]}.`;
  }

  if (input.sharedTokens.length > 0) {
    return `Only low-signal overlap: ${formatTokenList(input.sharedTokens)}.`;
  }

  return "No meaningful customer-name overlap.";
}

function computeNameScore(
  transactionName: string,
  customerName: string
): { score: number; signalSummary: string } {
  const txTokens = dedupeTokens(tokenizeForScoring(transactionName));
  const invoiceTokens = dedupeTokens(tokenizeForScoring(customerName));

  if (txTokens.length === 0 || invoiceTokens.length === 0) {
    return {
      score: 0,
      signalSummary: "No meaningful customer-name overlap.",
    };
  }

  const invoiceTokenSet = new Set(invoiceTokens);
  const sharedTokens = txTokens.filter((token) => invoiceTokenSet.has(token));
  const sharedIdentifiers = sharedTokens.filter((token) =>
    isIdentifierToken(token)
  );
  const sharedCoreTokens = sharedTokens.filter(
    (token) => !isIdentifierToken(token) && !isLowSignalToken(token)
  );

  if (sharedTokens.length === 0) {
    return {
      score: 0,
      signalSummary: "No meaningful customer-name overlap.",
    };
  }

  const overlapWeight = sumTokenWeights(sharedTokens);
  const txWeight = sumTokenWeights(txTokens);
  const invoiceWeight = sumTokenWeights(invoiceTokens);

  let score = overlapWeight / Math.max(txWeight, invoiceWeight);

  if (
    sharedIdentifiers.length === 0 &&
    sharedCoreTokens.length <= 1 &&
    sharedTokens.length === 1
  ) {
    score = Math.min(score, 0.55);
  }

  return {
    score: Number(Math.min(score, 1).toFixed(4)),
    signalSummary: buildNameSignalSummary({
      sharedTokens,
      sharedIdentifiers,
      sharedCoreTokens,
    }),
  };
}

function computeAmountScore(paymentAmount: number, balanceDue: number): {
  score: number;
  reason: string;
} {
  const payment = Math.abs(Number(paymentAmount));
  const balance = Number(balanceDue);
  const diff = Math.abs(payment - balance);

  if (diff <= 0.01) {
    return {
      score: 1,
      reason: "Exact amount match",
    };
  }

  if (payment < balance) {
    const ratio = payment / balance;

    if (ratio >= 0.8) {
      return {
        score: 0.85,
        reason: "Strong partial payment candidate",
      };
    }

    if (ratio >= 0.5) {
      return {
        score: 0.65,
        reason: "Possible partial payment",
      };
    }

    if (ratio >= 0.2) {
      return {
        score: 0.4,
        reason: "Low partial payment compatibility",
      };
    }

    return {
      score: 0.15,
      reason: "Payment much smaller than balance due",
    };
  }

  if (diff <= 1) {
    return {
      score: 0.8,
      reason: "Very close amount match",
    };
  }

  if (diff <= 5) {
    return {
      score: 0.6,
      reason: "Close amount match within tolerance",
    };
  }

  return {
    score: 0.1,
    reason: "Payment exceeds balance due by too much",
  };
}

function buildReason(
  nameScore: number,
  amountReason: string,
  transactionName: string,
  customerName: string,
  signalSummary: string
): string {
  const nameReason =
    nameScore >= 0.9
      ? "Very strong customer name similarity"
      : nameScore >= 0.6
      ? "Good customer name similarity"
      : nameScore >= 0.3
      ? "Partial customer name similarity"
      : "Weak customer name similarity";

  return `${nameReason}. ${signalSummary} ${amountReason}. Transaction "${transactionName}" compared to invoice customer "${customerName}".`;
}

export function buildCandidates(
  transaction: TransactionRow,
  invoices: InvoiceRow[]
): MatchCandidate[] {
  if (transaction.direction !== "incoming") {
    return [];
  }

  return invoices
    .map((invoice) => {
      const { score: nameScore, signalSummary } = computeNameScore(
        transaction.name,
        invoice.customer_name
      );

      const { score: amountScore, reason: amountReason } = computeAmountScore(
        transaction.amount,
        invoice.balance_due
      );

      const totalScore = Number(
        (nameScore * 0.6 + amountScore * 0.4).toFixed(4)
      );

      return {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        customer_name: invoice.customer_name,
        balance_due: Number(invoice.balance_due),
        status: invoice.status,
        score: totalScore,
        name_score: Number(nameScore.toFixed(4)),
        amount_score: Number(amountScore.toFixed(4)),
        reason: buildReason(
          nameScore,
          amountReason,
          transaction.name,
          invoice.customer_name,
          signalSummary
        ),
      };
    })
    .filter((candidate) => candidate.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

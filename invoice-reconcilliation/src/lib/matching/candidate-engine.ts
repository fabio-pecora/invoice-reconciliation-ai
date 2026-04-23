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

export function normalizeCustomerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(
      /\b(inc|llc|corp|corporation|company|co|ltd|limited|services|service)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeCustomerName(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function computeNameScore(transactionName: string, customerName: string): number {
  const txTokens = new Set(tokenize(transactionName));
  const invoiceTokens = new Set(tokenize(customerName));

  if (txTokens.size === 0 || invoiceTokens.size === 0) {
    return 0;
  }

  let overlap = 0;

  for (const token of txTokens) {
    if (invoiceTokens.has(token)) {
      overlap += 1;
    }
  }

  const maxSize = Math.max(txTokens.size, invoiceTokens.size);
  return overlap / maxSize;
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
  customerName: string
): string {
  const nameReason =
    nameScore >= 0.9
      ? "Very strong customer name similarity"
      : nameScore >= 0.6
      ? "Good customer name similarity"
      : nameScore >= 0.3
      ? "Partial customer name similarity"
      : "Weak customer name similarity";

  return `${nameReason}. ${amountReason}. Transaction "${transactionName}" compared to invoice customer "${customerName}".`;
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
      const nameScore = computeNameScore(
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
          invoice.customer_name
        ),
      };
    })
    .filter((candidate) => candidate.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

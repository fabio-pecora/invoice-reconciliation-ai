import { supabaseServer } from "@/lib/supabase/server";
import {
  buildCandidates,
  InvoiceRow,
  MatchCandidate,
  normalizeCustomerName,
  TransactionRow,
} from "@/lib/matching/candidate-engine";

type MatchRow = {
  id: string;
  transaction_id: string;
  status: "matched" | "partially_matched" | "unmatched";
  confidence: number;
  reason: string;
};

type AllocationRow = {
  id: string;
  match_id: string;
  invoice_id: string;
  amount: number;
};

type RunMatchResult = {
  transaction: TransactionRow;
  existing: boolean;
  match: MatchRow;
  allocations: AllocationRow[];
  candidates: MatchCandidate[];
};

type PlannedAllocation = {
  invoice: InvoiceRow;
  candidate: MatchCandidate;
  amount: number;
  newBalanceDue: number;
  newStatus: "paid" | "partially_paid";
};

const AUTO_MATCH_THRESHOLD = 0.75;
const MULTI_INVOICE_MIN_TOP_SCORE = 0.6;
const MONEY_EPSILON = 0.01;
const STRONG_NAME_THRESHOLD = 0.6;

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function buildInvoiceStatus(newBalanceDue: number): "paid" | "partially_paid" {
  return newBalanceDue <= MONEY_EPSILON ? "paid" : "partially_paid";
}

function normalizeBalanceDue(value: number): number {
  const rounded = roundMoney(value);
  return rounded <= MONEY_EPSILON ? 0 : rounded;
}

function isUniqueTransactionMatchError(error: {
  code?: string;
  message?: string;
}): boolean {
  const message = error.message?.toLowerCase() ?? "";

  return (
    error.code === "23505" &&
    (message.includes("transaction_id") || message.includes("matches"))
  );
}

async function fetchTransaction(
  transactionId: string
): Promise<TransactionRow | null> {
  const { data, error } = await supabaseServer
    .from("transactions")
    .select("*")
    .eq("id", transactionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load transaction: ${error.message}`);
  }

  return (data as TransactionRow | null) ?? null;
}

async function fetchExistingMatch(
  transactionId: string
): Promise<MatchRow | null> {
  const { data, error } = await supabaseServer
    .from("matches")
    .select("*")
    .eq("transaction_id", transactionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load existing match: ${error.message}`);
  }

  return (data as MatchRow | null) ?? null;
}

async function fetchAllocations(matchId: string): Promise<AllocationRow[]> {
  const { data, error } = await supabaseServer
    .from("allocations")
    .select("*")
    .eq("match_id", matchId);

  if (error) {
    throw new Error(`Failed to load allocations: ${error.message}`);
  }

  return (data ?? []) as AllocationRow[];
}

async function fetchEligibleInvoices(): Promise<InvoiceRow[]> {
  const { data, error } = await supabaseServer
    .from("invoices")
    .select("*")
    .in("status", ["open", "partially_paid"])
    .gt("balance_due", 0)
    .order("invoice_date", { ascending: false });

  if (error) {
    throw new Error(`Failed to load invoices: ${error.message}`);
  }

  return (data ?? []) as InvoiceRow[];
}

async function fetchEligibleInvoiceById(
  invoiceId: string
): Promise<InvoiceRow | null> {
  const { data, error } = await supabaseServer
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .in("status", ["open", "partially_paid"])
    .gt("balance_due", 0)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load invoice: ${error.message}`);
  }

  return (data as InvoiceRow | null) ?? null;
}

async function fetchEligibleInvoicesByIds(
  invoiceIds: string[]
): Promise<InvoiceRow[]> {
  if (invoiceIds.length === 0) {
    return [];
  }

  const { data, error } = await supabaseServer
    .from("invoices")
    .select("*")
    .in("id", invoiceIds)
    .in("status", ["open", "partially_paid"])
    .gt("balance_due", 0);

  if (error) {
    throw new Error(`Failed to load invoices: ${error.message}`);
  }

  return (data ?? []) as InvoiceRow[];
}

async function insertMatch(input: {
  transaction_id: string;
  status: "matched" | "partially_matched" | "unmatched";
  confidence: number;
  reason: string;
}): Promise<MatchRow> {
  const { data, error } = await supabaseServer
    .from("matches")
    .insert(input)
    .select("*")
    .single();

  if (error) {
    const wrappedError = new Error(
      `Failed to insert match: ${error.message}`
    ) as Error & {
      code?: string;
    };
    wrappedError.code = error.code;
    throw wrappedError;
  }

  return data as MatchRow;
}

async function insertMatchOrGetExisting(input: {
  transaction_id: string;
  status: "matched" | "partially_matched" | "unmatched";
  confidence: number;
  reason: string;
}): Promise<{ existing: boolean; match: MatchRow }> {
  try {
    const match = await insertMatch(input);
    return {
      existing: false,
      match,
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      isUniqueTransactionMatchError(error as { code?: string; message?: string })
    ) {
      const existingMatch = await fetchExistingMatch(input.transaction_id);

      if (existingMatch) {
        return {
          existing: true,
          match: existingMatch,
        };
      }
    }

    throw error;
  }
}

async function insertAllocation(input: {
  match_id: string;
  invoice_id: string;
  amount: number;
}): Promise<AllocationRow> {
  const { data, error } = await supabaseServer
    .from("allocations")
    .insert(input)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to insert allocation: ${error.message}`);
  }

  return data as AllocationRow;
}

async function updateInvoiceBalance(input: {
  invoiceId: string;
  newBalanceDue: number;
  newStatus: "paid" | "partially_paid";
}): Promise<void> {
  const { error } = await supabaseServer
    .from("invoices")
    .update({
      balance_due: input.newBalanceDue,
      status: input.newStatus,
    })
    .eq("id", input.invoiceId);

  if (error) {
    throw new Error(`Failed to update invoice: ${error.message}`);
  }
}

async function buildExistingResult(
  transaction: TransactionRow,
  match: MatchRow,
  candidates?: MatchCandidate[]
): Promise<RunMatchResult> {
  const existingAllocations = await fetchAllocations(match.id);
  const resolvedCandidates =
    candidates ??
    (transaction.direction === "incoming"
      ? buildCandidates(transaction, await fetchEligibleInvoices())
      : []);

  return {
    transaction,
    existing: true,
    match,
    allocations: existingAllocations,
    candidates: resolvedCandidates,
  };
}

async function createUnmatchedResult(input: {
  transaction: TransactionRow;
  confidence: number;
  reason: string;
  candidates: MatchCandidate[];
}): Promise<RunMatchResult> {
  const insertResult = await insertMatchOrGetExisting({
    transaction_id: input.transaction.id,
    status: "unmatched",
    confidence: input.confidence,
    reason: input.reason,
  });

  if (insertResult.existing) {
    return buildExistingResult(
      input.transaction,
      insertResult.match,
      input.candidates
    );
  }

  return {
    transaction: input.transaction,
    existing: false,
    match: insertResult.match,
    allocations: [],
    candidates: input.candidates,
  };
}

function buildCandidateFamily(
  candidates: MatchCandidate[],
  topCandidate: MatchCandidate
): MatchCandidate[] {
  const customerFamily = normalizeCustomerName(topCandidate.customer_name);

  return candidates.filter((candidate) => {
    return (
      normalizeCustomerName(candidate.customer_name) === customerFamily &&
      candidate.name_score >= STRONG_NAME_THRESHOLD
    );
  });
}

function hasSafeMultiInvoiceConfidence(
  topCandidate: MatchCandidate,
  familyCandidates: MatchCandidate[]
): boolean {
  return (
    familyCandidates.length > 1 &&
    topCandidate.score >= MULTI_INVOICE_MIN_TOP_SCORE &&
    topCandidate.name_score >= STRONG_NAME_THRESHOLD
  );
}

function compareInvoiceDates(left: InvoiceRow, right: InvoiceRow): number {
  const leftTime = Date.parse(left.invoice_date);
  const rightTime = Date.parse(right.invoice_date);

  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) {
    return 0;
  }

  if (Number.isNaN(leftTime)) {
    return 1;
  }

  if (Number.isNaN(rightTime)) {
    return -1;
  }

  return leftTime - rightTime;
}

function buildAllocationPlan(input: {
  paymentAmount: number;
  candidates: MatchCandidate[];
  invoiceLookup: Map<string, InvoiceRow>;
}): { allocations: PlannedAllocation[]; remainingPayment: number } {
  const orderedCandidates = [...input.candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    const leftInvoice = input.invoiceLookup.get(left.invoice_id);
    const rightInvoice = input.invoiceLookup.get(right.invoice_id);

    if (leftInvoice && rightInvoice) {
      const dateComparison = compareInvoiceDates(leftInvoice, rightInvoice);

      if (dateComparison !== 0) {
        return dateComparison;
      }
    }

    return left.invoice_id.localeCompare(right.invoice_id);
  });

  let remainingPayment = roundMoney(input.paymentAmount);
  const allocations: PlannedAllocation[] = [];

  for (const candidate of orderedCandidates) {
    const invoice = input.invoiceLookup.get(candidate.invoice_id);

    if (!invoice || remainingPayment <= MONEY_EPSILON) {
      continue;
    }

    const currentBalanceDue = roundMoney(Number(invoice.balance_due));
    const allocationAmount = roundMoney(
      Math.min(remainingPayment, currentBalanceDue)
    );

    if (allocationAmount <= 0) {
      continue;
    }

    const newBalanceDue = normalizeBalanceDue(
      currentBalanceDue - allocationAmount
    );

    allocations.push({
      invoice,
      candidate,
      amount: allocationAmount,
      newBalanceDue,
      newStatus: buildInvoiceStatus(newBalanceDue),
    });

    remainingPayment = normalizeBalanceDue(remainingPayment - allocationAmount);
  }

  return {
    allocations,
    remainingPayment,
  };
}

function buildMatchStatus(allocations: PlannedAllocation[]): MatchRow["status"] {
  if (
    allocations.length === 1 &&
    allocations[0].newBalanceDue <= MONEY_EPSILON
  ) {
    return "matched";
  }

  return "partially_matched";
}

function buildAllocationReason(allocations: PlannedAllocation[]): string {
  if (allocations.length <= 1) {
    return allocations[0]?.candidate.reason ?? "Auto-applied to one invoice.";
  }

  const customerName = allocations[0].candidate.customer_name;
  return `Auto-applied across ${allocations.length} invoices for ${customerName} using strong same-customer candidates ordered by score and invoice date.`;
}

export async function runTransactionMatch(
  transactionId: string
): Promise<RunMatchResult> {
  const transaction = await fetchTransaction(transactionId);

  if (!transaction) {
    throw new Error("Transaction not found");
  }

  const existingMatch = await fetchExistingMatch(transactionId);

  if (existingMatch) {
    return buildExistingResult(transaction, existingMatch);
  }

  if (transaction.direction !== "incoming") {
    return createUnmatchedResult({
      transaction,
      confidence: 0,
      reason: "Outgoing transaction. Not eligible for invoice matching.",
      candidates: [],
    });
  }

  const invoices = await fetchEligibleInvoices();
  const candidates = buildCandidates(transaction, invoices);
  const topCandidate = candidates[0];

  if (!topCandidate) {
    return createUnmatchedResult({
      transaction,
      confidence: 0,
      reason: "No candidate met the auto-match confidence threshold.",
      candidates,
    });
  }

  const familyCandidates = buildCandidateFamily(candidates, topCandidate);
  const hasSafeSingleConfidence = topCandidate.score >= AUTO_MATCH_THRESHOLD;
  const hasSafeMultiConfidence = hasSafeMultiInvoiceConfidence(
    topCandidate,
    familyCandidates
  );

  if (!hasSafeSingleConfidence && !hasSafeMultiConfidence) {
    return createUnmatchedResult({
      transaction,
      confidence: topCandidate.score,
      reason: topCandidate.reason,
      candidates,
    });
  }

  const selectedCandidateSet = hasSafeMultiConfidence
    ? familyCandidates
    : [topCandidate];
  const selectedInvoices = hasSafeMultiConfidence
    ? await fetchEligibleInvoicesByIds(
        [...new Set(selectedCandidateSet.map((candidate) => candidate.invoice_id))]
      )
    : (
        await Promise.all([fetchEligibleInvoiceById(topCandidate.invoice_id)])
      ).filter((invoice): invoice is InvoiceRow => invoice !== null);

  if (selectedInvoices.length === 0) {
    return createUnmatchedResult({
      transaction,
      confidence: topCandidate.score,
      reason: "Candidate invoices are no longer eligible for auto-application.",
      candidates,
    });
  }

  const paymentAmount = roundMoney(Math.abs(Number(transaction.amount)));
  const invoiceLookup = new Map(
    selectedInvoices.map((invoice) => [invoice.id, invoice])
  );
  const allocationCandidates = selectedCandidateSet.filter((candidate) =>
    invoiceLookup.has(candidate.invoice_id)
  );

  if (allocationCandidates.length === 0) {
    return createUnmatchedResult({
      transaction,
      confidence: topCandidate.score,
      reason: "Candidate invoices are no longer eligible for auto-application.",
      candidates,
    });
  }

  const allocationPlan = buildAllocationPlan({
    paymentAmount,
    candidates: allocationCandidates,
    invoiceLookup,
  });

  if (allocationPlan.allocations.length === 0) {
    return createUnmatchedResult({
      transaction,
      confidence: topCandidate.score,
      reason: "Allocation amount was zero.",
      candidates,
    });
  }

  if (allocationPlan.remainingPayment > MONEY_EPSILON) {
    return createUnmatchedResult({
      transaction,
      confidence: topCandidate.score,
      reason:
        "Payment exceeded safely allocable balance across eligible candidate invoices. Overpayments are not auto-applied in v1.",
      candidates,
    });
  }

  const insertResult = await insertMatchOrGetExisting({
    transaction_id: transaction.id,
    status: buildMatchStatus(allocationPlan.allocations),
    confidence: topCandidate.score,
    reason: buildAllocationReason(allocationPlan.allocations),
  });

  if (insertResult.existing) {
    return buildExistingResult(transaction, insertResult.match, candidates);
  }

  const allocations: AllocationRow[] = [];

  for (const plannedAllocation of allocationPlan.allocations) {
    const allocation = await insertAllocation({
      match_id: insertResult.match.id,
      invoice_id: plannedAllocation.invoice.id,
      amount: plannedAllocation.amount,
    });

    allocations.push(allocation);

    await updateInvoiceBalance({
      invoiceId: plannedAllocation.invoice.id,
      newBalanceDue: plannedAllocation.newBalanceDue,
      newStatus: plannedAllocation.newStatus,
    });
  }

  return {
    transaction,
    existing: false,
    match: insertResult.match,
    allocations,
    candidates,
  };
}

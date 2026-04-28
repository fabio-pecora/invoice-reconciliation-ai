// High level: Transaction detail/review page showing match results, candidates, allocations, and manual actions.
import Link from "next/link";
import { connection } from "next/server";
import {
  formatInvoiceDate,
  getInvoiceDueStatus,
} from "@/lib/invoices/due-status";
import {
  buildCandidates,
  type InvoiceRow,
  type MatchCandidate,
  type TransactionRow,
} from "@/lib/matching/candidate-engine";
import {
  MatchRow,
  formatMatchStatusLabel,
  isAppliedMatchStatus,
} from "@/lib/matching/match-status";
import {
  getMatchOutcomeHeading,
  getOriginBadgeClass,
  getStatusBadgeClass,
  inferMatchOrigin,
} from "@/lib/matching/match-ui";
import { supabaseServer } from "@/lib/supabase/server";
import ManualApplyButton from "./manual-apply-button";
import RunMatchButton from "./run-match-button";

type AllocationRow = {
  id: string;
  match_id: string;
  invoice_id: string;
  amount: number;
};

type AllocationDetail = AllocationRow & {
  invoice_number?: string;
  customer_name?: string;
  balance_due?: number;
  status?: string;
};

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatConfidence(confidence: number) {
  return Number(confidence).toFixed(2);
}

function formatDirectionLabel(direction: TransactionRow["direction"]): string {
  return direction === "incoming" ? "Incoming" : "Outgoing";
}

function formatEntityStatusLabel(value?: string): string {
  if (!value) {
    return "Unknown";
  }

  return value
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function getDirectionBadgeClass(direction: TransactionRow["direction"]): string {
  return direction === "incoming"
    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
    : "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

function getInvoiceStatusBadgeClass(status?: string): string {
  if (status === "paid") {
    return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
  }

  if (status === "partially_paid") {
    return "bg-amber-100 text-amber-900 ring-1 ring-amber-200";
  }

  if (status === "open") {
    return "bg-blue-100 text-blue-800 ring-1 ring-blue-200";
  }

  return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

function getOutcomeCallout(match: MatchRow | null): {
  toneClass: string;
  title: string;
  description: string;
} {
  if (!match) {
    return {
      toneClass: "border-blue-200 bg-blue-50 text-blue-900",
      title: "This transaction has not been processed yet.",
      description:
        "Run the matcher to generate the reconciliation outcome and any review context for this transaction.",
    };
  }

  if (match.status === "human_review_needed") {
    return {
      toneClass: "border-orange-200 bg-orange-50 text-orange-900",
      title: "Review needed before applying this payment.",
      description:
        "Multiple plausible invoice candidates were found. Human review is required before applying this payment.",
    };
  }

  const isManualResolution = match.reason.includes("Manually applied");

  if (match.status === "matched") {
    return {
      toneClass: isManualResolution
        ? "border-sky-200 bg-sky-50 text-sky-900"
        : "border-emerald-200 bg-emerald-50 text-emerald-900",
      title: isManualResolution
        ? "Payment applied during manual review"
        : "Payment applied automatically",
      description: isManualResolution
        ? "An agent selected a candidate invoice and safely applied the payment."
        : "The system found strong enough evidence to apply this payment without human intervention.",
    };
  }

  if (match.status === "partially_matched") {
    return {
      toneClass: isManualResolution
        ? "border-sky-200 bg-sky-50 text-sky-900"
        : "border-amber-200 bg-amber-50 text-amber-900",
      title: isManualResolution
        ? "Partial payment applied during manual review"
        : "Payment partially applied",
      description: isManualResolution
        ? "An agent selected a candidate invoice and safely applied a partial payment."
        : "A safe automatic allocation was created, but the payment did not resolve to a single fully paid invoice.",
    };
  }

  return {
    toneClass: "border-slate-200 bg-slate-50 text-slate-900",
    title: "This payment has not been applied to any invoice.",
    description: match.reason.includes("not eligible for invoice matching")
      ? "Stored for completeness, but not eligible for invoice matching."
      : "No safe invoice application was created for this transaction.",
  };
}

function getAllocationEmptyState(match: MatchRow): string {
  if (match.status === "human_review_needed") {
    return "This payment has not been applied to any invoice yet. Human review is still required.";
  }

  if (match.status === "unmatched") {
    return "This payment has not been applied to any invoice.";
  }

  return "No invoice allocation is stored for this result.";
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

async function fetchInvoicesByIds(invoiceIds: string[]): Promise<InvoiceRow[]> {
  if (invoiceIds.length === 0) {
    return [];
  }

  const { data, error } = await supabaseServer
    .from("invoices")
    .select("*")
    .in("id", invoiceIds);

  if (error) {
    throw new Error(`Failed to load invoices: ${error.message}`);
  }

  return (data ?? []) as InvoiceRow[];
}

async function fetchPersistedMatch(
  transactionId: string
): Promise<MatchRow | null> {
  const { data, error } = await supabaseServer
    .from("matches")
    .select("*")
    .eq("transaction_id", transactionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load match: ${error.message}`);
  }

  return (data as MatchRow | null) ?? null;
}

async function fetchAllocations(matchId: string): Promise<AllocationDetail[]> {
  const { data, error } = await supabaseServer
    .from("allocations")
    .select("*")
    .eq("match_id", matchId);

  if (error) {
    throw new Error(`Failed to load allocations: ${error.message}`);
  }

  const allocations = (data ?? []) as AllocationRow[];

  if (allocations.length === 0) {
    return [];
  }

  const invoiceIds = [...new Set(allocations.map((item) => item.invoice_id))];
  const { data: invoices, error: invoicesError } = await supabaseServer
    .from("invoices")
    .select("id, invoice_number, customer_name, balance_due, status")
    .in("id", invoiceIds);

  if (invoicesError) {
    throw new Error(
      `Failed to load allocation invoices: ${invoicesError.message}`
    );
  }

  const invoiceLookup = new Map(
    (invoices ?? []).map((invoice) => [
      invoice.id as string,
      {
        invoice_number: invoice.invoice_number as string,
        customer_name: invoice.customer_name as string,
        balance_due: Number(invoice.balance_due),
        status: invoice.status as string,
      },
    ])
  );

  return allocations.map((allocation) => ({
    ...allocation,
    ...invoiceLookup.get(allocation.invoice_id),
  }));
}

export default async function TransactionDetailPage(
  props: PageProps<"/reconciliation/[transactionId]">
) {
  await connection();

  const { transactionId } = await props.params;
  const [transaction, persistedMatch] = await Promise.all([
    fetchTransaction(transactionId),
    fetchPersistedMatch(transactionId),
  ]);

  if (!transaction) {
    return (
      <main className="p-8">
        <p className="text-red-600">Transaction not found.</p>
      </main>
    );
  }

  const allocations = persistedMatch
    ? await fetchAllocations(persistedMatch.id)
    : [];

  let candidates: MatchCandidate[] = [];
  let candidateMessage: string | undefined;

  if (transaction.direction !== "incoming") {
    candidateMessage = "Stored for completeness, but not eligible for invoice matching.";
  } else {
    const allocationInvoiceIds = [...new Set(allocations.map((item) => item.invoice_id))];
    const [eligibleInvoices, allocatedInvoices] = await Promise.all([
      fetchEligibleInvoices(),
      fetchInvoicesByIds(allocationInvoiceIds),
    ]);
    const allocatedAmountByInvoiceId = new Map<string, number>();

    for (const allocation of allocations) {
      allocatedAmountByInvoiceId.set(
        allocation.invoice_id,
        Number(allocatedAmountByInvoiceId.get(allocation.invoice_id) ?? 0) +
          Number(allocation.amount)
      );
    }

    const invoicePool = new Map<string, InvoiceRow>();

    for (const invoice of eligibleInvoices) {
      invoicePool.set(invoice.id, invoice);
    }

    for (const invoice of allocatedInvoices) {
      const restoredBalanceDue =
        Number(invoice.balance_due) +
        Number(allocatedAmountByInvoiceId.get(invoice.id) ?? 0);

      invoicePool.set(invoice.id, {
        ...invoice,
        balance_due: restoredBalanceDue,
        status:
          invoice.status === "paid" && restoredBalanceDue > 0
            ? "open"
            : invoice.status,
      });
    }

    candidates = buildCandidates(transaction, [...invoicePool.values()]);
  }

  const matchOrigin = inferMatchOrigin(persistedMatch);
  const outcomeCallout = getOutcomeCallout(persistedMatch);
  const canShowManualApplyActions =
    transaction.direction === "incoming" &&
    persistedMatch?.status === "human_review_needed";
  const hasAllocations = allocations.length > 0;
  const appliedInvoiceIds = new Set(allocations.map((allocation) => allocation.invoice_id));
  const shouldShowCandidatesFirst =
    persistedMatch?.status === "human_review_needed" && !hasAllocations;
  const allocationSectionTitle = hasAllocations
    ? allocations.length === 1
      ? "Applied Invoice"
      : "Payment Allocations"
    : "Payment Allocation";
  const allocationSectionDescription = hasAllocations
    ? allocations.length === 1
      ? "This payment was applied to the invoice below."
      : "This payment was allocated across the invoices below."
    : "This payment has not been applied to any invoice.";
  const candidateSectionDescription =
    hasAllocations && persistedMatch && isAppliedMatchStatus(persistedMatch.status)
      ? "These were the candidate invoices considered during reconciliation. The applied invoice is highlighted."
      : persistedMatch?.status === "human_review_needed"
        ? "These are the ranked invoice candidates awaiting review."
        : "These are the candidate invoices considered during reconciliation.";

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-3">
          <Link
            href="/reconciliation"
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            Back to reconciliation
          </Link>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm text-slate-500">Transaction Summary</p>
              <h1 className="mt-1 text-3xl font-semibold text-slate-900">
                {transaction.name}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${getDirectionBadgeClass(
                  transaction.direction
                )}`}
              >
                {formatDirectionLabel(transaction.direction)}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(
                  persistedMatch?.status ?? "pending"
                )}`}
              >
                {formatMatchStatusLabel(persistedMatch?.status ?? "pending")}
              </span>
              {matchOrigin ? (
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${getOriginBadgeClass(
                    matchOrigin
                  )}`}
                >
                  {matchOrigin}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-slate-900">
                Transaction Summary
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Core bank transaction details used by the reconciliation engine.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm text-slate-500">Amount</div>
                <div
                  className={`mt-1 text-lg font-semibold ${
                    transaction.direction === "incoming"
                      ? "text-emerald-700"
                      : "text-slate-900"
                  }`}
                >
                  {formatMoney(Number(transaction.amount))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm text-slate-500">Direction</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">
                  {formatDirectionLabel(transaction.direction)}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm text-slate-500">Date</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">
                  {transaction.date}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm text-slate-500">Plaid Transaction ID</div>
                <div className="mt-1 break-all text-sm font-medium text-slate-900">
                  {transaction.plaid_transaction_id}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-slate-900">
                Match Outcome
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Current persisted reconciliation state for this transaction.
              </p>
            </div>

            <div
              className={`rounded-2xl border p-4 ${outcomeCallout.toneClass}`}
            >
              <div className="text-sm font-semibold">
                {getMatchOutcomeHeading(persistedMatch?.status ?? "pending")}
              </div>
              <div className="mt-1 text-base font-medium">
                {outcomeCallout.title}
              </div>
              <p className="mt-2 text-sm leading-6">{outcomeCallout.description}</p>
            </div>

            {persistedMatch ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm text-slate-500">Decision State</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {formatMatchStatusLabel(persistedMatch.status)}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm text-slate-500">Confidence</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {formatConfidence(persistedMatch.confidence)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <RunMatchButton transactionId={transactionId} />
              </div>
            )}
          </section>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-slate-900">
              Why This Happened
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              The persisted explanation shown to operations users for this
              outcome.
            </p>
          </div>

          {persistedMatch ? (
            <div
              className={`rounded-2xl border p-5 ${
                persistedMatch.status === "human_review_needed"
                  ? "border-orange-200 bg-orange-50"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              <p className="text-sm leading-7 text-slate-800">
                {persistedMatch.reason}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-7 text-blue-900">
              This transaction has not been processed yet.
            </div>
          )}
        </section>

        {shouldShowCandidatesFirst ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-slate-900">
                Candidate Invoices
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {candidateSectionDescription}
              </p>
            </div>

            {persistedMatch?.status === "human_review_needed" ? (
              <div className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm leading-6 text-orange-900">
                Multiple plausible invoice candidates were found. Human review is
                required before applying this payment.
              </div>
            ) : null}

            {candidateMessage ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                {candidateMessage}
              </div>
            ) : candidates.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                No plausible invoice candidates were found for this payment.
              </div>
            ) : (
              <div className="space-y-4">
                {candidates.map((candidate, index) => {
                  const dueStatus = getInvoiceDueStatus({
                    dueDate: candidate.due_date,
                    invoiceStatus: candidate.status,
                  });
                  const canApplyThisCandidate =
                    canShowManualApplyActions &&
                    Number(candidate.balance_due) > 0 &&
                    ["open", "partially_paid"].includes(candidate.status);
                  const isAppliedCandidate = appliedInvoiceIds.has(candidate.invoice_id);

                  return (
                    <div
                      key={candidate.invoice_id}
                      className={`rounded-2xl border p-5 ${
                        isAppliedCandidate
                          ? "border-emerald-200 bg-emerald-50/70"
                          : index === 0
                            ? "border-blue-200 bg-blue-50/50"
                            : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-lg font-semibold text-slate-900">
                              {candidate.invoice_number}
                            </div>
                            {isAppliedCandidate ? (
                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                                Applied
                              </span>
                            ) : null}
                            {index === 0 ? (
                              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800 ring-1 ring-blue-200">
                                Highest Score
                              </span>
                            ) : null}
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-medium ${dueStatus.className}`}
                            >
                              {dueStatus.label}
                            </span>
                          </div>
                          <div className="text-sm text-slate-600">
                            {candidate.customer_name}
                          </div>
                          {isAppliedCandidate ? (
                            <div className="text-sm font-medium text-emerald-800">
                              This candidate was selected and applied during reconciliation.
                            </div>
                          ) : null}
                        </div>

                        <div
                          className={`rounded-xl border px-4 py-3 text-right ${
                            isAppliedCandidate
                              ? "border-emerald-200 bg-white"
                              : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            Overall Score
                          </div>
                          <div
                            className={`mt-1 text-2xl font-semibold ${
                              isAppliedCandidate ? "text-emerald-700" : "text-blue-700"
                            }`}
                          >
                            {candidate.score.toFixed(2)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="text-sm text-slate-500">Balance Due</div>
                          <div className="mt-1 font-semibold text-slate-900">
                            {formatMoney(Number(candidate.balance_due))}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="text-sm text-slate-500">Invoice Date</div>
                          <div className="mt-1 font-semibold text-slate-900">
                            {formatInvoiceDate(candidate.invoice_date)}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="text-sm text-slate-500">Due Date</div>
                          <div className="mt-1 font-semibold text-slate-900">
                            {formatInvoiceDate(candidate.due_date)}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="text-sm text-slate-500">Name Score</div>
                          <div className="mt-1 font-semibold text-slate-900">
                            {candidate.name_score.toFixed(2)}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="text-sm text-slate-500">Amount Score</div>
                          <div className="mt-1 font-semibold text-slate-900">
                            {candidate.amount_score.toFixed(2)}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="text-sm text-slate-500">Invoice Status</div>
                          <div className="mt-1 font-semibold text-slate-900">
                            {formatEntityStatusLabel(candidate.status)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-sm font-medium text-slate-900">
                          Evidence
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-700">
                          {candidate.reason}
                        </p>
                      </div>

                      {canApplyThisCandidate ? (
                        <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                              <div className="text-sm font-medium text-blue-900">
                                Manual review action
                              </div>
                              <p className="mt-1 text-sm text-blue-900/80">
                                Apply this incoming payment to{" "}
                                {candidate.invoice_number} using the existing
                                allocation rules.
                              </p>
                            </div>
                            <ManualApplyButton
                              transactionId={transactionId}
                              invoiceId={candidate.invoice_id}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}

        <section
          className={`rounded-2xl border p-6 shadow-sm ${
            hasAllocations
              ? "border-emerald-200 bg-emerald-50/40"
              : "border-slate-200 bg-white"
          }`}
        >
          <div className="mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-slate-900">
                {allocationSectionTitle}
              </h2>
              {hasAllocations ? (
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                  Applied
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {allocationSectionDescription}
            </p>
          </div>

          {!persistedMatch ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              No allocation is stored because this transaction has not been
              processed yet.
            </div>
          ) : allocations.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              {getAllocationEmptyState(persistedMatch)}
            </div>
          ) : (
            <div className="space-y-4">
              {allocations.map((allocation) => (
                <article
                  key={allocation.id}
                  className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-semibold text-slate-900">
                          {allocation.invoice_number ?? allocation.invoice_id}
                        </div>
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                          Applied
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${getInvoiceStatusBadgeClass(
                            allocation.status
                          )}`}
                        >
                          {formatEntityStatusLabel(allocation.status)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600">
                        {allocation.customer_name ?? "Unknown customer"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-right">
                      <div className="text-xs uppercase tracking-wide text-emerald-700">
                        Allocated Amount
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-emerald-900">
                        {formatMoney(Number(allocation.amount))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm text-slate-500">Invoice Number</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {allocation.invoice_number ?? allocation.invoice_id}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm text-slate-500">Customer</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {allocation.customer_name ?? "Unknown customer"}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm text-slate-500">Remaining Balance</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {allocation.balance_due !== undefined
                          ? formatMoney(Number(allocation.balance_due))
                          : "Unknown"}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm text-slate-500">Invoice Status</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatEntityStatusLabel(allocation.status)}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {!shouldShowCandidatesFirst ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-slate-900">
              Candidate Invoices
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {candidateSectionDescription}
            </p>
          </div>

          {persistedMatch?.status === "human_review_needed" ? (
            <div className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm leading-6 text-orange-900">
              Multiple plausible invoice candidates were found. Human review is
              required before applying this payment.
            </div>
          ) : null}

          {candidateMessage ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              {candidateMessage}
            </div>
          ) : candidates.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              No plausible invoice candidates were found for this payment.
            </div>
          ) : (
            <div className="space-y-4">
              {candidates.map((candidate, index) => {
                const dueStatus = getInvoiceDueStatus({
                  dueDate: candidate.due_date,
                  invoiceStatus: candidate.status,
                });
                const canApplyThisCandidate =
                  canShowManualApplyActions &&
                  Number(candidate.balance_due) > 0 &&
                  ["open", "partially_paid"].includes(candidate.status);
                const isAppliedCandidate = appliedInvoiceIds.has(candidate.invoice_id);

                return (
                  <div
                    key={candidate.invoice_id}
                    className={`rounded-2xl border p-5 ${
                      isAppliedCandidate
                        ? "border-emerald-200 bg-emerald-50/70"
                        : index === 0
                          ? "border-blue-200 bg-blue-50/50"
                          : "border-slate-200 bg-slate-50"
                    }`}
                  >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-semibold text-slate-900">
                          {candidate.invoice_number}
                        </div>
                        {isAppliedCandidate ? (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                            Applied
                          </span>
                        ) : null}
                        {index === 0 ? (
                          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800 ring-1 ring-blue-200">
                            Highest Score
                          </span>
                        ) : null}
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${dueStatus.className}`}
                        >
                          {dueStatus.label}
                        </span>
                      </div>
                      <div className="text-sm text-slate-600">
                        {candidate.customer_name}
                      </div>
                      {isAppliedCandidate ? (
                        <div className="text-sm font-medium text-emerald-800">
                          This candidate was selected and applied during reconciliation.
                        </div>
                      ) : null}
                    </div>

                    <div
                      className={`rounded-xl border px-4 py-3 text-right ${
                        isAppliedCandidate
                          ? "border-emerald-200 bg-white"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="text-xs uppercase tracking-wide text-slate-500">
                        Overall Score
                      </div>
                      <div
                        className={`mt-1 text-2xl font-semibold ${
                          isAppliedCandidate ? "text-emerald-700" : "text-blue-700"
                        }`}
                      >
                        {candidate.score.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-sm text-slate-500">Balance Due</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatMoney(Number(candidate.balance_due))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-sm text-slate-500">Invoice Date</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatInvoiceDate(candidate.invoice_date)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-sm text-slate-500">Due Date</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatInvoiceDate(candidate.due_date)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-sm text-slate-500">Name Score</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {candidate.name_score.toFixed(2)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-sm text-slate-500">Amount Score</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {candidate.amount_score.toFixed(2)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-sm text-slate-500">Invoice Status</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatEntityStatusLabel(candidate.status)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-sm font-medium text-slate-900">
                      Evidence
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">
                      {candidate.reason}
                    </p>
                  </div>

                  {canApplyThisCandidate ? (
                    <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-sm font-medium text-blue-900">
                            Manual review action
                          </div>
                          <p className="mt-1 text-sm text-blue-900/80">
                            Apply this incoming payment to{" "}
                            {candidate.invoice_number} using the existing
                            allocation rules.
                          </p>
                        </div>
                        <ManualApplyButton
                          transactionId={transactionId}
                          invoiceId={candidate.invoice_id}
                        />
                      </div>
                    </div>
                  ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        ) : null}
      </div>
    </main>
  );
}

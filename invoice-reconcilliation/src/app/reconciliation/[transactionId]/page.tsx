import Link from "next/link";
import {
  buildCandidates,
  type InvoiceRow,
  type MatchCandidate,
  type TransactionRow,
} from "@/lib/matching/candidate-engine";
import { supabaseServer } from "@/lib/supabase/server";
import RunMatchButton from "./run-match-button";

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

function inferMatchOrigin(
  match: MatchRow | null
): "Deterministic" | "LLM-assisted" | "Unmatched" | null {
  if (!match) {
    return null;
  }

  if (match.status === "unmatched") {
    return "Unmatched";
  }

  return match.reason.startsWith("LLM-assisted decision.")
    ? "LLM-assisted"
    : "Deterministic";
}

function getStatusBadgeClass(status: MatchRow["status"] | "pending"): string {
  if (status === "matched") {
    return "bg-green-100 text-green-700";
  }

  if (status === "partially_matched") {
    return "bg-amber-100 text-amber-800";
  }

  if (status === "unmatched") {
    return "bg-gray-100 text-gray-700";
  }

  return "bg-blue-100 text-blue-700";
}

function getOriginBadgeClass(
  origin: ReturnType<typeof inferMatchOrigin>
): string {
  if (origin === "LLM-assisted") {
    return "bg-violet-100 text-violet-700";
  }

  if (origin === "Deterministic") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (origin === "Unmatched") {
    return "bg-gray-100 text-gray-700";
  }

  return "bg-blue-100 text-blue-700";
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
    candidateMessage =
      "This transaction is outgoing, so it is not eligible for invoice matching.";
  } else {
    candidates = buildCandidates(transaction, await fetchEligibleInvoices());
  }

  const matchOrigin = inferMatchOrigin(persistedMatch);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <Link
            href="/reconciliation"
            className="text-sm text-blue-600 hover:underline"
          >
            Back to reconciliation
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_1.4fr]">
          <section className="space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div>
              <div className="text-sm text-gray-500">Selected Transaction</div>
              <h1 className="mt-1 text-2xl font-semibold text-gray-900">
                {transaction.name}
              </h1>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-sm text-gray-500">Amount</div>
                <div
                  className={`font-medium ${
                    transaction.direction === "incoming"
                      ? "text-green-700"
                      : "text-gray-900"
                  }`}
                >
                  {formatMoney(Number(transaction.amount))}
                </div>
              </div>

              <div>
                <div className="text-sm text-gray-500">Direction</div>
                <div className="font-medium text-gray-900">
                  {transaction.direction}
                </div>
              </div>

              <div>
                <div className="text-sm text-gray-500">Date</div>
                <div className="font-medium text-gray-900">
                  {transaction.date}
                </div>
              </div>

              <div>
                <div className="text-sm text-gray-500">
                  Plaid Transaction ID
                </div>
                <div className="break-all font-medium text-gray-900">
                  {transaction.plaid_transaction_id}
                </div>
              </div>
            </div>

            {persistedMatch ? (
              <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(
                      persistedMatch.status
                    )}`}
                  >
                    {persistedMatch.status.replace("_", " ")}
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

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="text-sm text-gray-500">Current Match Status</div>
                    <div className="font-medium text-gray-900">
                      {persistedMatch.status.replace("_", " ")}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-gray-500">Confidence</div>
                    <div className="font-medium text-gray-900">
                      {formatConfidence(persistedMatch.confidence)}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-sm text-gray-500">Reason</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-800">
                    {persistedMatch.reason}
                  </p>
                </div>

                <div>
                  <div className="text-sm text-gray-500">Allocations</div>
                  {allocations.length === 0 ? (
                    <div className="mt-2 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
                      {persistedMatch.status === "unmatched"
                        ? "No allocations were created because this transaction remained unmatched."
                        : "No allocations were created for this persisted result."}
                    </div>
                  ) : (
                    <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white">
                      <div className="grid grid-cols-[1.1fr_1.2fr_0.9fr_0.9fr_0.8fr] gap-3 border-b border-gray-200 px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500">
                        <div>Invoice</div>
                        <div>Customer</div>
                        <div>Allocated</div>
                        <div>Remaining</div>
                        <div>Status</div>
                      </div>
                      <div className="divide-y divide-gray-200">
                        {allocations.map((allocation) => (
                          <div
                            key={allocation.id}
                            className="grid grid-cols-[1.1fr_1.2fr_0.9fr_0.9fr_0.8fr] gap-3 px-4 py-3 text-sm"
                          >
                            <div className="font-medium text-gray-900">
                              {allocation.invoice_number ?? allocation.invoice_id}
                            </div>
                            <div className="text-gray-700">
                              {allocation.customer_name ?? allocation.invoice_id}
                            </div>
                            <div className="font-medium text-gray-900">
                              {formatMoney(Number(allocation.amount))}
                            </div>
                            <div className="text-gray-700">
                              {allocation.balance_due !== undefined
                                ? formatMoney(Number(allocation.balance_due))
                                : "Unknown"}
                            </div>
                            <div className="text-gray-700">
                              {allocation.status ?? "Unknown"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
                <div>
                  <div className="text-sm font-medium text-blue-900">
                    No persisted match yet
                  </div>
                  <p className="mt-1 text-sm text-blue-800">
                    Inspect the candidate invoices below, then run the matcher to
                    persist either a deterministic match, an LLM-assisted match,
                    or an explicit unmatched result.
                  </p>
                </div>
                <RunMatchButton transactionId={transactionId} />
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <div className="text-sm text-gray-500">Candidate Invoices</div>
              <h2 className="mt-1 text-2xl font-semibold text-gray-900">
                Suggested Matches
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Candidate scores remain deterministic. The LLM is only used
                later for ambiguous middle-band decisions.
              </p>
            </div>

            {candidateMessage ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                {candidateMessage}
              </div>
            ) : candidates.length === 0 ? (
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
                No eligible invoice candidates were found for this transaction.
              </div>
            ) : (
              <div className="space-y-4">
                {candidates.map((candidate, index) => (
                  <div
                    key={candidate.invoice_id}
                    className="rounded-2xl border border-gray-200 p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-lg font-semibold text-gray-900">
                            {candidate.invoice_number}
                          </div>
                          {index === 0 ? (
                            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
                              Top candidate
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm text-gray-600">
                          {candidate.customer_name}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-sm text-gray-500">Score</div>
                        <div className="text-xl font-semibold text-blue-700">
                          {candidate.score.toFixed(2)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-4">
                      <div>
                        <div className="text-sm text-gray-500">Balance Due</div>
                        <div className="font-medium text-gray-900">
                          {formatMoney(Number(candidate.balance_due))}
                        </div>
                      </div>

                      <div>
                        <div className="text-sm text-gray-500">Name Score</div>
                        <div className="font-medium text-gray-900">
                          {candidate.name_score.toFixed(2)}
                        </div>
                      </div>

                      <div>
                        <div className="text-sm text-gray-500">Amount Score</div>
                        <div className="font-medium text-gray-900">
                          {candidate.amount_score.toFixed(2)}
                        </div>
                      </div>

                      <div>
                        <div className="text-sm text-gray-500">Status</div>
                        <div className="font-medium text-gray-900">
                          {candidate.status}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
                      <div className="text-sm font-medium text-blue-900">
                        Why this candidate is plausible
                      </div>
                      <p className="mt-1 text-sm leading-6 text-blue-800">
                        {candidate.reason}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

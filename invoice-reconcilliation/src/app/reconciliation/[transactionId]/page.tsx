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
};

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

async function fetchTransaction(
  transactionId: string,
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
  transactionId: string,
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
    .select("id, invoice_number, customer_name")
    .in("id", invoiceIds);

  if (invoicesError) {
    throw new Error(`Failed to load allocation invoices: ${invoicesError.message}`);
  }

  const invoiceLookup = new Map(
    (invoices ?? []).map((invoice) => [
      invoice.id as string,
      {
        invoice_number: invoice.invoice_number as string,
        customer_name: invoice.customer_name as string,
      },
    ]),
  );

  return allocations.map((allocation) => ({
    ...allocation,
    ...invoiceLookup.get(allocation.invoice_id),
  }));
}

export default async function TransactionDetailPage(
  props: PageProps<"/reconciliation/[transactionId]">,
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

  let candidates: MatchCandidate[] = [];
  let candidateMessage: string | undefined;
  const allocations = persistedMatch
    ? await fetchAllocations(persistedMatch.id)
    : [];

  if (transaction.direction !== "incoming") {
    candidateMessage =
      "Transaction is not incoming, so it is not a payment candidate.";
  } else {
    candidates = buildCandidates(transaction, await fetchEligibleInvoices());
  }

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
          <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div>
              <div className="text-sm text-gray-500">Selected Transaction</div>
              <h1 className="mt-1 text-2xl font-semibold text-gray-900">
                {transaction.name}
              </h1>
            </div>

              <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-sm text-gray-500">Date</div>
                <div className="font-medium text-gray-900">
                  {transaction.date}
                </div>
              </div>

              <div>
                <div className="text-sm text-gray-500">Amount</div>
                <div className="font-medium text-gray-900">
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
                <div className="text-sm text-gray-500">
                  Plaid Transaction ID
                </div>
                <div className="break-all font-medium text-gray-900">
                  {transaction.plaid_transaction_id}
                </div>
              </div>
            </div>

            {persistedMatch ? (
              <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                <div className="text-sm text-green-700">Persisted Result</div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="text-sm text-gray-500">Match Status</div>
                    <div className="font-medium text-gray-900">
                      {persistedMatch.status}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-gray-500">Confidence</div>
                    <div className="font-medium text-gray-900">
                      {persistedMatch.confidence}
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-sm text-gray-500">Reason</div>
                  <div className="font-medium text-gray-900">
                    {persistedMatch.reason}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-sm text-gray-500">Allocations</div>
                  {allocations.length === 0 ? (
                    <div className="font-medium text-gray-900">
                      No allocations created.
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {allocations.map((allocation) => (
                        <div
                          key={allocation.id}
                          className="rounded-lg border border-green-100 bg-white p-3"
                        >
                          <div className="font-medium text-gray-900">
                            {allocation.invoice_number ?? allocation.invoice_id}
                          </div>
                          <div className="text-sm text-gray-600">
                            {allocation.customer_name ?? allocation.invoice_id}
                          </div>
                          <div className="mt-1 text-sm font-medium text-gray-900">
                            {formatMoney(Number(allocation.amount))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <RunMatchButton transactionId={transactionId} />
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <div className="text-sm text-gray-500">Candidate Invoices</div>
              <h2 className="mt-1 text-2xl font-semibold text-gray-900">
                Suggested Matches
              </h2>
            </div>

            {candidateMessage ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-gray-700">
                {candidateMessage}
              </div>
            ) : candidates.length === 0 ? (
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-yellow-800">
                No candidate invoices found for this transaction.
              </div>
            ) : (
              <div className="space-y-4">
                {candidates.map((candidate) => (
                  <div
                    key={candidate.invoice_id}
                    className="rounded-2xl border border-gray-200 p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-lg font-semibold text-gray-900">
                          {candidate.invoice_number}
                        </div>
                        <div className="mt-1 text-sm text-gray-600">
                          {candidate.customer_name}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-sm text-gray-500">Score</div>
                        <div className="text-xl font-semibold text-blue-700">
                          {candidate.score}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                      <div>
                        <div className="text-sm text-gray-500">Balance Due</div>
                        <div className="font-medium text-gray-900">
                          {formatMoney(Number(candidate.balance_due))}
                        </div>
                      </div>

                      <div>
                        <div className="text-sm text-gray-500">Name Score</div>
                        <div className="font-medium text-gray-900">
                          {candidate.name_score}
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
                        Why this candidate
                      </div>
                      <div className="mt-1 text-sm text-blue-800">
                        {candidate.reason}
                      </div>
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

import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";

type TransactionRow = {
  id: string;
  plaid_transaction_id: string;
  date: string;
  name: string;
  amount: number;
  direction: "incoming" | "outgoing";
};

type MatchRow = {
  id: string;
  transaction_id: string;
  status: "matched" | "partially_matched" | "unmatched";
  confidence: number;
  reason: string;
};

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
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

export default async function ReconciliationPage() {
  const [
    { data: transactions, error: transactionsError },
    { data: matches, error: matchesError },
  ] = await Promise.all([
    supabaseServer.from("transactions").select("*").order("date", {
      ascending: false,
    }),
    supabaseServer.from("matches").select("*"),
  ]);

  if (transactionsError) {
    return (
      <main className="p-8">
        <h1 className="mb-4 text-2xl font-semibold">Reconciliation</h1>
        <p className="text-red-600">
          Failed to load transactions: {transactionsError.message}
        </p>
      </main>
    );
  }

  if (matchesError) {
    return (
      <main className="p-8">
        <h1 className="mb-4 text-2xl font-semibold">Reconciliation</h1>
        <p className="text-red-600">
          Failed to load match results: {matchesError.message}
        </p>
      </main>
    );
  }

  const typedTransactions = (transactions ?? []) as TransactionRow[];
  const typedMatches = (matches ?? []) as MatchRow[];
  const matchLookup = new Map(
    typedMatches.map((match) => [match.transaction_id, match])
  );

  const incomingCount =
    typedTransactions.filter((tx) => tx.direction === "incoming").length ?? 0;
  const outgoingCount =
    typedTransactions.filter((tx) => tx.direction === "outgoing").length ?? 0;

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">
            Reconciliation
          </h1>
          <p className="mt-1 text-gray-600">
            Review bank transactions and inspect deterministic or LLM-assisted
            invoice matches.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">Total Transactions</div>
            <div className="mt-2 text-2xl font-semibold text-gray-900">
              {typedTransactions.length}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">Incoming Payments</div>
            <div className="mt-2 text-2xl font-semibold text-green-700">
              {incomingCount}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">Outgoing / Noise</div>
            <div className="mt-2 text-2xl font-semibold text-gray-900">
              {outgoingCount}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-lg font-medium text-gray-900">Transactions</h2>
          </div>

          {typedTransactions.length === 0 ? (
            <div className="p-6 text-gray-600">
              No transactions found. Import or seed transactions to inspect
              reconciliation results.
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {typedTransactions.map((tx) => {
                const match = matchLookup.get(tx.id) ?? null;
                const origin = inferMatchOrigin(match);

                return (
                  <Link
                    key={tx.id}
                    href={`/reconciliation/${tx.id}`}
                    className="block transition hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between gap-4 px-5 py-4">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-gray-900">
                          {tx.name}
                        </div>
                        <div className="mt-1 text-sm text-gray-500">
                          {tx.date} · {tx.plaid_transaction_id}
                        </div>
                        {match ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(
                                match.status
                              )}`}
                            >
                              {match.status.replace("_", " ")}
                            </span>
                            {origin ? (
                              <span
                                className={`rounded-full px-2.5 py-1 text-xs font-medium ${getOriginBadgeClass(
                                  origin
                                )}`}
                              >
                                {origin}
                              </span>
                            ) : null}
                            <span className="text-xs text-gray-500">
                              Confidence {Number(match.confidence).toFixed(2)}
                            </span>
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-blue-700">
                            No persisted match yet. Open to inspect candidates
                            and run matching.
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            tx.direction === "incoming"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {tx.direction}
                        </span>

                        <div
                          className={`font-semibold ${
                            tx.direction === "incoming"
                              ? "text-green-700"
                              : "text-gray-900"
                          }`}
                        >
                          {formatMoney(Number(tx.amount))}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

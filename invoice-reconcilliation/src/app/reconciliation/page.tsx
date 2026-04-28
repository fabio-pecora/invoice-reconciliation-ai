// High level: Server-rendered reconciliation dashboard that loads transactions, matches, and sync status.
import { connection } from "next/server";
import PlaidSyncPanel from "@/components/plaid-sync-panel";
import TransactionOutcomeBoard from "@/components/transaction-outcome-board";
import { MatchRow } from "@/lib/matching/match-status";
import { getLatestPlaidSyncRun } from "@/lib/plaid/sync-runs";
import { supabaseServer } from "@/lib/supabase/server";

type TransactionRow = {
  id: string;
  plaid_transaction_id: string;
  date: string;
  name: string;
  amount: number;
  direction: "incoming" | "outgoing";
};

export default async function ReconciliationPage() {
  await connection();

  const [
    { data: transactions, error: transactionsError },
    { data: matches, error: matchesError },
    latestSyncRun,
  ] = await Promise.all([
    supabaseServer.from("transactions").select("*").order("date", {
      ascending: false,
    }),
    supabaseServer.from("matches").select("*"),
    getLatestPlaidSyncRun(),
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
  const items = typedTransactions.map((transaction) => ({
    transaction,
    match: matchLookup.get(transaction.id) ?? null,
  }));

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[96rem] space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">
            Reconciliation
          </h1>
          <p className="mt-1 max-w-3xl text-slate-600">
            Review automatic outcomes, sync fresh Plaid sandbox transactions,
            and keep incoming payments separated from outgoing bank activity.
          </p>
        </div>

        <PlaidSyncPanel initialSyncRun={latestSyncRun} />

        <TransactionOutcomeBoard items={items} showOriginBadge />
      </div>
    </main>
  );
}

import { connection } from "next/server";
import TransactionOutcomeBoard from "@/components/transaction-outcome-board";
import { MatchRow } from "@/lib/matching/match-status";
import { supabaseServer } from "@/lib/supabase/server";

type TransactionRow = {
  id: string;
  plaid_transaction_id: string;
  date: string;
  name: string;
  amount: number;
  direction: "incoming" | "outgoing";
};

export default async function TransactionsPage() {
  await connection();

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
      <main className="p-6">
        <h1 className="mb-4 text-2xl font-bold">Transactions</h1>
        <p className="text-red-600">
          Error loading transactions: {transactionsError.message}
        </p>
      </main>
    );
  }

  if (matchesError) {
    return (
      <main className="p-6">
        <h1 className="mb-4 text-2xl font-bold">Transactions</h1>
        <p className="text-red-600">
          Error loading transaction matches: {matchesError.message}
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
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Transactions</h1>
          <p className="mt-1 max-w-3xl text-slate-600">
            Incoming payments remain grouped by reconciliation outcome, while
            outgoing transactions stay hidden until you explicitly reveal them.
          </p>
        </div>

        <TransactionOutcomeBoard items={items} />
      </div>
    </main>
  );
}

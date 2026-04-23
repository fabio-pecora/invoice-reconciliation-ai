import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type TransactionRow = {
  id: string;
  plaid_transaction_id: string;
  date: string;
  name: string;
  amount: number;
  direction: "incoming" | "outgoing";
};

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export default async function ReconciliationPage() {
  const { data: transactions, error } = await supabase
    .from("transactions")
    .select("*")
    .order("date", { ascending: false });

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold mb-4">Reconciliation</h1>
        <p className="text-red-600">
          Failed to load transactions: {error.message}
        </p>
      </main>
    );
  }

  const incomingCount =
    transactions?.filter((tx) => tx.direction === "incoming").length ?? 0;

  const outgoingCount =
    transactions?.filter((tx) => tx.direction === "outgoing").length ?? 0;

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">
            Reconciliation
          </h1>
          <p className="text-gray-600 mt-1">
            Review bank transactions and inspect possible invoice matches.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
            <div className="text-sm text-gray-500">Total Transactions</div>
            <div className="mt-2 text-2xl font-semibold text-gray-900">
              {transactions?.length ?? 0}
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
            <div className="text-sm text-gray-500">Incoming Payments</div>
            <div className="mt-2 text-2xl font-semibold text-green-700">
              {incomingCount}
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
            <div className="text-sm text-gray-500">Outgoing / Noise</div>
            <div className="mt-2 text-2xl font-semibold text-gray-900">
              {outgoingCount}
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-lg font-medium text-gray-900">Transactions</h2>
          </div>

          {!transactions || transactions.length === 0 ? (
            <div className="p-6 text-gray-600">No transactions found.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {transactions.map((tx: TransactionRow) => (
                <Link
                  key={tx.id}
                  href={`/reconciliation/${tx.id}`}
                  className="block hover:bg-gray-50 transition"
                >
                  <div className="px-5 py-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">
                        {tx.name}
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        {tx.date} · {tx.plaid_transaction_id}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className={`text-xs px-2.5 py-1 rounded-full font-medium ${
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
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

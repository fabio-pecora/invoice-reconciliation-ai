import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export default async function TransactionsPage() {
  const { data: transactions, error } = await supabase
    .from("transactions")
    .select("*")
    .order("date", { ascending: false });

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold mb-4">Transactions</h1>
        <p className="text-red-600">
          Error loading transactions: {error.message}
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h1 className="text-2xl font-semibold text-gray-900">Transactions</h1>
        </div>

        {!transactions || transactions.length === 0 ? (
          <div className="p-6 text-gray-600">No transactions found.</div>
        ) : (
          <div className="divide-y divide-gray-200">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="px-5 py-4 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">
                    {tx.name}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {tx.date} · {tx.direction}
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="font-semibold text-gray-900">
                    {formatMoney(Number(tx.amount))}
                  </div>

                  <Link
                    href={`/reconciliation/${tx.id}`}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
                  >
                    View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

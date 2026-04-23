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

type Candidate = {
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  invoice_amount: number;
  balance_due: number;
  invoice_status: string;
  score: number;
  name_score: number;
  amount_score: number;
  reason: {
    summary: string;
  };
};

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ transactionId: string }>;
}) {
  const { transactionId } = await params;

  const { data: transaction, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", transactionId)
    .single<TransactionRow>();

  if (error || !transaction) {
    return (
      <main className="p-8">
        <p className="text-red-600">Transaction not found.</p>
      </main>
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  const candidateRes = await fetch(
    `${baseUrl}/api/matches/candidates/${transactionId}`,
    { cache: "no-store" },
  );

  const candidateJson = await candidateRes.json();
  const candidates: Candidate[] = candidateJson.candidates ?? [];
  const candidateMessage: string | undefined = candidateJson.message;

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <Link
            href="/reconciliation"
            className="text-sm text-blue-600 hover:underline"
          >
            ← Back to reconciliation
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_1.4fr]">
          <section className="rounded-2xl bg-white border border-gray-200 shadow-sm p-6 space-y-4">
            <div>
              <div className="text-sm text-gray-500">Selected Transaction</div>
              <h1 className="text-2xl font-semibold text-gray-900 mt-1">
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
                <div className="font-medium text-gray-900 break-all">
                  {transaction.plaid_transaction_id}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-white border border-gray-200 shadow-sm p-6">
            <div className="mb-4">
              <div className="text-sm text-gray-500">Candidate Invoices</div>
              <h2 className="text-2xl font-semibold text-gray-900 mt-1">
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
                        <div className="text-sm text-gray-600 mt-1">
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

                    <div className="grid gap-4 sm:grid-cols-3 mt-4">
                      <div>
                        <div className="text-sm text-gray-500">
                          Invoice Amount
                        </div>
                        <div className="font-medium text-gray-900">
                          {formatMoney(Number(candidate.invoice_amount))}
                        </div>
                      </div>

                      <div>
                        <div className="text-sm text-gray-500">Balance Due</div>
                        <div className="font-medium text-gray-900">
                          {formatMoney(Number(candidate.balance_due))}
                        </div>
                      </div>

                      <div>
                        <div className="text-sm text-gray-500">Status</div>
                        <div className="font-medium text-gray-900">
                          {candidate.invoice_status}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
                      <div className="text-sm font-medium text-blue-900">
                        Why this candidate
                      </div>
                      <div className="text-sm text-blue-800 mt-1">
                        {candidate.reason.summary}
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

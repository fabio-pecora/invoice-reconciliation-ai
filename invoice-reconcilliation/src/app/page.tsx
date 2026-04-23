import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full rounded-3xl bg-white border border-gray-200 shadow-sm p-8">
        <h1 className="text-3xl font-semibold text-gray-900">
          Invoice Reconciliation System
        </h1>

        <p className="text-gray-600 mt-3">
          Match incoming bank transactions to invoices using rule-based logic
          and AI-assisted decision making.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/reconciliation"
            className="rounded-xl bg-blue-600 text-white px-5 py-3 font-medium hover:bg-blue-700 transition text-center"
          >
            Open Reconciliation
          </Link>

          <Link
            href="/invoices"
            className="rounded-xl border border-gray-300 px-5 py-3 font-medium text-gray-900 hover:bg-gray-50 transition text-center"
          >
            View Invoices
          </Link>

          <Link
            href="/transactions"
            className="rounded-xl border border-gray-300 px-5 py-3 font-medium text-gray-900 hover:bg-gray-50 transition text-center"
          >
            View Transactions
          </Link>
        </div>
      </div>
    </main>
  );
}

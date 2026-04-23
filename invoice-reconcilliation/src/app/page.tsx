import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-4xl items-center">
        <div className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
          <p className="text-sm font-medium text-slate-500">Operations Tool</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900 sm:text-4xl">
            Reconciliation
          </h1>

          <p className="mt-3 max-w-2xl text-slate-600">
            Review incoming payments, sync Plaid sandbox activity, and resolve
            invoice applications from one main workflow.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/reconciliation"
              className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-medium text-white hover:bg-blue-700"
            >
              Open Reconciliation
            </Link>

            <Link
              href="/invoices"
              className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-medium text-slate-900 hover:bg-slate-50"
            >
              View Invoices
            </Link>
          </div>

          <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Included in reconciliation
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Incoming transactions, review-needed items, unmatched payments,
              sync status, and manual apply actions are all handled in the
              reconciliation workspace.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

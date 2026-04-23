import Link from "next/link";
import InvoiceImportForm from "@/components/invoice-import-form";
import ManualTransactionForm from "@/components/manual-transaction-form";

const dashboardCards = [
  {
    title: "Reconciliation",
    description:
      "Sync Plaid activity, review matched and unmatched payments, and resolve cases that need human review.",
    bullets: [
      "Sync transactions from connected bank activity",
      "Review matched and unmatched payment outcomes",
      "Resolve ambiguous cases before applying cash",
    ],
    href: "/reconciliation",
    actionLabel: "Open Reconciliation",
    tone: "primary",
  },
  {
    title: "Invoices",
    description:
      "View invoice balances, filter the receivables list, and monitor overdue items that need follow-up.",
    bullets: [
      "Review current invoice balances",
      "Filter by customer, status, and due date",
      "Monitor overdue invoices and open exposure",
    ],
    href: "/invoices",
    actionLabel: "View Invoices",
    tone: "secondary",
  },
] as const;

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 sm:py-12">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10 lg:p-12">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)] lg:items-start">
            <div>
              <p className="text-sm font-medium text-slate-500">
                Finance Operations
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
                Invoice Reconciliation
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
                Sync Plaid transactions, match payments to invoices, and review
                exceptions safely.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <div className="text-sm font-semibold text-slate-900">
                Core workflow
              </div>
              <div className="mt-4 space-y-4">
                <div className="border-b border-slate-200 pb-4 last:border-b-0 last:pb-0">
                  <div className="text-sm font-medium text-slate-900">
                    Transaction intake
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Pull recent bank activity into a controlled reconciliation
                    queue.
                  </p>
                </div>
                <div className="border-b border-slate-200 pb-4 last:border-b-0 last:pb-0">
                  <div className="text-sm font-medium text-slate-900">
                    Matching review
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Separate confirmed matches from unmatched and review-needed
                    payments.
                  </p>
                </div>
                <div className="border-b border-slate-200 pb-4 last:border-b-0 last:pb-0">
                  <div className="text-sm font-medium text-slate-900">
                    Receivables follow-up
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Monitor invoice balances and aging without leaving the main
                    operations workspace.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          {dashboardCards.map((card) => (
            <article
              key={card.title}
              className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8"
            >
              <p className="text-sm font-medium text-slate-500">Workspace</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                {card.title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
                {card.description}
              </p>

              <ul className="mt-6 space-y-3 text-sm text-slate-700">
                {card.bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-blue-600" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                <Link
                  href={card.href}
                  className={
                    card.tone === "primary"
                      ? "inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
                      : "inline-flex items-center justify-center rounded-xl border border-slate-300 bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
                  }
                >
                  {card.actionLabel}
                </Link>
              </div>
            </article>
          ))}
        </section>

        <ManualTransactionForm />

        <InvoiceImportForm />
      </div>
    </main>
  );
}

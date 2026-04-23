import { supabaseServer } from "@/lib/supabase/server";
import InvoiceListClient from "./invoice-list-client";

type InvoiceRow = {
  id: string;
  invoice_number: string;
  customer_name: string;
  invoice_date: string;
  due_date: string | null;
  amount: number;
  balance_due: number;
  status: string;
};

export default async function InvoicesPage() {
  const { data, error } = await supabaseServer
    .from("invoices")
    .select("*")
    .order("invoice_date", { ascending: false });

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-3xl font-semibold text-slate-900">Invoices</h1>
          <p className="mt-4 text-red-600">
            Failed to load invoices: {error.message}
          </p>
        </div>
      </main>
    );
  }

  const invoices = (data ?? []) as InvoiceRow[];

  const openCount = invoices.filter(
    (invoice) => invoice.status === "open",
  ).length;
  const partiallyPaidCount = invoices.filter(
    (invoice) => invoice.status === "partially_paid",
  ).length;
  const paidCount = invoices.filter(
    (invoice) => invoice.status === "paid",
  ).length;

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Invoices</h1>
          <p className="mt-1 text-slate-600">
            Search and filter imported invoices without leaving the main
            operations dashboard.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Total Invoices</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {invoices.length}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Open</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {openCount}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Partially Paid</div>
            <div className="mt-2 text-2xl font-semibold text-amber-700">
              {partiallyPaidCount}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Paid</div>
            <div className="mt-2 text-2xl font-semibold text-green-700">
              {paidCount}
            </div>
          </div>
        </div>

        <InvoiceListClient invoices={invoices} />
      </div>
    </main>
  );
}

import { supabaseServer } from "@/lib/supabase/server";

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

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(amount));
}

function getStatusClasses(status: string) {
  switch (status) {
    case "paid":
      return "bg-green-100 text-green-700";
    case "partially_paid":
      return "bg-amber-100 text-amber-700";
    case "open":
    default:
      return "bg-gray-100 text-gray-700";
  }
}

export default async function InvoicesPage() {
  const { data, error } = await supabaseServer
    .from("invoices")
    .select("*")
    .order("invoice_date", { ascending: false });

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-3xl font-semibold text-gray-900">Invoices</h1>
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
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">Invoices</h1>
          <p className="mt-1 text-gray-600">
            Imported invoices from CSV: {invoices.length}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">Total Invoices</div>
            <div className="mt-2 text-2xl font-semibold text-gray-900">
              {invoices.length}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">Open</div>
            <div className="mt-2 text-2xl font-semibold text-gray-900">
              {openCount}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">Partially Paid</div>
            <div className="mt-2 text-2xl font-semibold text-amber-700">
              {partiallyPaidCount}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">Paid</div>
            <div className="mt-2 text-2xl font-semibold text-green-700">
              {paidCount}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-lg font-medium text-gray-900">Invoice List</h2>
          </div>

          {invoices.length === 0 ? (
            <div className="p-6 text-gray-600">No invoices found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-5 py-3 font-medium">Invoice #</th>
                    <th className="px-5 py-3 font-medium">Customer</th>
                    <th className="px-5 py-3 font-medium">Invoice Date</th>
                    <th className="px-5 py-3 font-medium">Due Date</th>
                    <th className="px-5 py-3 font-medium">Amount</th>
                    <th className="px-5 py-3 font-medium">Balance Due</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-gray-50">
                      <td className="px-5 py-4 font-medium text-gray-900">
                        {invoice.invoice_number}
                      </td>
                      <td className="px-5 py-4 text-gray-700">
                        {invoice.customer_name}
                      </td>
                      <td className="px-5 py-4 text-gray-700">
                        {invoice.invoice_date}
                      </td>
                      <td className="px-5 py-4 text-gray-700">
                        {invoice.due_date ?? "-"}
                      </td>
                      <td className="px-5 py-4 text-gray-900">
                        {formatMoney(invoice.amount)}
                      </td>
                      <td className="px-5 py-4 text-gray-900">
                        {formatMoney(invoice.balance_due)}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClasses(
                            invoice.status,
                          )}`}
                        >
                          {invoice.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

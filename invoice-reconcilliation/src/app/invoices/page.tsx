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

export default async function InvoicesPage() {
  const { data, error } = await supabaseServer
    .from("invoices")
    .select("*")
    .order("invoice_date", { ascending: false });

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-bold">Invoices</h1>
        <p className="mt-4 text-red-600">
          Failed to load invoices: {error.message}
        </p>
      </main>
    );
  }

  const invoices = (data ?? []) as InvoiceRow[];

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Invoices</h1>
      <p className="mt-2 text-sm text-gray-600">
        Imported invoices from CSV: {invoices.length}
      </p>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full border border-gray-200 text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="border px-3 py-2 text-left">Invoice #</th>
              <th className="border px-3 py-2 text-left">Customer</th>
              <th className="border px-3 py-2 text-left">Invoice Date</th>
              <th className="border px-3 py-2 text-left">Due Date</th>
              <th className="border px-3 py-2 text-left">Amount</th>
              <th className="border px-3 py-2 text-left">Balance Due</th>
              <th className="border px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="border px-3 py-2">{invoice.invoice_number}</td>
                <td className="border px-3 py-2">{invoice.customer_name}</td>
                <td className="border px-3 py-2">{invoice.invoice_date}</td>
                <td className="border px-3 py-2">{invoice.due_date ?? "-"}</td>
                <td className="border px-3 py-2">{invoice.amount}</td>
                <td className="border px-3 py-2">{invoice.balance_due}</td>
                <td className="border px-3 py-2">{invoice.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

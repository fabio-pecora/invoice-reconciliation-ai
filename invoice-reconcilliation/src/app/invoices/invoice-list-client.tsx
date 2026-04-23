"use client";

import { useState } from "react";
import {
  formatInvoiceDate,
  getInvoiceDueStatus,
} from "@/lib/invoices/due-status";

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

type InvoiceListClientProps = {
  invoices: InvoiceRow[];
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
      return "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200";
    case "partially_paid":
      return "bg-amber-100 text-amber-800 ring-1 ring-amber-200";
    case "open":
    default:
      return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  }
}

function formatStatusLabel(status: string) {
  if (status === "partially_paid") {
    return "Partially Paid";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/['\s]+/g, "");
}

export default function InvoiceListClient({
  invoices,
}: InvoiceListClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dueStatusFilter, setDueStatusFilter] = useState("all");
  const [invoiceDateFrom, setInvoiceDateFrom] = useState("");
  const [invoiceDateTo, setInvoiceDateTo] = useState("");

  const filteredInvoices = invoices.filter((invoice) => {
    const normalizedQuery = normalizeText(searchQuery);
    const normalizedInvoiceNumber = normalizeText(invoice.invoice_number);
    const normalizedCustomerName = normalizeText(invoice.customer_name);
    const dueStatus = getInvoiceDueStatus({
      dueDate: invoice.due_date,
      invoiceStatus: invoice.status,
    });

    const matchesSearch =
      normalizedQuery.length === 0 ||
      normalizedInvoiceNumber.includes(normalizedQuery) ||
      normalizedCustomerName.includes(normalizedQuery);
    const matchesStatus =
      statusFilter === "all" || invoice.status === statusFilter;
    const matchesDueStatus =
      dueStatusFilter === "all" || dueStatus.id === dueStatusFilter;
    const matchesFromDate =
      invoiceDateFrom.length === 0 || invoice.invoice_date >= invoiceDateFrom;
    const matchesToDate =
      invoiceDateTo.length === 0 || invoice.invoice_date <= invoiceDateTo;

    return (
      matchesSearch &&
      matchesStatus &&
      matchesDueStatus &&
      matchesFromDate &&
      matchesToDate
    );
  });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
          <div className="min-w-0 flex-1">
            <label
              htmlFor="invoice-search"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Search
            </label>
            <input
              id="invoice-search"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search invoice number or customer"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:w-auto xl:grid-cols-[180px_180px_160px_160px]">
            <div>
              <label
                htmlFor="invoice-status-filter"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Status
              </label>
              <select
                id="invoice-status-filter"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
              >
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="partially_paid">Partially Paid</option>
                <option value="paid">Paid</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="invoice-due-filter"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Due Status
              </label>
              <select
                id="invoice-due-filter"
                value={dueStatusFilter}
                onChange={(event) => setDueStatusFilter(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
              >
                <option value="all">All</option>
                <option value="overdue">Overdue</option>
                <option value="almost_due">Almost Due</option>
                <option value="current">Current</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="invoice-date-from"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Invoice Date From
              </label>
              <input
                id="invoice-date-from"
                type="date"
                value={invoiceDateFrom}
                onChange={(event) => setInvoiceDateFrom(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label
                htmlFor="invoice-date-to"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Invoice Date To
              </label>
              <input
                id="invoice-date-to"
                type="date"
                value={invoiceDateTo}
                onChange={(event) => setInvoiceDateTo(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Invoice List
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {filteredInvoices.length} invoice
              {filteredInvoices.length === 1 ? "" : "s"} shown
            </p>
          </div>
        </div>

        {filteredInvoices.length === 0 ? (
          <div className="px-5 py-8 text-sm text-slate-600">
            No invoices match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-slate-600">
                  <th className="px-5 py-3 font-medium">Invoice #</th>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Invoice Date</th>
                  <th className="px-5 py-3 font-medium">Due Date</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Balance Due</th>
                  <th className="px-5 py-3 font-medium">Status / Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredInvoices.map((invoice) => {
                  const dueStatus = getInvoiceDueStatus({
                    dueDate: invoice.due_date,
                    invoiceStatus: invoice.status,
                  });

                  return (
                    <tr key={invoice.id} className="bg-white">
                      <td className="px-5 py-4 font-semibold text-slate-900">
                        {invoice.invoice_number}
                      </td>
                      <td className="px-5 py-4 text-slate-700">
                        {invoice.customer_name}
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {formatInvoiceDate(invoice.invoice_date)}
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {formatInvoiceDate(invoice.due_date)}
                      </td>
                      <td className="px-5 py-4 font-medium text-slate-900">
                        {formatMoney(invoice.amount)}
                      </td>
                      <td className="px-5 py-4 font-medium text-slate-900">
                        {formatMoney(invoice.balance_due)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-2">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClasses(
                              invoice.status
                            )}`}
                          >
                            {formatStatusLabel(invoice.status)}
                          </span>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${dueStatus.className}`}
                          >
                            {dueStatus.label}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

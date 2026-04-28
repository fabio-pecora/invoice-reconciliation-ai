// High level: Client form for manually creating invoices from one or more line items.
"use client";

import Link from "next/link";
import { type FormEvent, useMemo, useState } from "react";

type TaxState = "NY" | "NJ" | "CA" | "TX";

type LineItem = {
  id: string;
  description: string;
  amount: string;
};

type ManualInvoiceResponse = {
  success?: boolean;
  error?: string;
};

type FeedbackState =
  | {
      tone: "success" | "error";
      message: string;
    }
  | {
      tone: null;
      message: null;
    };

const TAX_RATES: Record<TaxState, number> = {
  NY: 0.08875,
  NJ: 0.06625,
  CA: 0.0725,
  TX: 0.0625,
};

const TAX_LABELS: Record<TaxState, string> = {
  NY: "NY (8.875%)",
  NJ: "NJ (6.625%)",
  CA: "CA (7.25%)",
  TX: "TX (6.25%)",
};

const TAX_STATES = Object.keys(TAX_RATES) as TaxState[];

const INITIAL_FORM_STATE = {
  invoice_number: "",
  customer_name: "",
  invoice_date: "",
  due_date: "",
  include_taxes: false,
  tax_state: "NY" as TaxState,
};

function createLineItem(): LineItem {
  return {
    id: crypto.randomUUID(),
    description: "",
    amount: "",
  };
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export default function ManualInvoiceForm() {
  const [formState, setFormState] = useState(INITIAL_FORM_STATE);
  const [lineItems, setLineItems] = useState<LineItem[]>([createLineItem()]);
  const [feedback, setFeedback] = useState<FeedbackState>({
    tone: null,
    message: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const subtotal = useMemo(
    () =>
      roundMoney(
        lineItems.reduce((total, lineItem) => {
          const amount = Number(lineItem.amount);
          return Number.isFinite(amount) ? total + amount : total;
        }, 0)
      ),
    [lineItems]
  );
  const tax = formState.include_taxes
    ? roundMoney(subtotal * TAX_RATES[formState.tax_state])
    : 0;
  const total = roundMoney(subtotal + tax);

  function updateField<K extends keyof typeof INITIAL_FORM_STATE>(
    field: K,
    value: (typeof INITIAL_FORM_STATE)[K]
  ) {
    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateLineItem(id: string, field: keyof LineItem, value: string) {
    setLineItems((current) =>
      current.map((lineItem) =>
        lineItem.id === id ? { ...lineItem, [field]: value } : lineItem
      )
    );
  }

  function addLineItem() {
    setLineItems((current) => [...current, createLineItem()]);
  }

  function removeLineItem(id: string) {
    setLineItems((current) =>
      current.length === 1
        ? current
        : current.filter((lineItem) => lineItem.id !== id)
    );
  }

  function validateForm(): string | null {
    if (!formState.invoice_number.trim()) {
      return "Invoice number is required.";
    }

    if (!formState.customer_name.trim()) {
      return "Customer name is required.";
    }

    if (!formState.invoice_date) {
      return "Invoice date is required.";
    }

    if (!formState.due_date) {
      return "Due date is required.";
    }

    if (lineItems.length === 0) {
      return "At least one line item is required.";
    }

    if (
      lineItems.some((lineItem) => {
        const amount = Number(lineItem.amount);
        return !Number.isFinite(amount) || amount <= 0;
      })
    ) {
      return "Line item amounts must be positive numbers.";
    }

    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const validationError = validateForm();

    if (validationError) {
      setFeedback({
        tone: "error",
        message: validationError,
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback({
      tone: null,
      message: null,
    });

    try {
      const response = await fetch("/api/invoices/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...formState,
          invoice_number: formState.invoice_number.trim(),
          customer_name: formState.customer_name.trim(),
          line_items: lineItems.map((lineItem) => ({
            description: lineItem.description.trim(),
            amount: Number(lineItem.amount),
          })),
        }),
      });

      const payload = (await response.json()) as ManualInvoiceResponse;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Failed to create invoice.");
      }

      setFormState(INITIAL_FORM_STATE);
      setLineItems([createLineItem()]);
      setFeedback({
        tone: "success",
        message: "Invoice created.",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Failed to create invoice.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-slate-500">
              Manual invoice entry
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900">
              Create an invoice
            </h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            Add invoices from line items. The invoice amount and balance due are
            calculated from the line item total.
          </p>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">
              Current total
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">Subtotal</dt>
                <dd className="mt-1 font-medium text-slate-900">
                  {formatMoney(subtotal)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Tax</dt>
                <dd className="mt-1 font-medium text-slate-900">
                  {formatMoney(tax)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Total</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {formatMoney(total)}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-900">
                Invoice number
              </span>
              <input
                type="text"
                value={formState.invoice_number}
                onChange={(event) =>
                  updateField("invoice_number", event.target.value)
                }
                disabled={isSubmitting}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                placeholder="INV-2026-001"
                required
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-900">
                Customer name
              </span>
              <input
                type="text"
                value={formState.customer_name}
                onChange={(event) =>
                  updateField("customer_name", event.target.value)
                }
                disabled={isSubmitting}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                placeholder="ACME Corp"
                required
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-900">
                Invoice date
              </span>
              <input
                type="date"
                value={formState.invoice_date}
                onChange={(event) =>
                  updateField("invoice_date", event.target.value)
                }
                disabled={isSubmitting}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                required
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-900">
                Due date
              </span>
              <input
                type="date"
                value={formState.due_date}
                onChange={(event) => updateField("due_date", event.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                required
              />
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Line items
              </h3>
              <button
                type="button"
                onClick={addLineItem}
                disabled={isSubmitting}
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add row
              </button>
            </div>

            <div className="space-y-3">
              {lineItems.map((lineItem, index) => (
                <div
                  key={lineItem.id}
                  className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_140px_auto]"
                >
                  <label className="space-y-2">
                    <span className="text-xs font-medium text-slate-600">
                      Description
                    </span>
                    <input
                      type="text"
                      value={lineItem.description}
                      onChange={(event) =>
                        updateLineItem(
                          lineItem.id,
                          "description",
                          event.target.value
                        )
                      }
                      disabled={isSubmitting}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                      placeholder={`Item ${index + 1}`}
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs font-medium text-slate-600">
                      Amount
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      value={lineItem.amount}
                      onChange={(event) =>
                        updateLineItem(lineItem.id, "amount", event.target.value)
                      }
                      disabled={isSubmitting}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                      placeholder="0.00"
                      required
                    />
                  </label>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => removeLineItem(lineItem.id)}
                      disabled={isSubmitting || lineItems.length === 1}
                      className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <input
                type="checkbox"
                checked={formState.include_taxes}
                onChange={(event) =>
                  updateField("include_taxes", event.target.checked)
                }
                disabled={isSubmitting}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-900">
                Include Taxes
              </span>
            </label>

            {formState.include_taxes ? (
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-900">
                  Tax state
                </span>
                <select
                  value={formState.tax_state}
                  onChange={(event) =>
                    updateField("tax_state", event.target.value as TaxState)
                  }
                  disabled={isSubmitting}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                >
                  {TAX_STATES.map((state) => (
                    <option key={state} value={state}>
                      {TAX_LABELS[state]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Creating invoice..." : "Create Invoice"}
            </button>
            <Link
              href="/invoices"
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              View Invoices
            </Link>
          </div>

          {feedback.message ? (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                feedback.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              <div>{feedback.message}</div>
              {feedback.tone === "success" ? (
                <div className="mt-1">
                  View it in{" "}
                  <Link
                    href="/invoices"
                    className="font-medium text-emerald-900 underline"
                  >
                    Invoices
                  </Link>
                  .
                </div>
              ) : null}
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}

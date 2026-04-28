// High level: Client form for manually creating incoming or outgoing transaction records.
"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

type TransactionDirection = "incoming" | "outgoing";

type ManualTransactionResponse = {
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

const INITIAL_FORM_STATE = {
  name: "",
  date: "",
  amount: "",
  direction: "incoming" as TransactionDirection,
};

export default function ManualTransactionForm() {
  const [formState, setFormState] = useState(INITIAL_FORM_STATE);
  const [feedback, setFeedback] = useState<FeedbackState>({
    tone: null,
    message: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField<K extends keyof typeof INITIAL_FORM_STATE>(
    field: K,
    value: (typeof INITIAL_FORM_STATE)[K]
  ) {
    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function validateForm(): string | null {
    if (!formState.name.trim()) {
      return "Transaction name is required.";
    }

    if (!formState.date) {
      return "Date is required.";
    }

    const amount = Number(formState.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return "Amount must be greater than 0.";
    }

    if (!formState.direction) {
      return "Direction is required.";
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
      const response = await fetch("/api/transactions/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: formState.name.trim(),
          date: formState.date,
          amount: Number(formState.amount),
          direction: formState.direction,
        }),
      });

      const payload = (await response.json()) as ManualTransactionResponse;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Failed to save manual transaction.");
      }

      setFormState(INITIAL_FORM_STATE);
      setFeedback({
        tone: "success",
        message: "Manual transaction saved as pending.",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to save manual transaction.",
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
              Manual transaction entry
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900">
              Add a transaction without Plaid
            </h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            Manual entries are saved as pending transactions and can be
            processed from Reconciliation.
          </p>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">
              Amount handling
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Enter a positive amount. Incoming transactions are stored as
              negative amounts, and outgoing transactions are stored as
              positive amounts.
            </p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 sm:col-span-2">
              <span className="text-sm font-medium text-slate-900">
                Transaction name
              </span>
              <input
                type="text"
                value={formState.name}
                onChange={(event) => updateField("name", event.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                placeholder="ACME Payment"
                required
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-900">Date</span>
              <input
                type="date"
                value={formState.date}
                onChange={(event) => updateField("date", event.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                required
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-900">
                Direction
              </span>
              <select
                value={formState.direction}
                onChange={(event) =>
                  updateField(
                    "direction",
                    event.target.value as TransactionDirection
                  )
                }
                disabled={isSubmitting}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                required
              >
                <option value="incoming">Incoming</option>
                <option value="outgoing">Outgoing</option>
              </select>
            </label>

            <label className="space-y-2 sm:col-span-2">
              <span className="text-sm font-medium text-slate-900">Amount</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={formState.amount}
                onChange={(event) => updateField("amount", event.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                placeholder="12.00"
                required
              />
            </label>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Saving..." : "Save Manual Transaction"}
            </button>
            <Link
              href="/reconciliation"
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              Open Reconciliation
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
                    href="/reconciliation"
                    className="font-medium text-emerald-900 underline"
                  >
                    Reconciliation
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

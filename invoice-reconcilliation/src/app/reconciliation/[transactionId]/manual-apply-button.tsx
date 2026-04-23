"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type ManualApplyButtonProps = {
  transactionId: string;
  invoiceId: string;
};

type ManualApplyResponse = {
  success?: boolean;
  message?: string;
  error?: string;
};

export default function ManualApplyButton({
  transactionId,
  invoiceId,
}: ManualApplyButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();

  const isPending = isSubmitting || isRefreshing;

  async function handleClick() {
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/matches/manual-apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transactionId,
          invoiceId,
        }),
      });

      const payload = (await response.json()) as ManualApplyResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to apply payment.");
      }

      setSuccess(payload.message ?? "Payment applied. Refreshing...");
      startRefresh(() => {
        router.refresh();
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to apply payment."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Applying..." : "Apply to This Invoice"}
      </button>

      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

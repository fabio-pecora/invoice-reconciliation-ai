// High level: Client button that triggers automatic matching for all pending transactions.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ProcessPendingTransactionsButtonProps = {
  pendingCount: number;
  pendingOutgoingCount: number;
};

type RunAllResponse = {
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

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export default function ProcessPendingTransactionsButton({
  pendingCount,
  pendingOutgoingCount,
}: ProcessPendingTransactionsButtonProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<FeedbackState>({
    tone: null,
    message: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (pendingCount === 0) {
    return null;
  }

  async function handleClick() {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setFeedback({
      tone: null,
      message: null,
    });

    try {
      const response = await fetch("/api/matches/run-all", {
        method: "POST",
      });
      const payload = (await response.json()) as RunAllResponse;

      if (!response.ok || !payload.success) {
        throw new Error(
          payload.error ?? "Failed to process pending transactions."
        );
      }

      setFeedback({
        tone: "success",
        message: "Pending transactions processed.",
      });

      await wait(400);
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to process pending transactions.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        className="inline-flex items-center justify-center rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Processing..." : "Process Pending Transactions"}
      </button>

      {pendingOutgoingCount > 0 ? (
        <p className="text-xs text-slate-500">
          Includes {pendingOutgoingCount} pending outgoing transaction
          {pendingOutgoingCount === 1 ? "" : "s"}.
        </p>
      ) : null}

      {feedback.message ? (
        <p
          className={`text-sm ${
            feedback.tone === "success" ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}

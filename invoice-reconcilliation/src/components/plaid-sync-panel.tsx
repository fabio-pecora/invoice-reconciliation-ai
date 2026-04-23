"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  PlaidSyncRunRow,
  PlaidSyncRunSummary,
} from "@/lib/plaid/sync-run-types";

type PlaidSyncPanelProps = {
  initialSyncRun: PlaidSyncRunRow | null;
};

type SyncFeedback =
  | {
      tone: "info" | "success" | "error";
      message: string;
    }
  | {
      tone: null;
      message: null;
    };

type SyncResponsePayload = {
  success?: boolean;
  error?: string;
  sync_run?: PlaidSyncRunRow | null;
  sync_summary?: PlaidSyncRunSummary;
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function buildSummaryFromRun(
  syncRun: PlaidSyncRunRow | null
): PlaidSyncRunSummary | null {
  if (!syncRun) {
    return null;
  }

  return {
    attempt: 0,
    date_range: {
      start_date: "",
      end_date: "",
    },
    fetched_count: syncRun.fetched_count,
    saved_count: syncRun.new_count,
    new_count: syncRun.new_count,
    processed_count: syncRun.processed_count,
    matched_count: syncRun.matched_count,
    review_needed_count: syncRun.review_needed_count,
    unmatched_count: syncRun.unmatched_count,
    failed_processing_count: 0,
  };
}

function buildSummaryText(summary: PlaidSyncRunSummary | null): string | null {
  if (!summary) {
    return null;
  }

  return `Last sync: ${summary.fetched_count} fetched, ${summary.new_count} new, ${summary.processed_count} processed`;
}

function getStatusBadgeClass(status: PlaidSyncRunRow["status"] | "idle"): string {
  if (status === "success") {
    return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
  }

  if (status === "failed") {
    return "bg-red-100 text-red-800 ring-1 ring-red-200";
  }

  if (status === "running") {
    return "bg-blue-100 text-blue-800 ring-1 ring-blue-200";
  }

  return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

function formatStatusLabel(status: PlaidSyncRunRow["status"] | "idle"): string {
  if (status === "success") {
    return "Success";
  }

  if (status === "failed") {
    return "Failed";
  }

  if (status === "running") {
    return "Running";
  }

  return "Not synced";
}

export default function PlaidSyncPanel({
  initialSyncRun,
}: PlaidSyncPanelProps) {
  const router = useRouter();
  const [syncRun, setSyncRun] = useState<PlaidSyncRunRow | null>(initialSyncRun);
  const [summary, setSummary] = useState<PlaidSyncRunSummary | null>(
    buildSummaryFromRun(initialSyncRun)
  );
  const [feedback, setFeedback] = useState<SyncFeedback>({
    tone: null,
    message: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();

  const isPending = isSubmitting || isRefreshing;
  const latestStatus = syncRun?.status ?? "idle";
  const lastSyncedAt = syncRun?.completed_at ?? syncRun?.started_at ?? null;

  async function handleSyncClick() {
    if (isPending) {
      return;
    }

    setFeedback({ tone: null, message: null });
    setIsSubmitting(true);
    setSyncRun((currentRun) =>
      currentRun
        ? {
            ...currentRun,
            status: "running",
            started_at: new Date().toISOString(),
          }
        : {
            id: "pending-sync",
            source: "plaid_sandbox",
            started_at: new Date().toISOString(),
            completed_at: null,
            status: "running",
            fetched_count: 0,
            new_count: 0,
            processed_count: 0,
            matched_count: 0,
            review_needed_count: 0,
            unmatched_count: 0,
            error_message: null,
            created_at: new Date().toISOString(),
          }
    );
    setFeedback({
      tone: "info",
      message: "Syncing transactions...",
    });

    try {
      const response = await fetch("/api/plaid/sandbox-transactions", {
        method: "POST",
      });
      const payload = (await response.json()) as SyncResponsePayload;

      if (payload.sync_run !== undefined) {
        setSyncRun(payload.sync_run);
      }

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Failed to sync transactions.");
      }

      const nextSummary =
        payload.sync_summary ?? buildSummaryFromRun(payload.sync_run ?? null);

      setSummary(nextSummary);
      setFeedback({
        tone: "success",
        message:
          buildSummaryText(nextSummary) ??
          "Transactions synced successfully.",
      });

      startRefresh(() => {
        router.refresh();
      });
    } catch (error) {
      setSummary(buildSummaryFromRun(syncRun));
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to sync transactions.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">
              Plaid Sandbox Sync
            </h2>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(
                latestStatus
              )}`}
            >
              {formatStatusLabel(latestStatus)}
            </span>
          </div>

          <p className="max-w-3xl text-sm text-slate-600">
            Fetches the last 30 days of transactions from Plaid sandbox and
            automatically processes newly inserted items.
          </p>
          <p className="text-sm text-slate-500">
            Last synced: {formatTimestamp(lastSyncedAt)}
          </p>
          {buildSummaryText(summary) ? (
            <p className="text-sm text-slate-700">{buildSummaryText(summary)}</p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleSyncClick}
          disabled={isPending}
          aria-busy={isPending}
          className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending
            ? "Syncing transactions..."
            : "Sync Transactions from Plaid Sandbox"}
        </button>
      </div>

      {feedback.message ? (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            feedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : feedback.tone === "info"
                ? "border-blue-200 bg-blue-50 text-blue-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      {syncRun?.status === "failed" && syncRun.error_message ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          Most recent sync failed: {syncRun.error_message}
        </div>
      ) : null}
    </section>
  );
}

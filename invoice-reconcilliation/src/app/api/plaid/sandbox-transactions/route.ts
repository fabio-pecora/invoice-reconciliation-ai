import { NextResponse } from "next/server";
import { Products } from "plaid";
import { runAutomaticMatchingForTransactions } from "@/lib/matching/process-new-transactions";
import { plaidClient } from "@/lib/plaid/client";
import {
  completePlaidSyncRun,
  createPlaidSyncRun,
  failPlaidSyncRun,
} from "@/lib/plaid/sync-runs";
import { PlaidSyncRunSummary } from "@/lib/plaid/sync-run-types";
import { supabaseServer } from "@/lib/supabase/server";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(date: Date) {
  return date.toISOString().split("T")[0];
}

function normalizeDirection(amount: number): "incoming" | "outgoing" {
  return amount < 0 ? "incoming" : "outgoing";
}

function getSandboxErrorResponse(error: unknown): {
  message: string;
  details: unknown;
} {
  if (typeof error === "object" && error !== null) {
    const message =
      "message" in error && typeof error.message === "string"
        ? error.message
        : "Unknown sandbox error";

    if ("response" in error) {
      const response = error.response;

      if (typeof response === "object" && response !== null && "data" in response) {
        const details = response.data;

        if (
          typeof details === "object" &&
          details !== null &&
          "error_message" in details &&
          typeof details.error_message === "string"
        ) {
          return {
            message: details.error_message,
            details,
          };
        }

        return {
          message,
          details,
        };
      }
    }

    return {
      message,
      details: null,
    };
  }

  return {
    message: "Unknown sandbox error",
    details: null,
  };
}

async function handleSandboxTransactionsSync() {
  const syncRun = await createPlaidSyncRun();

  try {
    const sandboxResponse = await plaidClient.sandboxPublicTokenCreate({
      institution_id: "ins_109508",
      initial_products: [Products.Transactions],
      options: {
        webhook: "https://example.com/webhook",
      },
    });

    const publicToken = sandboxResponse.data.public_token;

    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const accessToken = exchangeResponse.data.access_token;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 30);

    const formattedStartDate = formatDate(startDate);
    const formattedEndDate = formatDate(endDate);

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        if (attempt > 1) {
          await sleep(2000);
        }

        const transactionsResponse = await plaidClient.transactionsGet({
          access_token: accessToken,
          start_date: formattedStartDate,
          end_date: formattedEndDate,
          options: {
            count: 50,
            offset: 0,
          },
        });

        const normalizedTransactions = transactionsResponse.data.transactions.map(
          (tx) => ({
            plaid_transaction_id: tx.transaction_id,
            date: tx.date,
            name: tx.name,
            amount: Number(tx.amount),
            direction: normalizeDirection(Number(tx.amount)),
          })
        );

        const plaidTransactionIds = normalizedTransactions.map(
          (transaction) => transaction.plaid_transaction_id
        );
        const { data: existingTransactions, error: existingTransactionsError } =
          await supabaseServer
            .from("transactions")
            .select("id, plaid_transaction_id")
            .in("plaid_transaction_id", plaidTransactionIds);

        if (existingTransactionsError) {
          throw existingTransactionsError;
        }

        const existingPlaidTransactionIds = new Set(
          (existingTransactions ?? []).map(
            (transaction) => transaction.plaid_transaction_id as string
          )
        );

        const { data: insertedRows, error: insertError } = await supabaseServer
          .from("transactions")
          .upsert(normalizedTransactions, {
            onConflict: "plaid_transaction_id",
          })
          .select("id, plaid_transaction_id, date, name, amount, direction");

        if (insertError) {
          throw insertError;
        }

        const newTransactions = (insertedRows ?? []).filter(
          (transaction) =>
            !existingPlaidTransactionIds.has(transaction.plaid_transaction_id as string)
        );
        const automaticMatchSummary = await runAutomaticMatchingForTransactions(
          newTransactions.map((transaction) => transaction.id as string)
        );
        const syncSummary: PlaidSyncRunSummary = {
          attempt,
          date_range: {
            start_date: formattedStartDate,
            end_date: formattedEndDate,
          },
          fetched_count: normalizedTransactions.length,
          saved_count: insertedRows?.length ?? 0,
          new_count: newTransactions.length,
          processed_count: automaticMatchSummary.succeeded,
          matched_count: automaticMatchSummary.matched,
          review_needed_count: automaticMatchSummary.reviewNeeded,
          unmatched_count: automaticMatchSummary.unmatched,
          failed_processing_count: automaticMatchSummary.failed,
        };
        const completedSyncRun = await completePlaidSyncRun({
          syncRunId: syncRun.id,
          fetched_count: syncSummary.fetched_count,
          new_count: syncSummary.new_count,
          processed_count: syncSummary.processed_count,
          matched_count: syncSummary.matched_count,
          review_needed_count: syncSummary.review_needed_count,
          unmatched_count: syncSummary.unmatched_count,
        });

        return NextResponse.json({
          success: true,
          sync_run: completedSyncRun,
          sync_summary: syncSummary,
          auto_match: automaticMatchSummary,
          transactions: insertedRows ?? [],
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  } catch (error) {
    const sandboxError = getSandboxErrorResponse(error);

    console.error(
      "Sandbox transactions error:",
      sandboxError.details ?? error
    );

    return NextResponse.json(
      {
        success: false,
        error: sandboxError.message,
        details: sandboxError.details,
        sync_run: await failPlaidSyncRun({
          syncRunId: syncRun.id,
          errorMessage: sandboxError.message,
        }),
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return handleSandboxTransactionsSync();
}

export async function POST() {
  return handleSandboxTransactionsSync();
}

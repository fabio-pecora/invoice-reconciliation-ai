import { NextResponse } from "next/server";
import { runAutomaticMatchingForTransactions } from "@/lib/matching/process-new-transactions";
import { supabaseServer } from "@/lib/supabase/server";

type TransactionIdOnly = {
  id: string;
};

type MatchTransactionIdOnly = {
  transaction_id: string;
};

export async function POST() {
  try {
    const [
      { data: transactions, error: transactionsError },
      { data: matches, error: matchesError },
    ] = await Promise.all([
      supabaseServer
        .from("transactions")
        .select("id")
        .order("date", { ascending: true }),
      supabaseServer.from("matches").select("transaction_id"),
    ]);

    if (transactionsError) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to load transactions: ${transactionsError.message}`,
        },
        { status: 500 }
      );
    }

    if (matchesError) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to load match results: ${matchesError.message}`,
        },
        { status: 500 }
      );
    }

    const matchedTransactionIds = new Set(
      ((matches ?? []) as MatchTransactionIdOnly[]).map(
        (match) => match.transaction_id
      )
    );
    const pendingTransactionIds = ((transactions ?? []) as TransactionIdOnly[])
      .map((transaction) => transaction.id)
      .filter((transactionId) => !matchedTransactionIds.has(transactionId));
    const summary = await runAutomaticMatchingForTransactions(
      pendingTransactionIds
    );

    return NextResponse.json({
      success: true,
      processed_count: summary.processed,
      matched_count: summary.matched,
      review_needed_count: summary.reviewNeeded,
      unmatched_count: summary.unmatched,
      failed_count: summary.failed,
      results: summary.results,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

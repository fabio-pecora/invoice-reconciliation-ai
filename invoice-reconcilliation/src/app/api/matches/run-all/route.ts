import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { runTransactionMatch } from "@/lib/matching/run-transaction-match";

type TransactionIdOnly = {
  id: string;
};

type RunAllResultItem =
  | {
      transactionId: string;
      success: true;
      existing: boolean;
      matchId: string;
      matchStatus: "matched" | "partially_matched" | "unmatched";
      allocationCount: number;
    }
  | {
      transactionId: string;
      success: false;
      error: string;
    };

export async function POST() {
  try {
    const { data, error } = await supabaseServer
      .from("transactions")
      .select("id")
      .order("date", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: `Failed to load transactions: ${error.message}` },
        { status: 500 }
      );
    }

    const transactions = (data ?? []) as TransactionIdOnly[];
    const results: RunAllResultItem[] = [];

    let succeeded = 0;
    let failed = 0;
    let existing = 0;
    let created = 0;
    let matched = 0;
    let partiallyMatched = 0;
    let unmatched = 0;

    for (const transaction of transactions) {
      try {
        const result = await runTransactionMatch(transaction.id);

        succeeded += 1;

        if (result.existing) {
          existing += 1;
        } else {
          created += 1;
        }

        if (result.match.status === "matched") {
          matched += 1;
        } else if (result.match.status === "partially_matched") {
          partiallyMatched += 1;
        } else {
          unmatched += 1;
        }

        results.push({
          transactionId: transaction.id,
          success: true,
          existing: result.existing,
          matchId: result.match.id,
          matchStatus: result.match.status,
          allocationCount: result.allocations.length,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown server error";

        failed += 1;
        results.push({
          transactionId: transaction.id,
          success: false,
          error: message,
        });
      }
    }

    return NextResponse.json({
      processed: transactions.length,
      succeeded,
      failed,
      existing,
      created,
      matched,
      partially_matched: partiallyMatched,
      unmatched,
      results,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

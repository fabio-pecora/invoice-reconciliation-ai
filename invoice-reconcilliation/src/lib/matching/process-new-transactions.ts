// High level: Runs automatic matching for a batch of transaction IDs and summarizes the outcomes.
import { MatchStatus } from "@/lib/matching/match-status";
import { runTransactionMatch } from "@/lib/matching/run-transaction-match";

type AutomaticMatchResultItem =
  | {
      transactionId: string;
      success: true;
      existing: boolean;
      matchId: string;
      matchStatus: MatchStatus;
      allocationCount: number;
    }
  | {
      transactionId: string;
      success: false;
      error: string;
    };

export type AutomaticMatchRunSummary = {
  processed: number;
  succeeded: number;
  failed: number;
  matched: number;
  reviewNeeded: number;
  unmatched: number;
  results: AutomaticMatchResultItem[];
};

export async function runAutomaticMatchingForTransactions(
  transactionIds: string[]
): Promise<AutomaticMatchRunSummary> {
  const uniqueTransactionIds = [...new Set(transactionIds)];
  const results: AutomaticMatchResultItem[] = [];

  let succeeded = 0;
  let failed = 0;
  let matched = 0;
  let reviewNeeded = 0;
  let unmatched = 0;

  for (const transactionId of uniqueTransactionIds) {
    try {
      const result = await runTransactionMatch(transactionId);

      succeeded += 1;

      if (
        result.match.status === "matched" ||
        result.match.status === "partially_matched"
      ) {
        matched += 1;
      } else if (result.match.status === "human_review_needed") {
        reviewNeeded += 1;
      } else {
        unmatched += 1;
      }

      results.push({
        transactionId,
        success: true,
        existing: result.existing,
        matchId: result.match.id,
        matchStatus: result.match.status,
        allocationCount: result.allocations.length,
      });
    } catch (error) {
      failed += 1;
      results.push({
        transactionId,
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown automatic match error",
      });
    }
  }

  return {
    processed: uniqueTransactionIds.length,
    succeeded,
    failed,
    matched,
    reviewNeeded,
    unmatched,
    results,
  };
}

export type MatchStatus =
  | "matched"
  | "partially_matched"
  | "unmatched"
  | "human_review_needed";

export type MatchRow = {
  id: string;
  transaction_id: string;
  status: MatchStatus;
  confidence: number;
  reason: string;
};

export function formatMatchStatusLabel(status: MatchStatus | "pending"): string {
  switch (status) {
    case "matched":
      return "Matched";
    case "partially_matched":
      return "Partially Matched";
    case "human_review_needed":
      return "Review Needed";
    case "unmatched":
      return "Unmatched";
    case "pending":
      return "Pending";
  }
}

export function isAppliedMatchStatus(status: MatchStatus): boolean {
  return status === "matched" || status === "partially_matched";
}

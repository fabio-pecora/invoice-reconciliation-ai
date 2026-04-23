import {
  formatMatchStatusLabel,
  MatchRow,
  MatchStatus,
} from "@/lib/matching/match-status";

export type MatchOrigin =
  | "Deterministic"
  | "LLM-assisted"
  | "Review Queue"
  | "Unmatched";

export function inferMatchOrigin(match: MatchRow | null): MatchOrigin | null {
  if (!match) {
    return null;
  }

  if (match.status === "human_review_needed") {
    return "Review Queue";
  }

  if (match.status === "unmatched") {
    return "Unmatched";
  }

  return match.reason.includes("LLM-assisted")
    ? "LLM-assisted"
    : "Deterministic";
}

export function getStatusBadgeClass(status: MatchStatus | "pending"): string {
  if (status === "matched") {
    return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
  }

  if (status === "partially_matched") {
    return "bg-amber-100 text-amber-900 ring-1 ring-amber-200";
  }

  if (status === "human_review_needed") {
    return "bg-orange-100 text-orange-900 ring-1 ring-orange-200";
  }

  if (status === "unmatched") {
    return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  }

  return "bg-blue-100 text-blue-800 ring-1 ring-blue-200";
}

export function getOriginBadgeClass(origin: MatchOrigin | null): string {
  if (origin === "LLM-assisted") {
    return "bg-violet-100 text-violet-800 ring-1 ring-violet-200";
  }

  if (origin === "Review Queue") {
    return "bg-orange-100 text-orange-900 ring-1 ring-orange-200";
  }

  if (origin === "Deterministic") {
    return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
  }

  if (origin === "Unmatched") {
    return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  }

  return "bg-blue-100 text-blue-800 ring-1 ring-blue-200";
}

export function getMatchActionLabel(match: MatchRow | null): string {
  if (!match) {
    return "Review";
  }

  if (match.status === "human_review_needed") {
    return "Review";
  }

  return "View Details";
}

export function getShortMatchExplanation(match: MatchRow | null): string {
  if (!match) {
    return "No persisted reconciliation decision yet.";
  }

  return match.reason;
}

export function getMatchOutcomeHeading(status: MatchStatus | "pending"): string {
  if (status === "matched") {
    return "Payment Applied";
  }

  if (status === "partially_matched") {
    return "Payment Partially Applied";
  }

  if (status === "human_review_needed") {
    return "Human Review Required";
  }

  if (status === "unmatched") {
    return "No Invoice Applied";
  }

  return `${formatMatchStatusLabel(status)} Outcome`;
}

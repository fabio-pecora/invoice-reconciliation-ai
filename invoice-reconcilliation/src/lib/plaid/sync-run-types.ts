// High level: Defines TypeScript shapes for persisted Plaid sync runs and runtime sync summaries.
export type PlaidSyncRunStatus = "running" | "success" | "failed";

export type PlaidSyncRunRow = {
  id: string;
  source: string;
  started_at: string;
  completed_at: string | null;
  status: PlaidSyncRunStatus;
  fetched_count: number;
  new_count: number;
  processed_count: number;
  matched_count: number;
  review_needed_count: number;
  unmatched_count: number;
  error_message: string | null;
  created_at: string;
};

export type PlaidSyncRunSummary = {
  attempt: number;
  date_range: {
    start_date: string;
    end_date: string;
  };
  fetched_count: number;
  saved_count: number;
  new_count: number;
  processed_count: number;
  matched_count: number;
  review_needed_count: number;
  unmatched_count: number;
  failed_processing_count: number;
};

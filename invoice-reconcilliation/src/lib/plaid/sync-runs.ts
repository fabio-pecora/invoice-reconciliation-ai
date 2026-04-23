import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { PlaidSyncRunRow } from "@/lib/plaid/sync-run-types";

type CompletePlaidSyncRunInput = {
  syncRunId: string;
  fetched_count: number;
  new_count: number;
  processed_count: number;
  matched_count: number;
  review_needed_count: number;
  unmatched_count: number;
};

function castPlaidSyncRunRow(data: unknown): PlaidSyncRunRow {
  return data as PlaidSyncRunRow;
}

export async function createPlaidSyncRun(): Promise<PlaidSyncRunRow> {
  const { data, error } = await supabaseServer
    .from("plaid_sync_runs")
    .insert({
      source: "sandbox",
      status: "running",
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create Plaid sync run: ${error.message}`);
  }

  return castPlaidSyncRunRow(data);
}

export async function completePlaidSyncRun(
  input: CompletePlaidSyncRunInput
): Promise<PlaidSyncRunRow> {
  const { data, error } = await supabaseServer
    .from("plaid_sync_runs")
    .update({
      status: "success",
      completed_at: new Date().toISOString(),
      fetched_count: input.fetched_count,
      new_count: input.new_count,
      processed_count: input.processed_count,
      matched_count: input.matched_count,
      review_needed_count: input.review_needed_count,
      unmatched_count: input.unmatched_count,
      error_message: null,
    })
    .eq("id", input.syncRunId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to complete Plaid sync run: ${error.message}`);
  }

  return castPlaidSyncRunRow(data);
}

export async function failPlaidSyncRun(input: {
  syncRunId: string;
  errorMessage: string;
}): Promise<PlaidSyncRunRow> {
  const { data, error } = await supabaseServer
    .from("plaid_sync_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: input.errorMessage,
    })
    .eq("id", input.syncRunId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to fail Plaid sync run: ${error.message}`);
  }

  return castPlaidSyncRunRow(data);
}

export async function getLatestPlaidSyncRun(): Promise<PlaidSyncRunRow | null> {
  const { data, error } = await supabaseServer
    .from("plaid_sync_runs")
    .select("*")
    .eq("source", "sandbox")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load latest Plaid sync run: ${error.message}`);
  }

  return data ? castPlaidSyncRunRow(data) : null;
}

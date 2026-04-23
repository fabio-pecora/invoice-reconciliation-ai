create extension if not exists pgcrypto;

create table if not exists public.plaid_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'sandbox',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  fetched_count integer not null default 0 check (fetched_count >= 0),
  new_count integer not null default 0 check (new_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  matched_count integer not null default 0 check (matched_count >= 0),
  review_needed_count integer not null default 0 check (review_needed_count >= 0),
  unmatched_count integer not null default 0 check (unmatched_count >= 0),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists plaid_sync_runs_source_created_at_idx
  on public.plaid_sync_runs (source, created_at desc);

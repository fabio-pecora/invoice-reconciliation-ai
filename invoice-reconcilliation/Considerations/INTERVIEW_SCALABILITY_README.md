# Invoice Reconciliation Interview Study README

## What This Project Is

This project is an invoice reconciliation system built with Next.js, Supabase, Plaid, and OpenAI.

Its main flow is:

1. Import invoices into `invoices`.
2. Ingest bank transactions into `transactions`.
3. Match incoming payments to open invoices.
4. Persist the reconciliation decision in `matches`.
5. Persist applied dollars in `allocations`.
6. Update invoice balances and statuses.

That is the right business direction. The domain model is meaningful, and the project already has the correct high-level accounting shape:

- `transactions` = money events
- `matches` = reconciliation decisions
- `allocations` = actual payment applications
- `invoices` = receivables

That separation is one of the strongest parts of the repo.

## Executive Conclusion

The weakest part of the project, by far, is the **automatic matching pipeline**, centered on:

- [src/app/api/matches/run-all/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/matches/run-all/route.ts:13)
- [src/lib/matching/process-new-transactions.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/process-new-transactions.ts:29)
- [src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:1286)
- [src/lib/matching/candidate-engine.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/candidate-engine.ts:314)

If you need one single file to point to in an interview, point to:

- [src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:1)

It is the weakest single unit in the repo because it combines:

- database reads
- candidate generation
- business rules
- ambiguity resolution
- LLM invocation
- allocation planning
- persistence
- manual apply
- rollback behavior

That is both a **scalability problem** and a **code quality problem**.

## The Exact Problematic Code

### 1. Full-table reads to find pending transactions

[src/app/api/matches/run-all/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/matches/run-all/route.ts:15)

```ts
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

const matchedTransactionIds = new Set(
  ((matches ?? []) as MatchTransactionIdOnly[]).map(
    (match) => match.transaction_id
  )
);
const pendingTransactionIds = ((transactions ?? []) as TransactionIdOnly[])
  .map((transaction) => transaction.id)
  .filter((transactionId) => !matchedTransactionIds.has(transactionId));
```

Why this is bad:

- It loads all transactions.
- It loads all matches.
- It computes "pending" in application memory.
- It scales linearly with table size even before any matching work starts.

At 100k or 1M rows, this becomes slow, memory-heavy, and expensive.

### 2. Sequential request-bound processing

[src/lib/matching/process-new-transactions.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/process-new-transactions.ts:41)

```ts
for (const transactionId of uniqueTransactionIds) {
  const result = await runTransactionMatch(transactionId);
}
```

Why this is bad:

- Every transaction is processed one at a time.
- One slow transaction blocks the whole batch.
- One LLM call can hold up the entire HTTP request.
- There is no queue, no worker model, no bounded concurrency, and no retry policy.

This is not acceptable for large-scale reconciliation.

### 3. Every transaction loads all eligible invoices

[src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:202)

```ts
async function fetchEligibleInvoices(): Promise<InvoiceRow[]> {
  const { data, error } = await supabaseServer
    .from("invoices")
    .select("*")
    .in("status", ["open", "partially_paid"])
    .gt("balance_due", 0)
    .order("invoice_date", { ascending: false });
```

[src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:1310)

```ts
const invoices = await fetchEligibleInvoices();
const candidates = buildCandidates(transaction, invoices);
```

Why this is bad:

- The system reads the entire open invoice set for each transaction.
- Matching work grows with the number of open invoices.
- This is repeated across every pending transaction.

That means the core matching complexity is effectively:

- `O(number_of_pending_transactions * number_of_open_invoices)`

For example:

- 10,000 pending transactions
- 100,000 open invoices

This creates up to 1,000,000,000 invoice-scoring comparisons in application code.

That is the main scalability failure.

### 4. In-memory scoring and sorting of the invoice universe

[src/lib/matching/candidate-engine.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/candidate-engine.ts:322)

```ts
return invoices
  .map((invoice) => {
    // score every invoice
  })
  .filter((candidate) => candidate.name_score >= NAME_FILTER_MIN_SCORE)
  .sort((a, b) => {
    if (b.name_score !== a.name_score) {
      return b.name_score - a.name_score;
    }

    if (b.amount_score !== a.amount_score) {
      return b.amount_score - a.amount_score;
    }

    return b.score - a.score;
  })
  .slice(0, 10);
```

Why this is bad:

- It scores every eligible invoice in memory.
- It sorts the candidate list in memory.
- It only keeps 10 results at the end, after doing work for all rows.

For small demo data this is fine. For production scale it is not.

### 5. Non-atomic financial writes

[src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:953)

```ts
const insertResult = await insertMatchOrGetExisting(...);

for (const plannedAllocation of input.allocations) {
  const allocation = await insertAllocation(...);
  await updateInvoiceBalance(...);
}
```

And manual apply uses application-level rollback:

[src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:998)

Why this is bad:

- Match insert, allocation insert, and invoice balance update are separate calls.
- There is no database transaction across the whole payment application.
- If one step fails, the system can partially mutate financial state.
- Manual rollback in application code is weaker than a real database transaction.

This is more of a correctness and reliability issue than a pure scaling issue, but for a real system it is just as important.

## Why This Is the Weakest Part

This area is the weakest because it fails on both of the dimensions interviewers care about most:

### Scalability weakness

The current design does not reduce the search space before matching.

Instead it:

1. reads all pending transactions
2. reads all open invoices per transaction
3. scores everything in memory
4. processes sequentially in a request

That approach is acceptable for a take-home demo with maybe:

- dozens of invoices
- dozens of transactions

It breaks down for:

- 100k invoices
- 1M invoices
- many concurrent users
- real batch reconciliation windows

### Code quality weakness

[src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:1) is also too large and too mixed in responsibility.

It contains:

- data access functions
- threshold configuration
- candidate assessment
- exact-match combination search
- persistence
- error handling
- rollback
- manual apply logic
- LLM-assisted flow

That makes it:

- hard to test
- hard to reason about
- hard to extend safely
- hard to isolate failures
- easy to break during refactoring

## What Will Break at 100,000 or 1,000,000 Users

### At 100,000 invoices / moderate traffic

You will start seeing:

- slow matching latency
- large Supabase reads
- long API response times
- dashboard timeouts
- expensive CPU work in Node
- growing contention on invoice updates

### At 1,000,000 invoices / high traffic

You will likely see:

- HTTP timeouts on batch routes
- memory pressure from full-table result sets
- poor user experience from synchronous processing
- high DB read amplification
- LLM latency magnifying request times
- race conditions around concurrent matching/apply
- inconsistent balances from non-atomic writes under failure

### With many organizations/users

The design becomes even worse because the repo does not yet show:

- tenant scoping
- row-level security strategy
- organization-aware indexes
- background-job isolation

So the current matching pipeline would not just be slow. It would be structurally wrong for a multi-tenant production system.

## The Root Cause

The root cause is that the system currently treats matching as an **inline request-time loop over raw tables**, instead of as a **search-and-apply pipeline**.

A scalable reconciliation system should do this:

1. identify a small set of candidate transactions
2. identify a small set of candidate invoices
3. score only that reduced set
4. persist the result atomically
5. do all heavy work in background jobs

The current system does the opposite:

1. fetch broad sets
2. score broadly
3. process synchronously
4. write in multiple steps

## The Correct Design for 100k to 1M Users

### 1. Move matching out of the HTTP request path

Replace:

- `POST /api/matches/run-all` doing the whole batch inline

With:

- `POST /api/matches/run-all` creating a `reconciliation_run`
- a background worker processing jobs in batches
- a status endpoint or live progress UI

Why:

- no request timeout risk
- retries become possible
- throughput can be controlled
- concurrency can be tuned safely

### 2. Stop loading all invoices for every transaction

Replace:

- full eligible invoice fetch

With:

- indexed database prefiltering
- candidate search by organization, customer token, due window, amount band, invoice number fragments, or customer aliases
- return only a bounded candidate set, for example top 20 to 100 rows before scoring

A better approach:

1. Extract likely customer tokens from transaction text.
2. Query only invoices in the same tenant with `status in ('open', 'partially_paid')`.
3. Restrict by searchable name fields or trigram/full-text indexes.
4. Restrict by amount tolerance window.
5. Restrict by recency window when appropriate.
6. Score only the resulting shortlist in application code.

This changes the problem from:

- scan everything

to:

- search a narrowed candidate set

That is the single most important scalability improvement.

### 3. Add real database transactions for payment application

Replace:

- separate `insert match`
- separate `insert allocation`
- separate `update invoice`
- manual rollback in app code

With:

- one Postgres transaction or one Supabase RPC / stored procedure

That transaction should:

1. lock the target invoice rows
2. re-check eligibility and balances
3. insert the match
4. insert allocations
5. update invoice balances
6. write audit rows
7. commit or fail as one unit

Why:

- prevents partial financial writes
- handles concurrency correctly
- reduces data corruption risk
- makes retries safer

### 4. Split `run-transaction-match.ts` into smaller units

Recommended split:

- `match-repository.ts`
  - all reads/writes
- `candidate-search.ts`
  - DB prefiltering
- `candidate-scoring.ts`
  - pure ranking logic
- `match-decision-service.ts`
  - deterministic decision rules
- `llm-match-service.ts`
  - prompt + validation + logging
- `allocation-apply-service.ts`
  - atomic persistence

Why:

- better tests
- clearer ownership
- easier profiling
- easier to evolve thresholds and logic

### 5. Add batching and bounded concurrency

Replace:

```ts
for (const transactionId of uniqueTransactionIds) {
  await runTransactionMatch(transactionId);
}
```

With a worker model such as:

- batch size of 100 to 1000 transactions
- worker concurrency of 5 to 20
- separate queue for LLM-needed cases
- retry/backoff for transient failures

Why:

- better throughput
- better fault isolation
- prevents one bad item from blocking the whole run

### 6. Add the right indexes and tenant-aware schema

At minimum:

- `matches(transaction_id)` unique
- `transactions(plaid_transaction_id)` unique
- `invoices(status, balance_due)`
- tenant-scoped versions of all important indexes
- searchable customer name index
- amount/date composite indexes where candidate filtering uses them

In production this should become:

- `organization_id` on all business tables
- queries always scoped by organization
- row-level security or equivalent authorization model

### 7. Log decision history and performance

Add:

- `reconciliation_runs`
- `match_decision_logs`
- `llm_decision_logs`
- `invoice_balance_events`

Track:

- matching latency
- candidate set sizes
- LLM usage rate
- match/review/unmatched rates
- batch failures
- manual override rates

Without this, scaling work becomes guesswork.

## A Better End-State Architecture

### Current architecture

`HTTP request -> full-table reads -> per-transaction full invoice scan -> in-memory ranking -> inline persistence`

### Target architecture

`HTTP request -> enqueue run -> worker pulls next batch -> DB prefilter candidates -> score shortlist -> atomic apply transaction -> audit + metrics`

That is the architectural sentence I would use in the interview.

## Concrete Refactor Plan

### Phase 1: Highest-value fixes

1. Create a background job path for batch matching.
2. Add a DB query that selects pending transactions directly instead of reading all transactions and matches into memory.
3. Add a database-side candidate prefilter so `runTransactionMatch` does not load every open invoice.
4. Move payment application into a real DB transaction.

### Phase 2: Code quality cleanup

1. Break `run-transaction-match.ts` into smaller modules.
2. Convert decision logic into pure functions with unit tests.
3. Move all Supabase I/O into repository helpers.
4. Centralize thresholds/configuration.

### Phase 3: Production hardening

1. Add `organization_id` everywhere.
2. Add auth and authorization.
3. Add audit/event tables.
4. Add metrics and tracing.
5. Add job retries, dead-letter handling, and stuck-run monitoring.

## How To Explain This in the Interview

Use this answer:

"The weakest part of the project is the automatic matching pipeline, especially `run-transaction-match.ts` and the batch route around it. Right now the system finds pending transactions by loading entire tables, then for each transaction it loads all eligible invoices, scores them in memory, and processes everything sequentially inside an HTTP request. That is acceptable for a demo dataset but it does not scale. At 100k or 1M rows, it becomes an O(pending transactions x open invoices) problem, which means too many reads, too much CPU work, and long request times. It is also a code quality problem because the main file mixes data access, scoring, decisioning, LLM use, persistence, and rollback logic. The correct fix is to move matching to background jobs, prefilter candidate invoices in the database, score only a bounded shortlist, and apply matches inside a single database transaction with row locks and audit logging."

## Short Version to Memorize

If you only remember five points, remember these:

1. The weakest part is the matching pipeline, especially `run-transaction-match.ts`.
2. It does full-table and full-invoice-set work that scales poorly.
3. It processes batches sequentially in HTTP requests.
4. It performs financial writes without one atomic DB transaction.
5. The fix is queue + DB prefilter + shortlist scoring + transactional apply.

## Final Judgment

This repo has a solid v1 domain model and good product instincts.

But the current matching implementation is still a **demo-scale architecture**, not a **production-scale architecture**.

If the interviewer asks what you would change first, the best answer is:

**"I would redesign the matching pipeline before anything else, because it is the main bottleneck for both scalability and code quality."**

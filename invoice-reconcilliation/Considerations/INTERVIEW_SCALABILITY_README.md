# Interview Scalability Study Guide

## Main Conclusion

The weakest area in this project is the **matching pipeline**.

The most important files are:

- [src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:1)
- [src/lib/matching/candidate-engine.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/candidate-engine.ts:314)
- [src/lib/matching/process-new-transactions.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/process-new-transactions.ts:29)
- [src/app/api/matches/run-all/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/matches/run-all/route.ts:13)

If the interviewer asks for the single weakest file, answer:

`src/lib/matching/run-transaction-match.ts`

Reason:

- it is the main scalability bottleneck
- it mixes too many responsibilities
- it is in the financial write path

## Problem 1

### Problem

The batch route loads entire tables into memory just to figure out which transactions are still pending.

### Location

- [src/app/api/matches/run-all/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/matches/run-all/route.ts:15)

### Why It Is a Problem

The route does this:

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

Why that is bad:

- it reads all transactions
- it reads all matches
- it computes pending work in application memory
- memory usage grows with table size
- the DB is not doing the filtering work it should do

At 100k to 1M rows, this becomes slow and expensive before matching even starts.

### Possible Fix

Move pending selection into the database.

Use a query shape like:

- `transactions left join matches on transaction_id`
- filter where `matches.transaction_id is null`
- filter to `direction = 'incoming'`
- fetch in pages or bounded batches

Example design:

1. Query only pending incoming transactions.
2. Limit to a batch size such as 100 or 500.
3. Order by date or priority.
4. Hand those IDs to a background worker.

### Resolution

This reduces:

- memory pressure in Node
- unnecessary data transfer
- latency of the batch-start path

It changes the route from:

- full-table read + in-memory filtering

to:

- indexed DB selection of only the next work batch

## Problem 2

### Problem

Pending transactions are processed sequentially inside the request.

### Location

- [src/lib/matching/process-new-transactions.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/process-new-transactions.ts:41)

### Why It Is a Problem

The file does this:

```ts
for (const transactionId of uniqueTransactionIds) {
  const result = await runTransactionMatch(transactionId);
}
```

Why that is bad:

- one transaction is handled at a time
- one slow transaction blocks the rest
- one LLM call can delay the whole batch
- the batch is tied to HTTP request lifetime
- there is no queue, retry system, concurrency control, or progress tracking

At high scale, this leads to:

- request timeouts
- poor throughput
- weak fault tolerance

### Possible Fix

Turn batch matching into background job processing.

Better design:

1. API route creates a `reconciliation_run` record.
2. It queues transaction IDs in bounded batches.
3. Worker processes those batches asynchronously.
4. Worker uses bounded concurrency, for example 5 to 20 matches in flight.
5. Failures are retried with backoff.
6. UI polls a status endpoint or reads progress from the database.

### Resolution

This gives:

- much higher throughput
- better reliability
- safe retry behavior
- no long-running request bottleneck

For 100k and 1M scale, queue-based background work is the correct model.

## Problem 3

### Problem

Every transaction loads the entire set of eligible invoices before scoring.

### Location

- [src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:202)
- [src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:1310)

### Why It Is a Problem

The code does this:

```ts
async function fetchEligibleInvoices(): Promise<InvoiceRow[]> {
  const { data, error } = await supabaseServer
    .from("invoices")
    .select("*")
    .in("status", ["open", "partially_paid"])
    .gt("balance_due", 0)
    .order("invoice_date", { ascending: false });
}
```

Then:

```ts
const invoices = await fetchEligibleInvoices();
const candidates = buildCandidates(transaction, invoices);
```

Why that is bad:

- every incoming transaction reads the full open-invoice universe
- open invoice count directly increases matching cost
- this is repeated for each transaction
- read amplification becomes extreme

This produces an effective complexity of:

- `O(pending transactions x open invoices)`

Example:

- 10,000 pending transactions
- 100,000 open invoices

That creates up to 1,000,000,000 invoice comparisons in application code.

This is the single biggest scalability problem in the repo.

### Possible Fix

Introduce a database-side candidate prefilter before calling the scorer.

Candidate search should narrow the invoice set using:

- tenant or organization scope
- customer-name search tokens
- invoice number fragments
- amount tolerance windows
- date or recency windows
- only open or partially paid invoices

A better pipeline:

1. Parse useful tokens from `transaction.name`.
2. Query only invoices that are likely related.
3. Return a small shortlist, for example 20 to 100 invoices.
4. Run the current scoring logic only on that shortlist.

Useful DB features:

- composite indexes
- trigram index or full-text search on customer name
- tenant-scoped indexes

### Resolution

This changes the system from:

- scanning all open invoices

to:

- searching a small candidate subset

That is the key change needed for 100k to 1M scale.

## Problem 4

### Problem

Candidate scoring and sorting happen entirely in memory after all invoice rows are fetched.

### Location

- [src/lib/matching/candidate-engine.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/candidate-engine.ts:322)

### Why It Is a Problem

The core code is:

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

Why that is bad:

- it scores all rows that were fetched
- it sorts them in memory
- it only keeps the top 10 after doing all the work
- CPU cost grows with invoice count

For small demo data this is fine. For large production data it wastes CPU and memory.

### Possible Fix

Split candidate generation into two stages:

1. database shortlist stage
2. application scoring stage

Specific fix:

- DB returns only prefiltered likely candidates
- application scores only that shortlist
- if needed, add lightweight SQL ranking before final TypeScript scoring

If the shortlist is capped at 50 rows instead of 100,000 rows, the cost becomes manageable.

### Resolution

This sharply reduces:

- CPU time in Node
- sort cost
- memory usage per match

The candidate engine can stay deterministic, but it should run on a narrowed set, not the whole invoice table.

## Problem 5

### Problem

Financial writes are not atomic.

### Location

- [src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:953)
- [src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:998)

### Why It Is a Problem

The match apply path does this:

```ts
const insertResult = await insertMatchOrGetExisting(...);

for (const plannedAllocation of input.allocations) {
  const allocation = await insertAllocation(...);
  await updateInvoiceBalance(...);
}
```

Manual apply also uses application-level rollback if later steps fail.

Why that is bad:

- match creation is separate from allocation creation
- allocation creation is separate from invoice updates
- there is no single transaction around the whole financial operation
- if a failure happens in the middle, data can become partially updated
- concurrent requests can race on invoice balances

This is a correctness problem first, but at scale it becomes a scalability problem too because retries and concurrency become dangerous.

### Possible Fix

Move the apply logic into one database transaction.

Best design:

1. lock the target invoice rows
2. verify balances and eligibility again
3. insert the `matches` row
4. insert all `allocations`
5. update invoice balances and statuses
6. write audit records
7. commit or rollback as one unit

In this stack, that could be:

- a Postgres stored procedure
- a Supabase RPC
- or server logic that runs inside a real SQL transaction boundary

### Resolution

This gives:

- consistency under failure
- safe concurrency behavior
- easier retries
- much safer scaling for real money operations

For interview purposes, say:

"Financial apply must be atomic before this goes to production."

## Problem 6

### Problem

The main matching file has too many responsibilities and weak code boundaries.

### Location

- [src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:1)

### Why It Is a Problem

This file contains:

- database access
- candidate loading
- scoring orchestration
- exact multi-invoice combination logic
- ambiguity analysis
- LLM-assisted matching
- persistence
- manual apply
- rollback logic

Why that is bad:

- hard to unit test
- hard to reason about changes
- hard to profile performance bottlenecks
- high regression risk
- too much coupling between business rules and I/O

This is a code quality problem that makes scalability fixes harder to implement safely.

### Possible Fix

Split the file into smaller modules with one responsibility each.

Recommended structure:

- `match-repository.ts`
- `candidate-search.ts`
- `candidate-scoring.ts`
- `match-decision-service.ts`
- `llm-match-service.ts`
- `allocation-apply-service.ts`

Rules:

- pure decision logic should be isolated from I/O
- persistence should be isolated from scoring
- atomic apply should be isolated from decisioning

### Resolution

This gives:

- cleaner tests
- safer refactors
- easier performance work
- lower chance of accidental financial bugs

In an interview, this is a good example of how code quality and scalability are linked.

## Problem 7

### Problem

The reconciliation dashboard reads large datasets directly into the page.

### Location

- [src/app/reconciliation/page.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/reconciliation/page.tsx:20)

### Why It Is a Problem

The page does this:

```ts
const [
  { data: transactions, error: transactionsError },
  { data: matches, error: matchesError },
  latestSyncRun,
] = await Promise.all([
  supabaseServer.from("transactions").select("*").order("date", {
    ascending: false,
  }),
  supabaseServer.from("matches").select("*"),
  getLatestPlaidSyncRun(),
]);
```

Why that is bad:

- it loads all transactions
- it loads all matches
- it joins them in memory
- page payload and server work grow with data size

At large scale, dashboards need pagination and summary queries, not full-table reads.

### Possible Fix

Change the dashboard to use:

- paginated transaction queries
- status counts from the DB
- summary queries for queue sizes
- filters on the server side

Better model:

1. fetch only one page of transactions
2. fetch counts for matched, unmatched, review-needed, pending
3. fetch detail only when the user drills in

### Resolution

This keeps the UI responsive as data grows and avoids turning the dashboard into a scalability bottleneck.

## Problem 8

### Problem

The invoices page loads the entire invoice table.

### Location

- [src/app/invoices/page.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/invoices/page.tsx:16)

### Why It Is a Problem

The page does this:

```ts
const { data, error } = await supabaseServer
  .from("invoices")
  .select("*")
  .order("invoice_date", { ascending: false });
```

Why that is bad:

- it fetches every invoice row
- totals are computed in memory
- client filtering becomes heavier as data grows

This is manageable for demos but not for large invoice volumes.

### Possible Fix

Add:

- server-side pagination
- server-side filtering
- DB aggregate counts
- optional search indexes for invoice number and customer name

### Resolution

The invoice UI becomes stable for large datasets and does not require loading the full table into memory.

## Problem 9

### Problem

The Plaid sync path is also request-bound and limited to a small transaction fetch window.

### Location

- [src/app/api/plaid/sandbox-transactions/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/plaid/sandbox-transactions/route.ts:72)
- [src/app/api/plaid/sandbox-transactions/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/plaid/sandbox-transactions/route.ts:107)

### Why It Is a Problem

The route:

- performs Plaid sync inline
- processes inserted transactions inline
- calls matching inline
- fetches Plaid transactions with `count: 50` and `offset: 0`

Why that is bad:

- the route does too much work
- sync and matching are tightly coupled
- large transaction volumes would not be fully processed
- long-running external API work is sitting in the request path

### Possible Fix

Split sync from matching.

Better design:

1. sync job fetches transactions and stores them
2. new transaction IDs are queued for reconciliation
3. matching workers process them independently
4. use cursor-based syncing instead of a fixed single fetch window

### Resolution

This improves:

- reliability
- completeness of ingestion
- throughput
- recovery from external API issues

## Problem 10

### Problem

The system does not yet show tenant-aware scaling design.

### Location

- visible across all Supabase queries in the repo

Examples:

- [src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:160)
- [src/app/reconciliation/page.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/reconciliation/page.tsx:25)
- [src/app/invoices/page.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/invoices/page.tsx:16)

### Why It Is a Problem

There is no visible `organization_id` scoping in the main data access paths.

Why that is bad:

- queries cannot scale cleanly in a multi-tenant system
- indexes cannot be scoped properly per tenant
- authorization and row isolation are incomplete
- one tenant's data size can affect another tenant's performance

### Possible Fix

Add multi-tenant structure:

- `organization_id` on business tables
- all queries filtered by `organization_id`
- tenant-scoped unique constraints
- tenant-scoped indexes
- row-level security or equivalent auth enforcement

### Resolution

This is required for real production scale. Without tenant-aware design, 100k to 1M user scale is not realistic.

## Best Interview Answer

If they ask, "What is the weakest scalability area and how would you fix it?", use this:

"The weakest area is the matching pipeline. Right now the batch route reads all transactions and matches into memory, then each transaction loads all eligible invoices, candidate scoring runs in memory, and the whole thing processes sequentially inside an HTTP request. That does not scale because the cost grows with both pending transactions and open invoices. My fix would be to move matching to background jobs, select pending work in the database, prefilter candidate invoices with indexes and search, score only a bounded shortlist, and move the final payment application into one database transaction with locking and audit logging."

## What To Memorize Tonight

Memorize these five lines:

1. Weakest part: `run-transaction-match.ts` and the batch matching path around it.
2. Main scaling bug: full-table reads plus full invoice scans per transaction.
3. Main code quality bug: too many responsibilities in one file.
4. Main correctness bug: non-atomic financial writes.
5. Main fix: queue + DB prefilter + shortlist scoring + transactional apply.

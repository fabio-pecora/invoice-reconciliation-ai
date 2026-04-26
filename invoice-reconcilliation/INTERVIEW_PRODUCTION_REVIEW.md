# 1. Executive Summary

This app is an invoice reconciliation dashboard for finance operations. It imports invoices, ingests bank transactions from Plaid sandbox or manual entry, compares incoming payments against open invoices, applies safe matches, routes ambiguous cases to human review, and lets a reviewer manually apply a payment to an invoice.

The strongest parts are the domain direction and the matching workflow. The project models the important reconciliation concepts: invoices, transactions, matches, allocations, and Plaid sync runs. It also separates "decision" from "money movement": a `matches` row records the outcome for a transaction, while `allocations` record the amount applied to one or more invoices. The matching engine also uses a good safety pattern: deterministic rules first, human review for ambiguity, and LLM assistance only as a constrained proposal that is validated before persistence.

The weaker production-grade areas are mostly around system hardening, not the basic product idea. The repo is missing migrations for the core tables other than `plaid_sync_runs`; most pages and routes read entire tables into memory; service-role Supabase access is centralized but there is no auth, authorization, tenant isolation, or row-level security story; matching and invoice-balance updates are not wrapped in a single database transaction; and important audit/observability tables are missing. `src/lib/matching/run-transaction-match.ts` contains useful domain logic, but it has become a large orchestration module with persistence, scoring decisions, allocation planning, manual apply, rollback, and status reasoning all in one place.

In the interview, emphasize that you built a focused v1 to prove the reconciliation workflow, and then explain exactly how you would productionize it: stronger requirements gathering, normalized accounting entities, database constraints, transaction-safe allocation writes, background jobs, pagination, tenant isolation, audit logs, observability, and deterministic validation around any AI decision.

# 2. Architecture Review

The project uses Next.js App Router with server pages, client components, API routes, Supabase, Plaid, and OpenAI.

Frontend pages:

- `src/app/page.tsx`: home/dashboard page with links to reconciliation and invoices, plus manual transaction, manual invoice, and CSV invoice import forms.
- `src/app/invoices/page.tsx`: server-rendered invoice list page. It loads all invoices, calculates summary counts, and passes rows to the client table.
- `src/app/invoices/invoice-list-client.tsx`: client filtering/search UI for invoices and credits.
- `src/app/reconciliation/page.tsx`: main reconciliation dashboard. It loads all transactions, all matches, and the latest Plaid sync run, then renders `PlaidSyncPanel` and `TransactionOutcomeBoard`.
- `src/app/reconciliation/[transactionId]/page.tsx`: transaction detail and human review page. It loads the transaction, persisted match, allocations, and ranked candidate invoices.
- `src/app/transactions/page.tsx`: redirects to reconciliation.

API routes:

- `src/app/api/invoices/import/route.ts`: accepts CSV upload and calls invoice CSV parsing/import logic.
- `src/app/api/invoices/manual/route.ts`: creates one invoice from line items and optional tax.
- `src/app/api/transactions/manual/route.ts`: creates a manual transaction.
- `src/app/api/plaid/sandbox-transactions/route.ts`: creates a Plaid sandbox item, fetches transactions, upserts them, and processes newly inserted transactions.
- `src/app/api/plaid/sync-status/route.ts`: returns latest sync run.
- `src/app/api/plaid/test/route.ts`: Plaid connectivity check.
- `src/app/api/matches/run/[transactionId]/route.ts`: runs matching for one transaction.
- `src/app/api/matches/run-all/route.ts`: finds transactions without matches and processes them.
- `src/app/api/matches/manual-apply/route.ts`: manually applies a review/unmatched transaction to one invoice.
- `src/app/api/matches/candidates/[transactionId]/route.ts`: debug-style endpoint for candidate generation.

Components:

- `src/components/transaction-outcome-board.tsx`: groups transactions into Applied, Review Needed, Unmatched, Pending, and optional Outgoing.
- `src/components/process-pending-transactions-button.tsx`: calls `POST /api/matches/run-all`.
- `src/components/plaid-sync-panel.tsx`: calls `POST /api/plaid/sandbox-transactions`.
- `src/components/invoice-import-form.tsx`: uploads CSV to `/api/invoices/import`.
- `src/components/manual-invoice-form.tsx`: posts manual invoice JSON.
- `src/components/manual-transaction-form.tsx`: posts manual transaction JSON.

Lib/business logic:

- `src/lib/invoices/import-csv.ts`: parses CSV, supports amount columns and line-item-derived totals, groups duplicate invoice rows, and upserts invoices.
- `src/lib/matching/candidate-engine.ts`: ranks invoice candidates by name similarity and amount compatibility.
- `src/lib/matching/run-transaction-match.ts`: core reconciliation orchestration: load data, decide outcome, persist matches, insert allocations, update invoice balances, and handle manual apply.
- `src/lib/matching/llm-decision.ts`: builds LLM prompt/schema, parses responses, and validates decisions.
- `src/lib/matching/process-new-transactions.ts`: loops through transaction IDs and runs matching.
- `src/lib/llm/openai-server.ts`: server-only OpenAI wrapper.
- `src/lib/plaid/client.ts` and `src/lib/plaid/sync-runs.ts`: Plaid client and sync-run persistence.
- `src/lib/supabase/server.ts`: Supabase service-role server client.

Database tables inferred from code:

- `invoices`: invoice receivables with amount, balance due, status, customer, dates.
- `transactions`: bank/manual transactions with Plaid ID, date, name, amount, direction.
- `matches`: one reconciliation decision per transaction.
- `allocations`: payment amounts applied from a match to invoices.
- `plaid_sync_runs`: sync status and counters. This is the only table migration included in the repo.

External services:

- Supabase stores all application data.
- Plaid sandbox provides recent transaction data.
- OpenAI assists ambiguous matching through strict structured JSON.

Data flow:

1. Invoices enter through CSV import or manual invoice form and are stored in `invoices`.
2. Transactions enter through Plaid sandbox sync or manual transaction form and are stored in `transactions`.
3. Matching loads a transaction and eligible open/partially paid invoices.
4. `buildCandidates` ranks candidate invoices.
5. `runTransactionMatch` decides unmatched, human review, deterministic apply, or LLM-assisted apply.
6. Applied matches create a `matches` row, one or more `allocations`, and invoice balance/status updates.
7. The reconciliation dashboard reads transactions and matches, then groups work into operational queues.

What is good: the architecture is easy to follow, the API routes are relatively thin for matching, and the core domain objects are close to the real accounting workflow. The separation between candidate generation, LLM validation, match status UI helpers, and Plaid sync helpers is a good start.

What should improve: add a complete schema/migrations folder, move database mutations that must be atomic into Postgres functions or transaction-capable server logic, add auth/tenant boundaries, paginate server reads, move long-running matching into jobs, extract `run-transaction-match.ts` into smaller modules, and persist decision/audit history.

# 3. Full Reconciliation Flow

## User Imports Invoices

Frontend: `src/components/invoice-import-form.tsx` on `src/app/page.tsx`.

API route: `src/app/api/invoices/import/route.ts`.

Lib/helper files: `src/lib/invoices/import-csv.ts`, `src/lib/supabase/server.ts`.

Database tables: reads existing `invoices` by `invoice_number`; upserts `invoices`.

Steps:

1. User selects/drops a CSV file.
2. Client validates that the filename ends with `.csv`.
3. Form posts `multipart/form-data` to `/api/invoices/import`.
4. API validates content type and file type.
5. API reads file text and calls `parseInvoiceCsv(csvContent, { amountMode: "auto" })`.
6. Parser normalizes headers, validates required columns, normalizes dates, parses amounts or line items, and groups compatible duplicate invoice numbers.
7. API calls `importInvoiceRecords`, which checks existing invoice numbers and upserts rows on `invoice_number`.

Possible failure cases:

- Empty CSV.
- Missing required columns.
- Invalid dates.
- Invalid amount or unsupported line-item format.
- Duplicate invoice number with conflicting metadata.
- Supabase lookup/upsert failure.
- Production issue: upsert on `invoice_number` alone is not tenant-safe and can overwrite a partially paid invoice balance.

Production improvements:

- Require organization/customer context.
- Preserve imported source file, import batch ID, row numbers, and raw row payloads.
- Avoid overwriting `balance_due` for invoices with existing allocations.
- Add idempotent import batches and duplicate detection.
- Validate CSV size and row limits.
- Move imported line items into a real `line_items` table.

## User Syncs Plaid Transactions

Frontend: `src/components/plaid-sync-panel.tsx` on `src/app/reconciliation/page.tsx`.

API route: `src/app/api/plaid/sandbox-transactions/route.ts`.

Lib/helper files: `src/lib/plaid/client.ts`, `src/lib/plaid/sync-runs.ts`, `src/lib/matching/process-new-transactions.ts`, `src/lib/matching/run-transaction-match.ts`.

Database tables: writes `plaid_sync_runs`; reads/writes `transactions`; writes `matches`; writes `allocations`; updates `invoices`.

Steps:

1. User clicks "Sync Transactions from Plaid Sandbox".
2. API creates a `plaid_sync_runs` row with `running` status.
3. API creates a Plaid sandbox public token and exchanges it for an access token.
4. API fetches the last 30 days of transactions, retrying up to five times.
5. It normalizes transaction direction: Plaid amount `< 0` is `incoming`, `> 0` is `outgoing`.
6. It queries existing `transactions` by `plaid_transaction_id`.
7. It upserts transactions on `plaid_transaction_id`.
8. It identifies newly inserted rows and runs automatic matching only for those.
9. It completes or fails the sync run with counts.

Possible failure cases:

- Plaid credentials missing or invalid.
- Plaid sandbox latency/no transactions yet.
- Supabase upsert failure.
- Automatic matching partially fails.
- Two syncs run at once and both classify the same transaction as new.
- Production issue: `transactionsGet` fetches only `count: 50` with `offset: 0`, so it is not complete for high-volume accounts.

Production improvements:

- Use Plaid `/transactions/sync` cursors rather than last-30-days polling.
- Store Plaid item/account IDs and access tokens securely.
- Use a background job with retry/backoff.
- Add idempotency key per sync/account/cursor.
- Lock per Plaid item during sync.
- Paginate Plaid results.
- Track updated/removed transactions.

## User Creates a Manual Transaction

Frontend: `src/components/manual-transaction-form.tsx` on `src/app/page.tsx`.

API route: `src/app/api/transactions/manual/route.ts`.

Lib/helper files: `src/lib/supabase/server.ts`.

Database tables: writes `transactions`.

Steps:

1. User enters transaction name, date, positive amount, and direction.
2. Client posts JSON to `/api/transactions/manual`.
3. Server validates required fields and date format.
4. Server stores incoming transactions as negative amounts and outgoing as positive amounts.
5. Server generates a synthetic `manual_...` transaction ID.
6. Server inserts the row into `transactions`.

Possible failure cases:

- Invalid body/date/amount/direction.
- Duplicate generated ID, retried up to three times.
- Supabase insert failure.
- Production issue: no duplicate detection for same date/name/amount manual entries.

Production improvements:

- Add idempotency key for manual creation.
- Add source fields: `source = manual`, `created_by`, `organization_id`.
- Add duplicate warning UX.
- Optionally trigger matching asynchronously after create.

## User Clicks "Run Match"

Frontend: `src/app/reconciliation/[transactionId]/run-match-button.tsx`.

API route: `src/app/api/matches/run/[transactionId]/route.ts`.

Lib/helper files: `src/lib/matching/run-transaction-match.ts`, `src/lib/matching/candidate-engine.ts`, `src/lib/matching/llm-decision.ts`, `src/lib/llm/openai-server.ts`.

Database tables: reads `transactions`, `matches`, `invoices`, `allocations`; writes `matches`, `allocations`; updates `invoices`.

Steps:

1. User opens a transaction detail page with no persisted match.
2. Click posts to `/api/matches/run/[transactionId]`.
3. Route calls `runTransactionMatch(transactionId)`.
4. The engine returns an existing match if already present.
5. Outgoing transactions are persisted as `unmatched`.
6. Incoming transactions are compared against eligible invoices.
7. The engine decides deterministic match, multi-invoice match, human review, LLM-assisted match, or unmatched.
8. Applied outcomes persist `matches`, `allocations`, and invoice balance updates.

Possible failure cases:

- Transaction not found.
- Existing match already created by another request.
- Eligible invoice changes while matching is running.
- Allocation insert succeeds but invoice update fails.
- LLM request fails or returns invalid content.
- Production issue: persistence is not atomic across match insert, allocation insert, and invoice update.

Production improvements:

- Put the full apply operation in a database transaction or Postgres RPC.
- Lock selected invoice rows with `FOR UPDATE`.
- Use idempotency keys/reconciliation run IDs.
- Add `matching_runs` and `match_decision_logs`.
- Persist validation failures and LLM request IDs.

## User Clicks "Process Pending"

Frontend: `src/components/process-pending-transactions-button.tsx` inside `src/components/transaction-outcome-board.tsx`.

API route: `src/app/api/matches/run-all/route.ts`.

Lib/helper files: `src/lib/matching/process-new-transactions.ts`, `src/lib/matching/run-transaction-match.ts`.

Database tables: reads all `transactions`, reads all `matches`, then same write set as single matching.

Steps:

1. Dashboard identifies pending items as transactions with no match.
2. User clicks "Process Pending Transactions".
3. API loads all transaction IDs and all matched transaction IDs.
4. It filters pending IDs in memory.
5. It calls `runAutomaticMatchingForTransactions`.
6. That loops sequentially and calls `runTransactionMatch` for each unique ID.
7. API returns processed/matched/review/unmatched/failed counts.

Possible failure cases:

- Full-table reads become slow.
- Another match process runs concurrently.
- Long request times out for many transactions.
- One slow OpenAI call delays the whole batch.

Production improvements:

- Use a background queue.
- Select pending transactions with a DB anti-join and limit.
- Store `reconciliation_runs`.
- Use per-transaction idempotency.
- Process in bounded batches with concurrency controls.
- Report progress through job status.

## User Manually Applies a Match During Human Review

Frontend: `src/app/reconciliation/[transactionId]/page.tsx` renders `src/app/reconciliation/[transactionId]/manual-apply-button.tsx`.

API route: `src/app/api/matches/manual-apply/route.ts`.

Lib/helper files: `src/lib/matching/run-transaction-match.ts`, `src/lib/matching/candidate-engine.ts`.

Database tables: reads `transactions`, `matches`, `allocations`, `invoices`; writes `allocations`; updates `invoices`; updates `matches`.

Steps:

1. Detail page shows ranked candidates for a `human_review_needed` transaction.
2. Reviewer clicks "Apply to This Invoice".
3. Client posts `transactionId` and `invoiceId` to `/api/matches/manual-apply`.
4. Server validates transaction exists, is incoming, has unresolved status, and has no allocations.
5. Server rebuilds eligible candidates and requires the selected invoice to still be eligible.
6. It rejects overpayment for single-invoice manual apply.
7. It inserts allocation, updates invoice balance/status, and updates match status/reason.
8. If later steps fail, it attempts application-level rollback.

Possible failure cases:

- Invoice no longer eligible.
- Payment exceeds invoice balance.
- Allocation insert succeeds but invoice update fails.
- Two reviewers click at once.
- Application rollback fails.

Production improvements:

- Use a database transaction.
- Lock match and invoice rows.
- Add manual reviewer identity and audit event.
- Store reason/comment from reviewer.
- Support multi-invoice manual allocation.
- Add optimistic UI conflict messages.

# 4. Data Model Review

`invoices` represent receivables. Current inferred fields are `id`, `invoice_number`, `customer_name`, `invoice_date`, `due_date`, `amount`, `balance_due`, and `status`. Statuses used are `open`, `partially_paid`, and `paid`.

`transactions` represent bank activity or manual entries. Current inferred fields are `id`, `plaid_transaction_id`, `date`, `name`, `amount`, and `direction`. Incoming payments are stored as negative amounts, outgoing as positive amounts. Matching uses `Math.abs(transaction.amount)`.

`matches` represent one reconciliation decision for one transaction. Current inferred fields are `id`, `transaction_id`, `status`, `confidence`, and `reason`. Statuses are `matched`, `partially_matched`, `unmatched`, and `human_review_needed`.

`allocations` represent actual payment application from a match to invoice(s). Current inferred fields are `id`, `match_id`, `invoice_id`, and `amount`.

`plaid_sync_runs` tracks sync attempts and operational counts. This table has a migration with status checks, nonnegative counters, and an index on `(source, created_at desc)`.

Matches and allocations should be separate because a match is the decision/outcome for a transaction, while allocations are the accounting distribution of payment dollars. One transaction can match zero invoices, one invoice, or many invoices. A `human_review_needed` or `unmatched` match can have no allocations. A `matched` or `partially_matched` match should have at least one allocation.

Relationships:

- `matches.transaction_id` should reference `transactions.id`.
- `allocations.match_id` should reference `matches.id`.
- `allocations.invoice_id` should reference `invoices.id`.
- In production, all major tables should also reference `organization_id`.

Constraints that should exist:

- `transactions.plaid_transaction_id` unique, scoped by Plaid item/account or organization.
- `matches.transaction_id` unique.
- `allocations.amount > 0`.
- `invoices.amount` and `balance_due` use numeric decimal precision, not float.
- `invoices.balance_due >= 0` unless credits are modeled separately.
- `invoices.status` check constraint.
- `transactions.direction` check constraint.
- `matches.status` check constraint.
- `invoice_number` unique per organization/customer context, not globally.
- Allocation totals for a match should not exceed transaction amount.
- Invoice allocated total should not exceed invoice amount unless explicit overpayment/credit handling exists.

Indexes that should exist:

- `invoices (organization_id, status, balance_due)` for eligible invoice lookup.
- `invoices (organization_id, invoice_number)` unique.
- `invoices (organization_id, customer_id, status)`.
- `transactions (organization_id, date desc)`.
- `transactions (organization_id, direction, date desc)`.
- `transactions (organization_id, plaid_transaction_id)` unique.
- `matches (organization_id, transaction_id)` unique.
- `matches (organization_id, status)`.
- `allocations (match_id)`.
- `allocations (invoice_id)`.
- `plaid_sync_runs (organization_id, source, created_at desc)`.

Missing production schema concepts:

- `users`, `organizations`, and memberships/roles.
- `customers` separate from invoice text names.
- `line_items` rather than only invoice totals.
- `payments` as a first-class accounting object distinct from raw bank transactions.
- `credits`, `refunds`, `chargebacks`, and overpayments.
- `audit_logs` for every mutation and manual decision.
- `reconciliation_runs` for batch matching attempts.
- `match_decision_logs` for candidate snapshots, scoring, LLM inputs/outputs, and validation results.
- Plaid `items` and `accounts`.
- Idempotency keys.
- Raw import batches and raw transaction payloads.

How to talk about the data model:

Say: "For a take-home v1, I modeled the core reconciliation state: invoice, transaction, match, allocation. In production I would normalize the accounting model further. I would introduce customers, organizations, line items, payments, credits, refunds, audit logs, and reconciliation runs. I would also enforce correctness in the database with unique constraints, foreign keys, check constraints, indexes, and transactional apply functions. The key design choice I would keep is separating a match decision from payment allocations, because that lets one transaction be unmatched, reviewed, applied to one invoice, or allocated across many invoices."

# 5. Matching Engine Review

## Candidate Generation

Current code: `src/lib/matching/candidate-engine.ts` builds candidates only for incoming transactions. It compares each eligible invoice with the transaction, computes `name_score`, `amount_score`, and total score, filters out `name_score < 0.65`, sorts by name score, amount score, and total score, and returns the top 10.

Why useful: it creates a bounded set of plausible invoices before deterministic or LLM decisions. This limits unsafe matches and limits what the LLM can see.

Handled edge cases: legal suffixes like `inc`, `llc`, `corp`; noisy transaction words like `ach`, `payment`, `transfer`, `stripe`; numeric identifier tokens; exact amount; partial amount; close amount tolerance; overpayment treated as weak.

Not handled: phonetic similarity, misspellings, aliases, parent/subsidiary relationships, customer IDs, payment memo invoice numbers, remittance advice, invoice dates/payment windows, currency, multi-tenant filtering, and high-scale candidate search.

Production risk: it scans all eligible invoices in memory. With 100,000+ invoices this becomes slow and expensive.

Improvement: add customer normalization tables, alias tables, trigram/full-text indexes, invoice-number extraction, date-window filtering, amount-window prefilters, and candidate snapshots.

## Name Similarity

Current code: tokenizes names, removes low-signal tokens, weights numeric identifiers more heavily, calculates overlap/coverage/Dice-style scoring, and describes evidence.

Useful because customer names in bank feeds are noisy.

Handled edge cases: "ACH ACME INC PAYMENT" can still match "ACME Corp"; store numbers or numeric fragments carry extra weight.

Not handled: abbreviations, misspellings, DBA names, multiple legal entities under one customer, and international text.

Production risk: one generic shared brand token can still be misleading in some domains.

Improvement: add customer aliases, historical confirmed matches, embedding or trigram similarity, and explicit "generic token" controls.

## Amount Scoring

Current code: exact amount is 1.0; partial payments get lower but meaningful scores; small overage tolerance receives some score; large overage gets 0.1.

Useful because payment amount is strong evidence but should not override customer mismatch.

Handled: exact payments, partial payments, close tolerance.

Not handled: fees, discounts, taxes withheld, split payments, overpayments converted to credits, refunds, chargebacks, and currency.

Production risk: floating-point money and heuristic thresholds can cause edge-case errors.

Improvement: store money as integer cents or decimal; model discounts/fees/credits; use explicit payment allocation rules.

## Deterministic Matching

Current code: `runTransactionMatch` applies deterministic matches when the candidate assessment is safe. Constants include `AUTO_MATCH_THRESHOLD = 0.75`, `STRONG_NAME_THRESHOLD = 0.8`, `EXACT_AMOUNT_THRESHOLD = 0.99`, and `CLOSE_COMPETITOR_GAP = 0.1`.

Useful because production reconciliation should prefer deterministic rules for explainability and repeatability.

Handled: existing match idempotency, outgoing transactions, no plausible candidates, strong exact single-invoice match, exact multi-invoice combinations, and ambiguous ties.

Not handled: atomic transaction safety, row locking, versioned rule configuration, or audited rule decisions.

Production risk: rules live as code constants and cannot be tuned per customer or measured over time.

Improvement: version the matcher, log every decision, build a regression dataset, and make thresholds configurable with controlled release.

## Partial Payments

Current code: if payment is less than invoice balance and the candidate is strong, allocation can reduce balance and mark invoice `partially_paid`.

Useful because real customers often pay partial amounts.

Handled: single-invoice partial payment where payment does not exceed balance.

Not handled: recurring payment plans, promises-to-pay, short pays, discounts, fees, or partial payment against a specific line item.

Production risk: partial payments without a `payments` ledger and audit trail are hard to reconcile later.

Improvement: first-class `payments` and `payment_applications`, balance history, and business rules for short pay/discount categories.

## Multi-Invoice Allocations

Current code: `findExactMultiInvoiceCombinations` searches up to two exact combinations among strong candidates. If exactly one combination equals the payment amount, it can auto-apply across invoices; if more than one, it routes to human review.

Useful because one customer payment may cover multiple invoices.

Handled: exact sum across multiple strong same-customer candidates.

Not handled: partial multi-invoice payments, overpayments, customer-specified remittance, or large combinatorial search.

Production risk: subset-sum search can get expensive if expanded without guardrails.

Improvement: use amount/date/customer prefilters, cap candidate count, use remittance documents, and require review when combinations are numerous.

## Human Review

Current code: ambiguity creates a persisted `human_review_needed` match. The detail page shows candidates and manual apply actions.

Useful because unsafe automation is worse than a review queue in financial workflows.

Handled: exact amount ties, similar customer-family ambiguity, multiple strong amount fits, close competitors.

Not handled: reviewer comments, assignment, approval workflow, dual control, SLA, or audit identity.

Production risk: no user/auth model means manual actions cannot be attributed.

Improvement: add review queue state, assignee, reviewer, comment, before/after snapshots, and audit logs.

## LLM-Assisted Matching

Current code: `applyLlmAssistedMatch` calls `requestLlmMatchDecision` only after deterministic checks. The LLM receives the transaction and ranked candidates, returns strict JSON, then `validateLlmMatchDecision` enforces candidate membership, allocation totals, positive amounts, balance limits, shape rules, confidence bounds, and name-score threshold.

Useful because LLMs can sometimes resolve fuzzy naming cases that deterministic token rules cannot.

Handled: schema validation, no invented invoice IDs, candidate-only universe, exact allocation sum, fallback on invalid output.

Not handled: prompt version storage, decision replay, monitoring, PII minimization, model drift tracking, or human-review fallback based on confidence thresholds.

Production risk: using LLM explanations without persisting raw input/output makes later audits weak.

Improvement: log prompt version, model, request ID, candidate snapshot, response, validation outcome, and final deterministic action.

## Manual Apply

Current code: `applyManualSingleInvoiceMatch` supports applying one unresolved transaction to one eligible candidate invoice, rejects resolved matches and existing allocations, and attempts rollback if persistence fails.

Useful because human review needs an operational resolution path.

Handled: non-incoming rejection, no unresolved match, already resolved, existing allocations, selected invoice no longer eligible, overpayment rejection.

Not handled: multi-invoice manual apply, reviewer identity, comments, atomic database transaction, approval workflow.

Production risk: two reviewers or processes can race.

Improvement: lock match/invoice rows in a transaction, require reviewer identity, support explicit allocation amounts, and write audit events.

# 6. LLM Safety Review

The LLM is called from `src/lib/matching/llm-decision.ts` through `src/lib/llm/openai-server.ts`. `run-transaction-match.ts` calls `requestLlmMatchDecision` in `applyLlmAssistedMatch`.

Input received by the LLM:

- Transaction ID, date, name, amount, direction, and usable payment amount.
- Up to 10 ranked candidate invoices with invoice ID, invoice number, customer name, balance due, scores, and reason.
- Allowed invoice IDs.
- Rules for unmatched, single-invoice, and multi-invoice decisions.

Output format:

- Strict JSON schema with `decision_type`, `selected_invoice_ids`, `proposed_allocations`, `confidence`, and `explanation`.
- Allowed decision types: `unmatched`, `single_invoice`, `multi_invoice`.

Validation currently done:

- JSON parses successfully.
- No unexpected keys.
- Decision type is valid.
- Confidence is between 0 and 1.
- Explanation is non-empty.
- Selected invoice IDs are non-empty when needed and unique.
- Selected IDs must be in the candidate list.
- Allocated invoice IDs must be in the candidate list.
- Selected IDs must exactly match allocation IDs.
- Allocation amounts must be positive.
- Allocation amounts must not exceed current invoice balances.
- Allocation totals must equal the incoming payment amount.
- Selected candidates must meet name safety threshold.
- Single vs multi shapes are enforced.

Why the LLM should not be trusted blindly:

- It can invent IDs, ignore constraints, overfit amount matches, or make inconsistent allocations.
- It may be nondeterministic across model versions.
- Its explanation is not proof.
- It does not have the full accounting context unless explicitly supplied.
- A false positive can incorrectly reduce receivables.

Safety checks already present:

- Candidate-only universe.
- Strict JSON schema.
- Deterministic validation after the model responds.
- Fallback to unmatched or human review if invalid.
- Temperature 0.
- The model never writes to the database directly.

Additional production safeguards:

- Use confidence thresholds for LLM-assisted auto-apply, not just validation.
- Persist every LLM request/response with prompt version, model, request ID, candidate snapshot, and validation result.
- Do not expose the whole invoice table; continue providing only a bounded candidate set.
- Redact or minimize sensitive fields.
- Store prompt versions and matcher versions.
- Make every LLM decision replayable offline.
- Monitor model decision rate, invalid output rate, manual override rate, and false-positive rate.
- Require human review for high-dollar payments, close ties, first-time customers, or low confidence.
- Add deterministic post-validation that checks current database state inside the same transaction as apply.
- Prevent invented invoice IDs with DB foreign keys and candidate snapshot checks.

# 7. Scalability Review

At 1,000 invoices, the current design likely works for a demo or small internal tool. Full-table reads and in-memory candidate scoring are acceptable but already inefficient.

At 100,000 invoices, `fetchEligibleInvoices()` and `buildCandidates()` become bottlenecks because every match loads all open/partially paid invoices with balance due and scores them in application memory.

At 1 million transactions, the reconciliation dashboard and `run-all` route break down because they load all transactions and all matches. Pagination, filtering, and server-side grouping become mandatory.

With many users or organizations, the current app has no tenant isolation. Every server query uses service-role Supabase and no `organization_id`, so real customer data would be commingled.

With concurrent match runs, the code relies partly on a unique match constraint implied by duplicate handling, but invoice balance updates and allocation inserts are not protected by a database transaction or row locks.

With repeated Plaid syncs, upsert by `plaid_transaction_id` prevents some duplicates, but sync is not cursor-based and only fetches a fixed first page of 50 transactions. Concurrent syncs can race when identifying "new" rows.

Current bottlenecks:

- Full-table reads in `src/app/reconciliation/page.tsx`, `src/app/invoices/page.tsx`, and `src/app/api/matches/run-all/route.ts`.
- Full eligible invoice scan per transaction in `run-transaction-match.ts`.
- Sequential matching loop in `process-new-transactions.ts`.
- LLM calls in request/response path.
- No background worker.
- No complete indexing strategy.

Indexes needed:

- Eligible invoices: `(organization_id, status, balance_due)`.
- Invoice number: unique `(organization_id, invoice_number)`.
- Transaction lookup/listing: `(organization_id, date desc)`, `(organization_id, direction, date desc)`.
- Plaid dedupe: unique `(organization_id, plaid_transaction_id)`.
- Match idempotency: unique `(organization_id, transaction_id)`.
- Queue/dashboard: `(organization_id, status)` on matches or materialized status views.
- Allocation lookups: `(match_id)`, `(invoice_id)`.

Pagination needed:

- Invoice list.
- Reconciliation transaction list.
- Candidate debug endpoint for large candidate sets.
- Plaid transaction fetch.
- Admin/audit logs.

Background jobs needed:

- Plaid sync.
- Batch matching.
- LLM-assisted matching.
- Import processing for large CSVs.
- Retry failed jobs.

Queueing strategy:

- Create `jobs` or use a managed queue.
- Job type: `plaid_sync`, `match_transaction`, `match_batch`, `invoice_import`.
- Job payload includes `organization_id`, idempotency key, and run ID.
- Workers process with bounded concurrency.
- Store attempts, status, error, started/completed timestamps.

Idempotency strategy:

- Unique transaction ID from Plaid.
- Unique match per transaction.
- Idempotency key for manual transaction create.
- Idempotency key for sync cursor and import batch.
- Reconciliation run ID to dedupe batch attempts.
- Allocation uniqueness such as `(match_id, invoice_id)` where appropriate.

Transaction/locking strategy:

- Use a Postgres function for applying allocations.
- Lock transaction row, match row, and selected invoice rows.
- Recheck invoice balances after lock.
- Insert match and allocations, update balances, and audit log in one DB transaction.
- Use optimistic version columns on invoices if not using explicit locks.

Caching opportunities:

- Customer normalization/alias tables.
- Recent eligible invoice candidate indexes.
- Plaid latest sync summary.
- Dashboard summary counts.

Scaling candidate search:

- Extract candidate generation into two phases: database prefilter then application scoring.
- Prefilter by organization, status, balance, amount window, date window, and customer/search tokens.
- Use trigram or full-text indexes for customer names.
- Store normalized customer tokens.
- Use confirmed match history to prioritize customers.

# 8. Production-Grade Code Review

Separation of concerns:

- Good: `candidate-engine.ts` is focused on scoring, `llm-decision.ts` is focused on LLM schema and validation, and `process-new-transactions.ts` is a simple batch loop.
- Weak: `run-transaction-match.ts` mixes data access, candidate assessment, deterministic decisioning, allocation planning, persistence, manual apply, rollback, and explanation text. Seriousness: medium-high because it is the core financial mutation path.
- Improvement: split into repositories, candidate assessment, allocation planner, match decision service, persistence/apply service, and manual review service.
- Interview framing: "I moved fast and kept logic centralized for the take-home, but production financial code benefits from smaller units with clear invariants and isolated tests."

API route thinness:

- Good: match routes mostly delegate to lib functions.
- Weak: Plaid sandbox route handles sync run creation, Plaid calls, transaction normalization, dedupe, upsert, matching, and error response in one route. Seriousness: medium.
- Improvement: move Plaid sync into a service/job and keep route as job trigger.

Duplication:

- `fetchEligibleInvoices`, `fetchTransaction`, and match/allocation loading logic appear in multiple files.
- Date validation and money rounding logic are duplicated in manual invoice/transaction/import/matching code.
- Seriousness: medium.
- Improvement: shared repositories and utility modules.

Error handling:

- Good: routes return JSON errors and manual apply has a custom status-bearing error.
- Weak: financial writes use application-level rollback instead of database transactions. Some errors expose raw service messages.
- Seriousness: high for production.
- Improvement: transaction-safe RPC, structured error codes, safe user-facing messages, full server logs.

Validation:

- Good: manual invoice/transaction and CSV import validate many fields; LLM output validation is strong.
- Weak: no schema library, no auth/authorization validation, no request size limits, no tenant checks.
- Seriousness: high before real customers.
- Improvement: use shared request schemas, server-side authorization middleware, and request limits.

Types:

- Good: TypeScript types are defined for rows and payloads.
- Weak: row types are duplicated and inferred manually instead of generated from Supabase schema.
- Seriousness: medium.
- Improvement: generate database types and share them across repository functions.

Naming:

- Good: domain names are readable: `matches`, `allocations`, `human_review_needed`.
- Weak: `plaid_transaction_id` is reused for manual synthetic IDs; `matched` vs `partially_matched` describes invoice balance result but not transaction application completeness.
- Improvement: add `external_transaction_id`, `source`, and clearer payment application states.

Constants/magic numbers:

- Matching thresholds are clear constants in `run-transaction-match.ts`, but they are not versioned or configurable.
- Seriousness: medium.
- Improvement: create a `MatchingPolicy` with version and audit it with each decision.

Testability:

- Good: `candidate-engine.ts` and `llm-decision.ts` are testable pure-ish modules.
- Weak: `run-transaction-match.ts` directly imports Supabase and OpenAI path dependencies, making unit tests harder.
- Seriousness: medium-high.
- Improvement: inject repositories/clients or isolate pure decision planning from persistence.

Maintainability:

- Good: the code is readable and domain intent is apparent.
- Weak: the transaction detail page and transaction outcome board are large UI files; `run-transaction-match.ts` is very large.
- Improvement: split UI subcomponents and backend services.

# 9. Requirements I Should Have Asked Earlier

- Can one payment pay multiple invoices? This determines whether allocations need to exist from day one.
- Can one invoice receive multiple payments? This determines partial payment and balance history modeling.
- Are overpayments allowed? This affects credits, unapplied cash, and whether manual apply should allow excess.
- Are refunds and chargebacks in scope? This affects negative payments and reversing allocations.
- Do customers have stable IDs or only names? This changes matching from fuzzy text to entity resolution.
- Can invoice numbers duplicate across customers or companies? This affects unique constraints.
- Is this single-company or multi-company? This affects every table, auth rule, and unique index.
- What is the human review workflow? This affects statuses, assignments, comments, and approvals.
- Do manual actions need audit history? In finance, yes; this affects audit tables and immutable logs.
- What user roles exist? This affects who can import, sync, apply, override, or view sensitive data.
- How should Plaid sync behave? This affects cursor sync, account selection, idempotency, and retries.
- Is LLM usage allowed for financial decisions? This affects safety gates, auditability, and review requirements.
- What false-positive rate is acceptable? This determines auto-apply thresholds.
- What false-negative/manual-review rate is acceptable? This determines operational workload.
- How many invoices and transactions should the system handle? This affects pagination, indexes, jobs, and candidate search.
- Are credits/prepayments common? This affects whether credits should be separate from invoices.
- Are line items needed for matching or just totals? This affects schema normalization.
- Are discounts, fees, taxes, or currency conversions in scope? This affects amount scoring.
- Should matching be real-time or batch? This affects architecture and UX.
- What audit evidence must be shown to finance users? This affects candidate snapshots and decision logs.

# 10. How To Explain "I Would Improve This"

What would you improve in your project?

"I would keep the core flow, but I would harden the production boundaries. The biggest improvements are a complete database schema with constraints and indexes, transaction-safe allocation writes, auth and tenant isolation, background jobs for Plaid sync and batch matching, and audit logs for every decision. I would also split the matching orchestration into smaller modules so the business rules are easier to test and evolve."

How would you make this production-grade?

"I would start with correctness: foreign keys, unique constraints, check constraints, decimal money, and a database transaction for applying allocations. Then I would add operational pieces: auth, organizations, RLS, audit logs, job queues, retries, observability, and dashboards. After that I would scale candidate search with database prefilters and indexes instead of scanning every open invoice."

How would you improve the data model?

"The v1 model has the right core nouns, but production needs more accounting structure. I would add customers, organizations, users, line items, payments, credits, refunds, audit logs, and reconciliation runs. I would keep matches separate from allocations because a transaction decision and the actual dollar applications are different concepts."

How would you improve code quality?

"I would extract persistence out of the matching engine, keep pure decision logic separate from database writes, and introduce generated database types and shared validation schemas. I would also move Plaid sync out of the API route into a service/job and split large UI files into smaller components."

How would you improve scalability?

"I would stop loading entire tables for dashboards and matching. Dashboards need server-side pagination and counts. Matching needs a database prefilter by tenant, status, amount range, date range, and normalized customer tokens before application scoring. Batch matching and Plaid sync should run as background jobs with progress tracking."

How would you make matching safer?

"I would treat auto-apply as a high-confidence path only. Every decision should log candidate snapshots, scores, rules, matcher version, and final action. Ambiguous or high-dollar cases should go to review. The apply step should recheck current balances inside a locked database transaction."

How would you test this?

"I would unit test scoring and LLM validation, integration test database apply behavior, and end-to-end test the import-sync-match-review flows. I would build a regression suite of realistic payment/invoice cases and run it whenever thresholds or prompts change."

How would you handle concurrency?

"I would use a unique match per transaction for idempotency, but I would also lock the transaction and selected invoice rows during apply. Allocation insert, invoice balance update, match update, and audit log write should commit or roll back together."

How would you handle audit logs?

"I would add immutable audit events for imports, syncs, automatic decisions, LLM proposals, manual applies, balance changes, and failures. Each event would include actor, organization, before/after state, reason, request ID, and reconciliation run ID."

How would you reduce LLM risk?

"I would keep the LLM outside the write path. It can propose, but deterministic validation and database constraints decide. I would limit input to candidates, block invented IDs, require exact allocation totals, store prompt/model versions, monitor outcomes, and route uncertain cases to human review."

# 11. Testing Strategy

Unit tests:

- `candidate-engine.ts`: token normalization, legal/noise token removal, identifier weighting, exact amount, partial amount, overpayment scoring, sort order, name threshold filtering.
- `llm-decision.ts`: parse valid/invalid JSON, reject extra keys, reject invented invoice IDs, reject duplicate IDs, reject over-allocation, reject bad totals, accept valid single/multi/unmatched.
- Allocation planning logic from `run-transaction-match.ts` after extraction.

Integration tests:

- `runTransactionMatch` with a test database or mocked repository.
- Manual apply success/failure.
- Invoice import upsert behavior.
- Plaid sync transaction normalization and dedupe.

End-to-end tests:

- Upload invoices, create/sync transactions, run matching, review details, manually apply candidate, verify invoice balance changes.

Database tests:

- Foreign keys.
- Unique match per transaction.
- Allocation positive amount.
- Invoice balance never below zero.
- Tenant isolation.
- Transactional rollback on failure.

LLM validation tests:

- Model returns invented invoice ID.
- Model returns valid ID but below threshold.
- Model returns allocation sum too low/high.
- Model returns multi-invoice decision with one allocation.
- Model returns unmatched with selected invoices.
- OpenAI unavailable.

Regression test cases:

- Exact match: same customer and exact amount auto-applies.
- Partial payment: amount below invoice balance marks invoice partially paid.
- Multi-invoice payment: one payment exactly equals two invoice balances.
- Ambiguous match: two similar candidates with same amount routes to review.
- Unmatched transaction: no plausible name match creates unmatched.
- Outgoing transaction: stored as unmatched/ineligible.
- Overpayment: not auto-applied in v1.
- Duplicate processing: second run returns existing match and does not allocate twice.
- Manual apply: review-needed transaction applies selected invoice.
- Failed allocation: no partial balance mutation remains after failure.
- Plaid sync: duplicate Plaid transaction is not processed twice.
- Invoice import: duplicate invoice rows combine only when metadata matches.

# 12. Concurrency and Idempotency

Duplicate matching could happen if a user clicks "Run Match" while "Process Pending" is running, if two users click the same action, or if Plaid sync and pending processing overlap.

Double allocations could happen if two processes both see no existing match, both compute the same candidate, and both write allocations/update balances without a transactional lock.

Current protections:

- `runTransactionMatch` checks for an existing match first.
- `insertMatchOrGetExisting` handles a unique violation on `transaction_id` and returns the existing match.
- Manual apply rejects matches that are already resolved or have existing allocations.
- Manual transaction ID generation retries duplicate generated IDs.
- Plaid upsert uses `onConflict: "plaid_transaction_id"`.

Still risky:

- The code assumes the `matches.transaction_id` unique constraint exists, but the migration is not in the repo.
- Allocation insert and invoice update are separate Supabase calls.
- There is no database transaction across match/allocations/invoice updates.
- Manual apply uses application rollback, which can fail.
- No invoice row locks or balance version checks.
- Concurrent Plaid syncs can race around "new" transaction detection.

Database constraints/transactions to add:

- Unique `matches(transaction_id)`.
- Foreign keys for transaction/match/invoice references.
- Check `allocations.amount > 0`.
- Unique or controlled allocation constraints.
- Postgres RPC `apply_match_allocations(transaction_id, allocations, reason, actor_id, run_id)`.
- Row locks on selected invoices and match rows.
- Audit insert in the same transaction.

Idempotent matching design:

- Create a `reconciliation_runs` row for each run.
- Give each transaction matching attempt an idempotency key: `transaction_id + matcher_version`.
- Insert or select match by transaction ID.
- If match exists and is resolved, return it.
- If match exists as in-progress, wait/retry or return job status.
- Inside transaction, re-read invoice balances and validate allocations.
- Commit all writes atomically.

# 13. Observability and Auditability

Logs:

- API request logs with route, organization, actor, status, latency.
- Plaid sync logs with item/account, cursor/date range, fetched/new/updated counts.
- Matching logs with transaction ID, run ID, outcome, latency, candidate count.
- LLM logs with request ID, model, prompt version, validation result, latency, token/cost.
- Error logs with stack traces and safe context.

Metrics:

- Match rate.
- Human-review rate.
- Unmatched rate.
- Manual override rate.
- LLM usage rate.
- LLM invalid response rate.
- Average matching latency.
- Plaid sync success/failure rate.
- Import success/failure rate.
- Invoice balance mutation failures.
- Queue depth and job age.

Audit tables/admin views:

- `audit_logs`: immutable actor/action/entity/before/after/reason.
- `match_decision_logs`: candidate snapshot, scores, thresholds, decision path.
- `llm_decision_logs`: prompt version, model, input hash/payload, output, validation reason.
- `invoice_balance_events`: every balance change with allocation ID and prior/new balance.
- `plaid_sync_runs`: already started; extend with organization/item/account/cursor.
- `import_batches` and `import_rows`.
- Admin dashboard for stuck jobs, failed syncs, high-risk manual actions, and review queue aging.

# 14. Security Review

Supabase service role key usage:

- `src/lib/supabase/server.ts` creates a service-role client using `SUPABASE_SERVICE_ROLE_KEY`.
- This is acceptable only in trusted server code.
- There is no auth or tenant filter in queries, so before real customers this must change.

Client vs server code:

- Good: OpenAI/Plaid/Supabase service clients are in server-side files/routes.
- Risk: API routes are unauthenticated, so any caller who can reach the app could import invoices, create transactions, run matching, or apply payments.

OpenAI API key safety:

- Key stays server-side in `openai-server.ts`.
- Production should add request logging, rate limits, model allowlist, and PII minimization.

Plaid secrets:

- Plaid credentials are server-side in `plaid/client.ts`.
- Production needs secure access token storage, item/account model, webhook validation, and environment separation.

Input validation:

- Some field validation exists.
- Missing: auth checks, tenant checks, request size limits, rate limits, schema validation library, CSRF/session considerations, and file upload limits.

Multi-tenant data isolation:

- Missing. Add `organization_id` to all business tables.
- Enforce RLS policies in Supabase.
- Avoid service-role broad reads in normal request handling, or wrap access in authorization-aware repository functions.

Authentication/authorization missing pieces:

- Users.
- Organizations.
- Roles/permissions.
- Audit actor identity.
- Route guards.
- Admin vs reviewer vs viewer roles.
- Approval rules for high-value manual applies.

Before real customers:

- Add auth and RLS.
- Scope every query by organization.
- Remove or protect debug endpoints.
- Add rate limiting.
- Add secrets management and environment validation.
- Add audit logs.
- Add database constraints and transactions.

# 15. Interview Questions They Might Ask

## Project Walkthrough

Q: What does your project do?

A: "It reconciles incoming bank transactions against open invoices. Users can import invoices, sync or create transactions, run a matcher, review ambiguous cases, and apply payments. The core records are transactions, invoices, matches, and allocations."

Q: What is the most important design decision?

A: "Separating matches from allocations. A match is the decision for a transaction; allocations are the dollars applied to invoices. That supports unmatched, review-needed, one-invoice, partial, and multi-invoice outcomes."

## Data Modeling

Q: Why not just put `transaction_id` on invoices?

A: "Because one transaction can pay multiple invoices and one invoice can receive multiple payments. A join/allocation table is the correct accounting shape."

Q: What is missing from the model?

A: "Customers, organizations, users, line items, payments, credits, refunds, audit logs, and reconciliation runs."

## System Design

Q: How would this work at scale?

A: "I would page dashboards, process matching in jobs, prefilter candidates in the database, and lock rows during apply. I would not scan all open invoices per transaction."

Q: How would you design the background job system?

A: "Plaid sync and match batches become jobs with run IDs, status, attempts, and idempotency keys. Workers process bounded batches and write progress to the database."

## Production Quality

Q: What production concern worries you most?

A: "Atomicity of financial writes. The current code inserts allocations and updates invoice balances in separate calls. In production that must be one database transaction with row locks and audit logging."

Q: How would you improve code quality?

A: "Split matching orchestration into pure decision logic, repositories, allocation planner, and persistence/apply service. Then unit test the pure logic and integration test the apply transaction."

## Scalability

Q: What breaks with 100,000 invoices?

A: "Candidate generation currently loads and scores all eligible invoices. I would add DB prefilters and indexes, then score only a bounded candidate set."

Q: What breaks with many users?

A: "There is no tenant model. Every table needs `organization_id`, every query must be scoped, and Supabase RLS/auth must enforce isolation."

## Matching Logic

Q: How do you avoid false positives?

A: "Name similarity is the safety gate. Amount alone cannot decide. Ambiguous ties go to human review, and LLM outputs are validated before writes."

Q: How do you handle partial payments?

A: "A payment below balance can create an allocation and leave the invoice `partially_paid`. Production would add a payment ledger and balance history."

## LLM Safety

Q: Why use an LLM at all?

A: "Only for fuzzy ambiguity where deterministic scoring has candidate evidence but cannot confidently resolve naming noise. It proposes a structured decision; deterministic validation and DB constraints control application."

Q: How do you stop hallucinated invoice IDs?

A: "The prompt lists allowed IDs, the schema restricts shape, validation rejects any ID outside candidates, and production should also enforce FK constraints and store candidate snapshots."

## Frontend/UI

Q: What is good about the UI?

A: "It maps persisted states into operational queues: applied, review needed, unmatched, pending, and outgoing. The detail page explains why a decision happened and shows candidate evidence."

Q: What would you improve?

A: "Server-side pagination, role-aware actions, richer manual allocation UX, and review workflow metadata like assignee, comments, and audit history."

## Database

Q: What indexes would you add first?

A: "`matches(transaction_id)` unique, `transactions(plaid_transaction_id)` unique, `invoices(status, balance_due)`, `transactions(direction, date)`, plus tenant-scoped versions of all of them."

Q: Why are migrations important here?

A: "Financial correctness should be enforced in the database. The repo currently only includes the Plaid sync migration, so production would need complete migrations for core tables, constraints, indexes, and RLS."

## Behavioral

Q: What did you learn from the feedback?

A: "I should slow down earlier to clarify requirements before locking the model. I built the right general domain direction, but I would now ask more about payment/invoice relationships, overpayments, credits, audit history, permissions, and scale before coding."

Q: How do you respond to code quality feedback?

A: "I agree with it. The v1 proves the workflow, but production code needs stronger boundaries, tests, and database guarantees. I can point to exactly where I would improve it and why."

# 16. File-by-File Weaknesses and Improvements

## `src/lib/matching/run-transaction-match.ts`

Does: core matching orchestration, candidate assessment, deterministic/LLM/manual apply, match/allocation persistence, invoice updates.

Good: thoughtful safety logic, handles existing matches, outgoing transactions, ambiguous candidates, exact multi-invoice combinations, partial payments, and manual apply checks.

Weak: too large; mixes persistence and domain logic; no DB transaction; application rollback; thresholds hardcoded; duplicated fetch helpers.

Improve: split into `MatchRepository`, `CandidateAssessment`, `AllocationPlanner`, `MatchDecisionService`, `PaymentApplicationService`; move apply into Postgres transaction/RPC; add audit logging.

Interview: "This is the most important file and also the first one I would refactor for production."

## `src/lib/matching/candidate-engine.ts`

Does: scores candidate invoices by name and amount.

Good: deterministic, explainable, handles noisy tokens and partial amount compatibility.

Weak: scans all eligible invoices passed to it; no customer alias/history; no date/remittance/currency logic.

Improve: DB prefilter, normalized customer aliases, invoice-number extraction, match history, regression tests.

## `src/lib/matching/llm-decision.ts`

Does: prompt/schema construction, LLM response parsing, deterministic validation.

Good: strong safety posture; candidate-only universe; validates IDs, shape, confidence, totals, and balances.

Weak: does not persist prompt version/input/output/validation failure; no confidence threshold for auto-apply beyond structural validation.

Improve: audit table, prompt versioning, model monitoring, human-review fallback for high risk.

## `src/lib/matching/process-new-transactions.ts`

Does: sequentially runs matching for unique transaction IDs and counts outcomes.

Good: simple, readable, isolates batch summary.

Weak: sequential and request-bound; no concurrency controls, job status, retries, or cancellation.

Improve: background queue with bounded concurrency and per-transaction job records.

## `src/app/api/matches/run/[transactionId]/route.ts`

Does: runs one transaction match.

Good: thin route; maps not found to 404.

Weak: unauthenticated; no tenant authorization; no idempotency key; no rate limiting.

Improve: auth guard, organization scope, job trigger for slow work.

## `src/app/api/matches/run-all/route.ts`

Does: loads all transactions and all matches, filters pending in memory, processes them.

Good: straightforward for v1.

Weak: full-table reads; long request; includes pending outgoing transactions; no batching limit.

Improve: DB anti-join/limit, background batch job, progress status, only eligible incoming transactions unless intentionally processing outgoing.

## `src/app/api/matches/manual-apply/route.ts`

Does: validates request body and calls manual apply service.

Good: handles JSON syntax errors and domain error statuses.

Weak: unauthenticated; no reviewer identity/comment; only single invoice apply.

Improve: actor context, audit event, multi-invoice manual allocations, authorization.

## `src/app/api/plaid/sandbox-transactions/route.ts`

Does: Plaid sandbox token flow, transaction fetch, upsert, new transaction matching, sync-run status.

Good: tracks sync runs and auto-processes new rows.

Weak: too much in route; fixed 30-day/50-row fetch; sandbox-only shape; no Plaid cursor; no locking per item; sync and matching happen in HTTP request.

Improve: Plaid service + background job, `/transactions/sync`, account/item tables, cursor storage, webhook support.

## `src/lib/invoices/import-csv.ts`

Does: CSV parsing/import; header normalization; amount/line-item parsing; duplicate invoice grouping.

Good: robust for a take-home; returns clear errors; supports flexible formats.

Weak: upsert can overwrite existing invoice balances; line items are collapsed into totals; no import batch/audit; no tenant context.

Improve: import batches, raw row storage, line item table, safe update policy, tenant-scoped uniqueness.

## `src/app/reconciliation/page.tsx`

Does: loads transactions, matches, latest sync run; builds dashboard items.

Good: simple server composition; clear state mapping through component.

Weak: loads all transactions and matches; in-memory join; no pagination or filters on server.

Improve: server-side pagination/counts, scoped queries, materialized summaries.

## `src/app/reconciliation/[transactionId]/page.tsx`

Does: transaction detail, persisted outcome, allocations, candidate evidence, manual apply actions.

Good: useful review UX; restores allocated invoice balance into candidate pool so applied candidates can still be explained.

Weak: very large page file; duplicated candidate rendering; no reviewer/audit metadata; candidate recomputation may differ from original decision if invoice data changed.

Improve: split components; store candidate snapshots; display audit timeline.

## `src/components/transaction-outcome-board.tsx`

Does: groups transactions into operational queues, search, pagination per section, outgoing toggle.

Good: maps domain states into practical finance work queues.

Weak: client-side grouping/search/pagination over all loaded data; pending count includes outgoing.

Improve: server-backed filters/counts and virtualized/paginated lists.

# 17. Final Study Checklist

Files to open before the interview:

- `src/lib/matching/run-transaction-match.ts`
- `src/lib/matching/candidate-engine.ts`
- `src/lib/matching/llm-decision.ts`
- `src/lib/matching/process-new-transactions.ts`
- `src/app/api/plaid/sandbox-transactions/route.ts`
- `src/app/api/matches/run-all/route.ts`
- `src/app/api/matches/manual-apply/route.ts`
- `src/lib/invoices/import-csv.ts`
- `src/app/reconciliation/page.tsx`
- `src/app/reconciliation/[transactionId]/page.tsx`
- `src/components/transaction-outcome-board.tsx`

Flows to explain:

- CSV import to `invoices`.
- Plaid sync to `transactions` and automatic matching.
- Manual transaction creation.
- Single transaction matching.
- Process pending batch.
- Human review manual apply.

Weaknesses to admit:

- Not enough up-front requirements gathering.
- Missing core migrations in repo.
- No auth/tenant model.
- No DB transaction for financial apply.
- Full-table reads and in-memory matching.
- Large matching orchestration file.
- Limited audit/observability.

Improvements to propose:

- Complete schema with constraints/indexes.
- Organizations/users/RLS.
- Transaction-safe allocation RPC.
- Background jobs.
- Audit logs and decision logs.
- Candidate search prefiltering.
- Generated DB types and test suite.

Questions to ask them:

- What false-positive rate is acceptable for auto-apply?
- How common are partial, over, and multi-invoice payments?
- Do customers provide remittance data?
- What scale should the system support?
- What audit/compliance expectations exist?
- Who can manually apply payments?
- Is LLM assistance acceptable, and under what safeguards?

90-second project pitch:

"This is an invoice reconciliation dashboard. It imports invoices, ingests Plaid or manual bank transactions, and matches incoming payments to open invoices. The core model is invoices, transactions, matches, and allocations. The matching engine first creates ranked candidates using customer-name similarity and amount compatibility. It auto-applies only when evidence is strong, creates allocations, and updates invoice balances. Ambiguous cases are persisted for human review. For some fuzzy cases, it can ask an LLM for a structured decision, but the LLM is only advisory: the code validates candidate IDs, allocation totals, balances, and safety thresholds before any write. If I were productionizing this, I would add complete database constraints, transaction-safe allocation writes, auth/tenant isolation, audit logs, background jobs, server-side pagination, and a stronger test/regression suite."

5-minute deep technical walkthrough:

1. Start with the data model: invoices are receivables; transactions are bank activity; matches are decisions; allocations are dollars applied to invoices.
2. Walk through invoice import and Plaid/manual transaction ingestion.
3. Explain candidate generation: normalize noisy names, score name and amount, filter below threshold, return ranked top candidates.
4. Explain decisioning: outgoing becomes ineligible; no candidate becomes unmatched; strong exact single candidate auto-applies; exact multi-invoice sum can auto-apply; ambiguous ties go to review; LLM proposes only after deterministic gates.
5. Explain persistence: match row, allocation rows, invoice balance/status updates.
6. Call out production gaps honestly: apply writes must be atomic, tenant/auth missing, scale needs pagination/jobs/indexes, audit logs missing.
7. End with production plan: schema hardening, transaction/RPC apply, background workers, observability, and regression tests.

# Project Study Guide

## 1. What This App Does

This is an internal invoice reconciliation dashboard built with Next.js 16 App Router, React, Supabase, Plaid, and OpenAI.

At a high level, the app helps finance operations:

- Import invoices from CSV or create invoices manually.
- Ingest bank transactions from Plaid sandbox or create transactions manually.
- Compare incoming payment transactions against open invoices.
- Automatically apply safe matches.
- Send ambiguous cases to human review.
- Allow a reviewer to manually apply a reviewed payment to one invoice.
- Track the final reconciliation outcome in the database.

The core business concept is:

- `invoices` represent receivables with an original amount, remaining balance, and status.
- `transactions` represent bank activity.
- `matches` represent the reconciliation decision for one transaction.
- `allocations` represent money applied from a transaction match to invoice(s).
- `plaid_sync_runs` records Plaid sandbox sync attempts and outcome counts.

## 2. Main Folder Responsibilities

### `src/app`

Next.js App Router UI routes and API route handlers.

- `page.tsx` files expose browser pages.
- `route.ts` files expose backend HTTP endpoints.
- Dynamic folders such as `[transactionId]` represent URL parameters.
- Server components load data directly from Supabase.
- Client components call API routes with `fetch`.

### `src/components`

Reusable client-side UI components used by app pages:

- Invoice import form.
- Manual invoice form.
- Manual transaction form.
- Plaid sync panel.
- Reconciliation transaction board.
- Process-pending button.

### `src/data`

Seed/sample input data. In this repo it contains a mock invoice CSV.

### `src/lib`

Server-side and shared business logic:

- CSV invoice parsing/import.
- Due date formatting and invoice due status.
- Supabase server client.
- Plaid client and sync-run helpers.
- Matching engine, LLM-assisted matching, match status helpers, and UI mapping helpers.

### `src/scripts`

Developer/seed scripts run from the command line:

- Import mock invoices.
- Seed test transactions and run matching.

### `src/types`

The folder exists but is empty in this checkout. Most types are currently defined near the files that use them.

### `supabase/migrations`

Database migrations included with this repo. This checkout contains only the `plaid_sync_runs` migration. The app also depends on `invoices`, `transactions`, `matches`, and `allocations`, but their create-table migrations are not present here.

## 3. File-By-File Project Structure

### Root Files

- `package.json`
  - Defines scripts and dependencies.
  - Key scripts: `npm run dev`, `npm run build`, `npm run lint`, `npm run import:invoices`.
  - Key dependencies: `next`, `react`, `@supabase/supabase-js`, `plaid`, `openai`, `csv-parse`.

- `next.config.ts`
  - Next.js config file.

- `tsconfig.json`
  - TypeScript config.

- `eslint.config.mjs`
  - ESLint config.

- `postcss.config.mjs`
  - PostCSS/Tailwind processing config.

- `README.md`
  - Default create-next-app README.

- `AGENTS.md`
  - Local instruction file noting that this Next.js version may differ from older conventions.

### `src/app`

- `src/app/layout.tsx`
  - Root layout for every page.
  - Loads Geist fonts.
  - Sets metadata title/description.
  - Wraps all pages in the base HTML/body shell.

- `src/app/globals.css`
  - Imports Tailwind CSS.
  - Defines background, foreground, and font theme variables.

- `src/app/favicon.ico`
  - App icon.

- `src/app/page.tsx`
  - Home/dashboard page.
  - Shows navigation cards for Reconciliation and Invoices.
  - Embeds the manual transaction form, manual invoice form, and CSV invoice import form.

### `src/app/invoices`

- `src/app/invoices/page.tsx`
  - Server page for `/invoices`.
  - Loads all invoices from Supabase.
  - Calculates total/open/partially-paid/paid counts.
  - Passes invoice rows to `InvoiceListClient`.

- `src/app/invoices/invoice-list-client.tsx`
  - Client-side invoice table and filters.
  - Supports search, status filter, due-status filter, and invoice-date range filters.
  - Splits positive invoices from negative credit items.
  - Uses due status helpers from `src/lib/invoices/due-status.ts`.

### `src/app/reconciliation`

- `src/app/reconciliation/page.tsx`
  - Main reconciliation dashboard at `/reconciliation`.
  - Loads transactions, matches, and latest Plaid sync run.
  - Joins transactions to existing match rows in memory.
  - Renders `PlaidSyncPanel` and `TransactionOutcomeBoard`.

- `src/app/reconciliation/[transactionId]/page.tsx`
  - Transaction detail/review page.
  - Loads one transaction, its persisted match, allocations, and candidate invoices.
  - Shows transaction summary, match outcome, explanation, allocations, and candidate evidence.
  - For review-needed matches, exposes manual apply actions.
  - Restores allocated invoice balances into the candidate pool so previously applied invoices can still be shown as candidates.

- `src/app/reconciliation/[transactionId]/run-match-button.tsx`
  - Client button for an unprocessed transaction.
  - Calls `POST /api/matches/run/[transactionId]`.
  - Refreshes the route after the match is created.

- `src/app/reconciliation/[transactionId]/manual-apply-button.tsx`
  - Client button shown during human review.
  - Calls `POST /api/matches/manual-apply` with `transactionId` and `invoiceId`.
  - Refreshes after a successful manual application.

### `src/app/transactions`

- `src/app/transactions/page.tsx`
  - Redirects `/transactions` to `/reconciliation`.

### `src/app/api/invoices`

- `src/app/api/invoices/import/route.ts`
  - Handles CSV invoice import.
  - Requires `multipart/form-data`.
  - Validates the uploaded file is CSV.
  - Calls `parseInvoiceCsv`.
  - Calls `importInvoiceRecords` to upsert invoices into Supabase.

- `src/app/api/invoices/manual/route.ts`
  - Creates one invoice from a JSON request.
  - Validates invoice number, customer name, invoice date, due date, and line items.
  - Optionally calculates tax for NY, NJ, CA, or TX.
  - Inserts into `invoices` with `status: "open"` and `balance_due` equal to total.

### `src/app/api/transactions`

- `src/app/api/transactions/manual/route.ts`
  - Creates one manual transaction.
  - Validates name, date, positive amount, and direction.
  - Generates a synthetic `plaid_transaction_id`.
  - Stores incoming transactions as negative amounts and outgoing transactions as positive amounts.
  - Inserts into `transactions`.

### `src/app/api/matches`

- `src/app/api/matches/run/[transactionId]/route.ts`
  - Runs matching for one transaction.
  - Calls `runTransactionMatch(transactionId)`.
  - Returns the match result as JSON.

- `src/app/api/matches/run-all/route.ts`
  - Finds transactions that do not yet have a match.
  - Calls `runAutomaticMatchingForTransactions` for those pending IDs.
  - Returns processed/matched/review/unmatched/failure counts.

- `src/app/api/matches/manual-apply/route.ts`
  - Manual review endpoint.
  - Requires `transactionId` and `invoiceId`.
  - Calls `applyManualSingleInvoiceMatch`.
  - Returns updated transaction, match, and allocations.

- `src/app/api/matches/candidates/[transactionId]/route.ts`
  - Debug/inspection endpoint for candidate generation.
  - Loads one transaction and eligible invoices.
  - Returns ranked candidates from `buildCandidates`.

### `src/app/api/plaid`

- `src/app/api/plaid/sandbox-transactions/route.ts`
  - Main Plaid sandbox ingestion endpoint.
  - Creates a `plaid_sync_runs` row with `running` status.
  - Creates a Plaid sandbox public token and exchanges it for an access token.
  - Fetches the last 30 days of transactions.
  - Normalizes direction from Plaid amount: negative means incoming, positive means outgoing.
  - Upserts into `transactions` on `plaid_transaction_id`.
  - Runs automatic matching only for newly inserted transactions.
  - Completes or fails the Plaid sync run with counts.

- `src/app/api/plaid/sync-status/route.ts`
  - Returns the latest Plaid sync run from `plaid_sync_runs`.

- `src/app/api/plaid/test/route.ts`
  - Simple Plaid connectivity test.
  - Calls Plaid institutions API and returns one institution name.

## 4. Components

- `src/components/invoice-import-form.tsx`
  - Drag/drop or file picker CSV upload UI.
  - Posts to `/api/invoices/import`.
  - Shows success/error feedback and links to `/invoices`.

- `src/components/manual-invoice-form.tsx`
  - Client form for creating invoices by line items.
  - Calculates subtotal, optional tax, and total in the browser.
  - Posts to `/api/invoices/manual`.

- `src/components/manual-transaction-form.tsx`
  - Client form for adding a transaction without Plaid.
  - Posts to `/api/transactions/manual`.
  - Explains that incoming amounts are stored as negative values.

- `src/components/plaid-sync-panel.tsx`
  - UI for Plaid sandbox sync.
  - Shows latest sync state and summary.
  - Calls `/api/plaid/sandbox-transactions`.
  - Refreshes the reconciliation page after sync.

- `src/components/process-pending-transactions-button.tsx`
  - Button shown in the pending transaction section.
  - Calls `/api/matches/run-all`.
  - Refreshes after processing.

- `src/components/transaction-outcome-board.tsx`
  - Main transaction grouping UI.
  - Groups incoming transactions into Applied, Review Needed, Unmatched, and Pending.
  - Keeps outgoing transactions hidden unless toggled.
  - Provides search and per-section pagination.
  - Links each transaction to `/reconciliation/[transactionId]`.

## 5. `src/lib` Files

### Invoice Helpers

- `src/lib/invoices/import-csv.ts`
  - Parses invoice CSV files.
  - Supports direct amount columns and line-item-based totals.
  - Normalizes headers, dates, money, and duplicate invoice rows.
  - Groups duplicate invoice numbers if the invoice metadata matches.
  - Imports invoices with Supabase upsert on `invoice_number`.

- `src/lib/invoices/due-status.ts`
  - Formats invoice dates.
  - Computes due status: paid, current, almost due, overdue, or no due date.
  - Provides Tailwind class names for due-status badges.

### Supabase

- `src/lib/supabase/server.ts`
  - Creates a Supabase server client.
  - Uses `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

### Plaid

- `src/lib/plaid/client.ts`
  - Configures Plaid client.
  - Chooses sandbox/development/production from `PLAID_ENV`.
  - Uses `PLAID_CLIENT_ID` and `PLAID_SECRET`.

- `src/lib/plaid/sync-run-types.ts`
  - Type definitions for Plaid sync run rows and sync summaries.

- `src/lib/plaid/sync-runs.ts`
  - Creates, completes, fails, and loads latest Plaid sync runs in `plaid_sync_runs`.

### OpenAI/LLM

- `src/lib/llm/openai-server.ts`
  - Server-only OpenAI wrapper.
  - Uses the Responses API with strict JSON schema output.
  - Defaults to model `gpt-5.2` unless `OPENAI_MATCHING_MODEL` is set.
  - Supports a local non-production override through `OPENAI_MATCHING_RESPONSE_OVERRIDE`.

### Matching Engine

- `src/lib/matching/candidate-engine.ts`
  - Builds ranked invoice candidates for a transaction.
  - Ignores outgoing transactions.
  - Scores customer/name similarity with token cleanup, legal-entity token removal, noise token removal, and identifier-token weighting.
  - Scores amount compatibility, including exact matches, partial payments, close tolerances, and overpayment rejection.
  - Combines scores as 80% name score and 20% amount score.
  - Filters out candidates with `name_score < 0.65`.
  - Returns up to 10 candidates.

- `src/lib/matching/run-transaction-match.ts`
  - Core reconciliation engine.
  - Loads transaction, existing match, eligible invoices, candidates, and allocations.
  - Decides between unmatched, human review, deterministic auto-apply, LLM-assisted apply, or manual apply.
  - Writes `matches`.
  - Writes `allocations`.
  - Updates invoice `balance_due` and `status`.
  - Contains manual apply rollback logic if invoice update/allocation insert fails.

- `src/lib/matching/llm-decision.ts`
  - Builds the LLM prompt and JSON schema.
  - Calls `createStructuredJsonResponse`.
  - Parses and validates LLM decisions.
  - Enforces safety rules after the model responds:
    - selected invoice IDs must be in the candidate list;
    - selected candidates must meet the name threshold;
    - allocations must be positive;
    - allocations must not exceed invoice balances;
    - allocations must sum exactly to the payment amount;
    - single/multi/unmatched shapes must be internally consistent.

- `src/lib/matching/process-new-transactions.ts`
  - Runs `runTransactionMatch` over a list of transaction IDs.
  - Produces counts for succeeded, failed, matched, review-needed, and unmatched.
  - Used by Plaid sync and the process-pending endpoint.

- `src/lib/matching/match-status.ts`
  - Defines match statuses:
    - `matched`
    - `partially_matched`
    - `unmatched`
    - `human_review_needed`
  - Formats labels and identifies applied match statuses.

- `src/lib/matching/match-ui.ts`
  - Maps persisted match state to UI badge classes, origins, action labels, and short explanations.
  - Infers origin from status/reason: Deterministic, LLM-assisted, Manual Review, Review Queue, or Unmatched.

## 6. `src/scripts`

- `src/scripts/import-invoices.ts`
  - CLI script for importing `src/data/mock_invoice.csv`.
  - Loads `.env.local`.
  - Parses the CSV in `lineItems` mode.
  - Upserts invoices into Supabase.

- `src/scripts/seed-test-transactions.ts`
  - CLI seed script.
  - Loads first two invoices.
  - Creates exact, partial, and unmatched incoming transactions.
  - Upserts them into `transactions`.
  - Runs automatic matching for newly inserted transactions.

## 7. `src/data`

- `src/data/mock_invoice.csv`
  - Sample invoice data.
  - Uses columns like `InvoiceNumber`, `CustomerName`, `InvoiceDate`, `DueDate`, `LineItems`, and `PaymentMethod`.
  - Includes similar customer names and duplicate-looking amounts to exercise fuzzy matching and ambiguity handling.

## 8. `supabase/migrations`

- `supabase/migrations/20260423170000_add_plaid_sync_runs.sql`
  - Enables `pgcrypto`.
  - Creates `public.plaid_sync_runs`.
  - Adds status checks for `running`, `success`, and `failed`.
  - Stores fetched/new/processed/matched/review/unmatched counts.
  - Adds an index on `(source, created_at desc)`.

## 9. Main Reconciliation Flow

### UI to API

1. User opens `/reconciliation`.
2. `src/app/reconciliation/page.tsx` loads:
   - all `transactions`;
   - all `matches`;
   - latest `plaid_sync_runs` row.
3. `TransactionOutcomeBoard` groups transactions:
   - Applied: match status `matched` or `partially_matched`;
   - Review Needed: `human_review_needed`;
   - Unmatched: `unmatched`;
   - Pending: no match row;
   - Outgoing: hidden separately.
4. User can process all pending transactions.
   - `ProcessPendingTransactionsButton` calls `POST /api/matches/run-all`.
5. User can open a transaction detail page.
   - `/reconciliation/[transactionId]` shows match outcome and candidates.
6. User can run a single match.
   - `RunMatchButton` calls `POST /api/matches/run/[transactionId]`.
7. User can manually apply a review-needed transaction.
   - `ManualApplyButton` calls `POST /api/matches/manual-apply`.

### API to Backend Logic

- `POST /api/matches/run/[transactionId]`
  - Calls `runTransactionMatch`.

- `POST /api/matches/run-all`
  - Finds transactions without matches.
  - Calls `runAutomaticMatchingForTransactions`.
  - That loops through each ID and calls `runTransactionMatch`.

- `POST /api/matches/manual-apply`
  - Calls `applyManualSingleInvoiceMatch`.

### Backend Logic to Database Writes

`runTransactionMatch`:

1. Loads the transaction.
2. Returns existing match if already persisted.
3. Marks outgoing transactions as `unmatched`.
4. Loads eligible invoices:
   - status is `open` or `partially_paid`;
   - `balance_due > 0`.
5. Builds candidates with `buildCandidates`.
6. Assesses ambiguity and safety.
7. Persists one of:
   - `matches` row with `unmatched`;
   - `matches` row with `human_review_needed`;
   - `matches` row with `matched` or `partially_matched`;
   - one or more `allocations`;
   - updated invoice balances/statuses.

## 10. Invoice Import Flow

### CSV Import

1. User uploads a CSV in `InvoiceImportForm`.
2. Form posts multipart data to `/api/invoices/import`.
3. Route validates content type and file type.
4. Route reads file text and calls `parseInvoiceCsv(csvContent, { amountMode: "auto" })`.
5. Parser:
   - accepts flexible header casing/spelling;
   - validates required columns;
   - normalizes dates to `YYYY-MM-DD`;
   - parses either amount columns or line items;
   - groups duplicate invoice numbers when details match;
   - sets `amount`, `balance_due`, and `status: "open"`.
6. Route calls `importInvoiceRecords`.
7. `importInvoiceRecords`:
   - checks which invoice numbers already exist;
   - upserts records into `invoices` on `invoice_number`;
   - returns imported and updated counts.

### Manual Invoice Creation

1. User fills out `ManualInvoiceForm`.
2. Client calculates subtotal/tax/total for display.
3. Form posts JSON to `/api/invoices/manual`.
4. Route validates fields and recalculates totals server-side.
5. Route inserts into `invoices`.

## 11. Transaction Ingestion Flow

### Plaid Sandbox Sync

1. User clicks sync in `PlaidSyncPanel`.
2. Client calls `/api/plaid/sandbox-transactions`.
3. Route creates a `plaid_sync_runs` row with `status: "running"`.
4. Route creates a Plaid sandbox public token.
5. Route exchanges it for an access token.
6. Route fetches the last 30 days of Plaid transactions.
7. Each Plaid transaction is normalized:
   - `plaid_transaction_id`;
   - `date`;
   - `name`;
   - `amount`;
   - `direction`, where negative amount means incoming.
8. Route checks existing `plaid_transaction_id`s.
9. Route upserts transactions into `transactions`.
10. Only newly inserted transactions are passed to `runAutomaticMatchingForTransactions`.
11. Route completes or fails the `plaid_sync_runs` row.

### Manual Transaction Creation

1. User fills out `ManualTransactionForm`.
2. Form posts to `/api/transactions/manual`.
3. Route validates fields.
4. Route generates a synthetic Plaid-like transaction ID.
5. Incoming transactions are stored as negative amounts.
6. Outgoing transactions are stored as positive amounts.
7. Route inserts into `transactions`.
8. The transaction appears as pending until matching is run.

## 12. How The Matching Engine Works

### Candidate Generation

`buildCandidates` compares one incoming transaction against eligible invoices.

For each invoice:

- Compute `name_score`.
  - Lowercase and tokenize transaction name and customer name.
  - Remove legal-entity tokens like `inc`, `llc`, `corp`.
  - Remove transaction noise like `ach`, `payment`, `transfer`, `stripe`.
  - Give numeric identifier tokens extra weight.
  - Use overlap/coverage/Dice-style scoring.

- Compute `amount_score`.
  - Exact amount match: strongest.
  - Payment smaller than balance: possible partial payment.
  - Payment slightly above balance: tolerated only within small close thresholds.
  - Payment much above balance: weak.

- Compute total score:
  - `total = name_score * 0.8 + amount_score * 0.2`.

- Filter:
  - candidate must have `name_score >= 0.65`.

- Sort:
  - name score first;
  - amount score second;
  - total score third.

### Deterministic Matching

`runTransactionMatch` tries deterministic rules before LLM help.

It can auto-apply when:

- The top candidate has strong name similarity.
- Overall score is high enough.
- There is no dangerous close competitor.
- Amount is exact or safely allocable.
- Multi-invoice combinations are clear and exact.

When deterministic auto-apply succeeds:

- A row is inserted into `matches`.
- One or more rows are inserted into `allocations`.
- Each invoice balance is reduced.
- Invoice status becomes:
  - `paid` when balance reaches zero;
  - `partially_paid` when a balance remains.

### Human Review

The engine avoids automatic application when a choice would be arbitrary.

It creates `human_review_needed` when:

- Multiple plausible candidates are close.
- Multiple candidates have exact or strong amount fits.
- Similar customer-family names make the choice ambiguous.
- Multiple exact multi-invoice combinations could explain the same payment.

Human review is a persisted match state, not just a UI label.

### LLM-Assisted Matching

The LLM is used only after deterministic clear cases and hard human-review cases are handled.

Flow:

1. `applyLlmAssistedMatch` builds a prompt from the transaction and ranked candidates.
2. `llm-decision.ts` asks OpenAI for strict JSON.
3. The response must fit the schema:
   - `unmatched`;
   - `single_invoice`;
   - `multi_invoice`.
4. The code validates the LLM decision before applying anything.
5. If validation passes, the system persists the planned match and allocations.
6. If the LLM fails or returns unsafe output, the code falls back to unmatched or human review.

The important interview point: the model does not write to the database directly. It proposes a structured decision, and deterministic validation decides whether it is safe to apply.

### Manual Apply

Manual apply is available for unresolved persisted outcomes:

- allowed statuses:
  - `human_review_needed`;
  - `unmatched`;
- in the UI, it is shown for `human_review_needed`.

`applyManualSingleInvoiceMatch`:

1. Loads transaction.
2. Requires incoming direction.
3. Requires an existing unresolved match.
4. Rejects already resolved matches.
5. Rejects matches with existing allocations.
6. Rebuilds eligible candidates.
7. Requires selected invoice to still be an eligible candidate.
8. Builds a one-invoice allocation plan.
9. Rejects overpayment for manual single-invoice apply.
10. Inserts allocation, updates invoice, then updates match.
11. Attempts rollback if part of the write sequence fails.

## 13. Database Tables Used

### `invoices`

Represents invoices/receivables.

Fields inferred from app usage:

- `id`
- `invoice_number`
- `customer_name`
- `invoice_date`
- `due_date`
- `amount`
- `balance_due`
- `status`

Statuses used:

- `open`
- `partially_paid`
- `paid`

### `transactions`

Represents bank transactions from Plaid or manual entry.

Fields inferred from app usage:

- `id`
- `plaid_transaction_id`
- `date`
- `name`
- `amount`
- `direction`

Directions:

- `incoming`
- `outgoing`

Important convention:

- Incoming payments are stored as negative amounts.
- Matching uses `Math.abs(transaction.amount)` when allocating payments.

### `matches`

Represents the reconciliation outcome for one transaction.

Fields inferred from app usage:

- `id`
- `transaction_id`
- `status`
- `confidence`
- `reason`

Statuses:

- `matched`
- `partially_matched`
- `unmatched`
- `human_review_needed`

Important behavior:

- The code expects one match per transaction.
- Existing matches are returned rather than recomputed.

### `allocations`

Represents payment amounts applied to invoices.

Fields inferred from app usage:

- `id`
- `match_id`
- `invoice_id`
- `amount`

Important behavior:

- A single match can have multiple allocations.
- Allocations are the durable link between a transaction match and invoice(s).

### `plaid_sync_runs`

Represents Plaid sync attempts.

Defined in the included migration:

- `id`
- `source`
- `started_at`
- `completed_at`
- `status`
- `fetched_count`
- `new_count`
- `processed_count`
- `matched_count`
- `review_needed_count`
- `unmatched_count`
- `error_message`
- `created_at`

## 14. Files To Focus On Most For An Interview

Focus first on these:

- `src/lib/matching/run-transaction-match.ts`
  - The heart of the app.
  - Explains deterministic matching, human review, LLM fallback, manual apply, allocations, and database writes.

- `src/lib/matching/candidate-engine.ts`
  - Explains how candidate scores are produced.
  - Good place to discuss fuzzy matching, name normalization, amount scoring, and safety thresholds.

- `src/lib/matching/llm-decision.ts`
  - Shows responsible LLM use.
  - Emphasize schema-constrained output and deterministic validation.

- `src/app/reconciliation/page.tsx`
  - Shows how the reconciliation dashboard is assembled from transactions and matches.

- `src/app/reconciliation/[transactionId]/page.tsx`
  - Shows how operations users inspect evidence and manually resolve review cases.

- `src/app/api/plaid/sandbox-transactions/route.ts`
  - Shows transaction ingestion and automatic processing of new bank activity.

- `src/lib/invoices/import-csv.ts`
  - Shows invoice import, validation, line-item parsing, and upsert behavior.

- `src/components/transaction-outcome-board.tsx`
  - Shows how persisted states become operational queues.

## 15. Interview Explanation

A concise way to explain the project:

> This is an invoice reconciliation dashboard for finance operations. It imports invoices, ingests bank transactions from Plaid or manual entry, and matches incoming payments to open invoices. The matching engine first uses deterministic scoring based mostly on customer-name similarity and secondarily on amount compatibility. Safe matches are automatically applied by creating a match, creating allocation rows, and updating invoice balances. Ambiguous cases are persisted as human-review items. For some fuzzy cases, the app asks an LLM for a structured decision, but it validates the response strictly before any database write. Reviewers can manually apply a payment from the transaction detail page when the system intentionally avoided an automatic choice.

Strong points to mention:

- The LLM is constrained and validated; it is not trusted blindly.
- The app keeps an audit-friendly state model with `matches` and `allocations`.
- It separates candidate generation, decisioning, persistence, and UI.
- It handles partial payments and multi-invoice allocations.
- It avoids over-applying payments and avoids unsafe automatic choices.
- Plaid sync records operational metrics in `plaid_sync_runs`.


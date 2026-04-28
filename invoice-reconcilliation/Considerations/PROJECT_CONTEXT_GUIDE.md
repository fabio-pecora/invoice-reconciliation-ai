# Project Context Guide

## Purpose

This file is a clear, reusable context document for the project.

Use it when:

- explaining the project to another engineer
- prompting an LLM with the current architecture
- brainstorming new features or refactors
- reviewing scalability, code quality, or product direction

## Project Summary

This project is an **invoice reconciliation dashboard**.

Its job is to:

1. ingest invoices
2. ingest bank transactions
3. identify which incoming payments match which invoices
4. auto-apply safe matches
5. send ambiguous cases to human review
6. keep invoice balances and statuses updated

The app is built with:

- Next.js App Router
- React
- TypeScript
- Supabase
- Plaid
- OpenAI
- Tailwind CSS

## Business Goal

The system is designed for finance operations users who need to reconcile incoming cash against accounts receivable.

Core business outcomes:

- show all invoices and balances
- sync or create transactions
- determine whether a payment matches one invoice, multiple invoices, or nothing
- keep a review queue for ambiguous cases
- allow a human to manually apply a payment when needed

## High-Level Flow

### Invoice intake

Invoices enter the system in two ways:

- CSV import
- manual invoice form

Invoices are stored in the `invoices` table.

### Transaction intake

Transactions enter the system in two ways:

- Plaid sandbox sync
- manual transaction form

Transactions are stored in the `transactions` table.

### Matching

For incoming transactions:

1. load eligible invoices
2. generate ranked candidate invoices
3. decide whether to:
   - auto-match
   - partially match
   - match across multiple invoices
   - send to human review
   - leave unmatched
4. persist the decision to `matches`
5. persist money application rows to `allocations`
6. update invoice balances and invoice status

### Review

If the system cannot safely choose a candidate, it creates a `human_review_needed` match result.

The detail page then shows:

- transaction summary
- persisted decision state
- ranked candidate invoices
- manual apply actions

## Important Domain Concepts

### Invoice

An invoice is money owed by a customer.

Important fields:

- invoice number
- customer name
- invoice date
- due date
- amount
- balance due
- status

### Transaction

A transaction is a bank activity record or manual cash activity record.

Important fields:

- Plaid transaction ID or generated manual ID
- date
- name
- amount
- direction

In this project:

- incoming transactions are stored as negative amounts
- outgoing transactions are stored as positive amounts

### Match

A match is the reconciliation decision for one transaction.

A match does not necessarily mean money was applied.

Possible match statuses:

- `matched`
- `partially_matched`
- `unmatched`
- `human_review_needed`

### Allocation

An allocation is the actual amount of a transaction applied to an invoice.

This is important because:

- one transaction can pay one invoice
- one transaction can pay multiple invoices
- one transaction can be partially applied

That is why `matches` and `allocations` are separate concepts.

## Main Pages

### `/`

Home page for operations entry points.

Shows:

- reconciliation workspace card
- invoices workspace card
- manual transaction form
- manual invoice form
- invoice import form

File:

- [src/app/page.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/page.tsx:1)

### `/reconciliation`

Main reconciliation dashboard.

Shows:

- latest Plaid sync state
- matched transactions
- review-needed transactions
- unmatched transactions
- pending transactions
- optional outgoing transactions

File:

- [src/app/reconciliation/page.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/reconciliation/page.tsx:1)

### `/reconciliation/[transactionId]`

Transaction detail page.

Shows:

- transaction summary
- current match result
- explanation
- candidate invoices
- allocations
- manual review actions

File:

- [src/app/reconciliation/[transactionId]/page.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/reconciliation/[transactionId]/page.tsx:1)

### `/invoices`

Invoice list and filtering page.

Shows:

- invoice counts
- invoice table
- credits table
- client-side filters

Files:

- [src/app/invoices/page.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/invoices/page.tsx:1)
- [src/app/invoices/invoice-list-client.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/invoices/invoice-list-client.tsx:1)

### `/transactions`

Redirects to reconciliation.

File:

- [src/app/transactions/page.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/transactions/page.tsx:1)

## Main API Routes

### `POST /api/transactions/manual`

Creates a manual transaction.

Validates:

- name
- date
- amount
- direction

Stores:

- generated manual transaction ID
- normalized amount sign

File:

- [src/app/api/transactions/manual/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/transactions/manual/route.ts:1)

### `POST /api/invoices/manual`

Creates a manual invoice from line items.

Can optionally calculate state tax.

File:

- [src/app/api/invoices/manual/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/invoices/manual/route.ts:1)

### `POST /api/invoices/import`

Imports invoice CSV data.

Uses CSV parsing and invoice upsert logic from `src/lib/invoices/import-csv.ts`.

File:

- [src/app/api/invoices/import/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/invoices/import/route.ts:1)

### `POST /api/matches/run-all`

Finds pending transactions and runs automatic matching for all of them.

File:

- [src/app/api/matches/run-all/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/matches/run-all/route.ts:1)

### `POST /api/matches/run/[transactionId]`

Runs matching for one transaction.

File:

- [src/app/api/matches/run/[transactionId]/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/matches/run/[transactionId]/route.ts:1)

### `GET /api/matches/candidates/[transactionId]`

Returns candidate invoices for one transaction.

This is useful for debugging the deterministic ranking logic.

File:

- [src/app/api/matches/candidates/[transactionId]/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/matches/candidates/[transactionId]/route.ts:1)

### `POST /api/matches/manual-apply`

Lets a human apply a payment to one invoice from the review page.

File:

- [src/app/api/matches/manual-apply/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/matches/manual-apply/route.ts:1)

### `GET|POST /api/plaid/sandbox-transactions`

Runs a Plaid sandbox sync.

It:

1. creates a Plaid sandbox item
2. fetches recent transactions
3. upserts transactions
4. identifies newly inserted transactions
5. runs automatic matching on those new transactions
6. records sync run status in `plaid_sync_runs`

File:

- [src/app/api/plaid/sandbox-transactions/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/plaid/sandbox-transactions/route.ts:1)

### `GET /api/plaid/sync-status`

Returns the latest Plaid sync run.

File:

- [src/app/api/plaid/sync-status/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/plaid/sync-status/route.ts:1)

### `GET /api/plaid/test`

Tests Plaid connectivity.

File:

- [src/app/api/plaid/test/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/plaid/test/route.ts:1)

## Core Matching Logic

The heart of the app is the matching subsystem.

### Candidate generation

File:

- [src/lib/matching/candidate-engine.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/candidate-engine.ts:1)

What it does:

- normalizes customer names
- removes noise tokens
- computes name similarity
- computes amount compatibility
- combines both into an overall score
- returns the top ranked invoice candidates

Candidate row structure includes:

- `invoice_id`
- `invoice_number`
- `customer_name`
- `invoice_date`
- `due_date`
- `balance_due`
- `status`
- `score`
- `name_score`
- `amount_score`
- `reason`

### Matching orchestration

File:

- [src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:1)

What it does:

- loads the transaction
- checks for existing match
- ignores outgoing transactions for invoice matching
- loads eligible invoices
- builds ranked candidates
- decides safe auto-match vs human review vs unmatched
- supports exact multi-invoice combinations
- invokes LLM only for ambiguity cases
- persists matches
- persists allocations
- updates invoice balances
- supports manual apply

This is the main business-logic file in the repo.

### Batch matching

File:

- [src/lib/matching/process-new-transactions.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/process-new-transactions.ts:1)

What it does:

- accepts a list of transaction IDs
- deduplicates them
- runs `runTransactionMatch` for each
- returns summary counts

### Match status and display helpers

Files:

- [src/lib/matching/match-status.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/match-status.ts:1)
- [src/lib/matching/match-ui.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/match-ui.ts:1)

What they do:

- define match statuses
- format labels
- infer origin labels like deterministic, LLM-assisted, manual review
- return UI badge styles and text helpers

### LLM ambiguity resolution

Files:

- [src/lib/matching/llm-decision.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/llm-decision.ts:1)
- [src/lib/llm/openai-server.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/llm/openai-server.ts:1)

What they do:

- define the prompt and JSON schema for LLM match decisions
- request structured JSON from OpenAI
- parse and validate the response
- enforce important safety rules:
  - candidate IDs must come from the provided candidate list
  - allocations must be positive
  - allocations must not exceed invoice balance due
  - allocations must sum exactly to the payment amount

The LLM is advisory, not trusted blindly.

## Invoice Logic

### CSV parsing and import

File:

- [src/lib/invoices/import-csv.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/invoices/import-csv.ts:1)

What it does:

- parses invoice CSV content
- validates required columns
- normalizes dates
- supports amount-based or line-item-based invoice totals
- groups duplicate invoice rows when details are consistent
- upserts invoices into Supabase

### Due-date formatting and status

File:

- [src/lib/invoices/due-status.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/invoices/due-status.ts:1)

What it does:

- formats invoice dates for UI
- computes due status labels such as:
  - `paid`
  - `current`
  - `almost_due`
  - `overdue`
  - `no_due_date`

## Plaid Logic

### Plaid client

File:

- [src/lib/plaid/client.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/plaid/client.ts:1)

What it does:

- creates the Plaid API client
- reads Plaid credentials from environment variables
- supports sandbox, development, and production base URLs

### Plaid sync-run model and persistence

Files:

- [src/lib/plaid/sync-run-types.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/plaid/sync-run-types.ts:1)
- [src/lib/plaid/sync-runs.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/plaid/sync-runs.ts:1)

What they do:

- define sync run types
- create a sync run
- mark a sync run as complete
- mark a sync run as failed
- fetch the latest sync run

## Supabase Access

File:

- [src/lib/supabase/server.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/supabase/server.ts:1)

What it does:

- creates a Supabase client using:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

Important note:

- the app currently uses a service-role client directly in server code

## UI Components

### Home page forms

- [src/components/manual-transaction-form.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/components/manual-transaction-form.tsx:1)
  - client form for creating manual transactions
- [src/components/manual-invoice-form.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/components/manual-invoice-form.tsx:1)
  - client form for creating invoices from line items
- [src/components/invoice-import-form.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/components/invoice-import-form.tsx:1)
  - client form for CSV upload

### Reconciliation UI

- [src/components/plaid-sync-panel.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/components/plaid-sync-panel.tsx:1)
  - sync button and latest sync status
- [src/components/process-pending-transactions-button.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/components/process-pending-transactions-button.tsx:1)
  - button to process unmatched pending transactions
- [src/components/transaction-outcome-board.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/components/transaction-outcome-board.tsx:1)
  - groups transactions into operational queues and renders them

### Transaction-detail actions

- [src/app/reconciliation/[transactionId]/run-match-button.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/reconciliation/[transactionId]/run-match-button.tsx:1)
  - triggers matching for one transaction
- [src/app/reconciliation/[transactionId]/manual-apply-button.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/reconciliation/[transactionId]/manual-apply-button.tsx:1)
  - applies a payment manually to one invoice

### Invoice list UI

- [src/app/invoices/invoice-list-client.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/invoices/invoice-list-client.tsx:1)
  - client-side invoice filtering, tables, and due-status display

## Scripts

### CSV import script

- [src/scripts/import-invoices.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/scripts/import-invoices.ts:1)

What it does:

- loads `.env.local`
- reads `src/data/mock_invoice.csv`
- parses invoices
- imports them into Supabase

### Seed test transactions script

- [src/scripts/seed-test-transactions.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/scripts/seed-test-transactions.ts:1)

What it does:

- loads some invoices
- creates sample exact-match, partial-match, and unmatched transactions
- stores them in `transactions`
- runs automatic matching

## Database Schema

Important note:

- the repo only contains an explicit SQL migration for `plaid_sync_runs`
- the other tables below are **inferred from application code**

## Table: `invoices`

Inferred from:

- [src/lib/matching/candidate-engine.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/candidate-engine.ts:10)
- [src/app/invoices/page.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/invoices/page.tsx:4)
- [src/lib/invoices/import-csv.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/invoices/import-csv.ts:10)

Columns:

- `id: string`
- `invoice_number: string`
- `customer_name: string`
- `invoice_date: string`
- `due_date: string | null`
- `amount: number`
- `balance_due: number`
- `status: string`

Observed status values:

- `open`
- `partially_paid`
- `paid`

Purpose:

- stores receivable invoices and remaining unpaid balances

## Table: `transactions`

Inferred from:

- [src/lib/matching/candidate-engine.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/candidate-engine.ts:1)
- [src/app/reconciliation/page.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/reconciliation/page.tsx:8)
- [src/app/api/transactions/manual/route.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/api/transactions/manual/route.ts:1)

Columns:

- `id: string`
- `plaid_transaction_id: string`
- `date: string`
- `name: string`
- `amount: number`
- `direction: "incoming" | "outgoing"`

Purpose:

- stores imported or manually entered transaction records

Important behavior:

- incoming amounts are stored as negative
- outgoing amounts are stored as positive

## Table: `matches`

Inferred from:

- [src/lib/matching/match-status.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/match-status.ts:1)
- [src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:256)

Columns:

- `id: string`
- `transaction_id: string`
- `status: "matched" | "partially_matched" | "unmatched" | "human_review_needed"`
- `confidence: number`
- `reason: string`

Purpose:

- stores one reconciliation outcome per transaction

## Table: `allocations`

Inferred from:

- [src/lib/matching/run-transaction-match.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/lib/matching/run-transaction-match.ts:17)
- [src/app/reconciliation/[transactionId]/page.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/reconciliation/[transactionId]/page.tsx:21)

Columns:

- `id: string`
- `match_id: string`
- `invoice_id: string`
- `amount: number`

Purpose:

- stores money amounts applied from a match to one or more invoices

## Table: `plaid_sync_runs`

Defined by:

- [supabase/migrations/20260423170000_add_plaid_sync_runs.sql](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/supabase/migrations/20260423170000_add_plaid_sync_runs.sql:1)

Columns:

- `id uuid primary key`
- `source text`
- `started_at timestamptz`
- `completed_at timestamptz`
- `status text`
- `fetched_count integer`
- `new_count integer`
- `processed_count integer`
- `matched_count integer`
- `review_needed_count integer`
- `unmatched_count integer`
- `error_message text`
- `created_at timestamptz`

Purpose:

- records Plaid sync execution history and summary counts

## Inferred Relationships

- `matches.transaction_id -> transactions.id`
- `allocations.match_id -> matches.id`
- `allocations.invoice_id -> invoices.id`

## Key Statuses and Meanings

### Match statuses

- `matched`
  - transaction fully applied to invoice(s)
- `partially_matched`
  - some amount applied, but not a fully resolved one-invoice outcome
- `unmatched`
  - no invoice safely applied
- `human_review_needed`
  - candidate invoices exist, but the system avoided an unsafe automatic choice

### Invoice statuses

- `open`
  - invoice has full or remaining balance due
- `partially_paid`
  - some cash has been applied
- `paid`
  - balance due is zero

### Transaction directions

- `incoming`
  - cash receipt / payment candidate
- `outgoing`
  - not eligible for invoice matching in this project

## Project Structure Overview

### `src/app`

Contains:

- route pages
- API routes
- page-local client components

### `src/components`

Contains:

- reusable UI components for forms, sync actions, and transaction boards

### `src/lib`

Contains:

- domain logic
- matching logic
- invoice parsing logic
- Supabase access
- Plaid helpers
- OpenAI helpers

### `src/scripts`

Contains:

- utility scripts for importing seed data and generating test transactions

### `src/data`

Contains:

- sample CSV data

### `supabase/migrations`

Contains:

- explicit SQL migrations, currently only for `plaid_sync_runs`

## Top-Level Config Files

- [package.json](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/package.json:1)
  - dependencies and npm scripts
- [tsconfig.json](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/tsconfig.json:1)
  - TypeScript compiler settings and path aliases
- [eslint.config.mjs](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/eslint.config.mjs:1)
  - ESLint config based on Next.js presets
- [next.config.ts](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/next.config.ts:1)
  - Next.js config
- [src/app/layout.tsx](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/layout.tsx:1)
  - root layout and metadata
- [src/app/globals.css](/C:/Users/JJ/Desktop/invoice-reconciliation-ai/invoice-reconcilliation/src/app/globals.css:1)
  - global Tailwind and theme styles

## Current Strengths

- good domain model direction
- strong separation between `matches` and `allocations`
- deterministic-first matching strategy
- LLM usage is constrained and validated
- human review path exists
- invoice import supports multiple amount formats

## Current Weaknesses

- core database schema is not fully represented in migrations
- matching is request-bound and not built for large scale
- invoice candidate search scans too broadly
- financial writes are not atomic across the full apply flow
- no visible tenant model or auth model in the core data access paths

## Reusable Short Description For LLM Prompts

Use this block when prompting another LLM:

```text
This project is a Next.js + TypeScript invoice reconciliation dashboard using Supabase, Plaid, and OpenAI. It imports invoices, ingests bank transactions, matches incoming payments to open invoices, stores one reconciliation decision per transaction in a matches table, stores actual payment applications in an allocations table, and updates invoice balances/statuses. Matching is deterministic first, with human review for ambiguity and constrained LLM assistance only for fuzzy tie-breaking. Main core files are src/lib/matching/run-transaction-match.ts, src/lib/matching/candidate-engine.ts, src/lib/matching/llm-decision.ts, and the API routes under src/app/api. Main inferred tables are invoices, transactions, matches, allocations, and plaid_sync_runs.
```

## Best Mental Model

If you need a simple way to think about the project:

- invoices are receivables
- transactions are bank events
- matches are reconciliation decisions
- allocations are applied dollars
- the reconciliation page is the operating queue
- the transaction detail page is the review workstation

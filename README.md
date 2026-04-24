# Invoice Reconciliation System

A full-stack TypeScript application for reconciling incoming bank transactions against open invoices.

The system connects to Plaid Sandbox, stores transactions and invoices in Supabase, applies safe deterministic matching first, and uses an LLM only when fuzzy/ambiguous reasoning is useful.

The project is designed around a realistic Accounts Receivable workflow: clear payments are applied automatically, ambiguous payments are escalated for human review, and unmatched transactions are not forced into unsafe financial decisions.

---

## 1. Assignment Focus

This project was built for the Monk Engineering TypeScript take-home.

The main requirements addressed are:

- Plaid Sandbox connection and transaction syncing
- Invoice ingestion from static invoice data
- Matching logic between incoming payments and invoices
- At least one LLM call to help determine the best match
- Automatic processing without requiring user action for every transaction
- Persisting transactions, invoices, matches, and allocation results
- Retrieving match results for a given transaction
- Handling realistic invoice-payment scenarios

---

## 2. Tech Stack

- **Next.js App Router**
- **TypeScript**
- **Supabase / PostgreSQL**
- **Plaid Sandbox**
- **OpenAI API**
- **React client components**
- **Node scripts with tsx**

---

## 3. Getting Started

### Clone the repository

```bash
git clone https://github.com/your-username/invoice-reconciliation-ai.git
cd invoice-reconciliation-ai
```

### Install dependencies

```bash
npm install
```

### Create environment file

Create a `.env.local` file in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

PLAID_CLIENT_ID=
PLAID_SECRET=

OPENAI_API_KEY=
OPENAI_MATCHING_MODEL=gpt-4o-mini
```

### Run locally

```bash
npm run dev
```

Open:

```bash
http://localhost:3000
```

---

## 4. Database Tables

### invoices

Stores the invoice data that payments are matched against.

| Column | Purpose |
|---|---|
| id | Primary key |
| invoice_number | Unique invoice identifier |
| customer_name | Customer or company name |
| invoice_date | Date invoice was issued |
| due_date | Date invoice is due |
| amount | Original invoice amount |
| balance_due | Remaining amount still unpaid |
| status | `open`, `partially_paid`, or `paid` |

---

### transactions

Stores Plaid and manually entered bank transactions.

| Column | Purpose |
|---|---|
| id | Primary key |
| plaid_transaction_id | Unique transaction identifier |
| date | Transaction date |
| name | Transaction description |
| amount | Transaction amount |
| direction | `incoming` or `outgoing` |

Important convention:

- Negative amounts represent incoming payments
- Positive amounts represent outgoing expenses

---

### matches

Stores the reconciliation decision for each processed transaction.

| Column | Purpose |
|---|---|
| id | Primary key |
| transaction_id | Related transaction |
| status | Match decision |
| confidence | Confidence score |
| reason | Human-readable explanation |

Supported statuses:

- `matched`
- `partially_matched`
- `unmatched`
- `human_review_needed`

---

### allocations

Stores how a payment was applied to one or more invoices.

| Column | Purpose |
|---|---|
| id | Primary key |
| match_id | Related match |
| invoice_id | Related invoice |
| amount | Amount applied to the invoice |

---

### plaid_sync_runs

Stores metadata about Plaid sync attempts.

| Column | Purpose |
|---|---|
| id | Primary key |
| status | `running`, `success`, or `failed` |
| fetched_count | Transactions fetched from Plaid |
| new_count | Newly inserted transactions |
| processed_count | Transactions processed |
| created_at | Sync creation timestamp |

This supports the UI showing the last sync time and sync summary.

---

## 5. Project Structure

```text
src/
  app/
    api/
      invoices/
        import/
        manual/
      matches/
        run/
        run-all/
        manual-apply/
      plaid/
        sandbox-transactions/
        sync-status/
      transactions/
        manual/

    invoices/
      page.tsx
      invoice-list-client.tsx

    reconciliation/
      page.tsx
      [transactionId]/
        page.tsx
        manual-apply-button.tsx
        run-match-button.tsx

    page.tsx
    layout.tsx
    globals.css

  components/
    plaid-sync-panel.tsx
    transaction-outcome-board.tsx
    manual-transaction-form.tsx

  lib/
    invoices/
      due-status.ts
      import-csv.ts

    matching/
      candidate-engine.ts
      llm-decision.ts
      match-status.ts
      match-ui.ts
      process-new-transactions.ts
      run-transaction-match.ts

    plaid/
      client.ts
      sync-runs.ts

    supabase/
      server.ts

scripts/
  import-invoices.ts
  seed-test-transactions.ts
```

---

## 6. Core Workflow

### 1. Invoice setup

Invoices can be imported from CSV. The CSV can include line items, and the system derives invoice totals from those line items when needed.

Invoices are stored with:

- original amount
- balance due
- invoice status
- invoice date
- due date

The invoice page also supports filtering by:

- invoice status
- due status
- invoice date
- invoice number
- customer name

---

### 2. Transaction ingestion

Transactions can enter the system from:

- Plaid Sandbox sync
- manual transaction entry

Plaid sync fetches the last 30 days of transactions and automatically processes newly inserted transactions.

Manual transactions are saved as pending and can be processed from the reconciliation page.

---

### 3. Matching

The matching engine evaluates incoming transactions against open invoices.

It uses:

- customer/name similarity
- amount compatibility
- exact amount checks
- partial payment checks
- multi-invoice allocation checks
- ambiguity detection

The system avoids unsafe matches. If multiple plausible invoices exist, it escalates the transaction to human review instead of guessing.

---

### 4. LLM-assisted decision making

The LLM is used only for ambiguous or fuzzy cases.

The LLM does not write directly to the database.

Instead:

1. The system builds candidate invoices
2. The LLM returns a structured decision
3. The response is parsed and validated
4. Only validated decisions are persisted

If the LLM response is invalid, unsafe, or unavailable, the system falls back safely.

---

### 5. Allocation

When a transaction is safely matched, the system:

- creates a match record
- creates one or more allocation records
- reduces invoice balance due
- updates invoice status

Possible outcomes:

- Full payment: invoice becomes `paid`
- Partial payment: invoice becomes `partially_paid`
- Multi-invoice payment: one transaction is split across multiple invoices

---

## 7. Matching Scenarios Included

### Deterministic match

A transaction has a strong name match and exact amount match.

Example:

```text
Transaction: Netflix Inc Payment
Invoice: Netflix Inc
```

Expected result:

```text
matched
```

---

### Fuzzy LLM-assisted match

A transaction name is not exact, but clearly points to an invoice customer.

Example:

```text
Transaction: Microsoft Payment
Invoice: Microsoft Corporation
```

Expected result:

```text
matched after validated LLM-assisted decision
```

---

### Human review

Multiple plausible invoices exist and the system cannot safely choose one.

Example:

```text
Transaction: Amazon Payment

Possible invoices:
- Amazon Marketplace
- Amazon Restaurant
- Amazon Account Services
```

Expected result:

```text
human_review_needed
```

An agent can then manually apply the payment to the correct invoice.

---

### Multi-invoice allocation

One payment covers multiple invoices.

Example:

```text
Transaction: Stripe Payment, $300

Invoices:
- Stripe invoice A, $150
- Stripe invoice B, $150
```

Expected result:

```text
matched with two allocations
```

---

### Partial payment

A payment is smaller than the invoice balance.

Example:

```text
Transaction: Netflix Partial Payment, $100
Invoice: Netflix Inc, $250
```

Expected result:

```text
partially_matched
```

The invoice remains open with a reduced balance.

---

### Unmatched

No meaningful invoice candidate exists.

Example:

```text
Transaction: Random Vendor Payment
```

Expected result:

```text
unmatched
```

---

### Outgoing transaction

Outgoing expenses are stored for completeness but are not eligible for invoice matching.

Expected result:

```text
unmatched / ignored
```

---

## 8. UI Overview

### Home page

The home page acts as a setup and operations entry point.

It includes:

- navigation to reconciliation
- navigation to invoices
- manual transaction entry
- invoice CSV import

---

### Reconciliation page

The reconciliation page is the main workflow page.

It shows:

- Applied
- Review Needed
- Unmatched
- Pending / Not Processed
- Outgoing / Ignored toggle

It also includes:

- Plaid Sandbox sync
- sync loading state
- last synced timestamp
- transaction search
- pagination by section
- summary metrics

---

### Transaction detail page

The detail page shows:

- transaction summary
- match outcome
- reason/explanation
- applied invoice/allocation
- candidate invoices
- manual apply action for review-needed cases

---

### Invoices page

The invoices page shows:

- invoice list
- credits separated visually from invoices
- invoice date and due date
- due-status labels
- filtering and search

---

## 9. Design Principles

### Safety first

The system avoids forcing uncertain financial decisions.

### Deterministic first

Clear cases are resolved without AI.

### LLM as helper, not authority

The LLM assists in fuzzy cases but does not directly mutate the database.

### Human review for ambiguity

Ambiguous cases are surfaced clearly and can be resolved manually.

### Database as source of truth

Transactions, matches, allocations, and invoice balances are persisted.

---

## 10. Demo Flow

Recommended demo order:

1. Show invoice list and filters
2. Import or verify invoice data
3. Sync transactions from Plaid Sandbox
4. Process pending/manual transactions
5. Show deterministic match
6. Show fuzzy LLM-assisted match
7. Show human review case
8. Manually apply a review-needed payment
9. Show multi-invoice allocation
10. Show partial payment
11. Show unmatched/outgoing examples

---

## 11. Notes

This project focuses on realistic reconciliation behavior rather than aggressive automation.

The main tradeoff is intentional:

```text
It is better to ask for human review than to apply a payment to the wrong invoice.
```

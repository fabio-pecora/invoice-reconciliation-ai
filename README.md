# Invoice Reconciliation System

A full-stack application that automates matching incoming payments to invoices using safe, production-style logic.

---

## 🚀 Setup

```bash
git clone https://github.com/your-username/invoice-reconciliation-ai.git
cd invoice-reconciliation-ai
npm install
npm run dev
```

Create a `.env.local` with:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PLAID_CLIENT_ID=
PLAID_SECRET=
OPENAI_API_KEY=
```

---

## 🧠 Tech Stack

- Next.js (App Router)
- TypeScript
- Supabase (PostgreSQL)
- Plaid (Sandbox)
- OpenAI API

---

## 🎯 What It Does

- Imports invoices from CSV (line items → amount)
- Syncs transactions from Plaid or manual input
- Matches transactions to invoices automatically
- Uses:
  - Deterministic logic first
  - LLM only for fuzzy cases
  - Human review when ambiguous

---

## 🔍 Matching Scenarios

### ✅ Deterministic Match
Exact name + amount → auto applied

### 🧠 Fuzzy Match (LLM)
“Microsoft” → “Microsoft Corporation”

### ⚠️ Review Needed
Multiple valid options → no guessing

### 🔗 Multi-Invoice
One payment → multiple invoices

### ➗ Partial Payment
Payment < invoice → partially applied

### ❌ Unmatched
No valid invoice found

---

## 🗄️ Core Tables

### invoices
- id, invoice_number, customer_name
- invoice_date, due_date
- amount, balance_due, status

### transactions
- id, name, amount, direction, date

### matches
- transaction_id, status, confidence, reason

### allocations
- match_id, invoice_id, amount

---

## 🧭 Flow

1. Transaction enters system
2. Candidates are found
3. Decision:
   - matched
   - partially_matched
   - human_review_needed
   - unmatched
4. Allocations update invoice balances

---

## ⚙️ Principles

- Safe > aggressive
- Database = source of truth
- LLM = helper, not decision-maker
- Human review for ambiguity

---

## 📌 Notes

This project focuses on real-world financial workflows and safe automation rather than over-automation.

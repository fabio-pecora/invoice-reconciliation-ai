# Check my Demo

https://drive.google.com/file/d/1vTAHSVr2h8uVRXkIPej_Sf4DNykz6b4J/view?usp=sharing

# 🧾 Invoice Reconciliation System

A clean, production-style system that matches incoming payments to invoices safely.

---

## 🚀 How to Run

```bash
git clone https://github.com/your-username/invoice-reconciliation-ai.git
cd invoice-reconciliation-ai
npm install
npm run dev
```

Create a `.env.local` file:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=
OPENAI_API_KEY=
NEXT_PUBLIC_SITE_URL=
```

Open 👉 http://localhost:3000

---

## 🧠 What This System Does

💳 Syncs transactions from Plaid  
🧾 Imports invoices from CSV (line items → amount)  
🤖 Matches payments to invoices automatically  
⚖️ Uses safe logic (never guesses blindly)  
🧠 Uses LLM only for fuzzy cases  
👤 Sends ambiguous cases to human review  
💾 Stores everything in database  

---

## 🎯 Matching Scenarios

### ✅ Deterministic Match  
Exact name + amount → auto applied  

### 🧠 Fuzzy Match (LLM)  
"Microsoft" → "Microsoft Corporation"  

### ⚠️ Review Needed  
Multiple valid invoices → no guessing  

### 🔗 Multi-Invoice  
One payment → multiple invoices  

### ➗ Partial Payment  
Payment < invoice → partially applied  

### ❌ Unmatched  
No valid invoice found  

### 🚫 Outgoing  
Stored but ignored  

---

## 🗄️ Core Tables

### invoices  
invoice_number, customer_name, invoice_date, due_date  
amount, balance_due, status  

### transactions  
name, amount, direction, date  

### matches  
status, confidence, reason  

### allocations  
invoice_id, amount  

---

## 🧭 How It Works

1. Transaction enters system  
2. Candidates are found  
3. System decides:

- matched  
- partially_matched  
- human_review_needed  
- unmatched  

4. Allocations update invoice balances  

---

## ⚙️ Key Principles

🛑 Safe > aggressive  
🧠 LLM = helper, not decision maker  
👤 Human review for ambiguity  
💾 Database = source of truth  

---

## 📂 Project Structure (Simplified)

```
src/
  app/
    reconciliation/
    invoices/
    api/
  components/
  lib/
    matching/
    plaid/
    invoices/
```

---

## 🎬 Demo Flow

1. Import invoices  
2. Sync transactions  
3. Process pending  
4. Show:
   - deterministic match  
   - fuzzy match  
   - review needed  
   - multi-invoice  
   - partial payment  

---

## 💡 Note

This system prioritizes **correctness over automation**.  
It’s better to ask for review than apply a wrong payment.

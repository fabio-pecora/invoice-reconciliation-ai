// High level: Seeds sample transactions and runs matching to exercise common reconciliation outcomes.
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { runAutomaticMatchingForTransactions } from "../lib/matching/process-new-transactions";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.log("SUPABASE URL:", supabaseUrl);
  console.log("SUPABASE ANON KEY:", supabaseAnonKey);
  throw new Error("Missing Supabase environment variables.");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

async function main() {
  const { data: invoices, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, invoice_number, customer_name, amount")
    .order("invoice_number", { ascending: true })
    .limit(2);

  if (invoiceError) {
    throw invoiceError;
  }

  if (!invoices || invoices.length < 2) {
    throw new Error("Need at least 2 invoices.");
  }

  const [inv1, inv2] = invoices;

  const exactAmount = -Math.abs(Number(inv1.amount));
  const partialAmount = -Math.abs(roundToTwo(Number(inv2.amount) / 2));

  const transactions = [
    {
      plaid_transaction_id: `seed_exact_${inv1.invoice_number}`,
      date: new Date().toISOString().split("T")[0],
      name: `${inv1.customer_name} ACH PAYMENT`,
      amount: exactAmount,
      direction: "incoming",
    },
    {
      plaid_transaction_id: `seed_partial_${inv2.invoice_number}`,
      date: new Date().toISOString().split("T")[0],
      name: `PAYMENT FROM ${inv2.customer_name}`,
      amount: partialAmount,
      direction: "incoming",
    },
    {
      plaid_transaction_id: "seed_unmatched_random_vendor",
      date: new Date().toISOString().split("T")[0],
      name: "RANDOM OFFICE SUPPLY WIRE",
      amount: -777.77,
      direction: "incoming",
    },
  ];

  const plaidTransactionIds = transactions.map(
    (transaction) => transaction.plaid_transaction_id
  );
  const { data: existingTransactions, error: existingTransactionsError } =
    await supabase
      .from("transactions")
      .select("id, plaid_transaction_id")
      .in("plaid_transaction_id", plaidTransactionIds);

  if (existingTransactionsError) {
    throw existingTransactionsError;
  }

  const existingPlaidTransactionIds = new Set(
    (existingTransactions ?? []).map(
      (transaction) => transaction.plaid_transaction_id as string
    )
  );
  const { data, error } = await supabase
    .from("transactions")
    .upsert(transactions, {
      onConflict: "plaid_transaction_id",
    })
    .select("id, plaid_transaction_id, date, name, amount, direction");

  if (error) {
    throw error;
  }

  const newTransactions = (data ?? []).filter(
    (transaction) =>
      !existingPlaidTransactionIds.has(transaction.plaid_transaction_id as string)
  );
  const automaticMatchSummary = await runAutomaticMatchingForTransactions(
    newTransactions.map((transaction) => transaction.id as string)
  );

  console.log("Seeded transactions:");
  console.table(data);
  console.log("Automatic match summary:");
  console.dir(automaticMatchSummary, { depth: null });
}

main()
  .then(() => {
    console.log("Done.");
  })
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });

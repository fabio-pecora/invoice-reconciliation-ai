import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

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

  const { data, error } = await supabase
    .from("transactions")
    .upsert(transactions, {
      onConflict: "plaid_transaction_id",
    })
    .select();

  if (error) {
    throw error;
  }

  console.log("Seeded transactions:");
  console.table(data);
}

main()
  .then(() => {
    console.log("Done.");
  })
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
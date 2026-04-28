// High level: Imports the sample invoice CSV into Supabase for local/demo data setup.
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  importInvoiceRecords,
  parseInvoiceCsv,
  type SupabaseInvoiceClient,
} from "../lib/invoices/import-csv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const csvPath = path.resolve(__dirname, "../data/mock_invoice.csv");

dotenv.config({
  path: path.resolve(__dirname, "../../.env.local"),
});

function requireFirstEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }

  throw new Error(
    `Missing environment variable. Expected one of: ${names.join(", ")}.`
  );
}

async function main(): Promise<void> {
  const supabaseUrl = requireFirstEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const supabaseKey = requireFirstEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  );

  const csvContent = await readFile(csvPath, "utf8");
  const parsed = parseInvoiceCsv(csvContent, { amountMode: "lineItems" });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.join("\n"));
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const summary = await importInvoiceRecords(
    supabase as unknown as SupabaseInvoiceClient,
    parsed.invoices
  );

  console.log(
    `Upserted ${summary.imported_count} invoices from ${csvPath}. Updated ${summary.updated_count}.`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Invoice import failed: ${message}`);
  process.exitCode = 1;
});

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../../.env.local"),
});

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

interface CsvInvoiceRow {
  InvoiceNumber?: string;
  CustomerName?: string;
  InvoiceDate?: string;
  DueDate?: string;
  LineItems?: string;
}

interface InvoiceRecord {
  invoice_number: string;
  customer_name: string;
  invoice_date: string;
  due_date: string;
  amount: number;
  balance_due: number;
  status: "open";
}

const csvPath = path.resolve(__dirname, "../data/mock_invoice.csv");

function requireFirstEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }

  throw new Error(`Missing environment variable. Expected one of: ${names.join(", ")}.`);
}

function parseNumericValue(value: string): number | null {
  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getObjectAmount(value: Record<string, JsonValue>): number | null {
  const amountKeys = ["amount", "total", "lineTotal", "line_total", "subtotal"];

  for (const key of amountKeys) {
    const amountValue = value[key];

    if (typeof amountValue === "number") return amountValue;

    if (typeof amountValue === "string") {
      const parsed = parseNumericValue(amountValue);
      if (parsed !== null) return parsed;
    }
  }

  const quantityValue = value.quantity;
  const unitPriceValue =
    value.unitPrice ?? value.unit_price ?? value.price ?? value.rate ?? value.unitCost;

  const quantity =
    typeof quantityValue === "number"
      ? quantityValue
      : typeof quantityValue === "string"
        ? parseNumericValue(quantityValue)
        : null;

  const unitPrice =
    typeof unitPriceValue === "number"
      ? unitPriceValue
      : typeof unitPriceValue === "string"
        ? parseNumericValue(unitPriceValue)
        : null;

  if (quantity !== null && unitPrice !== null) {
    return quantity * unitPrice;
  }

  return null;
}

function sumLineItems(value: JsonValue): number {
  if (typeof value === "number") return value;

  if (typeof value === "string") {
    const parsed = parseNumericValue(value);
    if (parsed === null) {
      throw new Error(`Unable to derive an amount from line item value "${value}".`);
    }
    return parsed;
  }

  if (Array.isArray(value)) {
    return value.reduce<number>((total, item) => total + sumLineItems(item), 0);
  }

  if (value && typeof value === "object") {
    const amount = getObjectAmount(value);
    if (amount === null) {
      throw new Error(
        `Unable to derive an amount from line item object: ${JSON.stringify(value)}`
      );
    }
    return amount;
  }

  throw new Error(`Unsupported line item value: ${String(value)}`);
}

function parseLineItems(rawLineItems: string, invoiceNumber: string): JsonValue {
  const trimmed = rawLineItems.trim();

  if (!trimmed) {
    throw new Error(`Invoice ${invoiceNumber} is missing LineItems.`);
  }

  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    const segments = trimmed
      .split(/[|;]/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length > 1) return segments;

    const singleValue = parseNumericValue(trimmed);
    if (singleValue !== null) return [singleValue];

    throw new Error(
      `Invoice ${invoiceNumber} has LineItems in an unsupported format. Expected JSON or a numeric list.`
    );
  }
}

function requireField(
  row: CsvInvoiceRow,
  field: keyof CsvInvoiceRow,
  rowNumber: number
): string {
  const value = row[field]?.trim();

  if (!value) {
    throw new Error(`Row ${rowNumber} is missing required field ${field}.`);
  }

  return value;
}

function toIsoDate(dateValue: string, fieldName: string, invoiceNumber: string): string {
  const parsed = new Date(dateValue);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invoice ${invoiceNumber} has invalid ${fieldName}: "${dateValue}".`);
  }

  return parsed.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const supabaseUrl = requireFirstEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const supabaseKey = requireFirstEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  );

  const csvContent = await readFile(csvPath, "utf8");
  const rows = parse(csvContent, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvInvoiceRow[];

  if (rows.length === 0) {
    throw new Error(`No invoice rows found in ${csvPath}.`);
  }

  const invoices: InvoiceRecord[] = rows.map((row, index) => {
    const rowNumber = index + 2;
    const invoiceNumber = requireField(row, "InvoiceNumber", rowNumber);
    const customerName = requireField(row, "CustomerName", rowNumber);
    const invoiceDate = requireField(row, "InvoiceDate", rowNumber);
    const dueDate = requireField(row, "DueDate", rowNumber);
    const rawLineItems = requireField(row, "LineItems", rowNumber);

    const lineItems = parseLineItems(rawLineItems, invoiceNumber);
    const amount = sumLineItems(lineItems);

    return {
      invoice_number: invoiceNumber,
      customer_name: customerName,
      invoice_date: toIsoDate(invoiceDate, "InvoiceDate", invoiceNumber),
      due_date: toIsoDate(dueDate, "DueDate", invoiceNumber),
      amount,
      balance_due: amount,
      status: "open",
    };
  });

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { error } = await supabase
    .from("invoices")
    .upsert(invoices, { onConflict: "invoice_number" });

  if (error) {
    throw error;
  }

  console.log(`Upserted ${invoices.length} invoices from ${csvPath}.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Invoice import failed: ${message}`);
  process.exitCode = 1;
});
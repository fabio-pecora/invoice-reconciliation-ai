import { parse } from "csv-parse/sync";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

type CsvRow = Record<string, string | undefined>;

export type InvoiceRecord = {
  invoice_number: string;
  customer_name: string;
  invoice_date: string;
  due_date: string;
  amount: number;
  balance_due: number;
  status: "open";
};

export type InvoiceCsvAmountMode = "amount" | "lineItems";

export type ParseInvoiceCsvResult = {
  invoices: InvoiceRecord[];
  errors: string[];
};

export type InvoiceImportSummary = {
  imported_count: number;
  updated_count: number;
  failed_count: number;
  errors: string[];
};

export type SupabaseInvoiceClient = {
  from: (table: "invoices") => {
    select: (columns: string) => {
      in: (
        column: string,
        values: string[]
      ) => Promise<{
        data: { invoice_number: string }[] | null;
        error: { message: string } | null;
      }>;
    };
    upsert: (
      values: InvoiceRecord[],
      options: { onConflict: string }
    ) => Promise<{ error: { message: string } | null }>;
  };
};

const AMOUNT_REQUIRED_COLUMNS = [
  "invoice_number",
  "customer_name",
  "invoice_date",
  "due_date",
  "amount",
] as const;

const LINE_ITEMS_REQUIRED_COLUMNS = [
  "InvoiceNumber",
  "CustomerName",
  "InvoiceDate",
  "DueDate",
  "LineItems",
] as const;

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getField(row: CsvRow, names: string[]): string {
  for (const name of names) {
    const value = row[name]?.trim();

    if (value) {
      return value;
    }
  }

  return "";
}

function parseNumericValue(value: string): number | null {
  const normalized = value.replace(/[$,\s]/g, "");

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getObjectAmount(value: Record<string, JsonValue>): number | null {
  const amountKeys = ["amount", "total", "lineTotal", "line_total", "subtotal"];

  for (const key of amountKeys) {
    const amountValue = value[key];

    if (typeof amountValue === "number") {
      return amountValue;
    }

    if (typeof amountValue === "string") {
      const parsed = parseNumericValue(amountValue);
      if (parsed !== null) {
        return parsed;
      }
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
  if (typeof value === "number") {
    return value;
  }

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

    if (segments.length > 1) {
      return segments;
    }

    const singleValue = parseNumericValue(trimmed);
    if (singleValue !== null) {
      return [singleValue];
    }

    throw new Error(
      `Invoice ${invoiceNumber} has LineItems in an unsupported format. Expected JSON or a numeric list.`
    );
  }
}

function toIsoDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const isoDate = parsed.toISOString().slice(0, 10);
  return isoDate === value ? isoDate : null;
}

function buildHeaderLookup(headers: string[]): Map<string, string> {
  return new Map(headers.map((header) => [normalizeHeader(header), header]));
}

function getColumnNames(
  headers: string[],
  requiredColumns: readonly string[]
): string[] {
  const lookup = buildHeaderLookup(headers);
  return requiredColumns
    .map((column) => lookup.get(normalizeHeader(column)))
    .filter((column): column is string => Boolean(column));
}

function getMissingColumns(
  headers: string[],
  requiredColumns: readonly string[]
): string[] {
  const lookup = buildHeaderLookup(headers);
  return requiredColumns.filter((column) => !lookup.has(normalizeHeader(column)));
}

function getRowAmount(
  row: CsvRow,
  mode: InvoiceCsvAmountMode,
  amountColumn: string
): number | null {
  if (mode === "amount") {
    return parseNumericValue(getField(row, [amountColumn]));
  }

  const invoiceNumber = getField(row, ["InvoiceNumber"]);
  const rawLineItems = getField(row, [amountColumn]);
  const lineItems = parseLineItems(rawLineItems, invoiceNumber);
  return sumLineItems(lineItems);
}

export function parseInvoiceCsv(
  csvContent: string,
  options: { amountMode: InvoiceCsvAmountMode }
): ParseInvoiceCsvResult {
  if (!csvContent.trim()) {
    return {
      invoices: [],
      errors: ["CSV file is empty."],
    };
  }

  let rows: CsvRow[];

  try {
    rows = parse(csvContent, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as CsvRow[];
  } catch (error) {
    return {
      invoices: [],
      errors: [
        error instanceof Error ? `CSV could not be parsed: ${error.message}` : "CSV could not be parsed.",
      ],
    };
  }

  if (rows.length === 0) {
    return {
      invoices: [],
      errors: ["CSV file does not contain any invoice rows."],
    };
  }

  const headers = Object.keys(rows[0] ?? {});
  const requiredColumns =
    options.amountMode === "amount"
      ? AMOUNT_REQUIRED_COLUMNS
      : LINE_ITEMS_REQUIRED_COLUMNS;
  const missingColumns = getMissingColumns(headers, requiredColumns);

  if (missingColumns.length > 0) {
    return {
      invoices: [],
      errors: [`Missing required column(s): ${missingColumns.join(", ")}.`],
    };
  }

  const [
    invoiceNumberColumn,
    customerNameColumn,
    invoiceDateColumn,
    dueDateColumn,
    amountColumn,
  ] = getColumnNames(headers, requiredColumns);
  const seenInvoiceNumbers = new Set<string>();
  const invoices: InvoiceRecord[] = [];
  const errors: string[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const invoiceNumber = getField(row, [invoiceNumberColumn]);
    const customerName = getField(row, [customerNameColumn]);
    const rawInvoiceDate = getField(row, [invoiceDateColumn]);
    const rawDueDate = getField(row, [dueDateColumn]);

    if (!invoiceNumber) {
      errors.push(`Row ${rowNumber} is missing invoice_number.`);
      return;
    }

    if (!customerName) {
      errors.push(`Row ${rowNumber} is missing customer_name.`);
      return;
    }

    if (seenInvoiceNumbers.has(invoiceNumber)) {
      errors.push(`Row ${rowNumber} has duplicate invoice_number "${invoiceNumber}".`);
      return;
    }

    seenInvoiceNumbers.add(invoiceNumber);

    const invoiceDate = toIsoDate(rawInvoiceDate);
    if (!invoiceDate) {
      errors.push(
        `Row ${rowNumber} has invalid invoice_date "${rawInvoiceDate}". Use YYYY-MM-DD.`
      );
      return;
    }

    const dueDate = toIsoDate(rawDueDate);
    if (!dueDate) {
      errors.push(`Row ${rowNumber} has invalid due_date "${rawDueDate}". Use YYYY-MM-DD.`);
      return;
    }

    let amount: number | null;

    try {
      amount = getRowAmount(row, options.amountMode, amountColumn);
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `Row ${rowNumber}: ${error.message}`
          : `Row ${rowNumber} has an invalid amount.`
      );
      return;
    }

    if (amount === null || !Number.isFinite(amount)) {
      errors.push(`Row ${rowNumber} has an invalid amount.`);
      return;
    }

    invoices.push({
      invoice_number: invoiceNumber,
      customer_name: customerName,
      invoice_date: invoiceDate,
      due_date: dueDate,
      amount,
      balance_due: amount,
      status: "open",
    });
  });

  return {
    invoices,
    errors,
  };
}

export async function importInvoiceRecords(
  supabase: SupabaseInvoiceClient,
  invoices: InvoiceRecord[]
): Promise<InvoiceImportSummary> {
  if (invoices.length === 0) {
    return {
      imported_count: 0,
      updated_count: 0,
      failed_count: 0,
      errors: [],
    };
  }

  const invoiceNumbers = invoices.map((invoice) => invoice.invoice_number);
  const { data: existingInvoices, error: lookupError } = await supabase
    .from("invoices")
    .select("invoice_number")
    .in("invoice_number", invoiceNumbers);

  if (lookupError) {
    throw new Error(`Failed to check existing invoices: ${lookupError.message}`);
  }

  const existingInvoiceNumbers = new Set(
    (existingInvoices ?? []).map((invoice) => invoice.invoice_number)
  );

  const { error } = await supabase
    .from("invoices")
    .upsert(invoices, { onConflict: "invoice_number" });

  if (error) {
    throw new Error(`Failed to import invoices: ${error.message}`);
  }

  return {
    imported_count: invoices.length,
    updated_count: invoices.filter((invoice) =>
      existingInvoiceNumbers.has(invoice.invoice_number)
    ).length,
    failed_count: 0,
    errors: [],
  };
}

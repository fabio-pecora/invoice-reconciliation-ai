// High level: API endpoint for validating and creating manual invoices from line items.
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const TAX_RATES = {
  NY: 0.08875,
  NJ: 0.06625,
  CA: 0.0725,
  TX: 0.0625,
} as const;

type TaxState = keyof typeof TAX_RATES;

type ManualInvoiceLineItemPayload = {
  description?: unknown;
  amount?: unknown;
};

type ManualInvoicePayload = {
  invoice_number?: unknown;
  customer_name?: unknown;
  invoice_date?: unknown;
  due_date?: unknown;
  line_items?: unknown;
  include_taxes?: unknown;
  tax_state?: unknown;
};

class ManualInvoiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualInvoiceValidationError";
  }
}

function isTaxState(value: unknown): value is TaxState {
  return typeof value === "string" && value in TAX_RATES;
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === value
  );
}

function parseAmount(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  return Number.NaN;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parsePayload(body: ManualInvoicePayload): {
  invoice_number: string;
  customer_name: string;
  invoice_date: string;
  due_date: string;
  amount: number;
  balance_due: number;
  status: "open";
} {
  const invoiceNumber =
    typeof body.invoice_number === "string" ? body.invoice_number.trim() : "";
  const customerName =
    typeof body.customer_name === "string" ? body.customer_name.trim() : "";
  const invoiceDate =
    typeof body.invoice_date === "string" ? body.invoice_date.trim() : "";
  const dueDate = typeof body.due_date === "string" ? body.due_date.trim() : "";
  const includeTaxes = body.include_taxes === true;
  const taxState = isTaxState(body.tax_state) ? body.tax_state : null;

  if (!invoiceNumber) {
    throw new ManualInvoiceValidationError("Invoice number is required.");
  }

  if (!customerName) {
    throw new ManualInvoiceValidationError("Customer name is required.");
  }

  if (!invoiceDate || !isValidDateString(invoiceDate)) {
    throw new ManualInvoiceValidationError(
      "Invoice date is required and must be a valid YYYY-MM-DD value."
    );
  }

  if (!dueDate || !isValidDateString(dueDate)) {
    throw new ManualInvoiceValidationError(
      "Due date is required and must be a valid YYYY-MM-DD value."
    );
  }

  if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
    throw new ManualInvoiceValidationError(
      "At least one line item is required."
    );
  }

  const lineItemAmounts = body.line_items.map((lineItem) => {
    const amount = parseAmount(
      (lineItem as ManualInvoiceLineItemPayload | null)?.amount
    );

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ManualInvoiceValidationError(
        "Line item amounts must be positive numbers."
      );
    }

    return amount;
  });

  if (includeTaxes && !taxState) {
    throw new ManualInvoiceValidationError(
      "Tax state is required when taxes are included."
    );
  }

  const subtotal = roundMoney(
    lineItemAmounts.reduce((total, amount) => total + amount, 0)
  );
  const tax =
    includeTaxes && taxState ? roundMoney(subtotal * TAX_RATES[taxState]) : 0;
  const total = roundMoney(subtotal + tax);

  return {
    invoice_number: invoiceNumber,
    customer_name: customerName,
    invoice_date: invoiceDate,
    due_date: dueDate,
    amount: total,
    balance_due: total,
    status: "open",
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ManualInvoicePayload;
    const invoice = parsePayload(body);

    const { data, error } = await supabaseServer
      .from("invoices")
      .insert(invoice)
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to create invoice: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      invoice: data,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        {
          success: false,
          error: "Request body must be valid JSON.",
        },
        { status: 400 }
      );
    }

    const message =
      error instanceof Error ? error.message : "Unknown server error.";
    const status = error instanceof ManualInvoiceValidationError ? 400 : 500;

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status }
    );
  }
}

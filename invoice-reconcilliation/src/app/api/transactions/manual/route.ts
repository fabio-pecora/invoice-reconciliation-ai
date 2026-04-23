import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

type TransactionDirection = "incoming" | "outgoing";

type ManualTransactionPayload = {
  name?: unknown;
  date?: unknown;
  amount?: unknown;
  direction?: unknown;
};

class ManualTransactionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualTransactionValidationError";
  }
}

function isTransactionDirection(value: unknown): value is TransactionDirection {
  return value === "incoming" || value === "outgoing";
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

function normalizeStoredAmount(
  amount: number,
  direction: TransactionDirection
): number {
  const normalizedAmount = Math.abs(amount);
  return direction === "incoming" ? -normalizedAmount : normalizedAmount;
}

function generateManualTransactionId(): string {
  return `manual_${Date.now()}_${crypto
    .randomUUID()
    .replace(/-/g, "")
    .slice(0, 10)}`;
}

function parsePayload(body: ManualTransactionPayload): {
  name: string;
  date: string;
  amount: number;
  direction: TransactionDirection;
} {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const date = typeof body.date === "string" ? body.date.trim() : "";
  const amount =
    typeof body.amount === "number"
      ? body.amount
      : typeof body.amount === "string"
        ? Number(body.amount)
        : Number.NaN;
  const direction = body.direction;

  if (!name) {
    throw new ManualTransactionValidationError("Transaction name is required.");
  }

  if (!date || !isValidDateString(date)) {
    throw new ManualTransactionValidationError(
      "Date is required and must be a valid YYYY-MM-DD value."
    );
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ManualTransactionValidationError(
      "Amount is required and must be greater than 0."
    );
  }

  if (!isTransactionDirection(direction)) {
    throw new ManualTransactionValidationError("Direction is required.");
  }

  return {
    name,
    date,
    amount,
    direction,
  };
}

function isDuplicatePlaidTransactionIdError(error: {
  code?: string;
  message?: string;
}): boolean {
  return (
    error.code === "23505" &&
    (error.message?.toLowerCase().includes("plaid_transaction_id") ?? false)
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ManualTransactionPayload;
    const parsedPayload = parsePayload(body);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const plaidTransactionId = generateManualTransactionId();
      const { data, error } = await supabaseServer
        .from("transactions")
        .insert({
          plaid_transaction_id: plaidTransactionId,
          date: parsedPayload.date,
          name: parsedPayload.name,
          amount: normalizeStoredAmount(
            parsedPayload.amount,
            parsedPayload.direction
          ),
          direction: parsedPayload.direction,
        })
        .select("*")
        .single();

      if (error) {
        if (
          isDuplicatePlaidTransactionIdError({
            code: error.code,
            message: error.message,
          }) &&
          attempt < 2
        ) {
          continue;
        }

        throw new Error(`Failed to save transaction: ${error.message}`);
      }

      return NextResponse.json({
        success: true,
        transaction: data,
      });
    }

    throw new Error("Failed to generate a unique transaction identifier.");
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
      error instanceof Error ? error.message : "Unknown server error";
    const status =
      error instanceof ManualTransactionValidationError ? 400 : 500;

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status }
    );
  }
}

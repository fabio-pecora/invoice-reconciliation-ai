import { NextResponse } from "next/server";
import { runTransactionMatch } from "@/lib/matching/run-transaction-match";

export async function POST(
  _request: Request,
  context: { params: Promise<{ transactionId: string }> }
) {
  try {
    const { transactionId } = await context.params;
    const result = await runTransactionMatch(transactionId);

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    const status = message === "Transaction not found" ? 404 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
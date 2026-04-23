import { NextResponse } from "next/server";
import {
  buildCandidates,
  InvoiceRow,
  TransactionRow,
} from "@/lib/matching/candidate-engine";
import { supabaseServer } from "@/lib/supabase/server";

async function fetchTransaction(transactionId: string): Promise<TransactionRow | null> {
  const { data, error } = await supabaseServer
    .from("transactions")
    .select("*")
    .eq("id", transactionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load transaction: ${error.message}`);
  }

  return (data as TransactionRow | null) ?? null;
}

async function fetchEligibleInvoices(): Promise<InvoiceRow[]> {
  const { data, error } = await supabaseServer
    .from("invoices")
    .select("*")
    .in("status", ["open", "partially_paid"])
    .gt("balance_due", 0)
    .order("invoice_date", { ascending: false });

  if (error) {
    throw new Error(`Failed to load invoices: ${error.message}`);
  }

  return (data ?? []) as InvoiceRow[];
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ transactionId: string }> }
) {
  try {
    const { transactionId } = await context.params;
    const transaction = await fetchTransaction(transactionId);

    if (!transaction) {
      return NextResponse.json(
        { success: false, error: "Transaction not found." },
        { status: 404 }
      );
    }

    if (transaction.direction !== "incoming") {
      return NextResponse.json({
        success: true,
        transaction,
        candidates: [],
        message: "Transaction is not incoming, so it is not a payment candidate.",
      });
    }

    const invoices = await fetchEligibleInvoices();
    const candidates = buildCandidates(transaction, invoices);

    return NextResponse.json({
      success: true,
      transaction,
      candidates,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown candidate generation error";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

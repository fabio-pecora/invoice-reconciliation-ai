import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type InvoiceRow = {
  id: string;
  invoice_number: string;
  customer_name: string;
  amount: number;
  balance_due: number;
  status: string;
};

type TransactionRow = {
  id: string;
  plaid_transaction_id: string;
  date: string;
  name: string;
  amount: number;
  direction: "incoming" | "outgoing";
};

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function getNameScore(transactionName: string, customerName: string) {
  const txTokens = tokenize(transactionName);
  const customerTokens = tokenize(customerName);

  if (txTokens.length === 0 || customerTokens.length === 0) return 0;

  const customerSet = new Set(customerTokens);
  let overlap = 0;

  for (const token of txTokens) {
    if (customerSet.has(token)) overlap++;
  }

  const ratio = overlap / Math.max(customerTokens.length, 1);

  if (ratio >= 1) return 40;
  if (ratio >= 0.66) return 30;
  if (ratio >= 0.33) return 20;
  if (overlap > 0) return 10;

  return 0;
}

function getAmountScore(transactionAmount: number, invoiceBalanceDue: number) {
  const txAbs = Math.abs(Number(transactionAmount));
  const balanceAbs = Math.abs(Number(invoiceBalanceDue));

  const diff = Math.abs(txAbs - balanceAbs);

  if (diff === 0) return 60;

  const pctDiff = balanceAbs === 0 ? 1 : diff / balanceAbs;

  if (pctDiff <= 0.01) return 50;
  if (pctDiff <= 0.05) return 40;
  if (pctDiff <= 0.15) return 25;

  if (txAbs < balanceAbs) return 15;

  return 0;
}

function buildReason(
  transaction: TransactionRow,
  invoice: InvoiceRow,
  nameScore: number,
  amountScore: number
) {
  const parts: string[] = [];

  if (nameScore > 0) {
    parts.push("customer name looks similar");
  }

  if (amountScore >= 50) {
    parts.push("amount is an exact or near-exact match");
  } else if (amountScore >= 25) {
    parts.push("amount is reasonably close");
  } else if (amountScore > 0) {
    parts.push("amount could represent a partial payment");
  }

  if (parts.length === 0) {
    parts.push("weak candidate based on limited signals");
  }

  return {
    transaction_name: transaction.name,
    invoice_customer_name: invoice.customer_name,
    transaction_amount: transaction.amount,
    invoice_balance_due: invoice.balance_due,
    summary: parts.join("; "),
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ transactionId: string }> }
) {
  try {
    const { transactionId } = await context.params;

    const { data: transaction, error: transactionError } = await supabase
      .from("transactions")
      .select("*")
      .eq("id", transactionId)
      .single<TransactionRow>();

    if (transactionError || !transaction) {
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

    const { data: invoices, error: invoicesError } = await supabase
      .from("invoices")
      .select("id, invoice_number, customer_name, amount, balance_due, status")
      .in("status", ["open", "partially_paid"])
      .returns<InvoiceRow[]>();

    if (invoicesError) {
      throw invoicesError;
    }

    const scoredCandidates = (invoices || [])
      .map((invoice) => {
        const nameScore = getNameScore(transaction.name, invoice.customer_name);
        const amountScore = getAmountScore(transaction.amount, invoice.balance_due);
        const totalScore = nameScore + amountScore;

        return {
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          customer_name: invoice.customer_name,
          invoice_amount: invoice.amount,
          balance_due: invoice.balance_due,
          invoice_status: invoice.status,
          score: totalScore,
          name_score: nameScore,
          amount_score: amountScore,
          reason: buildReason(transaction, invoice, nameScore, amountScore),
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return NextResponse.json({
      success: true,
      transaction,
      candidates: scoredCandidates,
    });
  } catch (error: any) {
    console.error("Candidate generation error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Unknown candidate generation error",
      },
      { status: 500 }
    );
  }
}
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

type TransactionRow = {
  id: string;
  plaid_transaction_id: string;
  date: string;
  name: string;
  amount: number;
  direction: "incoming" | "outgoing";
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  customer_name: string;
  invoice_date: string;
  due_date: string | null;
  amount: number;
  balance_due: number;
  status: string;
};

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(
      /\b(inc|llc|corp|corporation|company|co|ltd|limited|services|service)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeName(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function computeNameScore(transactionName: string, customerName: string): number {
  const txTokens = new Set(tokenize(transactionName));
  const invoiceTokens = new Set(tokenize(customerName));

  if (txTokens.size === 0 || invoiceTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of txTokens) {
    if (invoiceTokens.has(token)) {
      overlap += 1;
    }
  }

  const maxSize = Math.max(txTokens.size, invoiceTokens.size);
  return overlap / maxSize;
}

function computeAmountScore(paymentAmount: number, balanceDue: number): {
  score: number;
  reason: string;
} {
  const payment = Math.abs(paymentAmount);
  const balance = Number(balanceDue);
  const diff = Math.abs(payment - balance);

  if (payment === balance) {
    return {
      score: 1,
      reason: "Exact amount match",
    };
  }

  if (payment < balance) {
    const ratio = payment / balance;

    if (ratio >= 0.8) {
      return {
        score: 0.85,
        reason: "Strong partial payment candidate",
      };
    }

    if (ratio >= 0.5) {
      return {
        score: 0.65,
        reason: "Possible partial payment",
      };
    }

    if (ratio >= 0.2) {
      return {
        score: 0.4,
        reason: "Low partial payment compatibility",
      };
    }

    return {
      score: 0.15,
      reason: "Payment much smaller than balance due",
    };
  }

  if (diff <= 1) {
    return {
      score: 0.8,
      reason: "Very close amount match",
    };
  }

  if (diff <= 5) {
    return {
      score: 0.6,
      reason: "Close amount match within tolerance",
    };
  }

  return {
    score: 0.1,
    reason: "Payment exceeds balance due by too much",
  };
}

function buildReason(
  nameScore: number,
  amountReason: string,
  transactionName: string,
  customerName: string
): string {
  const nameReason =
    nameScore >= 0.9
      ? "Very strong customer name similarity"
      : nameScore >= 0.6
      ? "Good customer name similarity"
      : nameScore >= 0.3
      ? "Partial customer name similarity"
      : "Weak customer name similarity";

  return `${nameReason}. ${amountReason}. Transaction "${transactionName}" compared to invoice customer "${customerName}".`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ transactionId: string }> }
) {
  try {
    const { transactionId } = await context.params;

    const { data: transaction, error: transactionError } = await supabaseServer
      .from("transactions")
      .select("*")
      .eq("id", transactionId)
      .single<TransactionRow>();

    if (transactionError || !transaction) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 }
      );
    }

    if (transaction.direction !== "incoming") {
      return NextResponse.json({
        transaction,
        candidates: [],
        message: "Outgoing transactions are not eligible for invoice matching",
      });
    }

    const { data: invoices, error: invoicesError } = await supabaseServer
      .from("invoices")
      .select("*")
      .in("status", ["open", "partially_paid"])
      .gt("balance_due", 0)
      .order("invoice_date", { ascending: false });

    if (invoicesError) {
      return NextResponse.json(
        { error: `Failed to load invoices: ${invoicesError.message}` },
        { status: 500 }
      );
    }

    const scoredCandidates = ((invoices ?? []) as InvoiceRow[])
      .map((invoice) => {
        const nameScore = computeNameScore(
          transaction.name,
          invoice.customer_name
        );

        const { score: amountScore, reason: amountReason } = computeAmountScore(
          transaction.amount,
          invoice.balance_due
        );

        const totalScore = Number(
          (nameScore * 0.6 + amountScore * 0.4).toFixed(4)
        );

        return {
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          customer_name: invoice.customer_name,
          balance_due: invoice.balance_due,
          status: invoice.status,
          score: totalScore,
          name_score: Number(nameScore.toFixed(4)),
          amount_score: Number(amountScore.toFixed(4)),
          reason: buildReason(
            nameScore,
            amountReason,
            transaction.name,
            invoice.customer_name
          ),
        };
      })
      .filter((candidate) => candidate.score >= 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return NextResponse.json({
      transaction,
      candidates: scoredCandidates,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
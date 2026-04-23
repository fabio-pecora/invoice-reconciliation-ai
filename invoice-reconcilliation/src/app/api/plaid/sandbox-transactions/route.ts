import { NextResponse } from "next/server";
import { Products } from "plaid";
import { createClient } from "@supabase/supabase-js";
import { plaidClient } from "@/lib/plaid/client";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(date: Date) {
  return date.toISOString().split("T")[0];
}

function normalizeDirection(amount: number): "incoming" | "outgoing" {
  return amount < 0 ? "incoming" : "outgoing";
}

export async function GET() {
  try {
    const sandboxResponse = await plaidClient.sandboxPublicTokenCreate({
      institution_id: "ins_109508",
      initial_products: [Products.Transactions],
      options: {
        webhook: "https://example.com/webhook",
      },
    });

    const publicToken = sandboxResponse.data.public_token;

    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const accessToken = exchangeResponse.data.access_token;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 30);

    const formattedStartDate = formatDate(startDate);
    const formattedEndDate = formatDate(endDate);

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        if (attempt > 1) {
          await sleep(2000);
        }

        const transactionsResponse = await plaidClient.transactionsGet({
          access_token: accessToken,
          start_date: formattedStartDate,
          end_date: formattedEndDate,
          options: {
            count: 50,
            offset: 0,
          },
        });

        const normalizedTransactions = transactionsResponse.data.transactions.map(
          (tx) => ({
            plaid_transaction_id: tx.transaction_id,
            date: tx.date,
            name: tx.name,
            amount: Number(tx.amount),
            direction: normalizeDirection(Number(tx.amount)),
          })
        );

        const { data: insertedRows, error: insertError } = await supabase
          .from("transactions")
          .upsert(normalizedTransactions, {
            onConflict: "plaid_transaction_id",
          })
          .select();

        if (insertError) {
          throw insertError;
        }

        return NextResponse.json({
          success: true,
          attempt,
          date_range: {
            start_date: formattedStartDate,
            end_date: formattedEndDate,
          },
          fetched_count: normalizedTransactions.length,
          saved_count: insertedRows?.length ?? 0,
          transactions: insertedRows ?? [],
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  } catch (error: any) {
    console.error("Sandbox transactions error:", error?.response?.data || error);

    return NextResponse.json(
      {
        success: false,
        error:
          error?.response?.data?.error_message ||
          error?.message ||
          "Unknown sandbox error",
        details: error?.response?.data || null,
      },
      { status: 500 }
    );
  }
}
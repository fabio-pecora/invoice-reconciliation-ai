import { NextResponse } from "next/server";
import {
  applyManualSingleInvoiceMatch,
  ManualApplyError,
} from "@/lib/matching/run-transaction-match";

type ManualApplyPayload = {
  transactionId?: string;
  invoiceId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ManualApplyPayload;
    const transactionId = body.transactionId?.trim();
    const invoiceId = body.invoiceId?.trim();

    if (!transactionId || !invoiceId) {
      return NextResponse.json(
        {
          success: false,
          error: "transactionId and invoiceId are required.",
        },
        { status: 400 }
      );
    }

    const result = await applyManualSingleInvoiceMatch({
      transactionId,
      invoiceId,
    });

    return NextResponse.json({
      success: true,
      message: "Manual invoice application saved.",
      transaction: result.transaction,
      match: result.match,
      allocations: result.allocations,
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
      error instanceof Error ? error.message : "Unknown server error";
    const status = error instanceof ManualApplyError ? error.status : 500;

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status }
    );
  }
}

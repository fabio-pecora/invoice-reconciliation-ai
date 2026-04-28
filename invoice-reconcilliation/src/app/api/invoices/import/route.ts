// High level: API endpoint for receiving invoice CSV uploads and importing them.
import { NextResponse } from "next/server";
import {
  importInvoiceRecords,
  parseInvoiceCsv,
  type SupabaseInvoiceClient,
} from "@/lib/invoices/import-csv";
import { supabaseServer } from "@/lib/supabase/server";

const ACCEPTED_CSV_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
]);

function isCsvFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  return fileName.endsWith(".csv") || ACCEPTED_CSV_TYPES.has(file.type);
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return NextResponse.json(
        {
          success: false,
          imported_count: 0,
          updated_count: 0,
          failed_count: 1,
          errors: ["Request must be multipart/form-data."],
        },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const fileValue = formData.get("file");

    if (!(fileValue instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          imported_count: 0,
          updated_count: 0,
          failed_count: 1,
          errors: ["CSV file is required."],
        },
        { status: 400 }
      );
    }

    if (!isCsvFile(fileValue)) {
      return NextResponse.json(
        {
          success: false,
          imported_count: 0,
          updated_count: 0,
          failed_count: 1,
          errors: ["Only CSV files are supported."],
        },
        { status: 400 }
      );
    }

    const csvContent = await fileValue.text();
    const parsed = parseInvoiceCsv(csvContent, { amountMode: "auto" });

    if (parsed.errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          imported_count: 0,
          updated_count: 0,
          failed_count: parsed.errors.length,
          errors: parsed.errors,
        },
        { status: 400 }
      );
    }

    const summary = await importInvoiceRecords(
      supabaseServer as unknown as SupabaseInvoiceClient,
      parsed.invoices
    );

    return NextResponse.json({
      success: true,
      ...summary,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        imported_count: 0,
        updated_count: 0,
        failed_count: 1,
        errors: [
          error instanceof Error ? error.message : "Unknown server error.",
        ],
      },
      { status: 500 }
    );
  }
}

// High level: API endpoint for checking whether Plaid credentials and connectivity work.
import { NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid/client";
import { CountryCode } from "plaid";
export async function GET() {
  try {
    const response = await plaidClient.institutionsGet({
      count: 1,
      offset: 0,
      country_codes: [CountryCode.Us],
    });

    return NextResponse.json({
      success: true,
      message: "Plaid connection works",
      institution: response.data.institutions[0]?.name || null,
    });
  } catch (error) {
    console.error("Plaid test error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown Plaid error",
      },
      { status: 500 }
    );
  }
}

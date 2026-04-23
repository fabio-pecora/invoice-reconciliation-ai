import { NextResponse } from "next/server";
import { getLatestPlaidSyncRun } from "@/lib/plaid/sync-runs";

export async function GET() {
  try {
    const syncRun = await getLatestPlaidSyncRun();

    return NextResponse.json({
      success: true,
      sync_run: syncRun,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load Plaid sync status.";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

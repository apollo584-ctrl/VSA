import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Retired. The frontend server cannot see the real client address (the URL hostname comes from the Host header,
 * which any LAN client can set), so Quit now goes to the backend's POST /api/v1/app/quit, which checks it.
 */
export async function POST() {
  return NextResponse.json({ error: "Gone: Quit is handled by the backend." }, { status: 410 });
}

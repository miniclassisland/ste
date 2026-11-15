import { NextResponse } from "next/server";
import { getSteScreenshotBlob, verifySteRequestAuth } from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ request_guid: string }> }
): Promise<NextResponse> {
  if (!verifySteRequestAuth(request)) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { request_guid } = await context.params;
  const blob = getSteScreenshotBlob(request_guid);
  if (!blob) {
    return NextResponse.json(
      { detail: "Screenshot not found or expired" },
      { status: 404 }
    );
  }

  return new NextResponse(new Uint8Array(blob.bytes), {
    status: 200,
    headers: {
      "Content-Type": blob.mimeType,
      "Content-Length": String(blob.bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Screenshot-Sha256": blob.sha256,
    },
  });
}

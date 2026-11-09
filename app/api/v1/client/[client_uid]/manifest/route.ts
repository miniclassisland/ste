import { NextResponse } from "next/server";
import { buildClientManifest, touchClientLastSeen } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ client_uid: string }> }
) {
  try {
    const { client_uid } = await context.params;
    const xff = request.headers.get("x-forwarded-for");
    const clientIp = xff ? xff.split(",")[0].trim() : "127.0.0.1";
    const proto = request.headers.get("x-forwarded-proto") || "http";
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:21196";
    const originUrl = `${proto}://${host}`;

    touchClientLastSeen(client_uid, clientIp);
    const manifest = buildClientManifest(client_uid, clientIp, originUrl);
    return NextResponse.json(manifest, {
      headers: {
        "X-MiniClassIsland-Server": "ste",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Failed to build manifest" },
      {
        status: 403,
        headers: {
          "X-MiniClassIsland-Server": "ste",
        },
      }
    );
  }
}

import { NextResponse } from "next/server";
import { pollClientPairingStatus } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ client_uid: string }> }
) {
  try {
    const { client_uid } = await context.params;
    const url = new URL(request.url);
    const code = url.searchParams.get("code") || "";
    const classId = url.searchParams.get("class_id") || "";
    const mac = url.searchParams.get("mac") || "";
    const xff = request.headers.get("x-forwarded-for");
    const clientIp = xff ? xff.split(",")[0].trim() : "127.0.0.1";

    const status = await pollClientPairingStatus(client_uid, code, classId, mac, clientIp);
    return NextResponse.json(status, {
      headers: {
        "X-MiniClassIsland-Server": "ste",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Failed to poll pairing status" },
      {
        status: 500,
        headers: {
          "X-MiniClassIsland-Server": "ste",
        },
      }
    );
  }
}

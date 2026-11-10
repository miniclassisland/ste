import { NextResponse } from "next/server";
import { handleGrpcClientUnRegister } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ client_uid: string }> }
) {
  try {
    const { client_uid } = await context.params;
    const mac = (request.headers.get("x-client-mac") || "").trim();
    const res = await handleGrpcClientUnRegister(client_uid, mac);
    return NextResponse.json(
      {
        status: "ok",
        unregistered: res.retcode === 200,
        client_uid,
        message: res.message,
      },
      {
        headers: {
          "X-MiniClassIsland-Server": "miniclassisland-ste",
          "X-Server-Flavor": "miniclassisland-ste",
        },
      }
    );
  } catch (err) {
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Failed to unregister client" },
      {
        status: 500,
        headers: {
          "X-MiniClassIsland-Server": "miniclassisland-ste",
          "X-Server-Flavor": "miniclassisland-ste",
        },
      }
    );
  }
}

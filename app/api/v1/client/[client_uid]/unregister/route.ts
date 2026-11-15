import { NextResponse } from "next/server";
import { authorizeClientUnregister, handleGrpcClientUnRegister, SteHttpError } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ client_uid: string }> }
) {
  try {
    const { client_uid } = await context.params;
    const mac = (request.headers.get("x-client-mac") || "").trim();
    const sessionToken = (
      request.headers.get("x-client-session") ||
      request.headers.get("session") ||
      ""
    ).trim();
    const forwardedFor = (request.headers.get("x-forwarded-for") || "").split(",")[0]?.trim();
    const clientIp = forwardedFor || (request.headers.get("x-real-ip") || "").trim();

    const auth = authorizeClientUnregister(client_uid, {
      sessionToken,
      clientIp,
      mac,
    });
    if (!auth.exists) {
      return NextResponse.json(
        {
          status: "ok",
          unregistered: false,
          client_uid,
          message: "Already unregistered",
        },
        {
          headers: {
            "X-MiniClassIsland-Server": "miniclassisland-ste",
            "X-Server-Flavor": "miniclassisland-ste",
          },
        }
      );
    }

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
    const status = err instanceof SteHttpError ? err.statusCode : 500;
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Failed to unregister client" },
      {
        status,
        headers: {
          "X-MiniClassIsland-Server": "miniclassisland-ste",
          "X-Server-Flavor": "miniclassisland-ste",
        },
      }
    );
  }
}

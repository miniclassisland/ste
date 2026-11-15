import { NextRequest, NextResponse } from "next/server";
import { SteHttpError } from "@/lib/server/db";

export const STE_EDIT_SESSION_HEADERS = {
  "X-MiniClassIsland-Server": "miniclassisland-ste",
  "X-Server-Flavor": "miniclassisland-ste",
} as const;

export interface EditSessionRouteContext {
  params: Promise<{
    client_uid: string;
    session_id: string;
  }>;
}

export async function runEditSessionRoute(
  request: NextRequest,
  context: EditSessionRouteContext,
  handler: (args: {
    clientUid: string;
    sessionId: string;
    token: string;
  }) => Promise<unknown> | unknown
): Promise<NextResponse> {
  try {
    const { client_uid, session_id } = await context.params;
    const token = request.headers.get("x-edit-session-token") || "";
    const result = await handler({
      clientUid: client_uid,
      sessionId: session_id,
      token,
    });
    return NextResponse.json(result, { headers: STE_EDIT_SESSION_HEADERS });
  } catch (err) {
    const status = err instanceof SteHttpError ? err.statusCode : 500;
    const detail = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { detail },
      { status, headers: STE_EDIT_SESSION_HEADERS }
    );
  }
}

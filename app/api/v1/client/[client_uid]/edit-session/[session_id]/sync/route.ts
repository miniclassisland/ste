import { NextRequest } from "next/server";
import { SteHttpError, syncClientEditSession } from "@/lib/server/db";
import {
  runEditSessionRoute,
  type EditSessionRouteContext,
} from "@/lib/server/edit-session-route-helper";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: EditSessionRouteContext
) {
  return runEditSessionRoute(request, context, async ({ clientUid, sessionId, token }) => {
    let body: {
      changes?: Record<string, unknown>;
      base_versions?: Record<string, number>;
      force?: boolean;
      notify_clients?: boolean;
      sequence?: number;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      throw new SteHttpError(400, "Invalid JSON request body");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new SteHttpError(400, "Request body must be a JSON object");
    }
    return syncClientEditSession(clientUid, sessionId, token, body);
  });
}

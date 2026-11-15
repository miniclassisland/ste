import { NextRequest } from "next/server";
import { bootstrapClientEditSession } from "@/lib/server/db";
import {
  runEditSessionRoute,
  type EditSessionRouteContext,
} from "@/lib/server/edit-session-route-helper";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: EditSessionRouteContext
) {
  return runEditSessionRoute(request, context, ({ clientUid, sessionId, token }) =>
    bootstrapClientEditSession(clientUid, sessionId, token)
  );
}

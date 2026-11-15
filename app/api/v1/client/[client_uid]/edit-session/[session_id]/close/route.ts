import { NextRequest } from "next/server";
import { closeClientEditSession } from "@/lib/server/db";
import {
  runEditSessionRoute,
  type EditSessionRouteContext,
} from "@/lib/server/edit-session-route-helper";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: EditSessionRouteContext
) {
  return runEditSessionRoute(request, context, ({ clientUid, sessionId, token }) =>
    closeClientEditSession(clientUid, sessionId, token)
  );
}

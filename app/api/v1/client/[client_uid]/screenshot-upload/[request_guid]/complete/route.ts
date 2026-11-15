import { NextRequest, NextResponse } from "next/server";
import {
  extractSteUploadToken,
  finalizeSteScreenshotUpload,
  SteHttpError,
} from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STE_HEADERS = {
  "X-MiniClassIsland-Server": "miniclassisland-ste",
  "X-Server-Flavor": "miniclassisland-ste",
} as const;

interface CompleteRouteContext {
  params: Promise<{
    client_uid: string;
    request_guid: string;
  }>;
}

export async function POST(
  request: NextRequest,
  context: CompleteRouteContext
): Promise<NextResponse> {
  try {
    const { client_uid, request_guid } = await context.params;
    const url = new URL(request.url);
    const token = extractSteUploadToken(request.headers, url);

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new SteHttpError(400, "Invalid JSON request body");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new SteHttpError(400, "Request body must be a JSON object");
    }

    const totalChunks = Number(body.totalChunks ?? body.total_chunks ?? 0);
    const totalBytes = Number(body.totalBytes ?? body.total_bytes ?? 0);
    if (!Number.isInteger(totalChunks) || totalChunks < 1) {
      throw new SteHttpError(400, "totalChunks must be a positive integer");
    }

    const result = finalizeSteScreenshotUpload({
      clientUid: client_uid,
      requestGuid: request_guid,
      totalChunks,
      totalBytes: Number.isFinite(totalBytes) ? Math.trunc(totalBytes) : 0,
      sha256Hex: String(body.sha256 ?? body.sha256_hex ?? ""),
      mimeType: String(body.mimeType ?? body.mime_type ?? "image/png"),
      width: Number(body.width ?? 0) || 0,
      height: Number(body.height ?? 0) || 0,
      originalWidth: Number(body.originalWidth ?? body.original_width ?? 0) || 0,
      originalHeight: Number(body.originalHeight ?? body.original_height ?? 0) || 0,
      boundsX: Number(body.boundsX ?? body.bounds_x ?? 0) || 0,
      boundsY: Number(body.boundsY ?? body.bounds_y ?? 0) || 0,
      displayIndex: Number(body.displayIndex ?? body.display_index ?? 0) || 0,
      capturedAt: String(body.capturedAt ?? body.captured_at ?? ""),
      token,
    });

    return NextResponse.json(result, { headers: STE_HEADERS });
  } catch (err) {
    const status = err instanceof SteHttpError ? err.statusCode : 500;
    const detail = err instanceof Error ? err.message : "Failed to finalize screenshot upload";
    return NextResponse.json({ detail }, { status, headers: STE_HEADERS });
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  extractSteUploadToken,
  SteHttpError,
  storeSteScreenshotChunk,
} from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STE_HEADERS = {
  "X-MiniClassIsland-Server": "miniclassisland-ste",
  "X-Server-Flavor": "miniclassisland-ste",
} as const;

interface ChunkRouteContext {
  params: Promise<{
    client_uid: string;
    request_guid: string;
  }>;
}

async function handleChunkUpload(
  request: NextRequest,
  context: ChunkRouteContext
): Promise<NextResponse> {
  try {
    const { client_uid, request_guid } = await context.params;
    const url = new URL(request.url);
    const rawIdx =
      url.searchParams.get("chunk_index") ??
      request.headers.get("x-chunk-index") ??
      "";
    const rawTotal =
      url.searchParams.get("total_chunks") ??
      request.headers.get("x-total-chunks") ??
      "";

    if (!rawIdx.trim() || !rawTotal.trim()) {
      throw new SteHttpError(400, "Missing chunk_index or total_chunks");
    }
    const chunkIndex = Number(rawIdx);
    const totalChunks = Number(rawTotal);
    if (!Number.isInteger(chunkIndex) || !Number.isInteger(totalChunks)) {
      throw new SteHttpError(400, "chunk_index and total_chunks must be integers");
    }

    const token = extractSteUploadToken(request.headers, url);
    const chunkSha256 = request.headers.get("x-chunk-sha256") || "";
    const arrayBuf = await request.arrayBuffer();
    const chunkBytes = Buffer.from(arrayBuf);

    const res = storeSteScreenshotChunk({
      clientUid: client_uid,
      requestGuid: request_guid,
      chunkIndex,
      totalChunks,
      chunkBytes,
      token,
      chunkSha256,
    });
    return NextResponse.json(res, { headers: STE_HEADERS });
  } catch (err) {
    const status = err instanceof SteHttpError ? err.statusCode : 500;
    const detail = err instanceof Error ? err.message : "Failed to upload screenshot chunk";
    return NextResponse.json({ detail }, { status, headers: STE_HEADERS });
  }
}

export async function PUT(request: NextRequest, context: ChunkRouteContext) {
  return handleChunkUpload(request, context);
}

export async function POST(request: NextRequest, context: ChunkRouteContext) {
  return handleChunkUpload(request, context);
}

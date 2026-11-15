import { pollClientPairingStatus } from "@/lib/server/db";
import { subscribeSteEnvelopes, type SteSseEnvelope } from "@/lib/server/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  "X-MiniClassIsland-Server": "miniclassisland-ste",
  "X-Server-Flavor": "miniclassisland-ste",
} as const;

const TERMINAL_STATUSES = new Set(["approved", "registered", "rejected"]);

export async function GET(
  request: Request,
  context: { params: Promise<{ client_uid: string }> }
): Promise<Response> {
  const { client_uid: clientUid } = await context.params;
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const classId = url.searchParams.get("class_id") || "";
  const mac = url.searchParams.get("mac") || "";
  const timeoutSecRaw = Number(url.searchParams.get("timeout_seconds") || "55");
  const timeoutMs = Math.min(Math.max(Number.isFinite(timeoutSecRaw) ? timeoutSecRaw : 55, 1), 120) * 1000;
  const xff = request.headers.get("x-forwarded-for");
  const clientIp = xff ? xff.split(",")[0].trim() : "127.0.0.1";

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsub: (() => void) | null = null;
      let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const writeFrame = (eventName: string, data: Record<string, unknown>) => {
        if (closed) return;
        try {
          const frame = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        } catch {
          cleanup();
        }
      };

      const writeComment = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ${text}\n\n`));
        } catch {
          cleanup();
        }
      };

      cleanup = () => {
        if (closed) return;
        closed = true;
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (unsub) unsub();
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // Stream already closed
        }
      };

      if (request.signal.aborted) {
        cleanup();
        return;
      }
      request.signal.addEventListener("abort", cleanup, { once: true });

      const probeAndEmit = async () => {
        if (closed) return;
        try {
          const latest = await pollClientPairingStatus(clientUid, code, classId, mac, clientIp);
          writeFrame("pairing.status", {
            ...latest,
            event: "pairing.status",
            timestamp: new Date().toISOString(),
            data: latest,
          });
          if (TERMINAL_STATUSES.has(latest.status)) {
            cleanup();
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : "Failed to inspect pairing status";
          writeFrame("pairing.status", {
            status: "error",
            detail,
            event: "pairing.status",
            timestamp: new Date().toISOString(),
            data: {
              status: "error",
              detail,
            },
          });
          cleanup();
        }
      };

      const onEnvelope = (env: SteSseEnvelope) => {
        if (closed) return;
        if (env.event !== "pairing.updated" && env.event !== "client.status") return;
        const targetUid = String(env.data?.client_uid || "");
        if (targetUid && targetUid !== clientUid) return;
        void probeAndEmit();
      };

      // Register listener before initial DB probe to guarantee zero missed transitions
      unsub = subscribeSteEnvelopes(onEnvelope);
      writeFrame("connected", {
        topic: `pairing:${clientUid}`,
        ts: new Date().toISOString(),
      });

      keepaliveTimer = setInterval(() => {
        writeComment("keepalive");
      }, 15_000);
      timeoutTimer = setTimeout(() => {
        cleanup();
      }, timeoutMs);

      void probeAndEmit();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

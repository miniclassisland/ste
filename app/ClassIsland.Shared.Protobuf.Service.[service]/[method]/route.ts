import { NextResponse } from "next/server";
import { createConnectRouter } from "@connectrpc/connect";
import type { UniversalServerRequest } from "@connectrpc/connect/protocol";
import { registerConnectRoutes } from "@/lib/server/connect-routes";

export const dynamic = "force-dynamic";

const router = createConnectRouter();
registerConnectRoutes(router);

const handlerMap = new Map(
  router.handlers.map((h) => [h.requestPath, h])
);

async function handleRpc(
  request: Request,
  context: { params: Promise<{ service: string; method: string }> }
) {
  const { service, method } = await context.params;
  const path = `/${service}/${method}`;
  const uHandler = handlerMap.get(path);
  if (!uHandler) {
    return new NextResponse("Not Found", { status: 404 });
  }

  async function* bodyGenerator() {
    if (!request.body) return;
    const reader = request.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }

  const uReq: UniversalServerRequest = {
    httpVersion: "2.0",
    method: request.method,
    url: request.url,
    header: request.headers,
    body: bodyGenerator(),
    signal: request.signal,
  };

  const uRes = await uHandler(uReq);
  const resHeaders = new Headers(uRes.header);
  if (uRes.trailer) {
    for (const [k, v] of uRes.trailer.entries()) {
      resHeaders.append(k, v);
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (uRes.body) {
        try {
          for await (const chunk of uRes.body) {
            controller.enqueue(chunk);
          }
        } catch (err) {
          controller.error(err);
          return;
        }
      }
      controller.close();
    },
  });

  return new NextResponse(stream, {
    status: uRes.status,
    headers: resHeaders,
  });
}

export const POST = handleRpc;
export const GET = handleRpc;

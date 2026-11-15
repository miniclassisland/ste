const sseGlobal = globalThis as unknown as {
  __miniclassisland_ste_sse_subscribers?: Set<(frame: string) => void>;
  __miniclassisland_ste_sse_envelope_listeners?: Set<(env: SteSseEnvelope) => void>;
};

if (!sseGlobal.__miniclassisland_ste_sse_subscribers) {
  sseGlobal.__miniclassisland_ste_sse_subscribers = new Set();
}
if (!sseGlobal.__miniclassisland_ste_sse_envelope_listeners) {
  sseGlobal.__miniclassisland_ste_sse_envelope_listeners = new Set();
}

const subscribers = sseGlobal.__miniclassisland_ste_sse_subscribers;
const envelopeListeners = sseGlobal.__miniclassisland_ste_sse_envelope_listeners;
const textEncoder = new TextEncoder();

export interface SteSseEnvelope {
  event: string;
  account_id: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export function formatSteSseFrame(
  eventType: string,
  payload: SteSseEnvelope
): string {
  const safeEvent = eventType.replace(/[\r\n]/g, "").trim() || "message";
  return `event: ${safeEvent}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function publishSteEvent(
  eventType: string,
  data: Record<string, unknown>,
  accountId = "default"
): SteSseEnvelope {
  const envelope: SteSseEnvelope = {
    event: eventType,
    account_id: accountId,
    timestamp: new Date().toISOString(),
    data,
  };
  const frame = formatSteSseFrame(eventType, envelope);
  for (const push of Array.from(subscribers)) {
    try {
      push(frame);
    } catch {
      subscribers.delete(push);
    }
  }
  for (const listen of Array.from(envelopeListeners)) {
    try {
      listen(envelope);
    } catch {
      envelopeListeners.delete(listen);
    }
  }
  return envelope;
}

export function subscribeSteEnvelopes(
  listener: (env: SteSseEnvelope) => void
): () => void {
  envelopeListeners.add(listener);
  return () => {
    envelopeListeners.delete(listener);
  };
}

export function waitForSteEvent(
  predicate: (env: SteSseEnvelope) => boolean,
  timeoutMs = 5000
): Promise<SteSseEnvelope | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeSteEnvelopes((env) => {
      if (settled) return;
      try {
        if (!predicate(env)) return;
      } catch {
        return;
      }
      settled = true;
      if (timer) clearTimeout(timer);
      unsub();
      resolve(env);
    });
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub();
      resolve(null);
    }, Math.max(50, timeoutMs));
  });
}

export function createSteEventStream(
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  let cleanup = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const sendRaw = (frame: string) => {
        if (closed) return;
        try {
          controller.enqueue(textEncoder.encode(frame));
        } catch {
          cleanup();
        }
      };

      subscribers.add(sendRaw);

      const keepaliveTimer = setInterval(() => {
        sendRaw(": keepalive\n\n");
      }, 15_000);

      const onAbort = () => {
        cleanup();
      };

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepaliveTimer);
        subscribers.delete(sendRaw);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        try {
          controller.close();
        } catch {
          // Stream already closed or cancelled
        }
      };

      if (signal) {
        if (signal.aborted) {
          cleanup();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const initialEnvelope: SteSseEnvelope = {
        event: "connected",
        account_id: "default",
        timestamp: new Date().toISOString(),
        data: { status: "ok" },
      };
      sendRaw(formatSteSseFrame("connected", initialEnvelope));
    },
    cancel() {
      cleanup();
    },
  });
}

import net from "node:net";
import http from "node:http";
import http2 from "node:http2";
import { parse } from "node:url";
import next from "next";
import { connectNodeAdapter } from "@connectrpc/connect-node";

const dev = process.argv.includes("--dev") || process.env.NODE_ENV === "development";
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "21196", 10);

const app = next({ dev, hostname, port });
const handleNext = app.getRequestHandler();

async function main() {
  await app.prepare();

  // Dynamically import TypeScript server modules via Node 26 native TS loader or compiled output
  const { registerConnectRoutes } = await import("./lib/server/connect-routes.ts");

  const connectHandler = connectNodeAdapter({
    routes: registerConnectRoutes,
    fallback: (req, res) => {
      const parsedUrl = parse(req.url || "/", true);
      handleNext(req, res, parsedUrl);
    },
  });

  function ensureForwardedFor(req) {
    if (!req.headers["x-forwarded-for"]) {
      const rawIp = req.socket?.remoteAddress || "";
      const ip = rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp;
      if (ip) {
        req.headers["x-forwarded-for"] = ip;
      }
    }
  }

  // HTTP/1.1 Server (serves Next.js Web UI, Server Actions, /api/v1/client/.../manifest, /get, and Connect/gRPC-Web)
  const h1Server = http.createServer((req, res) => {
    ensureForwardedFor(req);
    const urlPath = (req.url || "").split("?", 2)[0];
    if (urlPath.startsWith("/ClassIsland.Shared.Protobuf.Service.")) {
      connectHandler(req, res);
      return;
    }
    const parsedUrl = parse(req.url || "/", true);
    handleNext(req, res, parsedUrl);
  });

  const upgradeHandler = app.getUpgradeHandler();
  h1Server.on("upgrade", (req, socket, head) => {
    upgradeHandler(req, socket, head);
  });

  // HTTP/2 Cleartext (h2c) Server for native ClassIsland gRPC client (Handshake, ClientRegister, ClientCommandDeliver, ConfigUpload, Audit)
  const h2Server = http2.createServer((req, res) => {
    ensureForwardedFor(req);
    connectHandler(req, res);
  });

  // Multiplex HTTP/2 (PRI * HTTP/2.0) and HTTP/1.1 on the same port 21196
  const tcpServer = net.createServer((socket) => {
    const onPreDispatchError = () => {
      socket.destroy();
    };
    socket.on("error", onPreDispatchError);

    const chunks = [];
    let totalLen = 0;

    const cleanup = () => {
      socket.removeListener("readable", onReadable);
      socket.removeListener("end", onEnd);
      socket.removeListener("error", onPreDispatchError);
    };

    const dispatch = (buf) => {
      cleanup();
      const isH2Preface = buf.length >= 14 && buf.toString("ascii", 0, 14) === "PRI * HTTP/2.0";
      socket.unshift(buf);
      if (isH2Preface) {
        h2Server.emit("connection", socket);
      } else {
        h1Server.emit("connection", socket);
      }
    };

    const onEnd = () => {
      cleanup();
      if (totalLen === 0) {
        socket.destroy();
        return;
      }
      dispatch(Buffer.concat(chunks, totalLen));
    };

    const onReadable = () => {
      let chunk;
      while ((chunk = socket.read()) !== null) {
        chunks.push(chunk);
        totalLen += chunk.length;
        const buf = Buffer.concat(chunks, totalLen);
        // Either we have enough bytes for the 14-byte HTTP/2 preface, or we see a newline (HTTP/1.x)
        if (buf.length >= 14 || buf.includes(0x0a)) {
          dispatch(buf);
          return;
        }
      }
    };

    socket.on("readable", onReadable);
    socket.on("end", onEnd);
  });

  tcpServer.listen(port, hostname, () => {
    console.log(
      `> MINI ClassIsland STE listening on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port} (Next.js + ConnectES HTTP/1.1 & HTTP/2 h2c)`
    );
  });
}

main().catch((err) => {
  console.error("Failed to start MINI ClassIsland STE server:", err);
  process.exit(1);
});

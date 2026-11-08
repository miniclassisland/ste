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

  // HTTP/1.1 Server (serves Next.js Web UI, Server Actions, /api/v1/client/.../manifest, /get, and Connect/gRPC-Web)
  const h1Server = http.createServer((req, res) => {
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
    connectHandler(req, res);
  });

  // Multiplex HTTP/2 (PRI * HTTP/2.0) and HTTP/1.1 on the same port 21196
  const tcpServer = net.createServer((socket) => {
    socket.once("readable", () => {
      const chunk = socket.read(24);
      if (!chunk) {
        socket.destroy();
        return;
      }
      const isH2Preface = chunk.toString("ascii", 0, 14) === "PRI * HTTP/2.0";
      socket.unshift(chunk);
      if (isH2Preface) {
        h2Server.emit("connection", socket);
      } else {
        h1Server.emit("connection", socket);
      }
    });
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

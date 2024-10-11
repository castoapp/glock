import { WebSocketServer } from "ws";
import { Server, AV } from "./";
import { arrayBufferToJSON } from "./utils";
import dotenv from "dotenv";

dotenv.config();

const port = parseInt(process.env.PORT || "8080");
const wss = new WebSocketServer({ port });

const authKey = process.env.AUTH_KEY || "";
const maxPacketSize = Number(process.env.MAX_PACKET_SIZE || `${101 * 1024}`); // 100 KB + 1 KB reserved for header
const debug = process.env.DEBUG === "true";

const server = new Server(wss, {
  maxPacketSize,
  authKey,
});

const av = new AV(server);

server.on("connect", () => {
  if (debug) console.debug("[Glock] Client connected");
});

server.on("packet", async (header, data) => {
  if (debug) console.debug("[Glock] Received chunk with header:", header);

  if (header === 0x10) {
    const payload = arrayBufferToJSON(data);
    if (debug) console.info("[Glock] Received AV stream start", payload);
    await av.start(payload);

    av.once("ready", () => {
      if (debug) console.debug("[Glock] AV stream ready");

      // 0x34 = AV stream ready
      server.wrtcHandler.sendHeader(0x34);
    });
  } else if (header === 0x41) {
    if (debug) console.debug("[Glock] Received AV chunk");
    await av.put(data);
  } else if (header === 0x84) {
    if (debug) console.debug("[Glock] Received AV stream end");
    await av.stop();
  }
});

server.on("disconnect", async (client) => {
  if (debug) console.debug("[Glock] Client disconnected");
  await av.stop();
});

console.log(`[Glock] WS server is running on ws://localhost:${port}`);

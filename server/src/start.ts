import { publicIpv4 } from "public-ip";
import chalk from "chalk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
dotenv.config();

import { WebSocketServer } from "ws";
import { Server, AV } from "./index.js";
import {
  DEFAULT_CHUNK_WAIT_CHECK_INTERVAL,
  DEFAULT_CHUNK_WAIT_TIMEOUT,
  DEFAULT_ICE_SERVERS,
  DEFAULT_MAX_PACKET_SIZE,
} from "./defaults.js";
import { arrayBufferToJSON } from "./utils/index.js";

import { Client } from "./wsHandler.js";
import { StreamConfig } from "./av/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
);
const version = packageJson.version || "unknown";

const port = parseInt(process.env.PORT || "8080");
const wss = new WebSocketServer({ port });

const authKey = process.env.AUTH_KEY || "";
const maxPacketSize = Number(
  process.env.MAX_PACKET_SIZE || DEFAULT_MAX_PACKET_SIZE
);
const chunkWaitTimeout = Number(
  process.env.CHUNK_WAIT_TIMEOUT || DEFAULT_CHUNK_WAIT_TIMEOUT
);
const chunkWaitCheckInterval = Number(
  process.env.CHUNK_WAIT_CHECK_INTERVAL || DEFAULT_CHUNK_WAIT_CHECK_INTERVAL
);
const iceServers = process.env.ICE_SERVERS
  ? process.env.ICE_SERVERS?.split(",")
  : DEFAULT_ICE_SERVERS;
const debug = process.env.DEBUG === "true";

const server = new Server(wss, {
  maxPacketSize,
  authKey,
  iceServers,
});

console.info(chalk.bgWhiteBright(`Glock v${version}\n`));

console.info(chalk.gray("---- Glock config ----"));
console.info(`Auth key: ${authKey}`);
console.info(`Max packet size: ${maxPacketSize}`);
console.info(`Chunk wait timeout: ${chunkWaitTimeout}`);
console.info(`Chunk wait check interval: ${chunkWaitCheckInterval}`);
console.info(`ICE servers: ${iceServers.join(", ")}`);
console.info(chalk.gray("---- Glock config ----\n"));

const avInstances = new Map<Client, AV>();

server.on("packet", async (header: number, data: Buffer, client: Client) => {
  if (debug) console.debug("[Glock] Received chunk with header:", header);

  if (header === 0x10) {
    // Parse the config payload
    const payload = arrayBufferToJSON(data) as Partial<StreamConfig>;
    if (debug) console.info("[Glock] Received AV stream start", payload);

    // Initialize the AV instance
    const av = new AV(client, { chunkWaitTimeout, chunkWaitCheckInterval });
    avInstances.set(client, av);

    av.once("timeout", () => {
      // Delete the AV instance if the chunk wait times out
      avInstances.delete(client);

      // 0x35 = AV chunk wait timeout
      client.wrtcHandler.sendHeader(0x36);
    });

    // Start the AV stream
    await av.start(payload);

    // Send the AV stream ready header
    av.once("ready", () => {
      if (debug) console.debug("[Glock] AV stream ready");

      // 0x34 = AV stream ready
      client.wrtcHandler.sendHeader(0x34);
    });
  } else if (header === 0x41) {
    if (debug) console.info("[Glock] Received AV chunk");

    const av = avInstances.get(client);
    await av?.put(data);
  } else if (header === 0x84) {
    if (debug) console.info("[Glock] Received AV stream end");

    const av = avInstances.get(client);
    await av?.stop();
    avInstances.delete(client);
  }
});

server.on("disconnect", async (client) => {
  if (debug) console.info("[Glock] Client disconnected");

  const av = avInstances.get(client);
  await av?.stop();
  avInstances.delete(client);
});

console.log(chalk.greenBright("[Glock] WebSockets server is running on:"));
console.log(`  - Local:   ${chalk.blueBright(`ws://localhost:${port}`)}`);

publicIpv4()
  .then((ip) => {
    console.log(`  - Network: ${chalk.blueBright(`ws://${ip}:${port}`)}`);
  })
  .catch(() => {
    console.log(`  - Network: <unknown>`);
  })
  .finally(() => {
    console.log(
      chalk.white(
        `\nUse your machine's IP address or domain name for remote connections`
      )
    );
  });

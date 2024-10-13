import { WebSocketServer } from "ws";
import events from "events";
import WSHandler from "./wsHandler.js";
import { DEFAULT_ICE_SERVERS, DEFAULT_MAX_PACKET_SIZE } from "./utils.js";

interface ServerOptions {
  maxPacketSize?: number;
  authKey?: string;
  iceServers?: string[];
}

export default class Server extends events.EventEmitter {
  public wsHandler!: WSHandler;

  constructor(
    public wss: WebSocketServer,
    public options: ServerOptions = {
      maxPacketSize: DEFAULT_MAX_PACKET_SIZE,
    }
  ) {
    super();
    // Maximum packet size (default: 300 KB)
    // WARNING: chunkSize of the client should be less than this value
    // otherwise connection will drop because of WebRTC restrictions
    if (
      options.maxPacketSize &&
      options.maxPacketSize > DEFAULT_MAX_PACKET_SIZE
    ) {
      throw new Error(
        "[Glock] Maximum packet size can not exceed " +
          DEFAULT_MAX_PACKET_SIZE / 1024 +
          " KB"
      );
    }
    if (!options.maxPacketSize) options.maxPacketSize = DEFAULT_MAX_PACKET_SIZE;
    if (!options.iceServers) options.iceServers = DEFAULT_ICE_SERVERS;
    this.wsHandler = new WSHandler(this);
  }
}

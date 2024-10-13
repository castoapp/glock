import { WebSocketServer } from "ws";
import events from "events";
import WSHandler from "./wsHandler.js";
import { DEFAULT_MAX_PACKET_SIZE } from "./utils.js";

export default class Server extends events.EventEmitter {
  public wsHandler!: WSHandler;

  constructor(
    public wss: WebSocketServer,
    public options: { maxPacketSize?: number; authKey?: string } = {
      maxPacketSize: DEFAULT_MAX_PACKET_SIZE,
    }
  ) {
    super();
    if (!options.maxPacketSize) options.maxPacketSize = DEFAULT_MAX_PACKET_SIZE;
    this.wsHandler = new WSHandler(this);
  }
}

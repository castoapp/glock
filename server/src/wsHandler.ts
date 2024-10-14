import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import Server from "./server.js";
import { parseJSON } from "./utils/index.js";
import { WRTCHandler } from "./wrtcHandler.js";

const debug = process.env.DEBUG === "true";

export interface Client {
  ws: WebSocket;
  wrtcHandler: WRTCHandler;
}

/**
 * WebSocket handler
 */
export default class WSHandler {
  private ws!: WebSocketServer;
  public clients: Map<WebSocket, Client> = new Map();

  constructor(private server: Server) {
    this.ws = server.wss;

    // Listen for connections
    this.ws.on("connection", this.onConnected.bind(this));
  }

  /**
   * Handle a new connection
   * @param socket - The WebSocket client instance
   * @param request - The request object
   */
  private onConnected(socket: WebSocket, request: IncomingMessage) {
    console.log("[Glock] [wsHandler] connection established");

    // Verify authentication key
    if (!this.verifyAuthKey(request))
      return socket.close(1002, "Invalid authentication key");

    // Create client
    const client = this.addClient(socket);

    // Listen for messages
    socket.on("message", (p) => this.onMessage(p.toString(), client));
    // Listen for disconnection
    socket.once("close", this.onDisconnected.bind(this));
  }

  /**
   * Handle a message
   * @param data - The message data
   */
  private async onMessage(data: string, client: Client) {
    if (debug) console.log("[Glock] [wsHandler] message received", data);

    const payload = await parseJSON<{
      type: string;
      offer?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    }>(data);

    if (payload.type === "wrtc:offer" && payload.offer)
      return client.wrtcHandler.handleWebRTCOffer(payload.offer, client);
    else if (payload.type === "wrtc:ice" && payload.candidate)
      return client.wrtcHandler.handleICECandidate(payload.candidate, client);
  }

  /**
   * Handle a disconnection
   * @param socket - The WebSocket client instance
   */
  private onDisconnected(socket: WebSocket) {
    console.log("[Glock] [wsHandler] connection closed");

    // Get client
    const client = this.clients.get(socket);
    if (!client) return;

    // Emit disconnect event
    this.server.emit("disconnect", client);

    // Close WebRTC connection
    client.wrtcHandler.close();

    // Remove client from map
    this.removeClient(socket);
  }

  /**
   * Verify the authentication key
   * @param request - The request object
   * @returns True if the authentication key is valid, false otherwise
   */
  private verifyAuthKey(request: IncomingMessage) {
    const authKey = request.url?.split("?")[1]?.split("=")[1];
    return (
      !this.server.options.authKey || authKey === this.server.options.authKey
    );
  }

  /**
   * Add a client to the map
   * @param socket - The WebSocket client instance
   * @returns The client
   */
  private addClient(socket: WebSocket) {
    const client = {
      ws: socket,
      wrtcHandler: new WRTCHandler(this.server, socket),
    };
    this.clients.set(socket, client);
    return client;
  }

  /**
   * Remove a client from the map
   * @param socket - The WebSocket client instance
   */
  private removeClient(socket: WebSocket) {
    this.clients.delete(socket);
  }
}

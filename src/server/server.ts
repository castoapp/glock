import WebSocket, { WebSocketServer } from "ws";
import { WRTCHandler } from "./wrtcHandler";
import events from "events";
import { randomUUID } from "crypto";

interface Client {
  ws: WebSocket;
  wrtcHandler: WRTCHandler;
  authenticated: boolean;
}

export default class Server extends events.EventEmitter {
  private clients: Map<WebSocket, Client> = new Map();
  public wrtcHandler!: WRTCHandler;

  constructor(
    public wss: WebSocketServer,
    public options: { maxPacketSize: number; authKey: string } = {
      maxPacketSize: 307200, // 300 KB
      authKey: randomUUID(),
    }
  ) {
    super();
    this.setupWebSocketServer();
  }

  private setupWebSocketServer() {
    this.wss.on("connection", (ws: WebSocket) => {
      // Handle connection
      this.handleConnect(ws);

      // Setup WebRTC handler
      this.wrtcHandler = new WRTCHandler(this, ws);

      // Setup client
      this.clients.set(ws, {
        ws,
        authenticated: false,
        wrtcHandler: this.wrtcHandler,
      });

      // Listen for events
      ws.on("message", (message: string) => this.handleMessage(ws, message));
      ws.on("close", () => this.handleDisconnect(ws));
    });
  }

  private handleMessage(ws: WebSocket, message: string) {
    const client = this.clients.get(ws);
    if (!client) return;

    try {
      const data = JSON.parse(message);
      if (data.type === "auth") {
        this.handleAuth(client, data.key);
      } else if (client.authenticated) {
        if (data.type === "wrtc:offer") {
          client.wrtcHandler.handleWebRTCOffer(data.offer);
        } else if (data.type === "wrtc:ice") {
          client.wrtcHandler.handleICECandidate(data.candidate);
        }
      } else {
        ws.send(
          JSON.stringify({ type: "error", message: "Not authenticated" })
        );
      }
    } catch (error) {
      console.error("Error handling message:", error);
    }
  }

  private handleAuth(client: Client, key: string) {
    if (key === this.options.authKey) {
      client.authenticated = true;
      client.ws.send(JSON.stringify({ type: "auth:success" }));
    } else {
      client.ws.send(JSON.stringify({ type: "auth:failed" }));
      client.ws.close(1008, "Invalid auth key");
    }
  }

  private handleConnect(ws: WebSocket) {
    const client = this.clients.get(ws);
    this.emit("connect", client);
  }

  private handleDisconnect(ws: WebSocket) {
    const client = this.clients.get(ws);
    if (client) {
      client.wrtcHandler.close();
    }
    this.clients.delete(ws);
    this.emit("disconnect", client);
  }
}

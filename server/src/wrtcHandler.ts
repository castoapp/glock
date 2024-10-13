import { PeerConnection, DataChannel } from "node-datachannel";
import type Server from "./server.js";
import { WebSocket } from "ws";
import { DEFAULT_ICE_SERVERS, stringifyJSON } from "./utils.js";
import { Client } from "./wsHandler.js";

const debug = process.env.DEBUG === "true";

enum DescriptionType {
  Unspec = "unspec",
  Offer = "offer",
  Answer = "answer",
  Pranswer = "pranswer",
  Rollback = "rollback",
}

/**
 * WebRTC handler
 */
export class WRTCHandler {
  private rtc?: PeerConnection;
  private dataChannel?: DataChannel;
  private maxPacketSize!: number;

  constructor(private server: Server, private ws: WebSocket) {
    this.maxPacketSize = server.options.maxPacketSize!;
  }

  /**
   * Handle the WebRTC offer
   * @param offer - The offer to handle
   * @param client - Client instance
   */
  handleWebRTCOffer(offer: RTCSessionDescriptionInit, client: Client) {
    // Create a new peer connection
    this.rtc = new PeerConnection("Server", {
      iceServers: DEFAULT_ICE_SERVERS,
    });

    // Handle local description
    this.rtc.onLocalDescription((sdp, type) => {
      stringifyJSON({ type: "wrtc:answer", answer: { sdp, type } }).then(
        (data) => this.ws.send(data)
      );
    });

    // Handle local candidate
    this.rtc.onLocalCandidate((candidate, mid) => {
      stringifyJSON({
        type: "wrtc:ice",
        candidate: { candidate, mid },
      }).then((data) => this.ws.send(data));
    });

    // Handle data channel open
    this.rtc.onDataChannel((dc) => {
      this.dataChannel = dc;
      if (debug) console.info("[Glock] [wrtcHandler] data channel opened");

      // Handle data channel message
      this.dataChannel.onMessage((msg: string | Buffer) => {
        try {
          // Check if the message is a buffer
          if (!Buffer.isBuffer(msg)) throw new Error("Invalid message type");
          // Check if the message is too large
          if (this.maxPacketSize && msg.length > this.maxPacketSize)
            throw new Error("Packet too large");

          // Read the header
          const header = msg.readUInt8(0);
          // Emit the packet
          this.server.emit("packet", header, msg.slice(1), client);
        } catch (error) {
          console.error("Error processing packet:", error);
        }
      });
    });

    // Set the remote description
    this.rtc.setRemoteDescription(
      String(offer.sdp),
      offer.type as DescriptionType
    );

    // Set the local description
    this.rtc.setLocalDescription();
  }

  /**
   * Handle the ICE candidate
   * @param candidate - The candidate to add
   * @param client - Client instance
   */
  handleICECandidate(candidate: RTCIceCandidateInit, _: Client) {
    if (!this.rtc) return;

    // Add the remote candidate
    this.rtc.addRemoteCandidate(
      String(candidate.candidate),
      candidate.sdpMid || ""
    );
  }

  /**
   * Sequence the packet into chunks
   * @param data - The data to sequence
   * @returns The chunks
   */
  public sequencePacket(data: ArrayBuffer) {
    const chunks = [];
    for (let i = 0; i < data.byteLength; i += this.maxPacketSize) {
      const remainingBytes = data.byteLength - i;
      const chunkSize = Math.min(this.maxPacketSize, remainingBytes);
      chunks.push(new Uint8Array(data, i, chunkSize));
    }

    return chunks;
  }

  /**
   * Send a packet
   * @param header - The header of the packet
   * @param data - The data to send
   */
  public async sendPacket(header: number, data: Blob) {
    const headerArray = new Uint8Array([header]);

    // Get sequence of chunks
    const chunksSeq = this.sequencePacket(await data.arrayBuffer());

    // ! TODO: add queue for the chunks
    for (const chunk of chunksSeq) {
      // Calculate the total packet size
      const headerSize = headerArray.length;
      const dataSize = chunk.length;
      const totalSize = headerSize + dataSize;

      // Create the packet with the correct size
      let packet = new Uint8Array(totalSize);

      // Put the header at the start of the packet
      packet.set(headerArray, 0);

      // Put the data at the end of the packet if present
      packet.set(chunk, headerSize);

      // Send the packet
      this.dataChannel?.sendMessageBinary(packet);

      if (debug)
        console.info(`[Glock] packet_sent: ${header} ${data.size} bytes`);
    }
  }

  /**
   * Send a header
   * @param header - The header to send
   */
  public async sendHeader(header: number) {
    if (this.dataChannel?.isOpen()) {
      this.dataChannel?.sendMessageBinary(new Uint8Array([header]));
      if (debug) console.info(`[Glock] header_sent: ${header} 1 bytes`);
    }
  }

  /**
   * Close the WebRTC connection
   */
  close() {
    if (this.rtc) this.rtc.close();
    if (this.dataChannel) this.dataChannel.close();
  }
}

import { PeerConnection, DataChannel } from "node-datachannel";
import type Server from "./server.js";
import { WebSocket } from "ws";

export class WRTCHandler {
  private rtc?: PeerConnection;
  private dataChannel?: DataChannel;

  constructor(private server: Server, private ws: WebSocket) {}

  handleWebRTCOffer(offer: RTCSessionDescriptionInit) {
    this.rtc = new PeerConnection("Server", {
      iceServers: ["stun:stun.l.google.com:19302"],
    });

    this.rtc.onLocalDescription((sdp, type) => {
      this.ws.send(
        JSON.stringify({
          type: "wrtc:answer",
          answer: { sdp, type },
        })
      );
    });

    this.rtc.onLocalCandidate((candidate, mid) => {
      this.ws.send(
        JSON.stringify({
          type: "wrtc:ice",
          candidate: { candidate, mid },
        })
      );
    });

    this.rtc.onDataChannel((dc) => {
      this.dataChannel = dc;
      this.server.emit("dataChannelOpened", dc);

      this.dataChannel.onMessage((msg: string | Buffer) => {
        try {
          // Check if the message is a buffer
          if (!Buffer.isBuffer(msg)) throw new Error("Invalid message type");
          // Check if the message is too large
          if (msg.length > this.server.options.maxPacketSize)
            throw new Error("Packet too large");

          // Read the header
          const header = msg.readUInt8(0);
          // Emit the packet
          this.server.emit("packet", header, msg.slice(1));
        } catch (error) {
          console.error("Error processing packet:", error);
        }
      });
    });

    this.rtc.setRemoteDescription(String(offer.sdp), offer.type as any);
    this.rtc.setLocalDescription();
  }

  handleICECandidate(candidate: RTCIceCandidateInit) {
    if (this.rtc) {
      this.rtc.addRemoteCandidate(
        String(candidate.candidate),
        candidate.sdpMid || ""
      );
    }
  }

  public sequencePacket(data: ArrayBuffer) {
    // Here we need to split the data into chunks of this.chunkSize
    // and return them as array of Uint8Array

    const chunks = [];
    for (
      let i = 0;
      i < data.byteLength;
      i += this.server.options.maxPacketSize
    ) {
      const remainingBytes = data.byteLength - i;
      const chunkSize = Math.min(
        this.server.options.maxPacketSize,
        remainingBytes
      );
      chunks.push(new Uint8Array(data, i, chunkSize));
    }

    return chunks;
  }

  public async sendPacket(header: number, data: Blob) {
    const headerArray = new Uint8Array([header]);

    // Get sequence of chunks
    const chunksSeq = this.sequencePacket(await data.arrayBuffer());
    console.info(`[Glock] sending ${chunksSeq.length} chunks`, chunksSeq);

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

      console.info(`[Glock] packet_sent: ${header} ${data.size} bytes`);
    }
  }

  public async sendHeader(header: number) {
    this.dataChannel?.sendMessageBinary(new Uint8Array([header]));
  }

  sendMessage(message: string) {
    if (this.dataChannel && this.dataChannel.isOpen()) {
      this.dataChannel.sendMessage(message);
    }
  }

  close() {
    if (this.rtc) this.rtc.close();
    if (this.dataChannel) this.dataChannel.close();
  }
}

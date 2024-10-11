import Client from "./client.js";

export default class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;

  onIceCandidate: ((candidate: RTCIceCandidate) => void) | null = null;
  onDataChannelOpen: (() => void) | null = null;
  onDataChannelClose: (() => void) | null = null;
  onDataChannelMessage: ((message: Uint8Array) => void) | null = null;
  onConnectionStateChange: ((state: RTCPeerConnectionState) => void) | null =
    null;

  constructor(
    public client: Client,
    public chunkSize: number = 100 * 1024,
    private iceServers: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
    ]
  ) {
    this.initializePeerConnection();
  }

  private initializePeerConnection() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidate) {
        this.onIceCandidate(event.candidate);
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(this.peerConnection!.connectionState);
      }
    };

    this.dataChannel = this.peerConnection.createDataChannel("dataChannel");
    this.setupDataChannel();
  }

  private setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      if (this.onDataChannelOpen) this.onDataChannelOpen();
    };

    this.dataChannel.onmessage = (event) => {
      if (this.onDataChannelMessage) this.onDataChannelMessage(event.data);
    };

    this.dataChannel.onclose = () => {
      if (this.onDataChannelClose) this.onDataChannelClose();
    };
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) throw new Error("PeerConnection not initialized");
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) throw new Error("PeerConnection not initialized");
    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(answer)
    );
  }

  public async addIceCandidate(candidateData: any): Promise<void> {
    if (!this.peerConnection) throw new Error("PeerConnection not initialized");
    let candidate;

    if (typeof candidateData === "string") {
      // If candidateData is a string, it's likely the candidate string itself
      candidate = { candidate: candidateData, sdpMid: "", sdpMLineIndex: 0 };
    } else if (typeof candidateData === "object") {
      // If it's an object, try to construct the RTCIceCandidate with available properties
      candidate = {
        candidate: candidateData.candidate || "",
        sdpMid: candidateData.sdpMid || candidateData.mid || "",
        sdpMLineIndex: candidateData.sdpMLineIndex || 0,
      };
    } else {
      console.error("[Glock] Invalid ICE candidate data:", candidateData);
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("[Glock] Error adding ICE candidate:", error);
      throw error;
    }
  }

  public async sendData(
    data: string | ArrayBuffer | Blob | Uint8Array | ArrayBufferView
  ) {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      console.error("[Glock] Data channel is not open");
      throw new Error("Data channel is not open");
    }

    try {
      let buffer: ArrayBuffer;
      if (typeof data === "string") {
        buffer = new TextEncoder().encode(data).buffer;
      } else if (data instanceof ArrayBuffer) {
        buffer = data;
      } else if (data instanceof Blob) {
        buffer = await data.arrayBuffer();
      } else if (data instanceof Uint8Array) {
        buffer = data.buffer;
      } else if (ArrayBuffer.isView(data)) {
        buffer = data.buffer;
      } else {
        throw new Error("Unsupported data type");
      }

      this.dataChannel.send(buffer);
    } catch (error) {
      console.error("[Glock] Error sending data:", error);
      throw error;
    }
  }

  public sequencePacket(data: ArrayBuffer) {
    // Here we need to split the data into chunks of this.chunkSize
    // and return them as array of Uint8Array

    const chunks = [];
    for (let i = 0; i < data.byteLength; i += this.chunkSize) {
      const remainingBytes = data.byteLength - i;
      const chunkSize = Math.min(this.chunkSize, remainingBytes);
      chunks.push(new Uint8Array(data, i, chunkSize));
    }

    return chunks;
  }

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
      this.sendData(packet.buffer);
    }

    if (this.client.options.debug)
      console.info(`[Glock] packet_sent: ${header} ${data.size} bytes`);
  }

  public close() {
    if (this.dataChannel) this.dataChannel.close();
    if (this.peerConnection) this.peerConnection.close();
  }

  public isConnected(): boolean {
    return (
      this.peerConnection !== null &&
      this.peerConnection.connectionState === "connected" &&
      this.dataChannel !== null &&
      this.dataChannel.readyState === "open"
    );
  }
}

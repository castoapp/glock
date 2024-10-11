import WebRTCManager from "./wrtcManager.js";
import { WSManager } from "./wsManager.js";
import "./types.js";
import { jsonToBlob } from "./utils.js";

const streamConfig = {
  destination: "test-" + Date.now() + ".mp4",
  fps: null,
};

interface ClientConfig {
  debug: boolean;
  authKey: string;
}

export default class Client {
  private wsManager: WSManager;
  private webRTCManager: WebRTCManager;
  private authKey: string;
  private mediaRecorder: MediaRecorder | null = null;
  public status: string = "disconnected";
  private videoBuffer: Blob[] = [];
  private bufferSize = 5; // Number of chunks to buffer before sending
  private isProcessingBuffer = false;
  private lastProcessingTime = performance.now();

  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  onMessage: ((message: Uint8Array) => void) | null = null;
  onStatusChange: ((status: string) => void) | null = null;

  constructor(
    private serverUrl: string,
    public stream: MediaStream,
    public options: ClientConfig = { debug: false, authKey: "" }
  ) {
    this.authKey = options.authKey;
    this.webRTCManager = new WebRTCManager(this);
    this.wsManager = new WSManager(this.serverUrl, this.webRTCManager);
  }

  public async connect() {
    this.setupWSManager();
    this.wsManager.connect();
  }

  public async disconnect() {
    await this.processBuffer(); // Ensure all chunks are sent
    this.stopVideoStreaming();
    this.webRTCManager.close();
    this.wsManager.disconnect();
  }

  private setupWSManager() {
    this.wsManager.onOpen = () => {
      this.updateStatus("authenticating");
      this.authenticate();
    };

    this.wsManager.onAuthSuccess = () => {
      this.updateStatus("authenticated");
      this.initializeWebRTC();
    };

    this.wsManager.onAuthFailed = () => {
      this.updateStatus("authenticationFailed");
    };

    this.wsManager.onStatusChange = (status) => {
      this.updateStatus(status);
    };

    this.wsManager.onOtherMessage = (message) => {
      if (this.onMessage) this.onMessage(message);
    };

    this.wsManager.onClose = () => {
      this.updateStatus("disconnected");
      if (this.onClose) this.onClose();
      if (this.mediaRecorder) this.mediaRecorder.stop();
    };

    this.wsManager.onError = (error) => {
      console.error("[Glock] WS connection error:", error);
      this.updateStatus("connectionFailed");
    };
  }

  private async startRecorder() {
    try {
      if (this.options.debug) {
        console.log("[Glock] Video tracks:", this.stream.getVideoTracks());
        console.log("[Glock] Audio tracks:", this.stream.getAudioTracks());
      }

      if (this.stream.getVideoTracks().length === 0) {
        throw new Error("[Glock] No video track found in the captured stream");
      }

      const mimeTypes = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=h264,opus",
        "video/mp4;codecs=h264,aac",
      ];

      const selectedMimeType = mimeTypes.find((type) =>
        MediaRecorder.isTypeSupported(type)
      );

      if (!selectedMimeType) {
        throw new Error(
          "[Glock] No supported MIME type found for MediaRecorder"
        );
      }

      if (this.options.debug)
        console.log("[Glock] Selected MIME type:", selectedMimeType);

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: 1500000, // 1.5Mbps for a balance of quality and performance
      });

      if (this.options.debug)
        console.log("[Glock] MediaRecorder created:", this.mediaRecorder);

      this.mediaRecorder.ondataavailable = this.handleDataAvailable.bind(this);
      this.mediaRecorder.onstart = () =>
        this.options.debug && console.log("[Glock] MediaRecorder started");
      this.mediaRecorder.onstop = () =>
        this.options.debug && console.log("[Glock] MediaRecorder stopped");
      this.mediaRecorder.onerror = (event) =>
        console.error("[Glock] MediaRecorder error:", event);

      if (this.options.debug) console.log("[Glock] Starting MediaRecorder...");
      this.mediaRecorder.start(200); // Capture every 200ms for smoother video
    } catch (error) {
      console.error("[Glock] Error setting up video streaming:", error);
      this.updateStatus("avSetupFailed");
    }
  }

  private handleDataAvailable(event: BlobEvent) {
    if (event.data && event.data.size > 0) {
      if (this.options.debug) {
        console.log(
          "[Glock] Video data available, size:",
          event.data.size,
          "bytes"
        );
      }
      this.addToBuffer(event.data);
    } else if (this.options.debug) {
      console.log("[Glock] No video data available in this event");
    }
  }

  private addToBuffer(chunk: Blob) {
    this.videoBuffer.push(chunk);
    if (this.videoBuffer.length >= this.bufferSize) {
      this.processBuffer();
    } else if (!this.isProcessingBuffer) {
      // Schedule processing even if buffer isn't full
      this.scheduleBufferProcessing();
    }
  }

  private async processBuffer() {
    if (this.isProcessingBuffer) return;
    this.isProcessingBuffer = true;

    const chunksToProcess = this.videoBuffer.splice(0, this.bufferSize);
    if (chunksToProcess.length === 0) return;

    const blob = new Blob(chunksToProcess, { type: chunksToProcess[0].type });

    if (this.webRTCManager && this.webRTCManager.isConnected()) {
      try {
        // 0x41 = AV chunk
        await this.webRTCManager.sendPacket(0x41, blob);
      } catch (error) {
        console.error("[Glock] Error sending buffered chunk:", error);
        this.videoBuffer.unshift(...chunksToProcess); // Put the chunks back at the start of the buffer
      }
    }

    this.isProcessingBuffer = false;

    // If there are still chunks in the buffer, process them
    if (this.videoBuffer.length >= this.bufferSize) {
      this.scheduleBufferProcessing();
    }

    this.adjustBufferSize();
    this.lastProcessingTime = performance.now();
  }

  private stopVideoStreaming() {
    if (this.mediaRecorder) {
      this.mediaRecorder.stop();
      // Send a message to the server indicating the end of the video stream
      if (this.webRTCManager && this.webRTCManager.isConnected()) {
        // 0x84 = AV stream end
        this.webRTCManager.sendPacket(0x84, new Blob());
      }
    }
  }

  private updateStatus(status: string) {
    this.status = status;
    if (this.onStatusChange) this.onStatusChange(status);
  }

  private authenticate() {
    this.wsManager.send(JSON.stringify({ type: "auth", key: this.authKey }));
  }

  private initializeWebRTC() {
    this.webRTCManager.onIceCandidate = (candidate) => {
      this.wsManager.send(JSON.stringify({ type: "wrtc:ice", candidate }));
    };

    this.webRTCManager.onConnectionStateChange = (state) => {
      if (state === "connected" && this.onOpen) {
        this.onOpen();
      }
    };

    this.webRTCManager.onDataChannelOpen = () => {
      this.updateStatus("connected");

      // 0x10 = AV stream start
      if (this.webRTCManager && this.webRTCManager.isConnected()) {
        this.webRTCManager.sendPacket(0x10, jsonToBlob(streamConfig));
      }
    };

    this.webRTCManager.onDataChannelMessage = (message) => {
      const header = new Uint8Array(message)[0];

      if (this.options.debug) console.info("[Glock] Received header:", header);

      if (header === 0x34) {
        if (this.options.debug) console.info("[Glock] AV stream ready");
        this.startRecorder();
      }
    };

    this.webRTCManager.onDataChannelClose = () => {
      this.updateStatus("dataChannelClosed");
    };

    this.webRTCManager
      .createOffer()
      .then((offer) => {
        this.wsManager.send(JSON.stringify({ type: "wrtc:offer", offer }));
      })
      .catch((error) => {
        console.error("[Glock] Error creating offer:", error);
        this.updateStatus("offerCreationFailed");
      });
  }

  private scheduleBufferProcessing() {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => this.processBuffer(), { timeout: 1000 });
    } else {
      setTimeout(() => this.processBuffer(), 100);
    }
  }

  private adjustBufferSize() {
    const processingTime = performance.now() - this.lastProcessingTime;
    if (processingTime > 50) {
      this.bufferSize = Math.max(2, this.bufferSize - 1);
    } else if (processingTime < 25 && this.bufferSize < 10) {
      this.bufferSize++;
    }
  }
}

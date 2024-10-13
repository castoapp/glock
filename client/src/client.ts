import WebRTCManager from "./wrtcManager.js";
import { WSManager } from "./wsManager.js";
import "./types.js";
import {
  DEFAULT_BUFFER_SIZE,
  DEFAULT_CHUNK_LENGTH_TIME,
  DEFAULT_CHUNK_SIZE,
  jsonToBlob,
  Status,
} from "./utils.js";

export interface StreamConfig {
  // Destination type: flv, mp4, etc.
  destinationType?: string;
  // Destination URL/path
  destination: string;
  // MediaRecorder bitrate (default: 1500000)
  recorderBitrate?: number;
  // Force a specific MIME type for the MediaRecorder
  forceMimeType?: string;
  // Video codec (default: libx264)
  vcodec?: string;
  // Audio codec (default: aac)
  acodec?: string;
  // Video bitrate (default: 6000k)
  vbitrate?: number;
  // Audio bitrate (default: 192k)
  abitrate?: number;
  // FPS (default: 30)
  fps?: number;
  // Resolution (default: 1920x1080)
  resolution?: string;
}

interface ClientConfig {
  debug?: boolean;
  authKey?: string;
  bufferSize?: number;
  chunkLengthTime?: number;
  chunkSize?: number;
}

export default class Client extends EventTarget {
  private wsManager!: WSManager;
  private webRTCManager: WebRTCManager;
  private authKey: string;
  private mediaRecorder: MediaRecorder | null = null;
  public status: Status = Status.IDLE;
  private videoBuffer: Blob[] = [];
  private bufferSize: number;
  private isProcessingBuffer = false;
  private lastProcessingTime = performance.now();
  private streamConfig: StreamConfig | null = null;

  /**
   * @param serverUrl - The URL of the server to connect to
   * @param stream - The MediaStream to capture
   * @param options - The client configuration options
   */
  constructor(
    /**
     * The URL of the server to connect to
     */
    private serverUrl: string,
    /**
     * The MediaStream to capture
     */
    public stream: MediaStream,
    /**
     * @param debug - Debug mode (default: false)
     * @param authKey - Authentication key (default: empty string)
     * @param bufferSize - Chunks buffer size (default: 5)
     */
    public options: ClientConfig = {}
  ) {
    super();

    // Authentication key (default: empty string)
    this.authKey = options.authKey || "";
    // Chunks buffer size (default: 5)
    this.bufferSize = options.bufferSize || DEFAULT_BUFFER_SIZE;
    // Debug mode (default: false)
    this.options.debug = options.debug || false;
    // Chunk length time (default: 200ms)
    // WARNING: Value less than 50ms is not recommended as it may cause
    // performance issues or packet loss
    this.options.chunkLengthTime =
      options.chunkLengthTime || DEFAULT_CHUNK_LENGTH_TIME;
    // Chunk size (default: 101 KB)
    // WARNING: Value can not exceed 101 KB as it's too big for WebRTC datachannel
    if (options.chunkSize && options.chunkSize > DEFAULT_CHUNK_SIZE) {
      throw new Error(
        "[Glock] Chunk size can not exceed " + DEFAULT_CHUNK_SIZE / 1024 + " KB"
      );
    }
    this.options.chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
    // Initialize WebRTCManager
    this.webRTCManager = new WebRTCManager(this, this.options.chunkSize);
    // Initialize WSManager
    this.createWSManager();
  }

  private createWSManager() {
    // Initialize WSManager
    this.wsManager = new WSManager(
      this.serverUrl,
      this.webRTCManager,
      this.authKey
    );

    // Listen connection open event
    this.wsManager.onOpen = this.initializeWebRTC.bind(this);
    // Listen connection close event
    this.wsManager.onClose = () => {
      this.mediaRecorder && this.mediaRecorder.stop();
      this.status = Status.IDLE;
    };
    // Listen connection error event
    this.wsManager.onError = (error) => {
      console.error("[Glock] WS connection error:", error);
      this.status = Status.SERVER_CONNECTION_FAILED;
    };
  }

  public async connect() {
    // Update the status
    this.status = Status.SERVER_CONNECTING;
    // Connect to the server
    this.status = await this.wsManager
      .connect()
      .then(() => Status.SERVER_CONNECTED)
      .catch(() => Status.SERVER_CONNECTION_FAILED);
  }

  public disconnect() {
    // Stop MediaRecorder
    this.stopRecorder();
    // Close the WebRTC connection
    this.webRTCManager.close();
    // Disconnect from the server
    this.wsManager.disconnect();
    // Reset the stream config
    this.streamConfig = null;
  }

  public async start(streamConfig: StreamConfig) {
    // Ensure the server is connected
    if (this.status !== Status.DATA_CHANNEL_OPENED)
      throw new Error("[Glock] Data channel is not opened");
    // Ensure the stream config is provided
    if (!streamConfig) throw new Error("[Glock] Stream config is required");

    // Set the stream config
    this.streamConfig = streamConfig;
    // Send: 0x10 = AV stream start
    if (
      this.webRTCManager &&
      this.webRTCManager.isConnected() &&
      this.streamConfig
    ) {
      this.webRTCManager.sendPacket(0x10, jsonToBlob(this.streamConfig));
    }
  }

  public async stop(drainBuffer = false) {
    if (drainBuffer) {
      this.isProcessingBuffer = false;
      this.videoBuffer = [];
    } else {
      // Ensure all chunks are sent
      await this.processBuffer();
    }
    // Stop buffer processing
    this.isProcessingBuffer = false;
    // Stop MediaRecorder
    this.stopRecorder();
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

      const selectedMimeType =
        this.streamConfig?.forceMimeType ||
        mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));

      if (!selectedMimeType) {
        throw new Error(
          "[Glock] No supported MIME type found for MediaRecorder"
        );
      }

      if (this.options.debug)
        console.log("[Glock] Selected MIME type:", selectedMimeType);

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: this.streamConfig?.recorderBitrate || 1500000,
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
      this.mediaRecorder.start(this.options.chunkLengthTime); // Capture every 200ms for smoother video
    } catch (error) {
      console.error("[Glock] Error setting up video streaming:", error);
      this.status = Status.AV_SETUP_FAILED;
    }
  }

  private handleDataAvailable(event: BlobEvent) {
    if (
      event.data &&
      event.data.size > 0 &&
      this.mediaRecorder?.state === "recording"
    ) {
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

    if (chunksToProcess.length === 0) {
      this.isProcessingBuffer = false;
      return;
    }

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

  private stopRecorder() {
    if (this.mediaRecorder) {
      this.mediaRecorder.stop();
      // Send a message to the server indicating the end of the video stream
      if (this.webRTCManager && this.webRTCManager.isConnected()) {
        // 0x84 = AV stream end
        this.webRTCManager.sendHeader(0x84);
      }
    }
  }

  private async initializeWebRTC() {
    this.webRTCManager.onIceCandidate = (candidate) => {
      this.wsManager.send(JSON.stringify({ type: "wrtc:ice", candidate }));
    };

    this.webRTCManager.onDataChannelOpen = () => {
      this.status = Status.DATA_CHANNEL_OPENED;
    };

    this.webRTCManager.onDataChannelMessage = (message) => {
      const header = new Uint8Array(message)[0];
      if (this.options.debug) console.info("[Glock] Received header:", header);

      // 0x34 = AV stream ready
      if (header === 0x34) {
        if (this.options.debug) console.info("[Glock] AV stream ready");
        this.startRecorder();
      }

      // 0x35 = AV stream start error
      if (header == 0x35) {
        console.error("[Glock] AV stream start error");
        this.stop(true);

        this.dispatchEvent(new Event("avStreamStartError"));
      }

      // 0x36 = AV chunk wait timeout
      if (header == 0x36) {
        console.error("[Glock] AV chunk wait timeout");
        this.stop(true);

        this.dispatchEvent(new Event("avStreamStartError"));
      }
    };

    this.webRTCManager.onDataChannelClose = () => {
      this.status = Status.DATA_CHANNEL_CLOSED;
    };

    return this.webRTCManager
      .createOffer()
      .then((offer) => {
        this.wsManager.send(JSON.stringify({ type: "wrtc:offer", offer }));
      })
      .catch((error) => {
        console.error("[Glock] Error creating offer:", error);
        this.status = Status.OFFER_CREATION_FAILED;
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

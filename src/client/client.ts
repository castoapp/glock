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

  public disconnect() {
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
      const videoTracks = this.stream.getVideoTracks();
      const audioTracks = this.stream.getAudioTracks();

      if (this.options.debug) {
        console.log("[Glock] Video tracks:", videoTracks);
        console.log("[Glock] Audio tracks:", audioTracks);
      }

      if (videoTracks.length === 0) {
        throw new Error("[Glock] No video track found in the captured stream");
      }

      // Try different MIME types
      const mimeTypes = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=h264,opus",
        "video/mp4;codecs=h264,aac",
      ];

      let selectedMimeType;
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }

      if (!selectedMimeType) {
        throw new Error(
          "[Glock] No supported MIME type found for MediaRecorder"
        );
      }

      if (this.options.debug)
        console.log("[Glock] Selected MIME type:", selectedMimeType);

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: 20971520,
      });

      if (this.options.debug)
        console.log("[Glock] MediaRecorder created:", this.mediaRecorder);

      this.mediaRecorder.ondataavailable = async (event) => {
        // console.log("ondataavailable event triggered", event);
        if (event.data && event.data.size > 0) {
          if (this.options.debug)
            console.log(
              "[Glock] Video data available, size:",
              event.data.size,
              "bytes"
            );
          if (this.webRTCManager && this.webRTCManager.isConnected()) {
            // 0x41 = AV chunk
            await this.webRTCManager.sendPacket(0x41, event.data);
          }
        } else {
          if (this.options.debug)
            console.log("[Glock] No video data available in this event");
        }
      };

      this.mediaRecorder.onstart = () => {
        if (this.options.debug) console.log("[Glock] MediaRecorder started");
      };

      this.mediaRecorder.onstop = () => {
        if (this.options.debug) console.log("[Glock] MediaRecorder stopped");
      };

      this.mediaRecorder.onerror = (event) => {
        console.error("[Glock] MediaRecorder error:", event);
      };

      if (this.options.debug) console.log("[Glock] Starting MediaRecorder...");
      this.mediaRecorder.start(100); // Capture every second
    } catch (error) {
      console.error("[Glock] Error setting up video streaming:", error);
      this.updateStatus("avSetupFailed");
    }
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
}

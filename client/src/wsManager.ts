import WebRTCManager from "./wrtcManager.js";

export class WSManager {
  private ws: WebSocket | null = null;

  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  onError: ((error: Event) => void) | null = null;
  onStatusChange: ((status: string) => void) | null = null;
  onOtherMessage: ((message: any) => void) | null = null;

  constructor(
    private serverUrl: string,
    private webRTCManager: WebRTCManager,
    private authKey: string
  ) {}

  public async connect() {
    // Append authKey as a query parameter
    const url = new URL(this.serverUrl);
    url.searchParams.append("authKey", this.authKey);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url.toString());

      this.ws.onopen = () => {
        console.log("WebSocket connection established");
        if (this.onOpen) this.onOpen();
        resolve(true);
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      };

      this.ws.onclose = () => {
        console.log("WebSocket connection closed");
        if (this.onClose) this.onClose();
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        if (this.onError) this.onError(error);
        reject(error);
      };
    });
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }

  public send(message: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      console.error("WebSocket is not open. Unable to send message.");
    }
  }

  private handleMessage(data: any) {
    switch (data.type) {
      case "wrtc:answer":
        this.handleWebRTCAnswer(data.answer);
        break;
      case "wrtc:ice":
        this.handleICECandidate(data.candidate);
        break;
      default:
        if (this.onOtherMessage) this.onOtherMessage(data);
        break;
    }
  }

  private async handleWebRTCAnswer(answer: RTCSessionDescriptionInit) {
    if (this.webRTCManager) {
      try {
        await this.webRTCManager.handleAnswer(answer);
        this.updateStatus("answerReceived");
      } catch (error) {
        console.error("Error setting remote description:", error);
        this.updateStatus("answerSettingFailed");
      }
    }
  }

  private async handleICECandidate(candidateData: RTCIceCandidateInit) {
    if (this.webRTCManager) {
      try {
        await this.webRTCManager.addIceCandidate(candidateData);
      } catch (error) {
        console.error("Error adding ICE candidate:", error);
        this.updateStatus("iceCandidateAdditionFailed");
      }
    }
  }

  private updateStatus(status: string) {
    if (this.onStatusChange) this.onStatusChange(status);
  }
}

export const DEFAULT_BUFFER_SIZE = 5; // Number of chunks to buffer before sending
export const DEFAULT_CHUNK_SIZE = 101 * 1024; // 100 KB + 1 KB header
export const DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }]; // Google STUN server
export const DEFAULT_CHUNK_LENGTH_TIME = 200; // 200ms

export enum Status {
  IDLE = "idle",
  SERVER_CONNECTING = "connecting",
  SERVER_CONNECTION_FAILED = "connectionFailed",
  SERVER_CONNECTED = "connected",
  AV_SETUP_FAILED = "avSetupFailed",
  DATA_CHANNEL_OPENED = "dataChannelOpened",
  DATA_CHANNEL_CLOSED = "dataChannelClosed",
  OFFER_CREATION_FAILED = "offerCreationFailed",
}

export function jsonToBlob(json: any) {
  return new Blob([JSON.stringify(json)], { type: "application/json" });
}

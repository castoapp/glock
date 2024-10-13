export const DEFAULT_MAX_PACKET_SIZE = 307 * 1024; // 300 KB
export const DEFAULT_ICE_SERVERS = ["stun:stun.l.google.com:19302"]; // Google STUN server
export const DEFAULT_CHUNK_WAIT_TIMEOUT = 10000; // 10 seconds
export const DEFAULT_CHUNK_WAIT_CHECK_INTERVAL = 1000; // 1 second

export function arrayBufferToJSON(arrayBuffer: ArrayBuffer) {
  return JSON.parse(new TextDecoder().decode(arrayBuffer));
}

export async function parseJSON<T>(data: string): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      resolve(JSON.parse(data));
    } catch (error) {
      reject("[Glock] Unable to parse data: " + error);
    }
  });
}

export function stringifyJSON<T>(data: T): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      resolve(JSON.stringify(data));
    } catch (error) {
      reject("[Glock] Unable to stringify data: " + error);
    }
  });
}

export function arrayBufferToJSON(arrayBuffer: ArrayBuffer) {
  return JSON.parse(new TextDecoder().decode(arrayBuffer));
}

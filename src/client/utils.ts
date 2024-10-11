export function jsonToBlob(json: any) {
  return new Blob([JSON.stringify(json)], { type: "application/json" });
}

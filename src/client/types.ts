interface HTMLVideoElement extends HTMLMediaElement {
  captureStream(frameRate?: number): MediaStream;
}

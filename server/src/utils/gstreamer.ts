import { StreamConfig } from "../av/types.js";

interface GSTStats {
  fps?: number;
  inFrames?: number;
  outFrames?: number;
  droppedFrames?: number;
  duplicatedFrames?: number;
  timestamp?: number;
}

let lastProcessedTimestamp = 0;
let lastProcessedStats: GSTStats | null = null;

export function parseGstStats(data: string): GSTStats | null {
  if (!data.includes("END")) return null;

  const result: GSTStats = {};

  // Parse timestamp
  const timeMatch = data.match(/next_ts (\d+):(\d+):(\d+)\.(\d+)/);
  if (timeMatch) {
    const [, hours, minutes, seconds, milliseconds] = timeMatch;
    result.timestamp =
      parseInt(hours) * 3600 +
      parseInt(minutes) * 60 +
      parseInt(seconds) +
      parseInt(milliseconds) / 1000000;

    // Only process logs at 1-second intervals
    if (Math.floor(result.timestamp) <= lastProcessedTimestamp) {
      return null;
    }
    lastProcessedTimestamp = Math.floor(result.timestamp);
  } else {
    return null;
  }

  // Parse input frames
  const inMatch = data.match(/in (\d+)/);
  if (inMatch) {
    result.inFrames = parseInt(inMatch[1], 10);
  }

  // Parse output frames
  const outMatch = data.match(/out (\d+)/);
  if (outMatch) {
    result.outFrames = parseInt(outMatch[1], 10);
  }

  // Parse dropped frames
  const dropMatch = data.match(/drop (\d+)/);
  if (dropMatch) {
    result.droppedFrames = parseInt(dropMatch[1], 10);
  }

  // Parse duplicated frames
  const dupMatch = data.match(/dup (\d+)/);
  if (dupMatch) {
    result.duplicatedFrames = parseInt(dupMatch[1], 10);
  }

  // Calculate FPS based on the change in output frames over the last second
  if (result.outFrames !== undefined) {
    result.fps = result.outFrames - (lastProcessedStats?.outFrames ?? 0);
  }

  // Store the current stats for the next calculation
  lastProcessedStats = { ...result };

  return result;
}

export function getGstMuxerAndSink(destination: StreamConfig["destination"]) {
  const { type, path } = destination;

  // File sink
  if (type === "file")
    return ["mp4mux", "name=mux", "!", "filesink", `location="${path}"`];
  // RTMP sink
  if (type === "rtmp")
    return ["flvmux", "name=mux", "!", "rtmpsink", `location="${path}"`];
  return [];
}

export function getGstVideoEncoder(encoder: StreamConfig["encoder"]["video"]) {
  const { codec, bitrate, fps } = encoder;

  if (codec === "x264")
    return [
      `video/x-raw,framerate=${fps}/1`,
      "!",
      `x264enc`,
      `bitrate=${bitrate}`,
      "tune=zerolatency",
      "!",
      "h264parse",
    ];
  else if (codec === "h264_nvenc")
    return [
      `video/x-raw,framerate=${fps}/1`,
      "!",
      `nvh264enc`,
      `bitrate=${bitrate}`,
      "rc-mode=cbr-ld-hq",
      "!",
      "h264parse",
    ];

  return [];
}

export function getGstAudioEncoder(encoder: StreamConfig["encoder"]["audio"]) {
  const { codec, bitrate, sampleRate } = encoder;

  if (codec === "aac")
    return [
      `avenc_aac`,
      `bitrate=${bitrate}`,
      `ar=${sampleRate}`,
      "!",
      "aacparse",
    ];
  if (codec === "opus")
    // Opus doesn't work with RTMP (flvmux)
    return [
      "audioresample",
      "!",
      `audio/x-raw,rate=${sampleRate}`,
      "!",
      `avenc_opus`,
      `bitrate=${bitrate}`,
      "!",
      "opusparse",
    ];

  return [];
}

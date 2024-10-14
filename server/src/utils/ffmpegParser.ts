export interface FFmpegInfo {
  version: string;
  input: {
    format: string;
    duration: string;
    bitrate: string;
    streams: Array<{
      index: string;
      type: string;
      codec: string;
      details: string;
    }>;
  };
  output?: {
    format: string;
    destination: string;
    streams: Array<{
      index: string;
      type: string;
      codec: string;
      details: string;
    }>;
  };
  progress?: {
    frame: number;
    fps: number;
    size: number; // Changed to number (kilobytes)
    time: number; // Milliseconds
    bitrate: number; // kbits/s
    speed: number;
  };
  error?: string; // New property for error messages
}

/**
 * Parses FFmpeg stderr output and extracts relevant information
 *
 * @param stderr - The FFmpeg stderr output as a string
 * @returns Parsed FFmpeg information
 */
export function parseFFmpegOutput(stderr: string): FFmpegInfo {
  const info: FFmpegInfo = {
    version: "",
    input: {
      format: "",
      duration: "",
      bitrate: "",
      streams: [],
    },
  };
  const lines = stderr.split("\n");
  const linesLength = lines.length;

  for (let i = 0; i < linesLength; i++) {
    const line = lines[i].trim();
    const firstChar = line[0];

    if (firstChar === "f") {
      if (line.startsWith("ffmpeg version")) {
        info.version = line.split(" ")[2] || "";
      } else if (line.startsWith("frame=")) {
        info.progress = parseProgressInfo(line);
      }
    } else if (firstChar === "I" && line.startsWith("Input #")) {
      info.input = parseInputInfo(lines, i, linesLength);
      i += info.input.streams.length + 1;
    } else if (isErrorLine(line)) {
      info.error = line;
      break;
    }
  }

  return info;
}

function parseInputInfo(
  lines: string[],
  startIndex: number,
  linesLength: number
): FFmpegInfo["input"] {
  const input: FFmpegInfo["input"] = {
    format: lines[startIndex].split(",")[1].trim(),
    duration: "",
    bitrate: "",
    streams: [],
  };

  const durationBitrateLine = lines[startIndex + 1].trim().split(",");
  [input.duration, input.bitrate] = [
    durationBitrateLine[0],
    durationBitrateLine[1],
  ].map(extractValue);

  for (let i = startIndex + 2; i < linesLength; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("Stream #")) break;
    input.streams.push(parseStreamInfo(line));
  }

  return input;
}

function extractValue(str: string): string {
  return str ? str.split(":")[1]?.trim() || "" : "";
}

function parseStreamInfo(line: string): FFmpegInfo["input"]["streams"][0] {
  const [indexType, codecDetails] = line.split(":");
  const [index, type] = indexType.split("(");
  const [codec, ...details] = codecDetails.split(",");

  return {
    index: index.replace("Stream #", "").trim(),
    type: type?.replace(")", "").trim() || "",
    codec: codec.trim(),
    details: details.join(",").trim(),
  };
}

function parseProgressInfo(line: string): FFmpegInfo["progress"] {
  const parts = line.split(/\s+/);
  const progress: FFmpegInfo["progress"] = {
    frame: parseInt(parts[1]) || 0,
    fps: parseFloat(parts[3]) || 0,
    size: 0,
    time: 0,
    bitrate: 0,
    speed: 0,
  };

  for (let i = 4, len = parts.length; i < len; i++) {
    const [key, value] = parts[i].split("=");
    switch (key.toLowerCase()) {
      case "size":
        progress.size = parseSize(value);
        break;
      case "time":
        progress.time = timeToMilliseconds(value);
        break;
      case "bitrate":
        progress.bitrate = parseFloat(value) || 0;
        break;
      case "speed":
        progress.speed = parseFloat(value) || 0;
        break;
    }
  }

  return progress;
}

// Update the isErrorLine function to catch more error types
const isErrorLine = (line: string): boolean =>
  line.includes("already exists") ||
  line.toLowerCase().includes("error") ||
  line.includes("Unknown encoder") ||
  line.includes("Unrecognized option") ||
  line.includes("Invalid argument");

function timeToMilliseconds(timeString: string): number {
  const [hours, minutes, seconds] = timeString.split(":").map(Number);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

const sizeUnits: { [key: string]: number } = {
  k: 1,
  m: 1024,
  g: 1048576,
};

function parseSize(sizeString: string): number {
  const match = sizeString.match(/^(\d+(?:\.\d+)?)(k|M|G)?B?$/i);
  if (!match) return 0;

  const [, size, unit = ""] = match;
  return parseFloat(size) * (sizeUnits[unit.toLowerCase()] || 1 / 1024);
}

export const DEFAULT_MAX_PACKET_SIZE = 300 * 1024; // 300 KB
export const DEFAULT_ICE_SERVERS = ["stun:stun.l.google.com:19302"]; // Google STUN server
export const DEFAULT_CHUNK_WAIT_TIMEOUT = 10000; // 10 seconds
export const DEFAULT_CHUNK_WAIT_CHECK_INTERVAL = 1000; // 1 second
export const DEFAULT_AV_PROCESSOR = "ffmpeg";

export const DEFAULT_FF_AV_CONFIG = {
  processor: "ffmpeg",

  destination: {
    type: "file",
    path: "output.mp4",
  },

  encoder: {
    video: {
      codec: "libx264", // libx264 / h264_nvenc / hevc_nvenc
      preset: "p4",
      bitrate: 3000,
      fps: 30,
    },

    audio: {
      bitrate: 128000,
      sampleRate: 44100,
      codec: "aac",
    },
  },
};

export const DEFAULT_GST_AV_CONFIG = {
  processor: "gstreamer",

  destination: {
    type: "file",
    path: "output.mp4",
  },

  encoder: {
    video: {
      codec: "x264", // x264 / h264_nvenc
      bitrate: 3000,
      fps: 30,
    },

    audio: {
      bitrate: 128000,
      sampleRate: 44100,
      codec: "aac", // aac / opus
    },
  },
};

import EventEmitter from "events";
import { ChildProcess, spawn } from "child_process";
import pathToFfmpeg from "ffmpeg-static/index.js";
import { Client } from "./wsHandler.js";
import {
  DEFAULT_CHUNK_WAIT_CHECK_INTERVAL,
  DEFAULT_CHUNK_WAIT_TIMEOUT,
} from "./utils.js";

const debug = process.env.DEBUG === "true";

const defaultStreamConfig = {
  destinationType: null,
  destination: "pipe:1",
  vcodec: "libx264", //"h264_nvenc",
  preset: "p4",
  vbitrate: "6000k",
  abitrate: "192k",
  acodec: "aac",
  fps: "30",
  scale: null, //"1920:-2", // Scale to 1080p while maintaining aspect ratio
};

interface Options {
  chunkWaitTimeout?: number;
  chunkWaitCheckInterval?: number;
}

export default class AV extends EventEmitter {
  private process: ChildProcess | null = null;
  public isReady: boolean = false;
  private lastChunkTime: number = 0;
  private chunkWaitCheckInterval: NodeJS.Timeout | null = null;

  constructor(private client: Client, public options: Options = {}) {
    super();

    this.options.chunkWaitTimeout =
      options.chunkWaitTimeout || DEFAULT_CHUNK_WAIT_TIMEOUT;
    this.options.chunkWaitCheckInterval =
      options.chunkWaitCheckInterval || DEFAULT_CHUNK_WAIT_CHECK_INTERVAL;
  }

  public async start(config = defaultStreamConfig) {
    if (this.process) {
      throw new Error("FFmpeg process is already running");
    }

    if (!pathToFfmpeg) {
      throw new Error("FFmpeg binary not found");
    }

    // Merge default config with provided config
    config = { ...defaultStreamConfig, ...config };

    console.info("[Glock] Config", config);

    const args = ["-i", "pipe:0", "-f", "mpegts", "-c:v", config.vcodec];

    if (config.vcodec === "libx264") {
      args.push(
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-crf",
        "23",
        "-maxrate",
        "6000k",
        "-bufsize",
        "12000k",
        "-g",
        "60",
        "-sc_threshold",
        "0",
        "-threads",
        "0"
      );
    }

    // Common arguments for both encoders
    args.push(
      "-c:a",
      config.acodec,
      "-b:a",
      config.abitrate,
      "-ar",
      "48000",
      "-filter_complex",
      "[0:v]fps=fps=30,format=yuv420p[v];[0:a]aresample=async=1[a]",
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-fps_mode",
      "vfr",
      "-max_muxing_queue_size",
      "1024"
    );

    // Add scaling if needed
    if (config.scale) {
      args.push("-vf", `scale=${config.scale}`);
    }

    if (config.destinationType) args.push("-f", config.destinationType);
    args.push(config.destination ?? "pipe:1");

    console.info("[Glock] FFmpeg args", args);

    // Start the FFmpeg process
    this.process = spawn(pathToFfmpeg, args);

    // Set the chunk wait check interval
    this.lastChunkTime = Date.now();
    this.chunkWaitCheckInterval = setInterval(
      this.onChunkWaitCheckInterval.bind(this),
      this.options.chunkWaitCheckInterval!
    );

    this.process.stdout?.on("data", (data) => {
      console.log(`stdout: ${data}`);
    });

    this.process.stderr?.on("data", (data) => {
      console.debug(data.toString());

      // Temporary solution to detect when FFmpeg is ready
      if (data.toString().includes("version") && !this.isReady) {
        this.isReady = true;
        this.emit("ready");
      }
    });

    this.process.on("error", (error) => {
      console.error(`FFmpeg process error: ${error.message}`);
    });

    this.process.on("close", (code, signal) => {
      if (debug)
        console.info(
          `[Glock] FFmpeg process closed with code ${code} and signal ${signal}`
        );

      this.process = null;
    });
  }

  public async put(data: Buffer) {
    // Reset the chunk wait timeout
    this.lastChunkTime = Date.now();

    // Check if the FFmpeg process is running and has a stdin stream
    if (!this.process || !this.process.stdin) {
      console.error(
        "[Glock] FFmpeg process is not running or stdin is not available"
      );

      // 0x35 = AV stream start error
      this.client.wrtcHandler.sendHeader(0x35);
    }

    // Write the data to the FFmpeg process stdin
    return new Promise<void>((resolve, reject) => {
      if (
        !this.process?.stdin?.write(data, (error) => {
          if (error) reject(error);
          else resolve();
        })
      ) {
        this.process?.stdin?.once("drain", resolve);
      }
    });
  }

  private onChunkWaitCheckInterval() {
    const currentTime = Date.now();
    if (currentTime - this.lastChunkTime > this.options.chunkWaitTimeout!) {
      console.error("[Glock] [av] Chunk wait timed out");
      this.stop();
      this.emit("timeout");
    }
  }

  public async stop() {
    // Clear the chunk wait check interval
    clearInterval(this.chunkWaitCheckInterval!);

    // Check if the FFmpeg process is running
    if (!this.process) {
      if (debug) console.warn("[Glock] No FFmpeg process to stop");
      return;
    }

    // Wait for the FFmpeg process to exit
    return new Promise<void>((resolve) => {
      this.process?.once("exit", () => {
        console.info("[Glock] FFMpeg process exited");
        this.process = null;
        resolve();
      });
      this.process?.kill("SIGINT");
    });
  }
}

import EventEmitter from "events";
import Server from "./server.js";
import { ChildProcess, spawn } from "child_process";
import pathToFfmpeg from "ffmpeg-static/index.js";

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

export default class AV extends EventEmitter {
  private process: ChildProcess | null = null;
  public isReady: boolean = false;

  constructor(private server: Server) {
    super();
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
      "-vsync",
      "1",
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

    this.process = spawn(pathToFfmpeg, args);

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

    this.process.on("exit", (code, signal) => {
      if (debug)
        console.debug(
          `[Glock] FFmpeg process exited with code ${code} and signal ${signal}`
        );
      this.process = null;
    });
  }

  public async put(data: Buffer) {
    if (!this.process || !this.process.stdin) {
      throw new Error(
        "FFmpeg process is not running or stdin is not available"
      );
    }
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

  public async stop() {
    if (!this.process) {
      if (debug) console.warn("[Glock] No FFmpeg process to stop");
      return;
    }
    return new Promise<void>((resolve) => {
      this.process?.on("exit", () => {
        this.process = null;
        resolve();
      });
      this.process?.kill("SIGINT");
    });
  }
}

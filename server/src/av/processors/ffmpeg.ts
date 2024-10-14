import { ChildProcess, spawn } from "child_process";
import pathToFfmpeg from "ffmpeg-static/index.js";
import { parseFFmpegOutput } from "../../utils/index.js";
import { VideoProcessor, StreamConfig } from "../types.js";

const debug = process.env.DEBUG === "true";

const defaultStreamConfig: StreamConfig = {
  destinationType: null,
  destination: "pipe:1",
  vcodec: "libx264",
  preset: "p4",
  vbitrate: "6000k",
  abitrate: "192k",
  acodec: "aac",
  fps: "30",
  scale: null,
};

export default class FFmpegProcessor implements VideoProcessor {
  private process: ChildProcess | null = null;

  constructor(
    private onReady: () => void,
    private onStats: (stats: any) => void,
    private onError: (error: Error) => void
  ) {}

  public isRunning(): boolean {
    return this.process !== null;
  }

  public async start(config: Partial<StreamConfig> = {}): Promise<void> {
    if (this.process) {
      throw new Error("FFmpeg process is already running");
    }

    if (!pathToFfmpeg) {
      throw new Error("FFmpeg binary not found");
    }

    const mergedConfig = { ...defaultStreamConfig, ...config };
    const args = this.buildFFmpegArgs(mergedConfig);

    console.info("[Glock] FFmpeg args", args);

    this.process = spawn(pathToFfmpeg, args);

    this.setupProcessListeners();
  }

  private buildFFmpegArgs(config: StreamConfig): string[] {
    const args = [
      "-i",
      "pipe:0", // Input from stdin
      "-f",
      "mpegts", // Output format: MPEG-TS
      "-c:v",
      config.vcodec, // Video codec
    ];

    const gopSize = Math.round(parseFloat(config.fps) * 2); // 2 seconds worth of frames

    if (config.vcodec === "libx264") {
      args.push(
        "-preset",
        "veryfast", // Encoding speed preset
        "-tune",
        "zerolatency", // Tune for low-latency streaming
        "-crf",
        "23", // Constant Rate Factor (balance between quality and file size)
        "-maxrate",
        config.vbitrate, // Use config.vbitrate instead of hardcoded value
        "-bufsize",
        `${parseInt(config.vbitrate) * 2}k`, // Double the maxrate for bufsize
        "-g",
        gopSize.toString(), // GOP size (interval between keyframes)
        "-sc_threshold",
        "0", // Disable scene change detection
        "-threads",
        "0" // Use all available CPU threads
      );
    } else if (
      config.vcodec === "h264_nvenc" ||
      config.vcodec === "hevc_nvenc"
    ) {
      args.push(
        "-preset",
        "p4", // NVENC preset (p1-p7, p4 is a good balance)
        "-tune",
        "ll", // Tune for low latency
        "-rc",
        "vbr", // Rate control: Variable Bitrate
        "-cq",
        "23", // Constant Quality value
        "-qmin",
        "0", // Minimum quantization parameter
        "-qmax",
        "51", // Maximum quantization parameter
        "-b:v",
        config.vbitrate, // Target video bitrate
        "-maxrate",
        config.vbitrate, // Use config.vbitrate instead of hardcoded value
        "-bufsize",
        `${parseInt(config.vbitrate) * 2}k`, // Double the maxrate for bufsize
        "-g",
        gopSize.toString(), // GOP size
        "-sc_threshold",
        "0", // Disable scene change detection
        "-i_qfactor",
        "0.75", // I-frame quantizer factor
        "-b_qfactor",
        "1.1" // B-frame quantizer factor
      );
    }

    args.push(
      "-c:a",
      config.acodec, // Audio codec
      "-b:a",
      config.abitrate, // Audio bitrate
      "-ar",
      "48000", // Audio sample rate
      "-filter_complex",
      `[0:v]fps=${config.fps},format=yuv420p[v];[0:a]aresample=async=1[a]`, // Video and audio filtering
      "-map",
      "[v]", // Map filtered video to output
      "-map",
      "[a]", // Map filtered audio to output
      "-fps_mode",
      "vfr", // Variable frame rate mode
      "-max_muxing_queue_size",
      "1024" // Increase muxing queue size to avoid errors
    );

    if (config.scale) {
      args.push("-vf", `scale=${config.scale}`); // Scale video if specified
    }

    if (config.destinationType) args.push("-f", config.destinationType); // Output format if specified
    args.push(config.destination ?? "pipe:1"); // Output destination (stdout if not specified)

    return args;
  }

  private setupProcessListeners() {
    this.process!.stdout?.on("data", (data) => {
      console.log(`stdout: ${data}`);
    });

    this.process!.stderr?.on("data", (data) => {
      const stats = parseFFmpegOutput(data.toString());

      if (stats.progress) {
        this.onStats(stats.progress);
      }

      if (stats.version) {
        this.onReady();
      }

      if (stats.error) {
        this.onError(new Error(stats.error));
      }

      console.info(data.toString());
    });

    this.process!.on("error", (error) => {
      console.error(`FFmpeg process error: ${error.message}`);
    });

    this.process!.on("close", (code, signal) => {
      if (debug) {
        console.info(
          `[Glock] FFmpeg process closed with code ${code} and signal ${signal}`
        );
      }
      this.process = null;
    });
  }

  public async processChunk(data: Buffer): Promise<void> {
    if (!this.process || !this.process.stdin) {
      throw new Error(
        "FFmpeg process is not running or stdin is not available"
      );
    }

    return new Promise<void>((resolve, reject) => {
      if (
        !this.process!.stdin!.write(data, (error) => {
          if (error) reject(error);
          else resolve();
        })
      ) {
        this.process!.stdin!.once("drain", resolve);
      }
    });
  }

  public async stop(): Promise<void> {
    if (!this.process) {
      if (debug) console.warn("[Glock] No FFmpeg process to stop");
      return;
    }

    return new Promise<void>((resolve) => {
      this.process!.once("exit", () => {
        console.info("[Glock] FFmpeg process exited");
        this.process = null;
        resolve();
      });
      this.process!.kill("SIGINT");
    });
  }
}

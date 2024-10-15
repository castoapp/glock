import { ChildProcess, spawn } from "child_process";
import pathToFfmpeg from "ffmpeg-static/index.js";
import { parseFFmpegOutput } from "../../utils/index.js";
import { VideoProcessor, StreamConfig } from "../types.js";
import { DEFAULT_FF_AV_CONFIG } from "../../defaults.js";
import { getFFmpegDestType } from "../../utils/ffmpeg.js";

const debug = process.env.DEBUG === "true";

export default class FFmpegProcessor implements VideoProcessor {
  private args: string[] = [];
  private process: ChildProcess | null = null;

  constructor(
    public streamConfig: StreamConfig,
    private onReady: () => void,
    private onStats: (stats: any) => void,
    private onError: (error: Error) => void
  ) {
    if (this.process) throw new Error("FFmpeg process is already running");
    if (!pathToFfmpeg) throw new Error("FFmpeg binary not found");

    // Merge the default stream config with the provided stream config
    const mergedConfig = { ...DEFAULT_FF_AV_CONFIG, ...this.streamConfig };
    this.args = this.buildFFmpegArgs(mergedConfig);
  }

  public async start(): Promise<void> {
    // Start the FFmpeg process
    this.process = spawn(pathToFfmpeg, this.args);
    // Setup process listeners
    this.setupProcessListeners();
  }

  private buildFFmpegArgs(config: StreamConfig): string[] {
    const { encoder, destination } = config;
    const destType = getFFmpegDestType(destination.type);
    const audioEncoderCodec = encoder.audio.codec as string;

    const args = [
      "-i",
      "pipe:0", // Input from stdin
      "-f",
      "mpegts", // Output format: MPEG-TS
      "-c:v",
      encoder.video.codec, // Video codec
    ];

    // Calculate GOP size based on FPS
    // 2 seconds worth of frames
    const gopSize = Math.round(encoder.video.fps * 2).toString();

    if (encoder.video.codec === "libx264") {
      args.push(
        "-preset",
        "veryfast", // Encoding speed preset
        "-tune",
        "zerolatency", // Tune for low-latency streaming
        "-crf",
        "23", // Constant Rate Factor (balance between quality and file size)
        "-maxrate",
        `${encoder.video.bitrate}k`, // Use config.vbitrate instead of hardcoded value
        "-bufsize",
        `${encoder.video.bitrate * 2}k`, // Double the maxrate for bufsize
        "-g",
        gopSize, // GOP size (interval between keyframes)
        "-sc_threshold",
        "0", // Disable scene change detection
        "-threads",
        "0" // Use all available CPU threads
      );
    } else if (
      encoder.video.codec === "h264_nvenc" ||
      encoder.video.codec === "hevc_nvenc"
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
        `${encoder.video.bitrate}k`, // Target video bitrate
        "-maxrate",
        `${encoder.video.bitrate}k`, // Use config.vbitrate instead of hardcoded value
        "-bufsize",
        `${encoder.video.bitrate * 2}k`, // Double the maxrate for bufsize
        "-g",
        gopSize, // GOP size
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
      audioEncoderCodec, // Audio codec
      "-b:a",
      `${encoder.audio.bitrate}`, // Audio bitrate
      "-ar",
      `${encoder.audio.sampleRate}`, // Audio sample rate
      "-filter_complex",
      `[0:v]fps=${encoder.video.fps},format=yuv420p[v];[0:a]aresample=async=1[a]`, // Video and audio filtering
      "-map",
      "[v]", // Map filtered video to output
      "-map",
      "[a]", // Map filtered audio to output
      "-fps_mode",
      "vfr", // Variable frame rate mode
      "-max_muxing_queue_size",
      "1024" // Increase muxing queue size to avoid errors
    );

    if (destType) args.push("-f", destType); // Output format if specified
    args.push(destination.path ?? "pipe:1"); // Output destination (stdout if not specified)

    if (debug) console.log("[Glock] [av -> ffmpeg] args:", args.join(" "));
    return args as string[];
  }

  private setupProcessListeners() {
    this.process!.stdout?.on("data", this.onStdout.bind(this));
    this.process!.stderr?.on("data", this.onStderr.bind(this));
    this.process!.stdin?.on("error", (error) => this.onError(error));
    this.process!.on("close", this.onClose.bind(this));
  }

  private onStdout(data: Buffer): void {
    if (debug) console.log(`[Glock] [av -> ffmpeg] stdout: ${data}`);
  }

  private onStderr(data: Buffer): void {
    const stats = parseFFmpegOutput(data.toString());
    if (stats.progress) this.onStats(stats.progress);
    if (stats.version) this.onReady();
    if (stats.error) this.onError(new Error(stats.error));
    if (debug) console.log(`[Glock] [av -> ffmpeg] stderr: ${data}`);
  }

  private onClose(code: number, signal: string) {
    if (debug) {
      console.info(
        `[Glock] [av -> ffmpeg] closed: code ${code} signal ${signal}`
      );
    }
    this.process = null;
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
      if (debug) console.warn("[Glock] [av -> ffmpeg] not running!");
      return;
    }

    return new Promise<void>((resolve) => {
      this.process!.once("exit", () => {
        if (debug) console.info("[Glock] [av -> ffmpeg] exited");
        this.process = null;
        resolve();
      });
      this.process!.kill("SIGINT");
    });
  }

  public isRunning(): boolean {
    return this.process !== null && this.process!.pid !== undefined;
  }
}

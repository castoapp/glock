import { ChildProcess, spawn } from "child_process";
import { VideoProcessor, StreamConfig } from "../types.js";
import { Writable } from "stream";
import {
  getGstAudioEncoder,
  getGstMuxerAndSink,
  getGstVideoEncoder,
  GSTPipe,
  parseGstStats,
} from "../../utils/index.js";
import { DEFAULT_GST_AV_CONFIG } from "../../defaults.js";

const debug = process.env.DEBUG === "true";

/**
 * GStreamer AV processor
 *
 * @description
 * This class is used to process AV stream using GStreamer pipeline
 */
export default class GStreamerProcessor implements VideoProcessor {
  private waitUntilReadyTimeout: NodeJS.Timeout | null = null;
  private args: string[] = [];
  private process: ChildProcess | null = null;
  private isEnding: boolean = false;
  private pipe!: GSTPipe;

  constructor(
    public streamConfig: StreamConfig,
    private onReady: () => void,
    private onStats: (stats: any) => void,
    private onError: (error: Error) => void
  ) {
    if (this.process) throw new Error("GStreamer process is already running");
    const mergedConfig = { ...DEFAULT_GST_AV_CONFIG, ...streamConfig };
    this.args = this.buildGStreamerArgs(mergedConfig);
    if (debug) console.info("[Glock] GStreamer args", this.args);
  }

  public async start(): Promise<void> {
    // Start the GStreamer process
    this.process = spawn("gst-launch-1.0", this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        GST_DEBUG: "videorate:6,fpsdisplaysink:6,fpsme",
        GST_VIDEORATE_DUMP: "1",
      },
    });

    // Create the GSTPipe
    this.pipe = new GSTPipe("glockGST", this.process.stdin as Writable);

    // Setup process listeners
    this.setupProcessListeners();

    // Wait for the pipeline to be ready
    await this.waitUntilReady();
  }

  private setupProcessListeners() {
    this.process!.stdout?.on("data", this.onStdout.bind(this));
    this.process!.stderr?.on("data", this.onStderr.bind(this));
    this.process!.on("error", this.onError);
    this.process!.on("close", this.onClose.bind(this));
  }

  private onStdout(data: Buffer): void {
    if (debug) console.info("[Glock] [av -> gstreamer]", data.toString());
  }

  private onStderr(data: Buffer): void {
    if (debug) console.error("[Glock] [av -> gstreamer]", data.toString());
    const stats = parseGstStats(data.toString());
    if (stats) this.onStats(stats);
  }

  private onClose(code: number, signal: string) {
    if (debug)
      console.log(
        `[Glock] GStreamer process closed with code ${code} and signal ${signal}`
      );
    this.isEnding = true;
    this.process = null;
    clearTimeout(this.waitUntilReadyTimeout!);
  }

  public async processChunk(data: Buffer): Promise<void> {
    if (this.isEnding) {
      if (debug) console.log("[Glock] Ignoring chunk as stream is ending");
      return;
    }

    if (!this.process || this.process.exitCode !== null) {
      console.error("[Glock] GStreamer process has exited unexpectedly");
      throw new Error("GStreamer process has exited unexpectedly");
    }

    this.pipe.put(data);
  }

  public async stop(): Promise<void> {
    if (!this.process)
      return console.warn("[Glock] No GStreamer process to stop");

    if (debug) console.log("[Glock] [av -> gstreamer] stopping");
    this.isEnding = true;

    // Close the pipe and signal EOF to GStreamer
    await this.pipe.close();

    // Send EOS (End of Stream) event to GStreamer
    this.process.stdin?.write("q");

    // Wait for the GStreamer process to exit
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (debug) console.warn("[Glock] [av -> gstreamer] timeout, SIGINT");
        this.process?.kill("SIGINT");
      }, 10 * 1000); // 5 seconds timeout

      this.process?.once("exit", (c, s) => {
        clearTimeout(timeout);
        if (debug)
          console.log(`[Glock] [av -> gstreamer] exited code ${c} signal ${s}`);
        this.process = null;
        resolve();
      });
    });
  }

  private async waitUntilReady(): Promise<void> {
    return await new Promise<void>((resolve, reject) => {
      this.waitUntilReadyTimeout = setTimeout(() => {
        reject(new Error("[Glock] gst_pipeline_timeout"));
      }, 10 * 1000);

      this.process!.stdout?.on("data", (data) => {
        if (data.toString().includes("Setting pipeline to PLAYING")) {
          if (debug) console.log("[Glock] gst_pipeline_ready");
          clearTimeout(this.waitUntilReadyTimeout!);
          this.onReady();
          resolve();
        }
      });
    });
  }

  private buildGStreamerArgs(config: StreamConfig): string[] {
    const { encoder, destination } = config;

    // It's a bit more complex than ffmpeg :\
    const baseArgs = this.getBaseArgs();
    const videoBranch = this.getVideoBranch(encoder.video);
    const audioBranch = this.getAudioBranch(encoder.audio);
    const muxerAndSink = this.getMuxerAndSink(destination);
    const args = [...baseArgs, ...videoBranch, ...audioBranch, ...muxerAndSink];

    if (debug) console.log("[Glock] gst_pipeline:", args.join(" "));
    return args;
  }

  private getBaseArgs(): string[] {
    return [
      "-e",
      // "-vvv",
      "fdsrc",
      "fd=0",
      "do-timestamp=true",
      "!",
      "queue",
      "max-size-buffers=100",
      "max-size-bytes=10485760",
      "max-size-time=5000000000",
      "leaky=downstream",
      "!",
      "identity",
      "name=input",
      "silent=false",
      "!",
      "matroskademux",
      "name=demux",
    ];
  }

  private getVideoBranch(encoder: StreamConfig["encoder"]["video"]): string[] {
    return [
      "demux.video_0",
      "!",
      "queue",
      "max-size-buffers=100",
      "max-size-bytes=10485760",
      "max-size-time=5000000000",
      "leaky=downstream",
      "!",
      "identity",
      "name=video_demuxed",
      "silent=false",
      "!",
      "vp9dec",
      "!",
      "videoconvert",
      "!",
      "videorate",
      "name=videorate",
      "silent=false",
      "!",
      "tee",
      "name=t",
      "t.",
      "!",
      "fakesink",
      "sync=false",
      "async=false",
      "t.",
      "!",
      ...getGstVideoEncoder(encoder),
      "!",
      "mux.",
    ];
  }

  private getAudioBranch(encoder: StreamConfig["encoder"]["audio"]): string[] {
    return [
      "demux.audio_0",
      "!",
      "queue",
      "max-size-buffers=100",
      "max-size-bytes=1048576",
      "max-size-time=5000000000",
      "leaky=downstream",
      "!",
      "identity",
      "name=audio_demuxed",
      "silent=false",
      "!",
      "opusdec",
      "!",
      "audioconvert",
      "!",
      ...getGstAudioEncoder(encoder),
      "!",
      "mux.",
    ];
  }

  private getMuxerAndSink(destination: StreamConfig["destination"]): string[] {
    const destType = getGstMuxerAndSink(destination);
    return [...destType, "sync=false", "async=false"];
  }

  public isRunning(): boolean {
    return this.process !== null && this.process!.pid !== undefined;
  }
}

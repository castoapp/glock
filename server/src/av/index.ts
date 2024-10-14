import EventEmitter from "events";
import { Client } from "../wsHandler.js";
import {
  DEFAULT_CHUNK_WAIT_CHECK_INTERVAL,
  DEFAULT_CHUNK_WAIT_TIMEOUT,
} from "../defaults.js";
import { stringifyJSON } from "../utils/json.js";
import { StreamConfig, VideoProcessor } from "./types.js";
import { FFmpegProcessor } from "./processors/index.js";

const debug = process.env.DEBUG === "true";

export interface Options {
  chunkWaitTimeout?: number;
  chunkWaitCheckInterval?: number;
}

export default class AV extends EventEmitter {
  private videoProcessor: VideoProcessor;
  public isReady: boolean = false;
  private lastChunkTime: number = 0;
  private chunkWaitCheckInterval: NodeJS.Timeout | null = null;
  private frameInterval: number = 0;
  private lastFrameTime: number = 0;
  private frameQueue: Buffer[] = [];
  private isProcessingFrame: boolean = false;

  constructor(private client: Client, public options: Options = {}) {
    super();

    this.options.chunkWaitTimeout =
      options.chunkWaitTimeout || DEFAULT_CHUNK_WAIT_TIMEOUT;
    this.options.chunkWaitCheckInterval =
      options.chunkWaitCheckInterval || DEFAULT_CHUNK_WAIT_CHECK_INTERVAL;

    this.videoProcessor = new FFmpegProcessor(
      this.onProcessorReady.bind(this),
      this.onProcessorStats.bind(this),
      this.onProcessorError.bind(this)
    );
  }

  private onProcessorReady() {
    this.isReady = true;
    this.emit("ready");
  }

  private onProcessorError(error: Error) {
    console.error("[Glock] [av] Processor error", error);
    this.client.wrtcHandler.sendHeader(0x35); // 0x35 = AV stream start error
  }

  private async onProcessorStats(stats: any) {
    this.client.ws.send(
      await stringifyJSON({
        type: "av:stats",
        data: stats,
      })
    );
  }

  public async start(config: Partial<StreamConfig> = {}) {
    if (this.videoProcessor.isRunning()) {
      throw new Error("Video processor is already running");
    }

    console.info("[Glock] Config", config);

    this.lastChunkTime = Date.now();
    this.chunkWaitCheckInterval = setInterval(
      this.onChunkWaitCheckInterval.bind(this),
      this.options.chunkWaitCheckInterval!
    );

    // Set frame interval based on config fps
    this.frameInterval = 1000 / parseInt(config.fps || "30");
    this.lastFrameTime = Date.now();

    await this.videoProcessor.start(config);
  }

  public async put(data: Buffer) {
    this.lastChunkTime = Date.now();

    if (!this.videoProcessor.isRunning()) {
      console.error("[Glock] Video processor is not running");
      this.client.wrtcHandler.sendHeader(0x35); // 0x35 = AV stream start error
      return;
    }

    // Add frame to queue
    this.frameQueue.push(data);

    // Start processing frames if not already doing so
    if (!this.isProcessingFrame) {
      this.processNextFrame();
    }
  }

  private async processNextFrame() {
    if (this.frameQueue.length === 0) {
      this.isProcessingFrame = false;
      return;
    }

    this.isProcessingFrame = true;

    const now = Date.now();
    const elapsed = now - this.lastFrameTime;

    if (elapsed < this.frameInterval) {
      // Wait for the next frame interval
      await new Promise((resolve) =>
        setTimeout(resolve, this.frameInterval - elapsed)
      );
    }

    const frame = this.frameQueue.shift();
    if (frame) {
      await this.videoProcessor.processChunk(frame);
    }

    this.lastFrameTime = Date.now();

    // Process next frame
    setImmediate(() => this.processNextFrame());
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
    clearInterval(this.chunkWaitCheckInterval!);
    this.chunkWaitCheckInterval = null;
    this.frameQueue = [];
    this.isProcessingFrame = false;
    this.lastChunkTime = 0;
    this.frameInterval = 0;
    this.lastFrameTime = 0;
    await this.videoProcessor.stop();
  }
}

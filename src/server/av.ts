import EventEmitter from "events";
import Server from "./server";
import { ChildProcess, spawn } from "child_process";
import pathToFfmpeg from "ffmpeg-static";

const debug = process.env.DEBUG === "true";

export default class AV extends EventEmitter {
  private process: ChildProcess | null = null;
  public isReady: boolean = false;

  constructor(private server: Server) {
    super();
  }

  public async start(
    config: {
      destination: string;
      vcodec?: string;
      preset?: string;
      vbitrate?: string;
      abitrate?: string;
      acodec?: string;
      fps?: string;
    } = {
      destination: "pipe:1",
      vcodec: "libx264",
      preset: "ultrafast",
      vbitrate: "5000k",
      abitrate: "128k",
      acodec: "libmp3lame",
      fps: "60",
    }
  ) {
    if (this.process) {
      throw new Error("FFmpeg process is already running");
    }

    if (!pathToFfmpeg) {
      throw new Error("FFmpeg binary not found");
    }

    this.process = spawn(pathToFfmpeg, [
      // "-hide_banner",
      // "-loglevel",
      // "error",
      "-i",
      "pipe:0",
      "-f",
      "mpegts",
      "-c:v",
      config.vcodec ?? "libx264",
      "-pix_fmt",
      "yuv420p",
      // "-preset",
      // config.preset ?? "ultrafast",
      "-c:a",
      config.acodec ?? "libmp3lame",
      "-b:a",
      config.abitrate ?? "128k",
      "-b:v",
      config.vbitrate ?? "5000k",
      "-threads",
      "6",
      "-qscale",
      "3",
      "-r",
      config.fps ?? "60",
      "-g",
      config.fps ? String(Math.floor(Number(config.fps) * 2)) : "120",
      "-bufsize",
      "512k",
      // "-f",
      // "flv",
      config.destination ?? "pipe:1",
    ]);

    this.process.stdout?.on("data", (data) => {
      console.log(`stdout: ${data}`);
    });

    this.process.stderr?.on("data", (data) => {
      console.debug(data);

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

import net from "net";
import { PassThrough, Writable } from "stream";
import path from "path";
import { platform } from "os";
import { unlinkSync } from "fs";

const debug = process.env.DEBUG === "true";

function normalizePipeName(pipeName: string): string {
  if (platform() === "win32")
    return path.win32.normalize(`\\\\.\\pipe\\${pipeName}`);
  else return path.posix.normalize(`/tmp/${pipeName}`);
}

/**
 * GStreamer writeable pipe
 *
 * @param pipeName - The name of the pipe
 * @param gstreamStdin - The GStreamer stdin stream
 *
 * @description
 * This class is used to pipe incoming chunks to GStreamer pipeline
 * because we can't pipe to a stdin of GST process.
 */
export default class GSTPipe {
  private pipeName: string;
  private server: net.Server | null;
  private pipeStream: net.Socket | null;
  private gstreamStdin: Writable;
  private passthrough: PassThrough;
  constructor(pipeName: string, gstreamStdin: Writable) {
    this.gstreamStdin = gstreamStdin;
    this.pipeStream = null;
    this.server = null;

    // Normalize the pipe name to OS format
    this.pipeName = normalizePipeName(pipeName);

    // Create a passthrough stream to handle backpressure
    this.passthrough = new PassThrough({ highWaterMark: 64 * 1024 });
    this.passthrough.pipe(gstreamStdin);
    this.passthrough.setDefaultEncoding("binary");

    // Start listening for incoming connections
    this.listen();
  }

  /**
   * Listen for incoming connections
   */
  listen(): void {
    // Create a server to listen for incoming connections
    this.server = net.createServer((socket: net.Socket) => {
      if (debug) console.info("[Glock] [av -> pipe] client connected");

      // Handle socket errors
      socket.on("error", (err) => {
        console.error("[Glock] [av -> pipe] socket error", err);
      });
    });

    // Listen for incoming connections
    this.server.listen(this.pipeName, this.connect.bind(this));
  }

  /**
   * Connect to the pipe
   */
  connect(): void {
    // Connect to the pipe
    this.pipeStream = net.connect(this.pipeName);

    // Handle connection
    this.pipeStream.on("connect", () => {
      if (debug) console.info("[Glock] [av -> pipe] connected");
      // Link the pipe stream to the GStreamer stdin
      this.pipeStream?.pipe(this.gstreamStdin);
    });

    // Handle errors
    this.pipeStream.on("error", (err) => {
      // Ignore EOF
      if ((err as Error & { code: string }).code !== "EOF") return;
      console.error("[Glock] [av -> pipe] error", err);
    });
  }

  /**
   * Put data into the pipe
   *
   * @param data - The data to put into the pipe
   * @returns A promise that resolves to true if the data was written successfully, false otherwise
   */
  put(data: Buffer): Promise<boolean> {
    return new Promise((resolve) => {
      // Write the data to the passthrough stream
      const success = this.passthrough?.write(data);

      // If the data was not written successfully, wait for the drain event to be emitted
      if (!success) {
        if (debug) console.warn("[Glock] [av -> pipe] backpressure");
        // Wait for the drain event to be emitted
        this.passthrough?.once("drain", () => {
          if (debug) console.info("[Glock] [av -> pipe] drained");
          resolve(true);
        });
      } else {
        // If the data was written successfully, resolve the promise
        resolve(true);
      }
    });
  }

  /**
   * Close the pipe and clean up resources
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      // Close the server
      if (this.server) {
        this.server.close(() => {
          if (debug) console.info("[Glock] [av -> pipe] server closed");
          this.cleanupPipeFile();
          resolve();
        });
      } else {
        this.cleanupPipeFile();
        resolve();
      }

      // Close the pipe stream
      if (this.pipeStream) {
        this.pipeStream.end();
        if (debug) console.info("[Glock] [av -> pipe] stream closed");
      }

      // End the passthrough stream
      if (this.passthrough) {
        this.passthrough.end();
      }
    });
  }

  /**
   * Clean up the pipe file
   */
  private cleanupPipeFile(): void {
    if (platform() !== "win32") {
      try {
        unlinkSync(this.pipeName);
        if (debug) console.info("[Glock] [av -> pipe] pipe file deleted");
      } catch (err) {
        console.error("[Glock] [av -> pipe] error deleting pipe file", err);
      }
    }
  }
}

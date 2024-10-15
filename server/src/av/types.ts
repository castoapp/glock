import { DEFAULT_FF_AV_CONFIG, DEFAULT_GST_AV_CONFIG } from "../defaults.js";

export type StreamConfig =
  | typeof DEFAULT_FF_AV_CONFIG
  | typeof DEFAULT_GST_AV_CONFIG;

export interface VideoProcessor {
  isRunning(): boolean;
  start(): Promise<void>;
  processChunk(data: Buffer): Promise<void>;
  stop(): Promise<void>;
}

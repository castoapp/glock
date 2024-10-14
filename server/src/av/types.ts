export interface StreamConfig {
  destinationType: string | null;
  destination: string;
  vcodec: string;
  preset: string;
  vbitrate: string;
  abitrate: string;
  acodec: string;
  fps: string;
  scale: string | null;
}

export interface VideoProcessor {
  isRunning(): boolean;
  start(config: Partial<StreamConfig>): Promise<void>;
  processChunk(data: Buffer): Promise<void>;
  stop(): Promise<void>;
}

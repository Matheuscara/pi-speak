import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

export type SynthesisOptions = {
  voice: string;
  speed: number;
  signal?: AbortSignal;
};

type WorkerResponse =
  | { id: number; type: "ready" }
  | { id: number; type: "audio"; audio: string }
  | { id: number; type: "error"; message: string };

type PendingRequest = {
  resolve: (samples: Float32Array | undefined) => void;
  reject: (error: Error) => void;
};

/** Keep model loading and CPU-bound inference out of the terminal process. */
export class KokoroBackend {
  private child: ChildProcess | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 0;
  private loading: Promise<void> | undefined;
  private prepared = false;
  private disposed = false;

  private request(message: { type: "prepare" } | { type: "synthesize"; text: string; voice: string; speed: number }): Promise<Float32Array | undefined> {
    const child = this.child;
    if (!child) return Promise.reject(new Error("Speech subprocess is unavailable"));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      child.send({ id, ...message }, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async prepare(): Promise<void> {
    if (this.prepared) return;
    if (this.disposed) throw new Error("Synthesis backend has been disposed");
    if (this.loading) return this.loading;

    const path = fileURLToPath(new URL("./synthesis-worker.ts", import.meta.url));
    const child = fork(path, [], {
      execPath: process.versions.bun ? "node" : process.execPath,
      execArgv: [],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    this.child = child;
    child.stderr?.resume();
    child.on("message", (response: WorkerResponse) => {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.type === "error") {
        pending.reject(new Error(response.message));
      } else if (response.type === "audio") {
        const bytes = Buffer.from(response.audio, "base64");
        const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        pending.resolve(samples);
      } else {
        pending.resolve(undefined);
      }
    });
    const fail = (error: Error): void => {
      if (this.child !== child) return;
      this.child = undefined;
      this.prepared = false;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    child.on("error", fail);
    child.on("exit", (code, signal) => fail(new Error(`Speech subprocess exited (${signal ?? code})`)));

    this.loading = this.request({ type: "prepare" })
      .then(() => { this.prepared = true; })
      .finally(() => { this.loading = undefined; });
    return this.loading;
  }

  async synthesize(text: string, options: SynthesisOptions): Promise<Float32Array> {
    options.signal?.throwIfAborted();
    await this.prepare();
    options.signal?.throwIfAborted();
    const samples = await this.request({ type: "synthesize", text, voice: options.voice, speed: options.speed });
    options.signal?.throwIfAborted();
    if (!samples) throw new Error("Speech subprocess returned no audio");
    return samples;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.loading?.catch(() => undefined);
    const child = this.child;
    this.child = undefined;
    this.prepared = false;
    for (const pending of this.pending.values()) pending.reject(new Error("Synthesis backend has been disposed"));
    this.pending.clear();
    if (child) {
      const exited = once(child, "exit").then(() => undefined);
      child.kill();
      await exited;
    }
  }
}

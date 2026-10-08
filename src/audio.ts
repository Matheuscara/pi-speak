import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

export const AUDIO_PLAYBACK_TIMEOUT_MS = 5 * 60 * 1000;

/** WAV players in order of preference. */
const DARWIN_PLAYERS = ["afplay"];
const LINUX_PLAYERS = ["pw-play", "paplay", "aplay"];
/** Searched after PATH so minimal environments (e.g. GUI launchers) still find system players. */
const FALLBACK_DIRS = ["/usr/bin", "/usr/local/bin"];

export interface AudioPlayerLookup {
  platform?: NodeJS.Platform;
  /** PATH-style directory list; defaults to `process.env.PATH`. */
  pathEnv?: string;
  isExecutable?: (path: string) => boolean;
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Absolute path of the preferred available WAV player, or `undefined` when none
 * is installed. Player preference wins over directory order; PATH directories
 * are searched before the conventional system locations.
 */
export function getAudioPlayer({
  platform = process.platform,
  pathEnv = process.env.PATH ?? "",
  isExecutable = isExecutableFile,
}: AudioPlayerLookup = {}): string | undefined {
  const dirs = new Set<string>();
  // Relative entries (including empty ones, meaning the cwd) are skipped so a
  // project directory can never shadow the system audio player.
  for (const dir of pathEnv.split(platform === "win32" ? ";" : ":")) {
    if (isAbsolute(dir)) dirs.add(dir);
  }
  for (const dir of FALLBACK_DIRS) dirs.add(dir);

  for (const name of platform === "darwin" ? DARWIN_PLAYERS : LINUX_PLAYERS) {
    for (const dir of dirs) {
      const candidate = join(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

export async function playWav(outPath: string): Promise<void> {
  const player = getAudioPlayer();
  if (!player) {
    const install =
      process.platform === "darwin"
        ? "afplay ships with macOS; make sure /usr/bin is on PATH"
        : "install pw-play (PipeWire), paplay (PulseAudio), or aplay (alsa-utils) and make sure it is on PATH";
    throw new Error(`No WAV audio player found: ${install}.`);
  }
  await promisify(execFile)(player, [outPath], { timeout: AUDIO_PLAYBACK_TIMEOUT_MS });
}

export interface QueueItem {
  play: () => Promise<void>;
}

export interface AudioQueue {
  enqueue(item: QueueItem): void;
  readonly size: number;
  readonly playing: boolean;
}

export function createAudioQueue(): AudioQueue {
  const queue: QueueItem[] = [];
  let playing = false;

  function drain(): void {
    if (playing) return;
    const item = queue.shift();
    if (!item) return;
    playing = true;
    item
      .play()
      .catch(() => {})
      .finally(() => {
        playing = false;
        drain();
      });
  }

  return {
    enqueue(item: QueueItem) {
      queue.push(item);
      drain();
    },
    get size() {
      return queue.length;
    },
    get playing() {
      return playing;
    },
  };
}

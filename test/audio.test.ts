import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAudioQueue, getAudioPlayer } from "../src/audio.js";

test("getAudioPlayer", async (t) => {
  const executables = (...paths: string[]) => (p: string) => paths.includes(p);

  await t.test("selects a Nix profile player found only on PATH", () => {
    const player = getAudioPlayer({
      platform: "linux",
      pathEnv: "/run/wrappers/bin:/home/user/.nix-profile/bin:/run/current-system/sw/bin",
      isExecutable: executables("/run/current-system/sw/bin/pw-play"),
    });
    assert.equal(player, "/run/current-system/sw/bin/pw-play");
  });

  await t.test("player preference wins over PATH order", () => {
    const player = getAudioPlayer({
      platform: "linux",
      pathEnv: "/opt/a/bin:/opt/b/bin",
      isExecutable: executables("/opt/a/bin/aplay", "/opt/a/bin/paplay", "/opt/b/bin/pw-play"),
    });
    assert.equal(player, "/opt/b/bin/pw-play");
  });

  await t.test("earlier PATH entry wins for the same player", () => {
    const player = getAudioPlayer({
      platform: "linux",
      pathEnv: "/home/user/.nix-profile/bin:/usr/bin",
      isExecutable: executables("/usr/bin/paplay", "/home/user/.nix-profile/bin/paplay"),
    });
    assert.equal(player, "/home/user/.nix-profile/bin/paplay");
  });

  await t.test("skips relative and empty PATH entries", () => {
    const player = getAudioPlayer({
      platform: "linux",
      pathEnv: ":bin:./node_modules/.bin",
      isExecutable: (p) => !p.startsWith("/"),
    });
    assert.equal(player, undefined);
  });

  await t.test("falls back to system dirs when PATH lacks them", () => {
    const player = getAudioPlayer({
      platform: "linux",
      pathEnv: "",
      isExecutable: executables("/usr/local/bin/aplay"),
    });
    assert.equal(player, "/usr/local/bin/aplay");
  });

  await t.test("returns undefined when no player is available", () => {
    assert.equal(getAudioPlayer({ platform: "linux", pathEnv: "/usr/bin", isExecutable: () => false }), undefined);
  });

  await t.test("darwin uses afplay", () => {
    const player = getAudioPlayer({
      platform: "darwin",
      pathEnv: "/opt/homebrew/bin:/usr/bin",
      isExecutable: executables("/opt/homebrew/bin/pw-play", "/usr/bin/afplay"),
    });
    assert.equal(player, "/usr/bin/afplay");
  });

  await t.test(
    "default check skips missing, non-executable and directory entries",
    { skip: process.platform === "win32" },
    async () => {
      const root = await mkdtemp(join(tmpdir(), "pi-speak-audio-"));
      try {
        const plain = join(root, "plain");
        const dir = join(root, "dir");
        const store = join(root, "store", "pipewire", "bin");
        const profile = join(root, "profile", "bin");
        await Promise.all([
          mkdir(plain),
          mkdir(join(dir, "pw-play"), { recursive: true }),
          mkdir(store, { recursive: true }),
          mkdir(profile, { recursive: true }),
        ]);
        await writeFile(join(plain, "pw-play"), "#!/bin/sh\n");
        await chmod(join(plain, "pw-play"), 0o644);
        await writeFile(join(store, "pw-play"), "#!/bin/sh\n");
        await chmod(join(store, "pw-play"), 0o755);
        // Nix profiles expose binaries as symlinks into the store.
        await symlink(join(store, "pw-play"), join(profile, "pw-play"));

        const player = getAudioPlayer({
          platform: "linux",
          pathEnv: [join(root, "missing"), plain, dir, profile].join(":"),
        });
        assert.equal(player, join(profile, "pw-play"));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

test("createAudioQueue serial drain", async () => {
  const queue = createAudioQueue();
  const order: number[] = [];

  // Mock play functions that record order
  let play1Started = false;

  let secondDone!: () => void;
  const secondFinished = new Promise<void>((r) => { secondDone = r; });

  queue.enqueue({
    async play() {
      play1Started = true;
      order.push(1);
      await new Promise((r) => setTimeout(r, 10));
      order.push(10);
    },
  });

  queue.enqueue({
    async play() {
      // Should not start until first finishes
      assert.equal(play1Started, true);
      order.push(2);
      await new Promise((r) => setTimeout(r, 5));
      order.push(20);
      secondDone();
    },
  });

  await secondFinished;
  // Give drain final tick to reset playing
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, [1, 10, 2, 20]);
  assert.equal(queue.playing, false);
  assert.equal(queue.size, 0);
});

test("createAudioQueue handles play rejection and continues", async () => {
  const queue = createAudioQueue();
  const order: number[] = [];

  let secondDone!: () => void;
  const secondFinished = new Promise<void>((r) => { secondDone = r; });

  queue.enqueue({
    async play() {
      order.push(1);
      throw new Error("play failed");
    },
  });

  queue.enqueue({
    async play() {
      order.push(2);
      secondDone();
    },
  });

  await secondFinished;
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, [1, 2]);
  assert.equal(queue.playing, false);
});

test("createAudioQueue tracks size and playing", async () => {
  const queue = createAudioQueue();
  assert.equal(queue.size, 0);
  assert.equal(queue.playing, false);

  let resolve: () => void = () => {};
  const gate = new Promise<void>((r) => { resolve = r; });
  let secondDone!: () => void;
  const secondFinished = new Promise<void>((r) => { secondDone = r; });

  queue.enqueue({
    async play() {
      await gate;
    },
  });

  // Give drain a tick to start
  await new Promise((r) => setImmediate(r));
  assert.equal(queue.playing, true);
  assert.equal(queue.size, 0);

  queue.enqueue({
    async play() {
      secondDone();
    },
  });
  assert.equal(queue.size, 1);
  assert.equal(queue.playing, true);

  resolve();
  await secondFinished;
  await new Promise((r) => setImmediate(r));
  assert.equal(queue.playing, false);
  assert.equal(queue.size, 0);
});

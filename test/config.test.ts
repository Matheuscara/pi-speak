import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readSettings, writeSettings, settingsForModel } from "../src/settings.js";
import { CATALOG_MODELS } from "../src/catalog.js";

test("config", async (t) => {
  await t.test("settings persistence round-trip and atomic 0o600", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-speak-config-"));
    const original = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    try {
      const model = CATALOG_MODELS[0]!;
      const fakePath = join(dir, "model.onnx");
      await writeFile(fakePath, "x");

      const created = settingsForModel(model.id, fakePath, { voice: model.voices[0], speed: 1.5 });
      await writeSettings(created);

      const filePath = join(dir, "pi-speak.json");
      const st = await stat(filePath);
      assert.equal(st.mode & 0o777, 0o600);

      const content = await readFile(filePath, "utf8");
      const parsed = JSON.parse(content);
      assert.equal(parsed.voice, created.voice);
      assert.equal(parsed.speed, 1.5);

      const read = await readSettings();
      assert.ok(read.settings);
      assert.equal(read.settings!.voice, created.voice);
      assert.equal(read.settings!.speed, 1.5);
      assert.equal(read.warning, undefined);

      const files = await readdir(dir);
      assert.ok(!files.some((f) => f.endsWith(".tmp")));
    } finally {
      process.env.PI_CODING_AGENT_DIR = original;
      await rm(dir, { recursive: true, force: true });
    }
  });

  await t.test("readSettings ENOENT returns empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-speak-config-enoent-"));
    const original = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    try {
      const result = await readSettings();
      assert.equal(result.settings, undefined);
      assert.equal(result.warning, undefined);
    } finally {
      process.env.PI_CODING_AGENT_DIR = original;
      await rm(dir, { recursive: true, force: true });
    }
  });

  await t.test("readSettings invalid JSON returns warning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-speak-config-invalid-"));
    const original = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    try {
      const path = join(dir, "pi-speak.json");
      await writeFile(path, "{ invalid json", "utf8");
      const result = await readSettings();
      assert.equal(result.settings, undefined);
      assert.ok(result.warning);
    } finally {
      process.env.PI_CODING_AGENT_DIR = original;
      await rm(dir, { recursive: true, force: true });
    }
  });

  await t.test("readSettings invalid shape returns warning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-speak-config-shape-"));
    const original = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    try {
      const path = join(dir, "pi-speak.json");
      await writeFile(path, JSON.stringify({ version: 999, backend: { type: "kokoro" }, voice: "x", speed: 1, model: { source: "catalog", id: "kokoro-82m", path: "/tmp/x" } }), "utf8");
      const result = await readSettings();
      assert.equal(result.settings, undefined);
      assert.ok(result.warning);
    } finally {
      process.env.PI_CODING_AGENT_DIR = original;
      await rm(dir, { recursive: true, force: true });
    }
  });

  await t.test("settingsForModel validates voice and speed", async () => {
    const model = CATALOG_MODELS[0]!;
    const fakePath = "/tmp/fake.onnx";

    const s1 = settingsForModel(model.id, fakePath, { voice: model.voices[0], speed: 2.0 });
    assert.equal(s1.voice, model.voices[0]);
    assert.equal(s1.speed, 2.0);

    const s2 = settingsForModel(model.id, fakePath, { voice: "nonexistent_voice", speed: 1 });
    assert.equal(s2.voice, "af_heart");

    const s3 = settingsForModel(model.id, fakePath, { voice: model.voices[0], speed: 99 as any });
    assert.equal(s3.speed, 1.0);

    assert.throws(() => settingsForModel("unknown", fakePath));
  });

  await t.test("writeSettings is atomic via temp rename", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-speak-config-atomic-"));
    const original = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    try {
      const model = CATALOG_MODELS[0]!;
      const fakePath = join(dir, "model.onnx");
      await writeFile(fakePath, "x");
      const s = settingsForModel(model.id, fakePath);
      await writeSettings(s);
      const s2 = settingsForModel(model.id, fakePath, { voice: model.voices[1] ?? model.voices[0], speed: 0.75 });
      await writeSettings(s2);
      const read = await readSettings();
      assert.equal(read.settings!.voice, s2.voice);
      assert.equal(read.settings!.speed, 0.75);
    } finally {
      process.env.PI_CODING_AGENT_DIR = original;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

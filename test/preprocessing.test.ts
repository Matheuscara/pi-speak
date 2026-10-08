import assert from "node:assert/strict";
import test from "node:test";
import type { Api, AssistantMessage, Context, Model, ProviderStreamOptions } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildPreprocessingUserMessage, generatePreprocessedText, type PreprocessingDeps } from "../src/preprocessing.js";

// Mirrors ModelRegistry#getApiKeyAndHeaders; the result type is not exported from the package root.
type Auth =
  | { ok: true; apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> }
  | { ok: false; error: string };

const model = { provider: "openai", id: "gpt-4o" } as unknown as Model<Api>;

function contextWithAuth(auth: Auth): ExtensionContext {
  return { modelRegistry: { getApiKeyAndHeaders: async () => auth } } as unknown as ExtensionContext;
}

function assistant(content: AssistantMessage["content"], extra: Partial<AssistantMessage> = {}): AssistantMessage {
  return { role: "assistant", content, stopReason: "stop", ...extra } as AssistantMessage;
}

test("preprocessing", async (t) => {
  await t.test("buildPreprocessingUserMessage wraps raw in quadruple quotes verbatim", () => {
    assert.equal(buildPreprocessingUserMessage("hello"), `""""\nhello\n""""`);
    const raw = "# Title\n```code```\nworld";
    assert.equal(buildPreprocessingUserMessage(raw), `""""\n${raw}\n""""`);
    // no cleaning, no trimming of raw
    assert.equal(buildPreprocessingUserMessage("  spaced  "), `""""\n  spaced  \n""""`);
  });

  await t.test("sends the prompt as system prompt with host auth and returns trimmed text", async () => {
    const calls: Array<{ model: Model<Api>; context: Context; options: ProviderStreamOptions | undefined }> = [];
    const complete: NonNullable<PreprocessingDeps["complete"]> = async (target, context, options) => {
      calls.push({ model: target as Model<Api>, context, options });
      return assistant([
        { type: "thinking", thinking: "internal" },
        { type: "text", text: "  summary result  " },
      ]);
    };
    const ctx = contextWithAuth({ ok: true, apiKey: "key", headers: { "x-h": "1" }, env: { E: "1" } });
    const raw = "raw **markdown**";

    const result = await generatePreprocessedText(raw, "my prompt", model, ctx, { complete });

    assert.equal(result, "summary result");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.model, model);
    assert.equal(calls[0]!.context.systemPrompt, "my prompt");
    assert.deepEqual(
      calls[0]!.context.messages.map((message) => [message.role, message.content]),
      [["user", [{ type: "text", text: `""""\n${raw}\n""""` }]]],
    );
    assert.equal(calls[0]!.context.tools, undefined, "preprocessing must not expose tools");
    assert.deepEqual(calls[0]!.options, { apiKey: "key", headers: { "x-h": "1" }, env: { E: "1" } });
  });

  await t.test("returns null when the model answers with only whitespace", async () => {
    const ctx = contextWithAuth({ ok: true, apiKey: "key" });
    const result = await generatePreprocessedText("raw", "prompt", model, ctx, {
      complete: async () => assistant([{ type: "text", text: "   " }]),
    });
    assert.equal(result, null);
  });

  await t.test("rejects with the auth error without calling the model", async () => {
    let called = false;
    const ctx = contextWithAuth({ ok: false, error: "No API key for openai" });
    await assert.rejects(
      generatePreprocessedText("raw", "prompt", model, ctx, {
        complete: async () => {
          called = true;
          return assistant([]);
        },
      }),
      /No API key for openai/,
    );
    assert.equal(called, false);
  });

  await t.test("rejects with the provider error message", async () => {
    const ctx = contextWithAuth({ ok: true, apiKey: "key" });
    await assert.rejects(
      generatePreprocessedText("raw", "prompt", model, ctx, {
        complete: async () => assistant([], { stopReason: "error", errorMessage: "rate limited" }),
      }),
      /rate limited/,
    );
  });
});

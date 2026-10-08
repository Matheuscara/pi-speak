import { complete, type Api, type Model, type UserMessage } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function buildPreprocessingUserMessage(raw: string): string {
  return `""""\n${raw}\n""""`;
}

export type PreprocessingDeps = {
  complete?: typeof complete;
};

/**
 * One-shot, tool-less completion through the host's model registry and auth.
 * Resolves `null` when the model answers with no text; auth and provider
 * failures reject so callers can report the reason.
 */
export async function generatePreprocessedText(
  raw: string,
  prompt: string,
  model: Model<Api>,
  ctx: ExtensionContext,
  deps: PreprocessingDeps = {},
): Promise<string | null> {
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);

  const message: UserMessage = {
    role: "user",
    content: [{ type: "text", text: buildPreprocessingUserMessage(raw) }],
    timestamp: Date.now(),
  };
  const response = await (deps.complete ?? complete)(
    model,
    { systemPrompt: prompt, messages: [message] },
    { apiKey: auth.apiKey, headers: auth.headers, env: auth.env },
  );
  if (response.stopReason === "error" || response.stopReason === "aborted") {
    throw new Error(response.errorMessage ?? `model stopped: ${response.stopReason}`);
  }

  const text = response.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
  return text.length > 0 ? text : null;
}

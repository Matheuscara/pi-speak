import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type PiSpeakRuntime = {
  shutdown(ctx: ExtensionContext): Promise<void>;
};

export function createPiSpeakRuntime(pi: ExtensionAPI): PiSpeakRuntime {
  void pi;

  let operation: Promise<void> | undefined;
  let shutDown = false;

  // Lazy placeholders for future modules (settings, synthesis, audio).
  // Kept as promises so first use pays import cost once, like pi-transcribe.
  let audioModulePromise: Promise<typeof import("./audio.js")> | undefined;
  let synthesisModulePromise: Promise<typeof import("./synthesis-service.js")> | undefined;
  let settingsModulePromise: Promise<typeof import("./settings.js")> | undefined;

  function loadAudio(): Promise<typeof import("./audio.js")> {
    return (audioModulePromise ??= import("./audio.js"));
  }

  function loadSynthesisService(): Promise<
    typeof import("./synthesis-service.js")
  > {
    return (synthesisModulePromise ??= import("./synthesis-service.js"));
  }

  function loadSettings(): Promise<typeof import("./settings.js")> {
    return (settingsModulePromise ??= import("./settings.js"));
  }

  // Retained for future wiring; referenced via void to avoid unused warnings
  // until tickets 02/03 wire them. Keeps the lazy boundary explicit.
  void loadAudio;
  void loadSynthesisService;
  void loadSettings;

  function runExclusive(
    ctx: ExtensionContext,
    task: () => Promise<void>,
  ): Promise<void> {
    if (operation) {
      if (ctx.hasUI) {
        ctx.ui.notify("A pi-speak operation is already in progress", "warning");
      }
      return operation;
    }

    const nextOperation = task().finally(() => {
      if (operation === nextOperation) operation = undefined;
    });
    operation = nextOperation;
    return nextOperation;
  }

  // Expose runExclusive internally for future tickets without changing public
  // shape yet; scaffold keeps it private but compiled.
  void runExclusive;

  async function shutdown(ctx: ExtensionContext): Promise<void> {
    if (shutDown) return;
    shutDown = true;

    await operation?.catch(() => undefined);

    if (audioModulePromise) {
      const audio = await audioModulePromise.catch(() => undefined);
      void audio;
    }

    void ctx;
  }

  return {
    shutdown,
  };
}

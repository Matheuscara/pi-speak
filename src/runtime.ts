import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { createAudioQueue, type AudioQueue } from "./audio.js";
import type { PiSpeakSettings } from "./settings.js";
import { STATUS_WIDGET_KEY } from "./shortcut-core.js";
import { SynthesisService } from "./synthesis-service.js";

export type PiSpeakRuntime = {
  readonly service: SynthesisService;
  readonly audioQueue: AudioQueue;
  requireConfiguredSettingsForTool(): Promise<PiSpeakSettings>;
  showSettings(ctx: ExtensionCommandContext): Promise<void>;
  shutdown(ctx: ExtensionContext): Promise<void>;
};

export function createPiSpeakRuntime(pi: ExtensionAPI): PiSpeakRuntime {
  let operation: Promise<void> | undefined;
  let shutDown = false;
  let settings: PiSpeakSettings | undefined;
  let settingsLoaded = false;
  let settingsReadWarning: string | undefined;
  let settingsWarningShown = false;

  let audioModulePromise: Promise<typeof import("./audio.js")> | undefined;
  let visualizerModulePromise: Promise<typeof import("./visualizer.js")> | undefined;

  const synthesisService = new SynthesisService();
  const audioQueue = createAudioQueue();

  function loadAudio(): Promise<typeof import("./audio.js")> {
    return (audioModulePromise ??= import("./audio.js"));
  }

  function loadVisualizer(): Promise<typeof import("./visualizer.js")> {
    return (visualizerModulePromise ??= import("./visualizer.js"));
  }

  // Keep lazy boundary explicit for future wiring (like pi-transcribe runtime.ts:69-75)
  void loadAudio;
  void loadVisualizer;

  function rememberSettings(configured: PiSpeakSettings): void {
    settings = configured;
    settingsLoaded = true;
    settingsReadWarning = undefined;
  }

  async function loadSettingsOnce(): Promise<void> {
    if (settingsLoaded) return;
    const { readSettings } = await import("./settings.js");
    const result = await readSettings();
    settingsLoaded = true;
    settings = result.settings;
    settingsReadWarning = result.warning;
  }

  async function configureFirstRun(
    ctx: ExtensionContext,
  ): Promise<PiSpeakSettings | undefined> {
    const { runOnboarding } = await import("./onboarding.js");
    const configured = await runOnboarding(ctx);
    if (configured) rememberSettings(configured);
    return configured;
  }

  async function configureModel(
    ctx: ExtensionContext,
    previous: PiSpeakSettings,
  ): Promise<PiSpeakSettings | undefined> {
    const { runModelSelection } = await import("./onboarding.js");
    const configured = await runModelSelection(ctx, {
      currentModelId: previous.model.id,
      voice: previous.voice,
      speed: previous.speed,
      continueAfterSelection: true,
    });
    if (configured) rememberSettings(configured);
    return configured;
  }

  async function ensureSettings(
    ctx: ExtensionContext,
  ): Promise<PiSpeakSettings | undefined> {
    await loadSettingsOnce();
    if (settingsReadWarning && !settingsWarningShown) {
      settingsWarningShown = true;
      ctx.ui.notify(settingsReadWarning, "warning");
    }

    if (settings && existsSync(settings.model.path)) return settings;

    const previous = settings;
    if (settings) {
      ctx.ui.notify(
        `Configured model file is missing: ${settings.model.path}. Choose a model again; nothing will be downloaded without confirmation.`,
        "warning",
      );
      settings = undefined;
    }

    const configured = previous
      ? await configureModel(ctx, previous)
      : await configureFirstRun(ctx);
    if (configured) {
      ctx.ui.notify("Setup complete. Use /speak for settings.", "info");
    }
    return configured;
  }

  async function requireConfiguredSettingsForTool(): Promise<PiSpeakSettings> {
    await loadSettingsOnce();
    if (settingsReadWarning) {
      throw new Error(
        `${settingsReadWarning} Run /speak in Pi's interactive TUI to configure a local model, then retry speak.`,
      );
    }
    if (!settings) {
      throw new Error(
        "pi-speak is not configured. Run /speak in Pi's interactive TUI once to choose and download a local model, then retry speak.",
      );
    }
    if (!existsSync(settings.model.path)) {
      throw new Error(
        `The configured speech model is missing: ${settings.model.path}. Run /speak and choose a model again, then retry speak.`,
      );
    }
    return settings;
  }

  function runExclusive(
    ctx: ExtensionContext,
    task: () => Promise<void>,
  ): Promise<void> {
    if (operation) {
      if (ctx.hasUI) ctx.ui.notify("A pi-speak operation is already in progress", "warning");
      return operation;
    }

    const nextOperation = task().finally(() => {
      if (operation === nextOperation) operation = undefined;
    });
    operation = nextOperation;
    return nextOperation;
  }

  async function showSettings(ctx: ExtensionCommandContext): Promise<void> {
    let reload = false;
    await runExclusive(ctx, async () => {
      const configured = await ensureSettings(ctx);
      if (!configured) return;
      const { showSpeakSettings } = await import("./settings-menu.js");
      reload = await showSpeakSettings(pi, ctx, configured);
    });
    if (reload) await ctx.reload();
  }

  async function shutdown(ctx: ExtensionContext): Promise<void> {
    if (shutDown) return;
    shutDown = true;

    await Promise.all([operation?.catch(() => undefined), synthesisService.shutdown().catch(() => undefined)]);

    if (visualizerModulePromise) {
      const visualizer = await visualizerModulePromise.catch(() => undefined);
      visualizer?.clearSynthesisWidget(ctx);
    } else if (ctx.hasUI) {
      // Fallback clear if visualizer never loaded
      ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined);
    }
  }

  return {
    service: synthesisService,
    audioQueue,
    requireConfiguredSettingsForTool,
    showSettings,
    shutdown,
  };
}

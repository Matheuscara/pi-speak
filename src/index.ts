import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiSpeakRuntime } from "./runtime.js";
import { STATUS_WIDGET_KEY } from "./shortcut-core.js";

// Pi awaits extension module evaluation before continuing startup. Keep this
// entry point registration-only and load feature implementations on first use.
export default function piSpeak(pi: ExtensionAPI): void {
  let runtimePromise: Promise<PiSpeakRuntime> | undefined;
  let shuttingDown = false;

  function loadRuntime(): Promise<PiSpeakRuntime> {
    if (shuttingDown) {
      return Promise.reject(new Error("pi-speak is shutting down"));
    }
    if (runtimePromise) return runtimePromise;

    const loading = import("./runtime.js").then(({ createPiSpeakRuntime }) =>
      createPiSpeakRuntime(pi),
    );
    runtimePromise = loading;
    void loading.catch(() => {
      if (runtimePromise === loading) runtimePromise = undefined;
    });
    return loading;
  }

  // Scaffold: no tool/command registered yet. Future tickets (04/05) will
  // register `speak` tool, `/speak` command, and `ctrl+alt+x` shortcut via
  // loadRuntime() closures. Keep this file free of heavy imports.

  // Demonstrate lazy boundary without exposing behavior: first heavy use
  // would paint synchronously before await. Kept as reference for future
  // `toggleCapture`/`showSettings` style handlers.
  void STATUS_WIDGET_KEY;
  void loadRuntime;

  pi.on("session_shutdown", async (_event, ctx) => {
    shuttingDown = true;
    const loading = runtimePromise;
    if (!loading) return;
    const runtime = await loading.catch(() => undefined);
    await runtime?.shutdown(ctx).catch(() => undefined);
  });
}

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { STATUS_WIDGET_KEY } from "./shortcut-core.js";

export function showSynthesisStatus(ctx: ExtensionContext, text: string): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(STATUS_WIDGET_KEY, [ctx.ui.theme.fg("muted", text)]);
}

export function clearSynthesisWidget(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined);
}

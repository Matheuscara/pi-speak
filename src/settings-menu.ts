import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getCatalogModel, getCatalogVoices } from "./catalog.js";
import { runModelSelection } from "./onboarding.js";
import { writeSettings, type PiSpeakSettings } from "./settings.js";
import { SPEED_VALUES, voiceHint } from "./text.js";

const SETTING_LABEL_WIDTH = "Transcription language".length;

function settingChoice(
  theme: ExtensionContext["ui"]["theme"],
  label: string,
  value: string,
): string {
  return `${theme.fg("muted", label.padEnd(SETTING_LABEL_WIDTH))}  ${value}`;
}

async function chooseVoice(
  ctx: ExtensionContext,
  current: string,
): Promise<string | undefined> {
  const voices = getCatalogVoices();
  const labels = voices.map((voice) => {
    const hint = voiceHint(voice);
    return hint ? `${voice} (${hint})` : voice;
  });
  const title = `Voice · ${current}${voiceHint(current) ? ` (${voiceHint(current)})` : ""}`;
  const selected = await ctx.ui.select(title, labels);
  if (!selected) return undefined;
  const index = labels.indexOf(selected);
  return index >= 0 ? voices[index] : undefined;
}

async function chooseSpeed(
  ctx: ExtensionContext,
  current: number,
): Promise<number | undefined> {
  const selected = await ctx.ui.select(`Speed · ${current}`, [...SPEED_VALUES]);
  if (!selected) return undefined;
  const speed = Number.parseFloat(selected);
  return Number.isFinite(speed) ? speed : undefined;
}

export async function showSpeakSettings(
  _pi: ExtensionAPI,
  ctx: ExtensionContext,
  configured: PiSpeakSettings,
): Promise<boolean> {
  while (true) {
    const model = getCatalogModel(configured.model.id);
    if (!model) {
      ctx.ui.notify(`Unknown model: ${configured.model.id}`, "error");
      return false;
    }
    const theme = ctx.ui.theme;
    const voiceChoice = settingChoice(
      theme,
      "Voice",
      `${configured.voice}${voiceHint(configured.voice) ? ` (${voiceHint(configured.voice)})` : ""}`,
    );
    const speedChoice = settingChoice(theme, "Speed", String(configured.speed));
    const modelChoice = settingChoice(theme, "Model", model.name);
    const choices = [voiceChoice, speedChoice, modelChoice, "Done"];
    const summary = "pi-speak settings";
    const choice = await ctx.ui.select(summary, choices);
    if (!choice || choice === "Done") return false;

    if (choice === voiceChoice) {
      const voice = await chooseVoice(ctx, configured.voice);
      if (!voice || voice === configured.voice) continue;
      const updated: PiSpeakSettings = { ...configured, voice };
      await writeSettings(updated);
      Object.assign(configured, updated);
      ctx.ui.notify(`Voice saved as ${voice}${voiceHint(voice) ? ` (${voiceHint(voice)})` : ""}`, "info");
      continue;
    }
    if (choice === speedChoice) {
      const speed = await chooseSpeed(ctx, configured.speed);
      if (speed === undefined || speed === configured.speed) continue;
      const updated: PiSpeakSettings = { ...configured, speed };
      await writeSettings(updated);
      Object.assign(configured, updated);
      ctx.ui.notify(`Speed saved as ${speed}`, "info");
      continue;
    }
    if (choice === modelChoice) {
      const changed = await runModelSelection(ctx, {
        currentModelId: configured.model.id,
        voice: configured.voice,
        speed: configured.speed,
      });
      if (changed) Object.assign(configured, changed);
      continue;
    }
  }
}

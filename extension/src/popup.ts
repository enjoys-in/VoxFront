// Extension popup: master switch, preset picker and fine-tune sliders. Every
// change is saved to chrome.storage, which the bridge pushes to live calls.

import { mergeConfig } from "../../voice-changer/ts/engine";
import { presets } from "../../voice-changer/ts/presets";
import type { VoiceChangerPatch, VoicePresetName } from "../../voice-changer/ts/types";
import { DEFAULT_SETTINGS } from "./shared";
import type { PageStatus, Settings } from "./shared";

const GROUPS: [string, VoicePresetName[]][] = [
  ["Natural", ["clean"]],
  ["Female", ["female", "female2", "female-18", "female-25", "female-30", "female-35", "old-lady"]],
  ["Male", ["male", "male2", "male-18", "male-25", "male-30", "male-35", "old-man"]],
  ["Kids", ["child-5", "girl-10", "boy-10"]],
  ["Heavy & fun", ["heavy", "giant", "monster", "demon", "chipmunk", "helium", "radio"]],
  ["Characters", ["robot", "alien", "villain"]],
];

const SLIDERS: { key: "pitch" | "drive" | "gain"; label: string; min: number; max: number; step: number; unit: string }[] = [
  { key: "pitch", label: "Pitch", min: -24, max: 24, step: 1, unit: " st" },
  { key: "drive", label: "Grit", min: 0, max: 1, step: 0.05, unit: "" },
  { key: "gain", label: "Volume", min: 0, max: 2, step: 0.05, unit: "×" },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let settings: Settings = DEFAULT_SETTINGS;

function save(next: Settings): void {
  settings = next;
  void chrome.storage.local.set({ settings });
  render();
}

function applyPreset(name: VoicePresetName): void {
  save({ ...settings, preset: name, config: structuredClone(presets[name].config) });
}

function tweak(patch: VoiceChangerPatch): void {
  // A manual tweak always means "process", even from the pass-through preset.
  save({ ...settings, preset: null, config: mergeConfig(settings.config, { ...patch, enabled: true }) });
}

function build(): void {
  const groups = $("groups");
  for (const [title, names] of GROUPS) {
    const section = document.createElement("section");
    section.innerHTML = `<h2>${title}</h2>`;
    const grid = document.createElement("div");
    grid.className = "grid";
    for (const name of names) {
      const b = document.createElement("button");
      b.dataset.preset = name;
      b.textContent = presets[name].label;
      b.title = presets[name].hint;
      b.onclick = () => applyPreset(name);
      grid.appendChild(b);
    }
    section.appendChild(grid);
    groups.appendChild(section);
  }

  const sliders = $("sliders");
  for (const s of SLIDERS) {
    const row = document.createElement("label");
    row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}"><output></output>`;
    const input = row.querySelector("input")!;
    input.id = `s-${s.key}`;
    input.oninput = () => tweak({ [s.key]: Number(input.value) });
    sliders.appendChild(row);
  }

  $<HTMLInputElement>("enabled").onchange = (e) =>
    save({ ...settings, enabled: (e.target as HTMLInputElement).checked });
  $("reset").onclick = () => applyPreset("clean");
}

function render(): void {
  $<HTMLInputElement>("enabled").checked = settings.enabled;
  document.body.classList.toggle("off", !settings.enabled);
  document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((b) => {
    b.classList.toggle("active", b.dataset.preset === settings.preset);
  });
  for (const s of SLIDERS) {
    const input = $<HTMLInputElement>(`s-${s.key}`);
    const v = settings.config[s.key];
    input.value = String(v);
    input.nextElementSibling!.textContent = `${s.key === "pitch" && v > 0 ? "+" : ""}${v}${s.unit}`;
  }
}

async function refreshStatus(): Promise<void> {
  const el = $("status");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let status: PageStatus | undefined;
  try {
    if (tab?.id !== undefined) status = await chrome.tabs.sendMessage(tab.id, { type: "status" });
  } catch {
    /* no frame on this tab uses the mic (or the page can't run extensions) */
  }
  el.className = status?.error ? "status err" : status?.active ? "status live" : "status";
  el.textContent = status?.error
    ? status.error
    : status?.active
      ? `● Changing your voice on this tab (${status.active} mic stream${status.active > 1 ? "s" : ""})`
      : "No mic in use on this tab. Start a call or recording — or reload the page if it opened the mic before you enabled this.";
}

build();
chrome.storage.local.get("settings").then(({ settings: s }) => {
  if (s) settings = s as Settings;
  render();
});
void refreshStatus();
setInterval(() => void refreshStatus(), 1000);

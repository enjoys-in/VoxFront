// Isolated-world content script: relays settings from chrome.storage to the
// injected page script, and the page's live status back to the popup.

import { DEFAULT_SETTINGS, EV_HELLO, EV_SETTINGS, EV_STATUS } from "./shared";
import type { PageStatus, Settings } from "./shared";

let status: PageStatus = { active: 0, error: null };

async function sendSettings(): Promise<void> {
  const { settings } = await chrome.storage.local.get("settings");
  const detail = JSON.stringify({
    base: chrome.runtime.getURL(""),
    settings: (settings as Settings | undefined) ?? DEFAULT_SETTINGS,
  });
  document.dispatchEvent(new CustomEvent(EV_SETTINGS, { detail }));
}

document.addEventListener(EV_HELLO, () => void sendSettings());
document.addEventListener(EV_STATUS, (e) => {
  status = JSON.parse((e as CustomEvent<string>).detail) as PageStatus;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) void sendSettings();
});

// Only frames that actually use the mic answer, so the popup hears from the
// right frame (or nobody, meaning "no mic in use on this tab").
chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, reply) => {
  if (msg?.type === "status" && (status.active > 0 || status.error)) reply(status);
});

void sendSettings();

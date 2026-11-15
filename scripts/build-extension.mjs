// Bundles the Chrome extension into extension/dist (load it via
// chrome://extensions -> "Load unpacked"). Expects the voice-changer wasm to be
// built first (`npm run build:vc`, done by `npm run build:ext`).
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ext = resolve(root, "extension");
const out = resolve(ext, "dist");
const vc = resolve(root, "voice-changer");

const assets = [
  [resolve(ext, "manifest.json"), "manifest.json"],
  [resolve(ext, "popup.html"), "popup.html"],
  [resolve(vc, "dist", "voice_changer.wasm"), "voice_changer.wasm"],
  [resolve(vc, "worklet", "voice-changer-processor.js"), "voice-changer-processor.js"],
];
for (const [src] of assets) {
  if (!existsSync(src)) {
    console.error(`Missing ${src} — run \`npm run build:vc\` first.`);
    process.exit(1);
  }
}

mkdirSync(out, { recursive: true });
await build({
  entryPoints: {
    inject: resolve(ext, "src", "inject.ts"),
    bridge: resolve(ext, "src", "bridge.ts"),
    popup: resolve(ext, "src", "popup.ts"),
  },
  outdir: out,
  bundle: true,
  format: "iife", // content scripts can't be ES modules
  target: "chrome116",
  logLevel: "info",
});
for (const [src, name] of assets) copyFileSync(src, resolve(out, name));
console.log(`Extension ready: ${out}`);

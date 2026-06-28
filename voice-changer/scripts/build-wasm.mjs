// Builds the voice-changer Rust crate to wasm32-unknown-unknown and copies the
// artifacts where they can be served:
//   - <package>/dist/voice_changer.wasm                 (package artifact)
//   - <repo>/public/voice_changer.wasm                  (local Vite dev server)
//   - <repo>/public/worklet/voice-changer-processor.js  (local Vite dev server)
// Runs wasm-opt when available.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const crateDir = resolve(scriptDir, "..");        // voice-changer/
const repoRoot = resolve(scriptDir, "..", "..");  // repo root
const target = "wasm32-unknown-unknown";
const wasmName = "voice_changer.wasm";
const workletName = "voice-changer-processor.js";

const builtWasm = resolve(crateDir, "target", target, "release", wasmName);
const distDir = resolve(crateDir, "dist");
const distWasm = resolve(distDir, wasmName);
const publicDir = resolve(repoRoot, "public");
const publicWasm = resolve(publicDir, wasmName);
const publicWorkletDir = resolve(publicDir, "worklet");
const workletSrc = resolve(crateDir, "worklet", workletName);

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

function which(cmd) {
  try {
    const probe = process.platform === "win32" ? "where" : "which";
    execFileSync(probe, [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

console.log("Building voice-changer Rust DSP -> WebAssembly...");
run("cargo", ["build", "--release", "--target", target], { cwd: crateDir });

if (!existsSync(builtWasm)) {
  console.error(`Expected wasm not found at ${builtWasm}`);
  process.exit(1);
}

mkdirSync(distDir, { recursive: true });
if (which("wasm-opt")) {
  console.log("Optimizing with wasm-opt...");
  run("wasm-opt", ["-O3", builtWasm, "-o", distWasm]);
} else {
  copyFileSync(builtWasm, distWasm);
}

// Stage the worklet alongside the wasm in dist for publishing.
copyFileSync(workletSrc, resolve(distDir, workletName));

// Mirror into the repo's public/ so `npm run dev` serves them at the default
// URLs (/voice_changer.wasm and /worklet/voice-changer-processor.js).
if (existsSync(publicDir)) {
  copyFileSync(distWasm, publicWasm);
  mkdirSync(publicWorkletDir, { recursive: true });
  copyFileSync(workletSrc, resolve(publicWorkletDir, workletName));
  console.log(`Copied to ${publicWasm} and ${publicWorkletDir}/${workletName}`);
}

const kb = (statSync(distWasm).size / 1024).toFixed(1);
console.log(`Wrote ${distWasm} (${kb} KiB)`);

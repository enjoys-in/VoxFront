// Builds the Rust DSP crate to wasm32-unknown-unknown and copies the resulting
// module into public/ so Vite serves it verbatim. Runs wasm-opt if available.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const crateDir = resolve(root, "rust-dsp");
const target = "wasm32-unknown-unknown";
const wasmName = "voip_dsp.wasm";
const builtWasm = resolve(crateDir, "target", target, "release", wasmName);
const publicDir = resolve(root, "public");
const outWasm = resolve(publicDir, wasmName);

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

console.log("Building Rust DSP -> WebAssembly...");
run("cargo", ["build", "--release", "--target", target], { cwd: crateDir });

if (!existsSync(builtWasm)) {
  console.error(`Expected wasm not found at ${builtWasm}`);
  process.exit(1);
}

mkdirSync(publicDir, { recursive: true });

if (which("wasm-opt")) {
  console.log("Optimizing with wasm-opt...");
  run("wasm-opt", ["-O3", builtWasm, "-o", outWasm]);
} else {
  copyFileSync(builtWasm, outWasm);
}

const kb = (statSync(outWasm).size / 1024).toFixed(1);
console.log(`Wrote ${outWasm} (${kb} KiB)`);

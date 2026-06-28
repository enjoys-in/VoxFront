import { defineConfig } from "vite";

// The DSP WebAssembly module and the AudioWorklet processor live in `public/`
// so they are served verbatim (the worklet cannot be bundled because it runs
// in the AudioWorkletGlobalScope, not a normal module/worker scope).
export default defineConfig({
  server: {
    port: 5173,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});

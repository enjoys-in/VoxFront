import "./style.css";
import { AudioEngine } from "./audio/AudioEngine";
import { SipTransport } from "./transport/SipTransport";
import { DTMF_KEYS, defaultConfig, presets } from "./dsp/config";
import type { DspConfig, DspStatus, ListenMode } from "./dsp/config";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

// --- Elements ----------------------------------------------------------------

const startBtn = el<HTMLButtonElement>("startBtn");
const preChk = el<HTMLInputElement>("preChk");
const stateBadge = el<HTMLSpanElement>("stateBadge");
const seg = document.querySelectorAll<HTMLButtonElement>(".seg-btn");

const scope = el<HTMLCanvasElement>("scope");
const sctx = scope.getContext("2d")!;
const inBar = el<HTMLDivElement>("inBar");
const outBar = el<HTMLDivElement>("outBar");
const noiseBar = el<HTMLDivElement>("noiseBar");
const inVal = el<HTMLSpanElement>("inVal");
const outVal = el<HTMLSpanElement>("outVal");
const noiseVal = el<HTMLSpanElement>("noiseVal");
const deltaVal = el<HTMLSpanElement>("deltaVal");
const vadDot = el<HTMLSpanElement>("vadDot");
const vadText = el<HTMLSpanElement>("vadText");
const gainVal = el<HTMLSpanElement>("gainVal");

const presetRow = el<HTMLDivElement>("presetRow");
const dtmfDisplay = el<HTMLDivElement>("dtmfDisplay");
const dtmfPad = el<HTMLDivElement>("dtmfPad");
const dtmfClear = el<HTMLButtonElement>("dtmfClear");
const farendBtn = el<HTMLButtonElement>("farendBtn");

const wsUrl = el<HTMLInputElement>("wsUrl");
const streamBtn = el<HTMLButtonElement>("streamBtn");
const linkDot = el<HTMLSpanElement>("linkDot");
const pktText = el<HTMLSpanElement>("pktText");
const byteText = el<HTMLSpanElement>("byteText");

let sampleRate = 48000;
let dtmfSequence = "";
let running = false;
let lastNoise = 0;

// --- Engine ------------------------------------------------------------------

const engine = new AudioEngine({
  onReady: () => {
    sampleRate = engine.context?.sampleRate ?? 48000;
    pushDelay();
    running = true;
    requestAnimationFrame(draw);
  },
  onState: (state, detail) => {
    stateBadge.textContent = state === "error" ? `error: ${detail ?? ""}` : state;
    stateBadge.className = `badge ${state}`;
    const isRunning = state === "running";
    startBtn.textContent = isRunning ? "Stop microphone" : "Start microphone";
    startBtn.classList.toggle("running", isRunning);
    if (state !== "running") resetMeters();
  },
  onStatus: renderStatus,
  onDtmf: onDtmf,
});

const transport = new SipTransport({
  onStats: (s) => {
    linkDot.className = `dot ${s.connected ? "link" : ""}`;
    pktText.textContent = String(s.chunks);
    byteText.textContent = formatBytes(s.bytes);
  },
});

// --- Status + meters ---------------------------------------------------------

function renderStatus(status: DspStatus): void {
  lastNoise = status.noiseFloor;
  noiseBar.style.width = `${Math.min(100, status.noiseFloor * 600)}%`;
  noiseVal.textContent = status.noiseFloor.toFixed(3);
  vadDot.className = `dot ${status.vad ? "on" : ""}`;
  vadText.textContent = status.vad ? "speech" : "silent";
  gainVal.textContent = `${status.gain.toFixed(2)}×`;
}

function resetMeters(): void {
  running = false;
  inBar.style.width = "0%";
  outBar.style.width = "0%";
  noiseBar.style.width = "0%";
  inVal.textContent = outVal.textContent = noiseVal.textContent = "0.000";
  deltaVal.textContent = "0.0 dB";
  vadDot.className = "dot";
  vadText.textContent = "silent";
  gainVal.textContent = "1.00×";
  sctx.clearRect(0, 0, scope.width, scope.height);
}

// --- A/B visualizer ----------------------------------------------------------

const rawData = new Float32Array(1024);
const procData = new Float32Array(1024);

function rms(buf: Float32Array): number {
  let acc = 0;
  for (let i = 0; i < buf.length; i++) acc += buf[i] * buf[i];
  return Math.sqrt(acc / buf.length);
}

function drawWave(buf: Float32Array, color: string, alpha: number): void {
  const w = scope.width;
  const h = scope.height;
  sctx.beginPath();
  sctx.lineWidth = 2;
  sctx.strokeStyle = color;
  sctx.globalAlpha = alpha;
  const step = w / buf.length;
  for (let i = 0; i < buf.length; i++) {
    const y = h / 2 - buf[i] * (h / 2) * 0.95;
    if (i === 0) sctx.moveTo(0, y);
    else sctx.lineTo(i * step, y);
  }
  sctx.stroke();
  sctx.globalAlpha = 1;
}

function draw(): void {
  if (!running) return;

  // Crisp canvas sizing.
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.floor(scope.clientWidth * dpr);
  const ch = Math.floor(scope.clientHeight * dpr);
  if (scope.width !== cw || scope.height !== ch) {
    scope.width = cw;
    scope.height = ch;
  }

  sctx.clearRect(0, 0, scope.width, scope.height);
  // midline
  sctx.strokeStyle = "#1c2430";
  sctx.lineWidth = 1;
  sctx.beginPath();
  sctx.moveTo(0, scope.height / 2);
  sctx.lineTo(scope.width, scope.height / 2);
  sctx.stroke();

  const ra = engine.rawAnalyser;
  const pa = engine.processedAnalyser;
  let inR = 0;
  let outR = 0;
  if (ra) {
    ra.getFloatTimeDomainData(rawData);
    drawWave(rawData, "#f0883e", 0.6);
    inR = rms(rawData);
  }
  if (pa) {
    pa.getFloatTimeDomainData(procData);
    drawWave(procData, "#4cc2ff", 0.95);
    outR = rms(procData);
  }

  inBar.style.width = `${Math.min(100, inR * 280)}%`;
  outBar.style.width = `${Math.min(100, outR * 280)}%`;
  inVal.textContent = inR.toFixed(3);
  outVal.textContent = outR.toFixed(3);
  const delta = 20 * Math.log10((outR + 1e-6) / (inR + 1e-6));
  deltaVal.textContent = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} dB`;
  // keep noise meter aligned to latest status value
  noiseBar.style.width = `${Math.min(100, lastNoise * 600)}%`;

  requestAnimationFrame(draw);
}

// --- DTMF --------------------------------------------------------------------

const padKeys: HTMLDivElement[] = [];
DTMF_KEYS.forEach((label, index) => {
  const key = document.createElement("div");
  key.className = "dtmf-key";
  key.textContent = label;
  dtmfPad.appendChild(key);
  padKeys[index] = key;
});

function onDtmf(index: number): void {
  const ch = DTMF_KEYS[index];
  if (!ch) return;
  dtmfSequence += ch;
  dtmfDisplay.textContent = dtmfSequence;
  const key = padKeys[index];
  key.classList.add("hit");
  window.setTimeout(() => key.classList.remove("hit"), 180);
}

dtmfClear.addEventListener("click", () => {
  dtmfSequence = "";
  dtmfDisplay.textContent = "—";
});

// --- Transport bar ----------------------------------------------------------

startBtn.addEventListener("click", async () => {
  if (engine.isRunning) {
    await engine.stop();
    transport.stop();
    streamBtn.textContent = "Start streaming (Opus)";
    return;
  }
  startBtn.disabled = true;
  try {
    await engine.start();
  } catch {
    /* onState already surfaced the error */
  } finally {
    startBtn.disabled = false;
  }
});

// master preprocessing on/off = bypass off/on
preChk.addEventListener("change", () => {
  engine.setBypass(!preChk.checked);
  document.querySelector(".grid")?.classList.toggle("bypassed", !preChk.checked);
});

seg.forEach((btn) => {
  btn.addEventListener("click", () => {
    seg.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    engine.setListenMode(btn.dataset.listen as ListenMode);
  });
});

farendBtn.addEventListener("click", () => {
  const on = engine.toggleFarEndTone();
  farendBtn.textContent = on ? "Stop far-end test tone" : "Play far-end test tone";
});

streamBtn.addEventListener("click", () => {
  if (transport.isActive) {
    transport.stop();
    streamBtn.textContent = "Start streaming (Opus)";
    return;
  }
  const stream = engine.processedStream;
  if (!stream) {
    alert("Start the microphone first.");
    return;
  }
  transport.start(stream, wsUrl.value.trim() || undefined);
  streamBtn.textContent = "Stop streaming";
});

// --- Presets -----------------------------------------------------------------

Object.entries(presets).forEach(([k, p]) => {
  const btn = document.createElement("button");
  btn.className = "preset-btn";
  btn.dataset.preset = k;
  btn.innerHTML = `${p.label}<small>${p.hint}</small>`;
  btn.addEventListener("click", () => applyPreset(k));
  presetRow.appendChild(btn);
});

function applyPreset(key: string): void {
  const preset = presets[key];
  if (!preset) return;
  engine.setConfig(preset.config);
  syncControls(preset.config);
  highlightPreset(key);
}

function highlightPreset(key: string | null): void {
  presetRow.querySelectorAll<HTMLButtonElement>(".preset-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.preset === key);
  });
}

// --- Control bindings --------------------------------------------------------

function markFeature(feature: string, on: boolean): void {
  document.querySelector(`.feature[data-feature="${feature}"]`)?.classList.toggle("off", !on);
}

function bindToggle(id: string, feature: string, apply: (on: boolean) => void): void {
  const input = el<HTMLInputElement>(id);
  input.addEventListener("change", () => {
    markFeature(feature, input.checked);
    apply(input.checked);
    highlightPreset(null);
  });
}

function bindCheck(id: string, apply: (on: boolean) => void): void {
  const input = el<HTMLInputElement>(id);
  input.addEventListener("change", () => {
    apply(input.checked);
    highlightPreset(null);
  });
}

function bindSlider(
  id: string,
  outId: string,
  digits: number,
  apply: (value: number) => void,
): void {
  const input = el<HTMLInputElement>(id);
  const out = el<HTMLOutputElement>(outId);
  input.addEventListener("input", () => {
    const v = Number(input.value);
    out.textContent = v.toFixed(digits);
    apply(v);
    highlightPreset(null);
  });
}

function setToggle(id: string, feature: string, on: boolean): void {
  el<HTMLInputElement>(id).checked = on;
  markFeature(feature, on);
}

function setSlider(id: string, outId: string, value: number, digits: number): void {
  el<HTMLInputElement>(id).value = String(value);
  el<HTMLOutputElement>(outId).textContent = value.toFixed(digits);
}

/** Push a full config object into the UI controls (used by presets). */
function syncControls(c: DspConfig): void {
  setToggle("aecOn", "aec", c.aec.on);
  setSlider("aecMu", "aecMuVal", c.aec.mu, 2);
  setToggle("nsOn", "ns", c.ns.on);
  setSlider("nsStrength", "nsStrengthVal", c.ns.strength, 1);
  setToggle("agcOn", "agc", c.agc.on);
  setSlider("agcTarget", "agcTargetVal", c.agc.target, 2);
  setToggle("vadOn", "vad", c.vad.on);
  setSlider("vadSens", "vadSensVal", c.vad.sensitivity, 2);
  el<HTMLInputElement>("vadGate").checked = c.vad.gate;
  setToggle("compOn", "comp", c.comp.on);
  setSlider("compThr", "compThrVal", c.comp.threshold, 2);
  setSlider("compRatio", "compRatioVal", c.comp.ratio, 1);
  el<HTMLInputElement>("fxHp").checked = c.fx.hp;
  el<HTMLInputElement>("fxEcho").checked = c.fx.echo;
  setSlider("fxDelay", "fxDelayVal", Math.round((c.fx.delay / sampleRate) * 1000), 0);
  setSlider("fxFb", "fxFbVal", c.fx.fb, 2);
  setSlider("fxMix", "fxMixVal", c.fx.mix, 2);
}

// AEC
bindToggle("aecOn", "aec", (on) => engine.updateConfig({ aec: { on } }));
bindSlider("aecMu", "aecMuVal", 2, (mu) => engine.updateConfig({ aec: { mu } }));
// Noise suppression
bindToggle("nsOn", "ns", (on) => engine.updateConfig({ ns: { on } }));
bindSlider("nsStrength", "nsStrengthVal", 1, (strength) => engine.updateConfig({ ns: { strength } }));
// AGC
bindToggle("agcOn", "agc", (on) => engine.updateConfig({ agc: { on } }));
bindSlider("agcTarget", "agcTargetVal", 2, (target) => engine.updateConfig({ agc: { target } }));
// VAD
bindToggle("vadOn", "vad", (on) => engine.updateConfig({ vad: { on } }));
bindSlider("vadSens", "vadSensVal", 2, (sensitivity) => engine.updateConfig({ vad: { sensitivity } }));
bindCheck("vadGate", (gate) => engine.updateConfig({ vad: { gate } }));
// Compressor
bindToggle("compOn", "comp", (on) => engine.updateConfig({ comp: { on } }));
bindSlider("compThr", "compThrVal", 2, (threshold) => engine.updateConfig({ comp: { threshold } }));
bindSlider("compRatio", "compRatioVal", 1, (ratio) => engine.updateConfig({ comp: { ratio } }));
// Effects
bindCheck("fxHp", (hp) => engine.updateConfig({ fx: { hp } }));
bindCheck("fxEcho", (echo) => engine.updateConfig({ fx: { echo } }));
bindSlider("fxDelay", "fxDelayVal", 0, () => pushDelay());
bindSlider("fxFb", "fxFbVal", 2, (fb) => engine.updateConfig({ fx: { fb } }));
bindSlider("fxMix", "fxMixVal", 2, (mix) => engine.updateConfig({ fx: { mix } }));

function pushDelay(): void {
  const ms = Number(el<HTMLInputElement>("fxDelay").value);
  const delay = Math.round((ms / 1000) * sampleRate);
  engine.updateConfig({ fx: { delay } });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Initialize control visuals from defaults.
syncControls(defaultConfig);

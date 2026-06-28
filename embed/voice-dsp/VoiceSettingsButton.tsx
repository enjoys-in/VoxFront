"use client";

// Floating voice-settings button for enjoys-voice (web/).
// Drop it anywhere global (e.g. in your call screen) and pass a live VoiceDSP
// instance. The user can tweak the DSP while speaking.
//
//   import { VoiceDSP } from "@/lib/voice-dsp";
//   import { VoiceSettingsButton } from "@/components/VoiceSettingsButton";
//   ...
//   <VoiceSettingsButton dsp={dsp} />
//
// Self-contained (inline styles) so it does not depend on your Tailwind/shadcn
// theme. Adjust the import paths to match where you put the files.

import { useEffect, useState } from "react";
import type { DspConfig } from "./VoiceDSP";
import type { VoiceDSP } from "./VoiceDSP";

type Preset = { key: string; label: string; patch: Partial<DspConfig> };

// Acoustic-environment presets — tuned per typical noise/echo profile.
const PRESETS: Preset[] = [
  { key: "studio", label: "Studio", patch: { aec: { on: false, mu: 0.3 }, ns: { on: true, strength: 0.4 }, agc: { on: true, target: 0.12 }, comp: { on: false, threshold: 0.3, ratio: 3, makeup: 1.2 }, vad: { on: true, sensitivity: 0.4, gate: false } } },
  { key: "bedroom", label: "Bedroom", patch: { aec: { on: true, mu: 0.25 }, ns: { on: true, strength: 0.9 }, agc: { on: true, target: 0.12 }, comp: { on: false, threshold: 0.3, ratio: 3, makeup: 1.2 }, vad: { on: true, sensitivity: 0.5, gate: false } } },
  { key: "living", label: "Living", patch: { aec: { on: true, mu: 0.3 }, ns: { on: true, strength: 1.2 }, agc: { on: true, target: 0.13 }, comp: { on: true, threshold: 0.35, ratio: 2.5, makeup: 1.1 }, vad: { on: true, sensitivity: 0.5, gate: false } } },
  { key: "office", label: "Office", patch: { aec: { on: true, mu: 0.3 }, ns: { on: true, strength: 1.4 }, agc: { on: true, target: 0.13 }, comp: { on: true, threshold: 0.3, ratio: 3, makeup: 1.2 }, vad: { on: true, sensitivity: 0.55, gate: false } } },
  { key: "open", label: "Open office", patch: { aec: { on: true, mu: 0.3 }, ns: { on: true, strength: 1.8 }, agc: { on: true, target: 0.14 }, comp: { on: true, threshold: 0.28, ratio: 3.5, makeup: 1.25 }, vad: { on: true, sensitivity: 0.65, gate: true } } },
  { key: "cafe", label: "Café", patch: { aec: { on: true, mu: 0.3 }, ns: { on: true, strength: 2.0 }, agc: { on: true, target: 0.15 }, comp: { on: true, threshold: 0.25, ratio: 4, makeup: 1.3 }, vad: { on: true, sensitivity: 0.7, gate: true } } },
  { key: "street", label: "Street", patch: { aec: { on: false, mu: 0.3 }, ns: { on: true, strength: 2.0 }, agc: { on: true, target: 0.16 }, comp: { on: true, threshold: 0.22, ratio: 5, makeup: 1.4 }, vad: { on: true, sensitivity: 0.75, gate: true } } },
  { key: "car", label: "Car", patch: { aec: { on: true, mu: 0.3 }, ns: { on: true, strength: 1.6 }, agc: { on: true, target: 0.15 }, comp: { on: true, threshold: 0.28, ratio: 3.5, makeup: 1.25 }, vad: { on: true, sensitivity: 0.6, gate: false } } },
  { key: "hall", label: "Hall", patch: { aec: { on: true, mu: 0.5 }, ns: { on: true, strength: 1.0 }, agc: { on: true, target: 0.13 }, comp: { on: false, threshold: 0.3, ratio: 3, makeup: 1.2 }, vad: { on: true, sensitivity: 0.5, gate: false } } },
  { key: "aggressive", label: "Loud room", patch: { aec: { on: true, mu: 0.3 }, ns: { on: true, strength: 2.0 }, agc: { on: true, target: 0.15 }, comp: { on: true, threshold: 0.25, ratio: 4, makeup: 1.3 }, vad: { on: true, sensitivity: 0.7, gate: true } } },
  { key: "enhanceLo", label: "Enhance Lo", patch: { aec: { on: false, mu: 0.3 }, ns: { on: true, strength: 0.8 }, agc: { on: true, target: 0.12 }, comp: { on: true, threshold: 0.4, ratio: 2, makeup: 1.1 }, vad: { on: true, sensitivity: 0.5, gate: false }, fx: { hp: true, echo: false, delay: 9600, fb: 0.3, mix: 0.4 } } },
  { key: "enhanceMid", label: "Enhance Mid", patch: { aec: { on: false, mu: 0.3 }, ns: { on: true, strength: 1.0 }, agc: { on: true, target: 0.13 }, comp: { on: true, threshold: 0.3, ratio: 3, makeup: 1.25 }, vad: { on: true, sensitivity: 0.5, gate: false }, fx: { hp: true, echo: false, delay: 9600, fb: 0.3, mix: 0.4 } } },
  { key: "enhanceHi", label: "Enhance Hi", patch: { aec: { on: false, mu: 0.3 }, ns: { on: true, strength: 1.2 }, agc: { on: true, target: 0.14 }, comp: { on: true, threshold: 0.22, ratio: 5, makeup: 1.5 }, vad: { on: true, sensitivity: 0.5, gate: false }, fx: { hp: true, echo: false, delay: 9600, fb: 0.3, mix: 0.4 } } },
  { key: "raw", label: "Raw", patch: { aec: { on: false, mu: 0.3 }, ns: { on: false, strength: 1 }, agc: { on: false, target: 0.12 }, comp: { on: false, threshold: 0.3, ratio: 3, makeup: 1.2 }, vad: { on: true, sensitivity: 0.5, gate: false } } },
];

export interface VoiceSettingsButtonProps {
  dsp: VoiceDSP;
  accent?: string;
  position?: "bottom-right" | "bottom-left";
}

export function VoiceSettingsButton({
  dsp,
  accent = "#4cc2ff",
  position = "bottom-right",
}: VoiceSettingsButtonProps) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<DspConfig>(() => dsp.getConfig());
  const [bypass, setBypass] = useState(() => dsp.getBypass());
  const [vad, setVad] = useState(false);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const off = dsp.on("status", (s) => {
      setVad(s.vad);
      setLevel(Math.min(1, s.rms * 2.8));
    });
    return off;
  }, [dsp]);

  const patch = (p: Partial<DspConfig>) => {
    dsp.setConfig(p);
    setCfg(dsp.getConfig());
  };

  const side = position === "bottom-left" ? { left: 20 } : { right: 20 };

  return (
    <div style={{ position: "fixed", bottom: 20, ...side, zIndex: 2147483000 }}>
      {open && (
        <div style={S.panel}>
          <div style={S.head}>
            <span style={{ fontWeight: 600 }}>Voice settings</span>
            <span style={{ ...S.dot, background: vad ? "#3fb950" : "#39414d" }} title="voice activity" />
            <div style={S.meter}><div style={{ ...S.meterFill, width: `${level * 100}%`, background: accent }} /></div>
            <button style={S.x} onClick={() => setOpen(false)}>✕</button>
          </div>

          <label style={S.master}>
            <span>Preprocessing</span>
            <Toggle
              checked={!bypass}
              accent="#3fb950"
              onChange={(on) => {
                setBypass(!on);
                dsp.setBypass(!on);
              }}
            />
          </label>

          <div style={{ ...S.body, opacity: bypass ? 0.45 : 1, pointerEvents: bypass ? "none" : "auto" }}>
            <Row label="Noise suppression">
              <Toggle checked={cfg.ns.on} accent={accent} onChange={(on) => patch({ ns: { ...cfg.ns, on } })} />
            </Row>
            <Slider
              label="Strength" min={0} max={2} step={0.1} value={cfg.ns.strength}
              onChange={(v) => patch({ ns: { ...cfg.ns, strength: v } })}
            />

            <Row label="Echo cancellation">
              <Toggle checked={cfg.aec.on} accent={accent} onChange={(on) => patch({ aec: { ...cfg.aec, on } })} />
            </Row>

            <Row label="Auto gain (volume)">
              <Toggle checked={cfg.agc.on} accent={accent} onChange={(on) => patch({ agc: { ...cfg.agc, on } })} />
            </Row>
            <Slider
              label="Target" min={0.03} max={0.3} step={0.01} value={cfg.agc.target}
              onChange={(v) => patch({ agc: { ...cfg.agc, target: v } })}
            />

            <Row label="Mute non-speech (VAD gate)">
              <Toggle checked={cfg.vad.gate} accent={accent} onChange={(g) => patch({ vad: { ...cfg.vad, gate: g } })} />
            </Row>

            <div style={S.presets}>
              {PRESETS.map((p) => (
                <button key={p.key} style={S.preset} onClick={() => patch(p.patch)}>{p.label}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      <button
        aria-label="Voice settings"
        style={{ ...S.fab, background: accent }}
        onClick={() => setOpen((o) => !o)}
      >
        {/* gear */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#04222f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={S.row}>
      <span>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, accent }: { checked: boolean; onChange: (v: boolean) => void; accent: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 999, border: "none", cursor: "pointer",
        background: checked ? accent : "#39414d", position: "relative", transition: "background .15s",
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: checked ? 21 : 3, width: 16, height: 16,
        borderRadius: "50%", background: "#fff", transition: "left .15s",
      }} />
    </button>
  );
}

function Slider({ label, min, max, step, value, onChange }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void;
}) {
  return (
    <label style={S.slider}>
      <span style={{ color: "#8693a5", fontSize: 12 }}>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "#4cc2ff" }}
      />
      <span style={{ width: 34, textAlign: "right", fontSize: 12, color: "#4cc2ff" }}>{value.toFixed(2)}</span>
    </label>
  );
}

const S: Record<string, React.CSSProperties> = {
  fab: {
    width: 52, height: 52, borderRadius: "50%", border: "none", cursor: "pointer",
    boxShadow: "0 6px 20px rgba(0,0,0,.35)", display: "grid", placeItems: "center",
  },
  panel: {
    width: 300, marginBottom: 12, background: "#141a23", color: "#e6edf3",
    border: "1px solid #283342", borderRadius: 14, padding: 14,
    boxShadow: "0 12px 40px rgba(0,0,0,.5)", fontFamily: "system-ui, sans-serif", fontSize: 14,
  },
  head: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  dot: { width: 10, height: 10, borderRadius: "50%" },
  meter: { flex: 1, height: 6, background: "#1b2330", borderRadius: 4, overflow: "hidden" },
  meterFill: { height: "100%", width: "0%", transition: "width .06s linear" },
  x: { background: "transparent", border: "none", color: "#8693a5", cursor: "pointer", fontSize: 14 },
  master: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 10px", background: "#1b2330", border: "1px solid #283342",
    borderRadius: 10, marginBottom: 10,
  },
  body: { display: "flex", flexDirection: "column", gap: 4, transition: "opacity .15s" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" },
  slider: { display: "flex", alignItems: "center", gap: 8, margin: "2px 0 8px" },
  presets: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 8 },
  preset: {
    padding: "7px 0", borderRadius: 8, border: "1px solid #283342",
    background: "#1b2330", color: "#e6edf3", cursor: "pointer", fontSize: 12,
  },
};

import { invoke } from "@tauri-apps/api/core";
import { arbeit, arbeitMessen } from "../../orbi/ticker";

// Messhaken (nur in der echten App und nur mit ORBIT_PERF=1, siehe src-tauri/src/perf.rs): misst die Bildabstände (requestAnimationFrame)
// je Szene und schreibt alle 3 s einen Bericht nach /tmp/orbit-perf.json. Ohne Umgebungsvariable oder ohne Tauri passiert nichts.

const grenze = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0; };

export function starteMessung(): () => void {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return () => {};
  let weg = false, stop = () => {};
  invoke<boolean>("perf_enabled").then((an) => {
    if (!an || weg) return;
    arbeitMessen(true);
    const phasen: Record<string, number[]> = {};
    let letzt = 0, raf = 0, gesendet = 0;
    const label = () => {
      const s = document.querySelector<HTMLElement>("[data-schritt]")?.dataset.schritt ?? "?";
      if (document.querySelector('[data-morph="an"]')) return "orbi-formwechsel";
      return `${s}:${document.querySelector<HTMLElement>("[data-buehne]")?.dataset.buehne ?? "-"}`;
    };
    const bericht = () => {
      const out: Record<string, unknown> = { dpr: window.devicePixelRatio, innen: [window.innerWidth, window.innerHeight], zeit: new Date().toISOString(), phasen: {} };
      for (const [k, a] of Object.entries(phasen)) {
        if (a.length < 5) continue;
        const mean = a.reduce((p, c) => p + c, 0) / a.length;
        (out.phasen as Record<string, unknown>)[k] = {
          frames: a.length, mittel_ms: +mean.toFixed(2), median_ms: +grenze(a, 0.5).toFixed(2), p95_ms: +grenze(a, 0.95).toFixed(2), max_ms: +Math.max(...a).toFixed(1),
          ueber_16_7: +(a.filter((v) => v > 16.7 + 1).length / a.length).toFixed(3), ueber_8_3: +(a.filter((v) => v > 8.3 + 1).length / a.length).toFixed(3), ueber_25: a.filter((v) => v > 25).length,
        };
      }
      if (arbeit.length > 5) out.arbeit_je_bild = { n: arbeit.length, mittel_ms: +(arbeit.reduce((p, c) => p + c, 0) / arbeit.length).toFixed(2), p95_ms: +grenze(arbeit, 0.95).toFixed(2), max_ms: +Math.max(...arbeit).toFixed(1), ueber_8_3: +(arbeit.filter((v) => v > 8.3).length / arbeit.length).toFixed(3) };
      return JSON.stringify(out);
    };
    const f = (t: number) => {
      if (letzt) {
        const d = t - letzt;
        if (d < 1000) { const k = label(); (phasen[k] ??= []).push(d); if (phasen[k].length > 40000) phasen[k].shift(); }
      }
      letzt = t;
      if (t - gesendet > 3000) { gesendet = t; void invoke("perf_log", { json: bericht() }).catch(() => {}); }
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    stop = () => cancelAnimationFrame(raf);
  }).catch(() => {});
  return () => { weg = true; stop(); };
}

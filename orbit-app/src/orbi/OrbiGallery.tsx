import { useState } from "react";
import { Orbi, type OrbiState } from "./index";
import { AVATAR_NAMES } from "./shapes";

const STATES: OrbiState[] = ["normal", "lebendig", "blick", "schlaeft"];

/** Zeigt alle 25 Avatare, alle Zustände, Größen, Farbe und Look in Hell und Dunkel. Nur für Entwicklung. */
export function OrbiGallery() {
  const [dark, setDark] = useState(false);
  const [color, setColor] = useState("#ef4444");
  const bg = dark ? "#121212" : "#ffffff", fg = dark ? "#f2f2f2" : "#1b1d2a";
  const h = { fontSize: 13, fontWeight: 600, margin: "20px 0 8px" } as const;
  const row = { display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" } as const;
  const cell = { display: "grid", gap: 4, justifyItems: "center", fontSize: 11 } as const;
  return (
    <div style={{ background: bg, color: fg, padding: 24, font: "13px system-ui", minHeight: "100vh" }}>
      <label><input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dunkel</label>{" "}
      <label>Farbe <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>

      <h2 style={h}>Alle 25 Avatare (lebendig, 64 px)</h2>
      <div style={row}>
        {AVATAR_NAMES.map((n) => (
          <div key={n} style={cell}><Orbi avatar={n} size={64} state="lebendig" dark={dark} /><span>{n}</span></div>
        ))}
      </div>

      <h2 style={h}>Zustände (alle Formen)</h2>
      {STATES.map((s) => (
        <div key={s} style={{ ...row, marginBottom: 12 }}>
          <strong style={{ width: 70 }}>{s}</strong>
          {AVATAR_NAMES.slice(10).map((n) => <Orbi key={n} avatar={n} size={48} state={s} dark={dark} />)}
        </div>
      ))}

      <h2 style={h}>Größen 24 bis 120</h2>
      <div style={row}>
        {[24, 32, 48, 64, 96, 120].map((s) => <div key={s} style={cell}><Orbi avatar="citrus" size={s} state="lebendig" dark={dark} /><span>{s}</span></div>)}
      </div>

      <h2 style={h}>Eigene Farbe ({color}) und Standard</h2>
      <div style={row}>
        {["strobi", "kirby", "mopsi", "trixi", "cloudee"].map((n) => (
          <div key={n} style={{ ...row, gap: 4 }}><Orbi avatar={n} size={56} dark={dark} /><Orbi avatar={n} size={56} dark={dark} color={color} /></div>
        ))}
      </div>

      <h2 style={h}>Seitenleiste (10 Figuren, folgen dem Zeiger) und Panel-Orbi</h2>
      <div style={row}>
        {AVATAR_NAMES.slice(0, 10).map((n) => <Orbi key={n} avatar={n} size={32} state="lebendig" follow dark={dark} />)}
        <Orbi avatar="strobi" size={80} dark={dark} panel follow />
      </div>
    </div>
  );
}

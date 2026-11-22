import { useEffect, useId, useState } from "react";
import { eyeColor, gestalt, mische, mischeHex, punkteZuPfad, MORPH_SKALA, type Gestalt } from "../../orbi";
import { subscribe } from "../../orbi/ticker";
import { farbHex, type FarbName } from "./dunkel";

/** Gezeichnete Zwischenform zweier Figuren (Umriss gemischt, Farbe und Beiwerk überblendet). e = 0 … 1. */
export function FormSvg({ von, nach, e, hexVon, hexNach, dunkel, seite }: {
  von: Gestalt; nach: Gestalt; e: number; hexVon: string; hexNach: string; dunkel: boolean; seite: number;
}) {
  const id = useId().replace(/:/g, "");
  const d = punkteZuPfad(mische(von.pts, nach.pts, e));
  const farbe = mischeHex(hexVon, hexNach, e);
  const aug = eyeColor(farbe, dunkel);
  const teile = (x: string[], o: number, k: string) => x.map((p, i) => <path key={`${k}${i}`} d={p} opacity={o} />);
  return (
    <svg width={seite} height={seite} viewBox="10 10 80 80" aria-hidden="true" style={{ overflow: "visible", display: "block" }}>
      <defs><clipPath id={`fs-${id}`}><path d={d} /></clipPath></defs>
      <g transform={`translate(50 50) scale(${MORPH_SKALA})`} fill={farbe}>
        {teile(von.extras.back, 1 - e, "vb")}{teile(nach.extras.back, e, "nb")}
        <path d={d} />
        <g clipPath={`url(#fs-${id})`} fill={aug}>{teile(von.extras.eyes, 1 - e, "ve")}{teile(nach.extras.eyes, e, "ne")}</g>
        {teile(von.extras.front, 1 - e, "vf")}{teile(nach.extras.front, e, "nf")}
      </g>
    </svg>
  );
}

export const KETTE: [string, FarbName][] = [["strobi", "pink"], ["citrus", "gelborange"], ["nova", "tuerkis"], ["trixi", "violett"], ["mopsi", "blau"], ["freddy", "orange"]];
const dauer = { punkt: 0.55, wachsen: 0.7, segment: 0.3, ende: 0.25 };
export const ERSTER_SPLIT = dauer.punkt + dauer.wachsen * 0.35 + (KETTE.length - 1) * dauer.segment + 0.1; // Sekunden bis zum Aufteilen

/** Eröffnung: ein Lichtpunkt wächst zu einem Orbi, der durch mehrere Formen und Farben fließt, bevor er sich in die Schar teilt. */
export function Eroeffnung({ dunkel, onFertig }: { dunkel: boolean; onFertig: () => void }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let t0 = 0;
    const un = subscribe((jetzt) => {
      if (!t0) t0 = jetzt;
      const u = jetzt - t0;
      setT(u);
      if (u > ERSTER_SPLIT + dauer.ende) { un(); onFertig(); }
    }, { maxFps: 60 });
    return un;
  }, [onFertig]);

  const ausl = (u: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 4); // ease-out (Expo-nah, gleiche Familie wie die Federn)
  const tw = t - dauer.punkt * 0.5;
  const wachs = ausl(tw / dauer.wachsen);
  const kt = Math.max(0, t - (dauer.punkt + dauer.wachsen * 0.35)) / dauer.segment;
  const seg = Math.min(KETTE.length - 2, Math.floor(kt));
  const e = ausl(Math.min(1, kt - seg));
  const gesamt = KETTE.length - 1;
  const fertig = Math.min(1, kt / gesamt);
  const a = KETTE[seg], b = KETTE[Math.min(KETTE.length - 1, seg + 1)];
  const gA = gestalt(a[0]), gB = gestalt(b[0]);
  const hexA = farbHex(a[1], dunkel), hexB = farbHex(b[1], dunkel);
  const aus = ausl((t - ERSTER_SPLIT) / dauer.ende);
  const licht = Math.min(1, t / dauer.punkt) * (1 - wachs * 0.6) * (1 - aus);
  const lichtFarbe = mischeHex(hexA, hexB, e);
  const groesse = 190;
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: 720 - 150, top: 450 - 150, width: 300, height: 300, pointerEvents: "none", opacity: 1 - aus * 0, zIndex: 3 }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", opacity: licht, transform: `scale(${0.08 + wachs * 1.1})`,
        background: `radial-gradient(closest-side, ${dunkel ? "rgba(255,255,255,0.95)" : lichtFarbe} 0%, ${lichtFarbe}66 28%, transparent 100%)` }} />
      {gA && gB && wachs > 0.02 ? (
        <div style={{ position: "absolute", left: 150 - groesse / 2, top: 150 - groesse / 2, opacity: (1 - aus) * Math.min(1, wachs * 1.6), transform: `scale(${(0.1 + 0.9 * wachs) * (1 + 0.08 * aus)})` }}>
          <FormSvg von={gA} nach={gB} e={fertig >= 1 ? 1 : e} hexVon={hexA} hexNach={hexB} dunkel={dunkel} seite={groesse} />
        </div>
      ) : null}
    </div>
  );
}

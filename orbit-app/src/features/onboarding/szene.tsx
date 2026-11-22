import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FarbName } from "./dunkel";

// Bühne für Willkommen (0 A/B) und Start (1): die 15 Orbis. Maße aus Figma 04 (53:104255, 53:104403, 53:104551),
// Mitte der 1440×900-Fläche = Mitte des Fensters. Orbis schauen zur Mitte (Orbi „blick“: schwebt und blinzelt).

export type Szene = "mitte" | "ring" | "start" | "zusammen";

interface Platz { avatar: string; farbe: FarbName; groesse: number; ring: [number, number]; start: [number, number] }

export const PLAETZE: Platz[] = [
  { avatar: "strobi", farbe: "pink", groesse: 64, ring: [747, 192], start: [788, 93] },
  { avatar: "freddy", farbe: "blau", groesse: 80, ring: [866, 220], start: [996, 139] },
  { avatar: "citrus", farbe: "gruen", groesse: 56, ring: [973, 301], start: [1169, 253] },
  { avatar: "nova", farbe: "orange", groesse: 88, ring: [1003, 375], start: [1231, 371] },
  { avatar: "grokbot", farbe: "violett", groesse: 64, ring: [1005, 483], start: [1225, 524] },
  { avatar: "sunee", farbe: "himmel", groesse: 72, ring: [936, 563], start: [1111, 644] },
  { avatar: "kirby", farbe: "gelborange", groesse: 56, ring: [835, 629], start: [935, 738] },
  { avatar: "cloudee", farbe: "tuerkis", groesse: 80, ring: [690, 640], start: [696, 760] },
  { avatar: "cubee", farbe: "rot", groesse: 64, ring: [563, 631], start: [475, 743] },
  { avatar: "onee", farbe: "limette", groesse: 88, ring: [437, 565], start: [271, 651] },
  { avatar: "rauti", farbe: "indigo", groesse: 56, ring: [381, 499], start: [165, 547] },
  { avatar: "trixi", farbe: "fuchsia", groesse: 72, ring: [355, 397], start: [126, 398] },
  { avatar: "tropi", farbe: "braun", groesse: 64, ring: [397, 309], start: [195, 267] },
  { avatar: "mopsi", farbe: "grau", groesse: 80, ring: [478, 228], start: [338, 151] },
  { avatar: "dosi", farbe: "blau", groesse: 60, ring: [612, 197], start: [557, 100] },
];

export const BREITE = 1440;
export const HOEHE = 900;
function useSkala(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [s, setS] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const neu = () => setS(Math.min(1, el.clientWidth / BREITE, el.clientHeight / HOEHE) || 1);
    neu();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(neu);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, s];
}

/** Fläche 1440×900 (bei kleinerem Fenster verkleinert), Mitte = Fenstermitte. Kinder stehen in Figma-Koordinaten. */
export function Flaeche({ children, className }: { children: ReactNode; className?: string }) {
  const [ref, s] = useSkala();
  return (
    <div ref={ref} className={`absolute inset-0 overflow-hidden ${className ?? ""}`}>
      <div className="absolute left-1/2 top-1/2" style={{ width: BREITE, height: HOEHE, marginLeft: -BREITE / 2, marginTop: -HOEHE / 2, transform: `scale(${s})` }}>
        {children}
      </div>
    </div>
  );
}

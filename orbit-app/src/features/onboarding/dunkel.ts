import { useEffect, useState } from "react";

// Gemeinsame Helfer für Erststart und Einstellungen: Hell/Dunkel, reduzierte Bewegung, Orbi-Farben.

const DUNKEL = "(prefers-color-scheme: dark)";
const WENIG = "(prefers-reduced-motion: reduce)";

function istDunkel(): boolean {
  if (typeof document === "undefined") return false;
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return typeof matchMedia === "function" && matchMedia(DUNKEL).matches;
}

/** Dunkel, wenn data-theme="dark" gesetzt ist, sonst nach dem System (prefers-color-scheme). */
export function useDunkel(): boolean {
  const [dunkel, setDunkel] = useState(istDunkel);
  useEffect(() => {
    const neu = () => setDunkel(istDunkel());
    neu();
    const mo = new MutationObserver(neu);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = typeof matchMedia === "function" ? matchMedia(DUNKEL) : null;
    mq?.addEventListener?.("change", neu);
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.("change", neu);
    };
  }, []);
  return dunkel;
}

/** Bewegung reduzieren (Systemeinstellung). */
export function useWenigBewegung(): boolean {
  const [wenig, setWenig] = useState(() => typeof matchMedia === "function" && matchMedia(WENIG).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(WENIG);
    const neu = () => setWenig(mq.matches);
    neu();
    mq.addEventListener?.("change", neu);
    return () => mq.removeEventListener?.("change", neu);
  }, []);
  return wenig;
}

export type FarbName =
  | "rot" | "orange" | "gelborange" | "limette" | "gruen" | "tuerkis" | "himmel"
  | "blau" | "indigo" | "violett" | "fuchsia" | "pink" | "braun" | "grau";

/** Die 14 Orbi-Farben im Farbkreis (D54) mit Hell- und Dunkelwert (tokens.css, --orbit-orbi-*). */
export const FARBEN: { name: FarbName; text: string; hell: string; dunkel: string }[] = [
  { name: "rot", text: "Red", hell: "#d93a3d", dunkel: "#e84447" },
  { name: "orange", text: "Orange", hell: "#df6521", dunkel: "#e87031" },
  { name: "gelborange", text: "Amber", hell: "#cf811e", dunkel: "#e9993a" },
  { name: "limette", text: "Lime", hell: "#8fb82f", dunkel: "#a5d046" },
  { name: "gruen", text: "Green", hell: "#43a561", dunkel: "#5ac078" },
  { name: "tuerkis", text: "Teal", hell: "#43a191", dunkel: "#55b5a4" },
  { name: "himmel", text: "Sky", hell: "#199ecd", dunkel: "#32b3e6" },
  { name: "blau", text: "Blue", hell: "#3378ec", dunkel: "#3e82f4" },
  { name: "indigo", text: "Indigo", hell: "#4f5ae0", dunkel: "#626df5" },
  { name: "violett", text: "Violet", hell: "#8152eb", dunkel: "#895df3" },
  { name: "fuchsia", text: "Fuchsia", hell: "#b53acb", dunkel: "#c849e4" },
  { name: "pink", text: "Pink", hell: "#de3a8e", dunkel: "#e74897" },
  { name: "braun", text: "Brown", hell: "#8a6038", dunkel: "#996e42" },
  { name: "grau", text: "Grey", hell: "#6b7483", dunkel: "#7d8797" },
];

export const farbHex = (name: FarbName, dunkel: boolean): string => {
  const f = FARBEN.find((x) => x.name === name) ?? FARBEN[11];
  return dunkel ? f.dunkel : f.hell;
};

/** Hex (Hell oder Dunkel) zurück auf den Farbnamen; unbekannt = null. */
export const farbName = (hex: string | null | undefined): FarbName | null => {
  const h = (hex ?? "").toLowerCase();
  return FARBEN.find((f) => f.hell === h || f.dunkel === h)?.name ?? null;
};

/** Formen des Erststarts (Schritt 8, Figma „Formen“): 14, ohne Dosi. Figma „Grok“ heißt im Dienst „grokbot“. */
export const FORMEN: { figma: string; avatar: string }[] = [
  ["Strobi", "strobi"], ["Freddy", "freddy"], ["Citrus", "citrus"], ["Nova", "nova"], ["Grok", "grokbot"],
  ["Sunee", "sunee"], ["Kirby", "kirby"], ["Cloudee", "cloudee"], ["Cubee", "cubee"], ["Onee", "onee"],
  ["Rauti", "rauti"], ["Trixi", "trixi"], ["Tropi", "tropi"], ["Mopsi", "mopsi"],
].map(([figma, avatar]) => ({ figma, avatar }));

/** Text eines abgelehnten Aufrufs (die Hülle wirft den deutschen Fehlertext des Dienstes als String). */
export function fehlerText(e: unknown): string {
  if (typeof e === "string" && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return e.message;
  if (e && typeof e === "object" && "error" in e && typeof (e as { error: unknown }).error === "string") return (e as { error: string }).error;
  return "That did not work. Try again in a moment.";
}

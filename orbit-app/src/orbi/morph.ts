// Formwechsel (Morph) zwischen zwei Figuren: die Umrisse der Engine (Kopfpfad im Ruhebild) werden auf gleich viele Punkte
// umgerechnet und punktweise gemischt. Nur im Browser (braucht SVG-Pfadmessung); ohne Messung gibt umriss() null zurück.
import { neutralExpression, renderGeometry } from "./geometry";
import { shapeOf, type Shape } from "./shapes";

export type Pt = [number, number];
export const MORPH_PUNKTE = 96;
/** Engine-Einheiten -> 100er-Sicht (gleich wie in Orbi.tsx). */
export const MORPH_SKALA = 68 / 240;

export interface Extras { back: string[]; front: string[]; eyes: string[] }
export interface Gestalt { pts: Pt[]; extras: Extras }

const cache = new Map<Shape, Gestalt | null>();

function ruhebild(shape: Shape) {
  return renderGeometry(shape, neutralExpression(shape), 1, 0, 0, true);
}

function messen(d: string): Pt[] | null {
  if (typeof document === "undefined") return null;
  const teile = d.split(/(?=M)/).filter((t) => t.trim().length > 1).sort((a, b) => b.length - a.length);
  if (!teile.length) return null;
  const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
  el.setAttribute("d", teile[0]);
  if (typeof el.getTotalLength !== "function") return null;
  let len = 0;
  try { len = el.getTotalLength(); } catch { return null; }
  if (!(len > 0)) return null;
  let pts: Pt[] = [];
  for (let i = 0; i < MORPH_PUNKTE; i++) { const p = el.getPointAtLength((len * i) / MORPH_PUNKTE); pts.push([p.x, p.y]); }
  // Richtung vereinheitlichen (Uhrzeigersinn) und am höchsten Punkt beginnen: so passen die Punkte zweier Figuren zusammen.
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length]; a += pts[i][0] * q[1] - q[0] * pts[i][1]; }
  if (a < 0) pts = pts.reverse();
  let top = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[top][1]) top = i;
  return [...pts.slice(top), ...pts.slice(0, top)];
}

/** Umriss und Beiwerk (Hinter-/Vorderteile, Augen) einer Figur im Ruhebild; null, wenn nicht messbar. */
export function gestalt(avatar: string): Gestalt | null {
  const shape = shapeOf(avatar);
  if (cache.has(shape)) return cache.get(shape)!;
  const g = ruhebild(shape);
  const pts = messen(g.head);
  const r: Gestalt | null = pts ? { pts, extras: { back: g.back, front: g.front, eyes: [g.leftVisible ? g.left : "", g.rightVisible ? g.right : ""].filter(Boolean) } } : null;
  cache.set(shape, r);
  return r;
}

export function mische(a: Pt[], b: Pt[], e: number): Pt[] {
  return a.map((p, i) => [p[0] + (b[i][0] - p[0]) * e, p[1] + (b[i][1] - p[1]) * e] as Pt);
}

export function punkteZuPfad(pts: Pt[]): string {
  return "M" + pts.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join("L") + "Z";
}

export function mischeHex(a: string, b: string, e: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * e);
  return "#" + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("");
}

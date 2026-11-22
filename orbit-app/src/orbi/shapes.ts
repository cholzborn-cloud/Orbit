// Die 25 Avatar-Namen des Dienstes und ihre 15 Formen (wie OrbiShape in mac/Orbit/Figures/OrbiLook.swift).
export const SHAPES = [
  "strobi", "freddy", "citrus", "nova", "grokbot", "sunee", "kirby", "cloudee",
  "cubee", "onee", "rauti", "trixi", "tropi", "mopsi", "dosi",
] as const;
export type Shape = (typeof SHAPES)[number];

/** Alte Planetennamen laufen über ihre neue Form. */
const LEGACY: Record<string, Shape> = {
  erdi: "strobi", marsi: "cubee", sati: "onee", jupi: "citrus", mondi: "freddy",
  veni: "kirby", nepi: "trixi", urani: "rauti", pluti: "nova", universi: "sunee",
};

/** Alle 25 gültigen Namen im Dienst (bots.avatar). */
export const AVATAR_NAMES = [...Object.keys(LEGACY), ...SHAPES] as const;
export type AvatarName = (typeof AVATAR_NAMES)[number];

export function shapeOf(avatar: string): Shape {
  const name = avatar.toLowerCase();
  if ((SHAPES as readonly string[]).includes(name)) return name as Shape;
  if (LEGACY[name]) return LEGACY[name];
  let hash = 0;
  for (const ch of avatar) hash = (Math.imul(hash, 31) + (ch.codePointAt(0) ?? 0)) >>> 0;
  return SHAPES[hash % SHAPES.length];
}

/** Grundfarbe je Form: hell (Theme.OrbiColor.lightHex) und dunkel (DARK_PALETTE im früheren Rust-Prototyp). */
export const BASE_COLORS: Record<Shape, { light: string; dark: string }> = {
  strobi: { light: "#3378ec", dark: "#3e82f4" },
  freddy: { light: "#906538", dark: "#996e42" },
  citrus: { light: "#cf811e", dark: "#e9993a" },
  nova: { light: "#43a191", dark: "#55b5a4" },
  grokbot: { light: "#6b7585", dark: "#7d8797" },
  sunee: { light: "#9bc636", dark: "#a5d046" },
  kirby: { light: "#de3a8e", dark: "#e74897" },
  cloudee: { light: "#ffffff", dark: "#ffffff" },
  cubee: { light: "#df363c", dark: "#e84447" },
  onee: { light: "#199ecd", dark: "#32b3e6" },
  rauti: { light: "#5a62ed", dark: "#626df5" },
  trixi: { light: "#8152eb", dark: "#895df3" },
  tropi: { light: "#43a561", dark: "#5ac078" },
  mopsi: { light: "#bf3bdb", dark: "#c849e4" },
  dosi: { light: "#df6521", dark: "#e87031" },
};

export const EYE_LIGHT = "#ffffff";
export const EYE_DARK = "#0f172a";
export const INK = "#1b1d2a";
export const GEAR = "#2a2d3e";
export const CHEEK = "#ff808f";

export function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function luminance(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  return (mx + mn) / 2; // HSL-Helligkeit
}

import { AVATARS } from "./avatars.gen";
import { engineFast, engineFine } from "./engine.gen";
import type { Engine } from "./engineTypes";
import { type Shape } from "./shapes";

const FIELDS = [
  "headX", "headY", "headZ", "widthLeft", "widthRight", "heightLeft", "heightRight", "spacing",
  "positionXLeft", "positionXRight", "positionYLeft", "positionYRight", "leftAngle", "rightAngle", "perspective",
] as const;

export interface Box { x0: number; y0: number; x1: number; y1: number }

export interface Geometry {
  back: string[];
  head: string;
  left: string;
  right: string;
  front: string[];
  leftVisible: boolean;
  rightVisible: boolean;
  leftBox: Box | null;
  rightBox: Box | null;
  bounds: Box | null;
}

const empty = (): Box => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
function add(b: Box, x: number, y: number) {
  if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x;
  if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
}

/** Umgrenzung eines Engine-Pfads (absolute M/L/C/A/Z; die Bögen der Engine sind halbe Ellipsen). */
export function pathBox(path: string, into: Box = empty()): Box | null {
  const t = path.match(/[A-Za-z]|-?\d*\.?\d+(?:e[+-]?\d+)?/gi) ?? [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0;
  const n = () => Number(t[i++]);
  while (i < t.length) {
    const op = t[i++];
    if (op === "M") { cx = n(); cy = n(); sx = cx; sy = cy; add(into, cx, cy); }
    else if (op === "L") { cx = n(); cy = n(); add(into, cx, cy); }
    else if (op === "C") {
      const x1 = n(), y1 = n(), x2 = n(), y2 = n(), x = n(), y = n();
      for (let k = 1; k <= 4; k++) {
        const u = k / 4, q = 1 - u;
        add(into, q ** 3 * cx + 3 * q * q * u * x1 + 3 * q * u * u * x2 + u ** 3 * x,
          q ** 3 * cy + 3 * q * q * u * y1 + 3 * q * u * u * y2 + u ** 3 * y);
      }
      cx = x; cy = y;
    } else if (op === "A") {
      const rx = n(), ry = n(), rot = (n() * Math.PI) / 180;
      n(); n();
      const x = n(), y = n();
      const mx = (cx + x) / 2, my = (cy + y) / 2;
      const hx = Math.hypot(rx * Math.cos(rot), ry * Math.sin(rot));
      const hy = Math.hypot(rx * Math.sin(rot), ry * Math.cos(rot));
      add(into, mx - hx, my - hy); add(into, mx + hx, my + hy);
      cx = x; cy = y;
    } else if (op === "Z" || op === "z") { cx = sx; cy = sy; }
  }
  return Number.isFinite(into.x0) ? into : null;
}

const CACHE = new Map<string, Geometry>();
const CACHE_MAX = 3000;

/** Rechnet einen Ausdruck (15 Zahlen) mit der Lab-Engine in Umrisse um. `fast` = halbe Stützpunkte (Figuren bis ca. 100 px). */
export function renderGeometry(shape: Shape, expr: number[], blink: number, eyeX: number, eyeY: number, fast: boolean): Geometry {
  const key = `${fast ? 1 : 0}|${shape}|${expr.map((v, i) => Math.round(v * (i === 14 ? 1000 : 8))).join(",")}|${Math.round(blink * 20)}|${Math.round(eyeX * 4)},${Math.round(eyeY * 4)}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const def = AVATARS[shape] ?? AVATARS.strobi;
  const engine: Engine = fast ? engineFast : engineFine;
  const values: Record<string, unknown> = { id: "x", eyeMotion: "none", bodyMotion: "none" };
  FIELDS.forEach((f, i) => { values[f] = expr[i]; });
  const r = engine.renderAvatar(engine.poseFromExpression(values), def.surface, blink, {
    includeWire: false, bodyNodes: def.bodyNodes, eyeOffset: { x: eyeX, y: eyeY },
  });
  const back = (r.backPaths ?? []).filter(Boolean), front = (r.frontPaths ?? []).filter(Boolean);
  const bounds = empty();
  for (const p of [...back, r.headPath, ...front]) if (p) pathBox(p, bounds);
  const g: Geometry = {
    back, head: r.headPath ?? "", left: r.leftPath ?? "", right: r.rightPath ?? "", front,
    leftVisible: r.leftVisible, rightVisible: r.rightVisible,
    leftBox: r.leftPath ? pathBox(r.leftPath) : null, rightBox: r.rightPath ? pathBox(r.rightPath) : null,
    bounds: Number.isFinite(bounds.x0) ? bounds : null,
  };
  if (CACHE.size > CACHE_MAX) CACHE.clear();
  CACHE.set(key, g);
  return g;
}

export function neutralExpression(shape: Shape): number[] {
  return [...(AVATARS[shape] ?? AVATARS.strobi).neutral];
}

// Verhalten der Figur (Port der Moods aus mac/Orbit/Figures/OrbiBehavior.swift): Blick, Blinzeln, Schweben, Schlafen, Zeigerfolgen.
// Reine Rechnung ohne Zeichnen; liefert pro Bild eine Pose.

export type OrbiState = "normal" | "lebendig" | "schlaeft" | "blick";

export interface Pose {
  lx: number; ly: number;      // Blick -1..1 (y nach unten)
  tilt: number;                // Neigung in Grad
  blink: number;               // 0 offen .. 1 zu
  x: number; y: number;        // Verschiebung im 100er-Maß des Artifacts
  sx: number; sy: number;      // Stauchung
  pitch: number;               // Kopf nach unten (Grad, Engine headX)
  sleep: number;               // 0..1, Schlafzeichen sichtbar
}

export const STILL: Pose = { lx: 0, ly: 0, tilt: 0, blink: 0, x: 0, y: 0, sx: 1, sy: 1, pitch: 0, sleep: 0 };
export const SLEEP_PERIOD = 3.6;

const GAZE_DURATION: [number, number] = [0.7, 0.9];
const GAZE_INTERVAL: [number, number] = [1.2, 2.5];
const BLINK_INTERVAL: [number, number] = [2.5, 4];
const BLINK_LENGTH = 0.17;

/** Gedämpfte Feder in kleinen Schritten (wie OrbiBehavior.spring). */
function spring(s: { v: number; vel: number }, target: number, dt: number, response: number, damping: number) {
  const omega = (2 * Math.PI) / response;
  let rest = dt;
  while (rest > 1e-9) {
    const h = Math.min(rest, 1 / 240);
    s.vel += (omega * omega * (target - s.v) - 2 * damping * omega * s.vel) * h;
    s.v += s.vel * h;
    rest -= h;
  }
}

export class Behavior {
  pose: Pose = { ...STILL };
  /** Nichts bewegt sich: der Zeitgeber darf diese Figur auslassen, bis `untilNext` verstrichen ist. */
  settled = false;
  untilNext = 0.5;

  private last = 0;
  private started = false;
  private t0 = 0;
  private nextGaze = 0;
  private gazeFrom = { lx: 0, tilt: 0 };
  private gazeTo = { lx: 0, tilt: 0 };
  private gazeStart = 0;
  private gazeDuration = 0.8;
  private prevSide = 1;
  private nextBlink = 0;
  private blinkStart = -1;
  private sx = { v: 0, vel: 0 };
  private sy = { v: 0, vel: 0 };
  private stretchX = 1;
  private stretchY = 1;

  constructor(
    public state: OrbiState,
    private random: () => number = Math.random,
    private reaction = 0.11,
  ) {}

  private rnd(r: [number, number]) { return r[0] + this.random() * (r[1] - r[0]); }

  setState(state: OrbiState) {
    if (state === this.state) return;
    this.state = state;
    this.started = false;
    this.settled = false;
    this.blinkStart = -1;
  }

  setReaction(reaction: number) { this.reaction = reaction; }

  /** Ruhebild ohne Bewegung (reduzierte Bewegung). Schlafen behält geschlossene Augen. */
  still(): Pose {
    return this.state === "schlaeft" ? sleeping(0) : { ...STILL };
  }

  /** Ein Bild. `mouse` = Zeigerrichtung (-1..1) nur wenn gefolgt wird, sonst null. */
  step(now: number, mouse: { x: number; y: number } | null): Pose {
    const dt = this.started ? Math.min(0.05, Math.max(0.001, now - this.last)) : 0.016;
    this.last = now;
    if (!this.started) {
      this.started = true;
      this.t0 = now;
      this.nextBlink = now + this.rnd(BLINK_INTERVAL);
      this.nextGaze = now;
      this.gazeStart = now;
      this.gazeDuration = 0;
      this.sx = { v: this.pose.lx, vel: 0 };
      this.sy = { v: this.pose.ly, vel: 0 };
    }
    const t = now - this.t0;
    const p = this.pose;

    if (this.state === "schlaeft") {
      this.pose = sleeping(t);
      this.settled = false;
      this.untilNext = 0.05;
      return this.pose;
    }

    let tx = 0, ty = 0, ttilt = 0;
    let floaty = 0;
    if (mouse) {
      tx = mouse.x; ty = mouse.y; ttilt = mouse.x * 5;
      this.stretchX += ((1 + 0.06 * Math.abs(mouse.x) - 0.03 * Math.abs(mouse.y)) - this.stretchX) * (1 - Math.exp(-30 * dt));
      this.stretchY += ((1 + 0.06 * Math.abs(mouse.y) - 0.03 * Math.abs(mouse.x)) - this.stretchY) * (1 - Math.exp(-30 * dt));
      const response = this.reaction * (0.15 / 0.11);
      spring(this.sx, tx, dt, response, 0.75);
      spring(this.sy, ty, dt, response, 0.75);
      p.lx = this.sx.v; p.ly = this.sy.v; p.tilt += (ttilt - p.tilt) * (1 - Math.exp(-14 * dt));
      p.sx = this.stretchX; p.sy = this.stretchY;
      this.nextGaze = now; this.gazeDuration = 0;
    } else {
      this.stretchX += (1 - this.stretchX) * (1 - Math.exp(-8 * dt));
      this.stretchY += (1 - this.stretchY) * (1 - Math.exp(-8 * dt));
      p.sx = this.stretchX; p.sy = this.stretchY;
      if (this.state === "lebendig") {
        // Blick wandert links/rechts, wie "selected" in OrbiBehavior.
        if (this.gazeDuration === 0 || now >= this.nextGaze) {
          const side = -this.prevSide; this.prevSide = side;
          const x = (0.2 + this.random() * 0.15) * side;
          this.gazeFrom = { lx: p.lx, tilt: p.tilt };
          this.gazeTo = { lx: x, tilt: x * 3 };
          this.gazeStart = now;
          this.gazeDuration = this.rnd(GAZE_DURATION);
          this.nextGaze = now + this.rnd(GAZE_INTERVAL);
        }
        const u = Math.min(1, Math.max(0, (now - this.gazeStart) / this.gazeDuration));
        const e = u * u * (3 - 2 * u);
        p.lx = this.gazeFrom.lx + (this.gazeTo.lx - this.gazeFrom.lx) * e;
        p.tilt = this.gazeFrom.tilt + (this.gazeTo.tilt - this.gazeFrom.tilt) * e;
        p.ly += (0 - p.ly) * (1 - Math.exp(-10 * dt));
      } else {
        // normal und blick: Blick zur Mitte (zurück per Ease, nicht abrupt).
        const k = 1 - Math.exp(-dt / 0.35);
        p.lx += (0 - p.lx) * k; p.ly += (0 - p.ly) * k; p.tilt += (0 - p.tilt) * k;
        this.sx = { v: p.lx, vel: 0 }; this.sy = { v: p.ly, vel: 0 };
        if (this.state === "blick") floaty = Math.sin((t * 2 * Math.PI) / 3.2);
      }
    }
    p.y = this.state === "blick" ? floaty * 1.6 : p.y * Math.exp(-8 * dt);

    // Blinzeln: lebendig und blick (normal bleibt offen).
    if (this.state !== "normal") {
      if (now >= this.nextBlink) { this.blinkStart = now; this.nextBlink = now + this.rnd(BLINK_INTERVAL); }
      const bt = now - this.blinkStart;
      p.blink = this.blinkStart >= 0 && bt < BLINK_LENGTH ? Math.sin((bt / BLINK_LENGTH) * Math.PI) : 0;
    } else p.blink = 0;
    p.pitch = 0; p.sleep = 0;

    const moving = this.state === "lebendig" || this.state === "blick" || !!mouse
      || Math.abs(p.lx) + Math.abs(p.ly) + Math.abs(p.tilt) > 0.002 || Math.abs(p.sx - 1) > 0.001;
    this.settled = !moving;
    this.untilNext = this.state === "normal" ? 0.5 : 0.03;
    this.pose = p;
    return p;
  }
}

/** Schlafpose: Augen zu, Kopf nach unten, gestaucht, atmet langsam. */
export function sleeping(t: number): Pose {
  const breath = Math.sin((t * 2 * Math.PI) / SLEEP_PERIOD);
  return { lx: 0, ly: 0.5, tilt: 4, blink: 1, x: 0, y: 1.2 + breath * 0.9, sx: 1.04 - breath * 0.006, sy: 0.9 + breath * 0.012, pitch: 10, sleep: 1 };
}

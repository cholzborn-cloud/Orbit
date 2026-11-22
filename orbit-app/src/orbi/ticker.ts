// Ein gemeinsamer Zeitgeber für alle Figuren: ein requestAnimationFrame mit der Bildrate der Anzeige (kein 30-fps-Deckel mehr),
// steht still ohne Figuren, bei verstecktem Fenster. Sichtbarkeit und reduzierte Bewegung regelt jede Figur selbst (An-/Abmelden).

/** Pose der Figuren (Blick, Blinzeln) wird höchstens so oft neu gezeichnet; Bewegung der Bühne läuft mit voller Bildrate. */
export const POSE_FPS = 60;
type Listener = (now: number) => void;
interface Eintrag { fn: Listener; minMs: number; last: number }

const listeners = new Set<Eintrag>();
let raf = 0;

const frameRequest = (cb: (t: number) => void): number =>
  typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : (setTimeout(() => cb(performance.now()), 1000 / 60) as unknown as number);
const frameCancel = (id: number) =>
  typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id);

/** Arbeitszeit je Bild (Takt plus anschließende React-Zeichnung bis zur nächsten Aufgabe), nur für den Messhaken (perf.ts). */
export const arbeit: number[] = [];
let kanal: MessageChannel | null = null;
let messen = false;
export function arbeitMessen(an: boolean) { messen = an; }

function loop(ms: number) {
  raf = 0;
  if (listeners.size === 0) return;
  if (messen && typeof MessageChannel !== "undefined") {
    const t0 = performance.now();
    kanal ??= new MessageChannel();
    kanal.port1.onmessage = () => { arbeit.push(performance.now() - t0); if (arbeit.length > 40000) arbeit.shift(); };
    kanal.port2.postMessage(0);
  }
  if (typeof document === "undefined" || !document.hidden) {
    for (const e of [...listeners]) {
      // Ohne Deckel (minMs 0) bei jedem Bild der Anzeige (60/120 Hz); mit Deckel höchstens maxFps, Zeitschritt kommt vom Aufrufer (delta-time).
      if (e.minMs === 0 || ms - e.last >= e.minMs - 1.5) { e.last = ms; e.fn(ms / 1000); }
    }
  }
  raf = frameRequest(loop);
}

/** Meldet einen Takt an; Rückgabe meldet ihn wieder ab. `maxFps` (optional) begrenzt nur diesen Takt, sonst jedes Anzeigebild. */
export function subscribe(listener: Listener, opts?: { maxFps?: number }): () => void {
  const e: Eintrag = { fn: listener, minMs: opts?.maxFps ? 1000 / opts.maxFps : 0, last: -Infinity };
  listeners.add(e);
  if (!raf) raf = frameRequest(loop);
  return () => {
    listeners.delete(e);
    if (listeners.size === 0 && raf) { frameCancel(raf); raf = 0; }
  };
}

export function activeCount() { return listeners.size; }

// Zeigerstand (Seitenkoordinaten) einmal für alle.
export const pointer = { x: -1e9, y: -1e9, moved: 0 };
let pointerBound = false;
export function trackPointer() {
  if (pointerBound || typeof window === "undefined") return;
  pointerBound = true;
  window.addEventListener("pointermove", (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.moved = performance.now();
  }, { passive: true });
  window.addEventListener("blur", () => { pointer.x = -1e9; pointer.y = -1e9; });
}

/** Zeigerrichtung relativ zur Figur (-1..1, y nach unten), wie FigureMode.mouseLook. */
export function mouseLook(rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } | null {
  if (pointer.x < -1e8) return null;
  const dx = pointer.x - (rect.left + rect.width / 2), dy = pointer.y - (rect.top + rect.height / 2);
  const dist = Math.hypot(dx, dy);
  if (dist < 0.5 || rect.width <= 0) return null;
  const strength = Math.tanh(dist / (rect.width * 1.4));
  return { x: (dx / dist) * strength, y: (dy / dist) * strength };
}

// FLIP-Animationen: Elemente mit data-flip="<id>" fliegen von ihrer alten an die neue Stelle (nur transform und opacity).
// Ablauf: vor der Änderung messe(), nach dem Zeichnen fliege(). Elemente ohne alte Stelle blenden ein.
// data-flip-skala: auch die Größe wird mitgeführt (Ursprung oben links). id "chat": Verschiebung der Mitte, nicht der Kante.

export type Stellen = Map<string, DOMRect>;

/** Feder (gedämpft, ca. 3 % Überschwinger) als linear()-Kurve; ältere WebViews bekommen eine ähnliche Bezier-Kurve. */
function federKurve(): string {
  const fallback = "cubic-bezier(0.34, 1.3, 0.64, 1)";
  if (typeof CSS === "undefined" || !CSS.supports?.("animation-timing-function", "linear(0, 1)")) return fallback;
  const zeta = 0.74, w = 2 * Math.PI * 2.2, n = 36;
  const punkte: string[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 0.95;
    const wd = w * Math.sqrt(1 - zeta * zeta);
    const y = 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta * w / wd) * Math.sin(wd * t));
    punkte.push((i === n ? 1 : y).toFixed(4));
  }
  return `linear(${punkte.join(", ")})`;
}
export const FEDER = federKurve();
export const DAUER = 420;

export function reduziert(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function messe(root: ParentNode): Stellen {
  const m: Stellen = new Map();
  root.querySelectorAll<HTMLElement>("[data-flip]").forEach((e) => m.set(e.dataset.flip!, e.getBoundingClientRect()));
  return m;
}

/** Fliegt alle [data-flip] von `alt` an ihre jetzige Stelle; [data-flip-text] blendet ein, wenn `text` gesetzt ist. */
export function fliege(root: ParentNode, alt: Stellen, text = false) {
  const els = Array.from(root.querySelectorAll<HTMLElement>("[data-flip]"));
  for (const el of els) el.getAnimations?.().forEach((a) => a.cancel()); // laufende Flüge enden, damit neu gemessen wird
  for (const el of els) {
    const id = el.dataset.flip!;
    const a = alt.get(id);
    if (!a) {
      el.animate?.({ opacity: [0, 1] }, { duration: 180, delay: 80, easing: "ease-out", fill: "backwards" });
      continue;
    }
    const n = el.getBoundingClientRect();
    const dx = id === "chat" ? a.left + a.width / 2 - (n.left + n.width / 2) : a.left - n.left;
    const dy = a.top - n.top;
    const skala = el.hasAttribute("data-flip-skala") && n.width > 0 && n.height > 0;
    const sx = skala ? a.width / n.width : 1, sy = skala ? a.height / n.height : 1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) continue;
    el.animate?.(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: "none" }],
      { duration: DAUER, easing: FEDER },
    );
  }
  if (text) {
    root.querySelectorAll<HTMLElement>("[data-flip-text]").forEach((e) =>
      e.animate?.({ opacity: [0, 1] }, { duration: 200, delay: 90, easing: "ease-out", fill: "backwards" }));
  }
}

/** Geist des alten Elements (Kopie samt Text), blendet schnell aus; fliegende Teile und Hintergrund sind darin unsichtbar. */
export function geist(alt: HTMLElement, root: HTMLElement): HTMLElement {
  const r = alt.getBoundingClientRect(), rr = root.getBoundingClientRect();
  const g = alt.cloneNode(true) as HTMLElement;
  g.querySelectorAll<HTMLElement>("[data-flip],[data-griff]").forEach((e) => { e.style.visibility = "hidden"; });
  g.setAttribute("aria-hidden", "true");
  g.setAttribute("inert", "");
  Object.assign(g.style, {
    position: "absolute", left: `${r.left - rr.left}px`, top: `${r.top - rr.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    margin: "0", pointerEvents: "none", zIndex: "3",
  });
  return g;
}

/** Hängt den Geist ein und blendet ihn aus. */
export function geistAusblenden(g: HTMLElement, root: HTMLElement) {
  root.appendChild(g);
  const a = g.animate?.({ opacity: [1, 0] }, { duration: 150, easing: "ease-out", fill: "forwards" });
  if (a) a.finished.then(() => g.remove(), () => g.remove());
  else g.remove();
}

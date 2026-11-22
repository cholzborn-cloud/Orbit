import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gestalt, type Gestalt } from "../../orbi";
import { pointer, subscribe, trackPointer } from "../../orbi/ticker";
import { OrbiFigur } from "./bausteine";
import { farbHex, useDunkel, useWenigBewegung } from "./dunkel";
import { Eroeffnung, FormSvg } from "./form";
import { BREITE, HOEHE, Flaeche, PLAETZE, type Szene } from "./szene";
import type { Schritt } from "./store";

// Bühne des Erststarts (Willkommen und Start): eine lockere, asymmetrische Konstellation mit Tiefenstaffelung
// (vorne groß, hinten klein und durchscheinend, nie weichgezeichnet, weiches Glimmen/Schatten unter jeder Figur).
// Leben: Parallax mit dem Zeiger (vorne stärker), Schweben in langsamen, unregelmäßigen Perioden, Aufmerksamkeit
// (die zwei nächsten Orbis lehnen sich dezent zum Zeiger und schauen hin). Ein Ereignis zur Zeit, nie mehrere: Blickwechsel
// zweier Orbis mit Nicken, einzelnes Nicken, oder zwei Orbis verschmelzen zu einer Form (Umriss-Morph) und trennen sich wieder.
// Eine Bewegungsfamilie: kritisch gedämpfte Federn (300–600 ms), ease-out für CSS. Ein Zeitgeber (orbi/ticker, höchstens
// Bildschirmtakt), nur transform/opacity direkt am Element. Reduzierte Bewegung: keine laufende Simulation.

export type Schluessel = "mitte" | "willkommen" | "start" | "weit" | "auswahl" | "orbi" | "weg" | "zusammen";

export function schluesselVon(schritt: Schritt, szene: Szene): Schluessel {
  if (szene === "zusammen") return "zusammen";
  switch (schritt) {
    case "willkommen": return szene === "mitte" ? "mitte" : "willkommen";
    case "start": return "start";
    case "name": case "modelle": case "plugins": case "mac": return "auswahl";
    case "orbi": return "orbi";
    case "fertig": return "weg";
    default: return "weit";
  }
}

const TAU = Math.PI * 2;
const N = PLAETZE.length;
const klemme = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const frac = (v: number) => v - Math.floor(v);
const DPR = () => (typeof window !== "undefined" && window.devicePixelRatio) || 1;

/** Konstellationen in Figma-Koordinaten (1440×900): Mitte x, y und Tiefe 0 hinten, 1 Mitte, 2 vorne. Reihenfolge wie PLAETZE. */
type Stern = [number, number, 0 | 1 | 2];
const ZUSAMMEN = (c: Stern[], kx: number, ky: number): Stern[] => c.map(([x, y, z]) => [Math.round(720 + (x - 720) * kx), Math.round(450 + (y - 450) * ky), z]);
const WILLKOMMEN: Stern[] = ZUSAMMEN([
  [1060, 240, 1], [310, 620, 2], [800, 130, 0], [1215, 450, 2], [240, 310, 1], [1030, 720, 1], [520, 175, 0], [610, 770, 0],
  [1335, 235, 0], [770, 790, 1], [140, 160, 0], [405, 330, 0], [1320, 640, 0], [165, 760, 1], [1235, 120, 1],
], 0.8, 0.84);
const START: Stern[] = [
  [1110, 170, 1], [230, 560, 2], [330, 190, 0], [1240, 520, 2], [150, 350, 1], [1075, 760, 1], [640, 110, 0], [500, 790, 0],
  [1330, 300, 0], [860, 790, 1], [90, 170, 0], [390, 700, 1], [1300, 690, 0], [165, 760, 1], [900, 115, 1],
];
const TIEFE = [
  { s: 0.9, o: 0.6, parallax: 3, schweben: 2.5 },
  { s: 1.2, o: 0.95, parallax: 9, schweben: 4 },
  { s: 1.55, o: 1, parallax: 18, schweben: 5.5 },
];

/** Kantenlänge je Element = Größe in der Willkommens-Konstellation (Tiefe), damit dort kein Skalieren nötig ist. */
const BASIS = PLAETZE.map((p, i) => p.groesse * TIEFE[WILLKOMMEN[i][2]].s);

interface Feder { v: number; vel: number }
/** Kritisch gedämpfte Feder; antwort = Antwortzeit in Sekunden. */
function feder(s: Feder, ziel: number, dt: number, antwort: number) {
  const w = TAU / antwort;
  let rest = dt;
  while (rest > 1e-9) {
    const h = Math.min(rest, 1 / 120);
    s.vel += (w * w * (ziel - s.v) - 2 * w * s.vel) * h;
    s.v += s.vel * h;
    rest -= h;
  }
}
const mkFeder = (v = 0): Feder => ({ v, vel: 0 });

interface Orb {
  x: Feder; y: Feder; s: Feder; o: Feder; hover: Feder; lx: Feder; ly: Feder;
  key: Schluessel; t0: number;
  geste: number; nick: number;
  blick: { current: { x: number; y: number } | null };
}

interface Ziel { x: number; y: number; s: number; o: number; tiefe: 0 | 1 | 2 }

export function ziel(i: number, key: Schluessel, tt: number, _anker: { x: number; y: number }): Ziel {
  const g = PLAETZE[i].groesse;
  const stern = (c: Stern[]): Ziel => { const [x, y, z] = c[i]; return { x, y, s: TIEFE[z].s, o: TIEFE[z].o, tiefe: z }; };
  switch (key) {
    case "mitte": return { x: 720, y: 450, s: 24 / g, o: 0, tiefe: 1 };
    case "willkommen": return stern(WILLKOMMEN);
    case "start": return stern(START);
    case "weit": { const z = stern(START); return { ...z, s: z.s * 0.9, o: 0 }; }
    case "auswahl": {
      const a = (i / N) * TAU - Math.PI / 2, r = i % 2 ? 1 : 0.93;
      return { x: 720 + Math.cos(a) * 570 * r, y: 450 + Math.sin(a) * 375 * r, s: 0.62, o: 0.72, tiefe: 1 };
    }
    // Ruhig: die Schar blendet an ihrem Platz aus, statt zur Figur zu fliegen (Consti 19.11.).
    case "orbi": { const a = (i / N) * TAU - Math.PI / 2, r = i % 2 ? 1 : 0.93; return { x: 720 + Math.cos(a) * 570 * r, y: 450 + Math.sin(a) * 375 * r, s: 0.62, o: 0, tiefe: 1 }; }
    case "zusammen": return { x: 720, y: 450, s: 0.3, o: tt < 0.22 ? 1 : 0, tiefe: 1 };
    default: return { x: 720, y: 450, s: 0.5, o: 0, tiefe: 1 };
  }
}

export interface Verschmolzen { x: number; y: number; seite: number; alpha: number; puls: number; a: number; b: number }
interface Callbacks { merge: (m: Verschmolzen | null) => void; lead: (i: number) => void }
const EREIGNISSE = ["blick", "verschmelzen", "nick", "blick", "nick"] as const;

class Sim {
  orbs: Orb[];
  key: Schluessel = "mitte";
  wechselAb = 0;
  ereignisAb = 0;
  ereignisNr = 0;
  reihe = 0;
  hoverZiel = new Array<number>(N).fill(0);
  par = { x: mkFeder(), y: mkFeder() };
  mgLetzt = 0;
  paar: { a: number; b: number; bis: number } | null = null;
  mg: { a: number; b: number; t0: number; mx: number; my: number; dx: number; dy: number; ra: number; rb: number } | null = null;

  constructor(public els: (HTMLDivElement | null)[], public cb: Callbacks) {
    this.orbs = PLAETZE.map((p) => ({
      x: mkFeder(720), y: mkFeder(450), s: mkFeder(24 / p.groesse), o: mkFeder(0), hover: mkFeder(), lx: mkFeder(), ly: mkFeder(),
      key: "mitte" as Schluessel, t0: 0, geste: -9, nick: -9, blick: { current: null },
    }));
  }

  szene(key: Schluessel, jetzt: number) {
    if (key === this.key) return;
    this.key = key;
    this.wechselAb = jetzt;
    this.ereignisAb = jetzt + 3.5;
    this.paar = null;
    if (this.mg) { this.mg = null; this.cb.merge(null); }
    const interaktiv = key === "willkommen" || key === "start";
    this.orbs.forEach((_, i) => {
      const el = this.els[i];
      if (!el) return;
      const z = ziel(i, key, 1, { x: 720, y: 330 });
      el.style.zIndex = String(interaktiv ? z.tiefe + 1 : 1);
    });
  }

  geste(i: number, jetzt: number) { this.orbs[i].geste = jetzt; }

  schreibe(i: number, x: number, y: number, s: number, o: number) {
    const el = this.els[i];
    if (!el) return;
    const w = BASIS[i];                 // Kantenlänge des Elements; im Ruhezustand der Konstellation ist der Maßstab 1 (Raster 1:1, scharf)
    const d = DPR();
    const px = Math.round((x - w / 2) * d) / d, py = Math.round((y - w / 2) * d) / d; // auf Gerätepixel gerastet
    const k = s * PLAETZE[i].groesse / w;
    el.style.transform = k > 0.9995 && k < 1.0005 ? `translate3d(${px}px,${py}px,0)` : `translate3d(${px}px,${py}px,0) scale(${k.toFixed(4)})`;
    el.style.opacity = o.toFixed(3);
  }

  /** Reduzierte Bewegung: Zielwerte sofort setzen. */
  statisch() {
    for (let i = 0; i < N; i++) {
      const z = ziel(i, this.key, 1, { x: 720, y: 330 });
      this.schreibe(i, z.x, z.y, z.s, z.o);
    }
  }

  private nachbar(a: number, gleicheTiefe: boolean, max: number): number {
    const c = this.key === "start" ? START : WILLKOMMEN;
    let best = -1, bd = max;
    for (let j = 0; j < N; j++) {
      if (j === a || (gleicheTiefe && c[j][2] !== c[a][2])) continue;
      const d = Math.hypot(c[j][0] - c[a][0], c[j][1] - c[a][1]);
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }

  private ereignis(jetzt: number) {
    const art = EREIGNISSE[this.ereignisNr++ % EREIGNISSE.length];
    const a = (this.reihe = (this.reihe * 7 + 4) % N); // feste, gemischte Reihenfolge
    this.cb.lead(a);
    if (art === "nick") { this.orbs[a].nick = jetzt; this.ereignisAb = jetzt + 5; return; }
    if (art === "blick") {
      const b = this.nachbar(a, false, 520);
      if (b < 0) { this.orbs[a].nick = jetzt; this.ereignisAb = jetzt + 5; return; }
      this.paar = { a, b, bis: jetzt + 2.8 };
      this.orbs[b].nick = jetzt + 1.5;
      this.ereignisAb = jetzt + 5;
      return;
    }
    const b = this.nachbar(a, true, 460);
    if (b < 0) { this.ereignisAb = jetzt + 3; return; }
    const c = this.key === "start" ? START : WILLKOMMEN;
    const ra = PLAETZE[a].groesse * 0.43 * TIEFE[c[a][2]].s, rb = PLAETZE[b].groesse * 0.43 * TIEFE[c[b][2]].s;
    const mx = (c[a][0] + c[b][0]) / 2, my = (c[a][1] + c[b][1]) / 2;
    const L = Math.hypot(c[b][0] - c[a][0], c[b][1] - c[a][1]) || 1;
    this.mg = { a, b, t0: jetzt, mx, my, dx: (c[b][0] - c[a][0]) / L, dy: (c[b][1] - c[a][1]) / L, ra, rb };
    this.ereignisAb = jetzt + 7;
  }

  step(jetzt: number, dt: number, env: { rect: DOMRect | null; anker: { x: number; y: number }; dunkel: boolean }) {
    const ruhig = this.key === "willkommen" || this.key === "start";
    if (ruhig && !this.mg && !this.paar && jetzt >= this.ereignisAb) this.ereignis(jetzt);
    if (this.paar && jetzt > this.paar.bis) this.paar = null;
    const r = env.rect;
    const sk = r ? r.width / BREITE : 1;
    const maus = pointer.x > -1e8;
    const aktiv = maus && performance.now() - pointer.moved < 3000;
    const w = typeof window !== "undefined" ? window : null;
    feder(this.par.x, maus && w ? klemme((pointer.x - w.innerWidth / 2) / (w.innerWidth / 2), -1, 1) : 0, dt, 0.6);
    feder(this.par.y, maus && w ? klemme((pointer.y - w.innerHeight / 2) / (w.innerHeight / 2), -1, 1) : 0, dt, 0.6);

    // Aufmerksamkeit: die zwei nächsten Orbis in Reichweite des Zeigers.
    const nah: number[] = [];
    if (aktiv && r && ruhig) {
      const ds = this.orbs.map((o, i) => [i, Math.hypot(pointer.x - (r.left + o.x.v * sk), pointer.y - (r.top + o.y.v * sk))] as const)
        .filter(([, d]) => d < 420 * sk).sort((p, q) => p[1] - q[1]).slice(0, 2);
      for (const [i] of ds) nah.push(i);
    }

    // Verschmelzen: Zeitablauf (Zusammenrücken 0,9 s, Form 1,4 s, Trennen 0,8 s).
    let mu = -1;
    if (this.mg) {
      mu = jetzt - this.mg.t0;
      if (mu > 3.1) { this.mg = null; this.cb.merge(null); mu = -1; }
    }

    for (let i = 0; i < N; i++) {
      const o = this.orbs[i];
      const versatz = o.key === "mitte" ? i * 0.018 : i * 0.004;
      if (o.key !== this.key && jetzt >= this.wechselAb + versatz) { o.key = this.key; o.t0 = jetzt; }
      const z = ziel(i, o.key, jetzt - o.t0, env.anker);
      const T = TIEFE[z.tiefe];
      let zx = z.x, zy = z.y, zo = z.o;
      const mg = this.mg;
      if (mg && (i === mg.a || i === mg.b)) {
        const sgn = i === mg.a ? -1 : 1, abst = (mg.ra + mg.rb) / 2;
        const zusammen = mu < 2.3;
        if (zusammen) { zx = mg.mx + sgn * mg.dx * abst; zy = mg.my + sgn * mg.dy * abst; }
        zo = mu >= 0.9 && mu < 2.2 ? 0 : z.o;
      }
      feder(o.x, zx, dt, 0.4);
      feder(o.y, zy, dt, 0.4);
      feder(o.s, z.s, dt, 0.34);
      feder(o.o, zo, dt, mg && (i === mg.a || i === mg.b) ? 0.14 : 0.3);
      feder(o.hover, this.hoverZiel[i], dt, 0.22);
      const lean = nah.includes(i) && r
        ? (() => { const dx = pointer.x - (r.left + o.x.v * sk), dy = pointer.y - (r.top + o.y.v * sk), d = Math.hypot(dx, dy) || 1; return [dx / d * 7, dy / d * 7]; })()
        : [0, 0];
      feder(o.lx, lean[0], dt, 0.5);
      feder(o.ly, lean[1], dt, 0.5);

      // Schweben (nur in der Ruhe): zwei langsame, unregelmäßige Perioden je Figur.
      let fx = 0, fy = 0, px = 0, py = 0;
      if (ruhig) {
        const p1 = 6.5 + 4.5 * frac(i * 0.618), p2 = 9 + 5 * frac(i * 0.37 + 0.3), ph = i * 1.7;
        fy = (T.schweben * (Math.sin((jetzt / p1) * TAU + ph) + 0.5 * Math.sin((jetzt / p2) * TAU + 2 * ph))) / 1.5;
        fx = 0.6 * T.schweben * Math.sin((jetzt / p2) * TAU + ph);
        px = this.par.x.v * T.parallax; py = this.par.y.v * T.parallax * 0.7;
      }
      const gu = (jetzt - o.geste) / 0.6;
      const gh = gu >= 0 && gu < 1 ? Math.sin(Math.PI * gu) ** 2 : 0;
      const nu = (jetzt - o.nick) / 0.55;
      const nk = nu >= 0 && nu < 1 ? Math.sin(Math.PI * nu) ** 2 : 0;
      const hov = o.hover.v;
      this.schreibe(i, o.x.v + fx + px + o.lx.v, o.y.v + fy + py + o.ly.v - 5 * gh - 3 * hov + 5 * nk,
        Math.max(0.01, o.s.v * (1 + 0.03 * gh + 0.04 * hov)), klemme(o.o.v, 0, 1));

      // Blick: Paar > Zeiger (die zwei Nahen) > eigenes gemächliches Wandern der Figur.
      let b: { x: number; y: number } | null = null;
      const pa = this.paar;
      if (pa && (i === pa.a || i === pa.b)) {
        const t = this.orbs[i === pa.a ? pa.b : pa.a];
        const dx = t.x.v - o.x.v, dy = t.y.v - o.y.v, d = Math.hypot(dx, dy) || 1, st = Math.tanh(d / (PLAETZE[i].groesse * 1.4));
        b = { x: (dx / d) * st, y: (dy / d) * st };
      } else if (nah.includes(i) && r) {
        const dx = pointer.x - (r.left + o.x.v * sk), dy = pointer.y - (r.top + o.y.v * sk), d = Math.hypot(dx, dy) || 1, st = Math.tanh(d / (PLAETZE[i].groesse * sk * 1.4));
        b = { x: (dx / d) * st, y: (dy / d) * st };
      }
      o.blick.current = b;
    }

    // Überlagerung der verschmolzenen Form
    if (this.mg && mu >= 0 && jetzt - this.mgLetzt >= 1 / 60 - 0.003) {
      this.mgLetzt = jetzt;
      const mg = this.mg;
      const sm = (a: number, b: number, v: number) => { const u = klemme((v - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
      const alpha = sm(0.8, 1.05, mu) * (1 - sm(2.15, 2.4, mu));
      this.cb.merge({ x: mg.mx, y: mg.my, seite: ((mg.ra + mg.rb) * 1.15) / 0.85, alpha, puls: 1 + 0.05 * Math.sin(((mu - 0.9) / 1.3) * Math.PI), a: mg.a, b: mg.b });
    }
  }
}

/** Die Bühne. Liegt unter den Schritten (kein Klick auf Text); die Orbis selbst reagieren auf den Zeiger. */
export function Buehne({ schritt, szene, ohneIntro = false }: { schritt: Schritt; szene: Szene; ohneIntro?: boolean }) {
  const wenig = useWenigBewegung();
  const dunkel = useDunkel();
  const key = schluesselVon(schritt, szene);
  const els = useRef<(HTMLDivElement | null)[]>(Array.from({ length: N }, () => null));
  const innen = useRef<HTMLDivElement>(null);
  const [mg, setMg] = useState<Verschmolzen | null>(null);
  const [lead, setLead] = useState<number>(0);
  const [intro, setIntro] = useState(() => !ohneIntro && !wenig && schritt === "willkommen" && szene === "mitte");
  const cb = useRef<Callbacks>({ merge: () => {}, lead: () => {} });
  cb.current.merge = setMg; cb.current.lead = setLead;
  const sim = useRef<Sim | null>(null);
  if (!sim.current) sim.current = new Sim(els.current, cb.current);
  const interaktiv = key === "willkommen" || key === "start";
  const dunkelRef = useRef(dunkel); dunkelRef.current = dunkel;

  useLayoutEffect(() => { sim.current!.statisch(); }, []);

  useEffect(() => {
    const s = sim.current!;
    for (const el of els.current) if (el) el.style.pointerEvents = interaktiv ? "auto" : "none";
    if (wenig) {
      s.key = key;
      for (const o of s.orbs) o.key = key;
      for (const el of els.current) if (el) el.style.transition = "opacity 200ms linear";
      s.statisch();
      return;
    }
    for (const el of els.current) if (el) el.style.transition = "";
    s.szene(key, performance.now() / 1000);
  }, [key, wenig, interaktiv]);

  useEffect(() => {
    if (wenig) return;
    trackPointer();
    const s = sim.current!;
    let letzt = 0;
    return subscribe((jetzt) => {
      const dt = letzt ? Math.min(0.05, Math.max(0.001, jetzt - letzt)) : 1 / 60;
      letzt = jetzt;
      const rect = innen.current?.getBoundingClientRect() ?? null;
      let anker = { x: 720, y: 330 };
      if (s.key === "orbi" && rect && rect.width > 0) {
        const a = document.querySelector('[data-anker="orbi"]')?.getBoundingClientRect();
        if (a && a.width > 0) {
          const sk = rect.width / BREITE;
          anker = { x: 720 + (a.left + a.width / 2 - (rect.left + rect.width / 2)) / sk, y: 450 + (a.top + a.height / 2 - (rect.top + rect.height / 2)) / sk };
        }
      }
      s.step(jetzt, dt, { rect, anker, dunkel: dunkelRef.current });
    });
  }, [wenig]);

  const figuren = useMemo(() => PLAETZE.map((p, i) => (
    <div key={p.avatar} data-orbi={p.avatar} aria-hidden="true"
      ref={(el) => { els.current[i] = el; sim.current!.els[i] = el; }}
      onPointerEnter={() => { sim.current!.hoverZiel[i] = 1; }}
      onPointerLeave={() => { sim.current!.hoverZiel[i] = 0; }}
      onPointerDown={() => sim.current!.geste(i, performance.now() / 1000)}
      style={{ position: "absolute", left: 0, top: 0, width: BASIS[i], height: BASIS[i], display: "flex", alignItems: "center", justifyContent: "center", opacity: 0 }}>
      <span style={{ position: "absolute", left: "16%", top: "78%", width: "68%", height: "22%", borderRadius: "50%", pointerEvents: "none",
        background: dunkel ? `radial-gradient(closest-side, ${farbHex(p.farbe, true)}55, transparent)` : "radial-gradient(closest-side, rgba(20,24,40,0.16), transparent)" }} />
      <OrbiFigur avatar={p.avatar} farbe={p.farbe} koerper={Math.round(BASIS[i] * 0.86)} zustand="lebendig" blick={sim.current!.orbs[i].blick} />
    </div>
  )), [dunkel]);

  const eroeffnungFertig = useCallback(() => setIntro(false), []);
  const g = mg ? { a: gestalt(PLAETZE[mg.a].avatar), b: gestalt(PLAETZE[mg.b].avatar) } : null;

  return (
    <Flaeche className="pointer-events-none">
      <div ref={innen} className="absolute inset-0" data-buehne={key} style={{ width: BREITE, height: HOEHE, pointerEvents: "none" }}>
        <Schimmer hex={farbHex(PLAETZE[lead].farbe, dunkel)} an={interaktiv} />
        {figuren}
        {mg && g?.a && g.b ? (
          <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, zIndex: 2, opacity: mg.alpha, pointerEvents: "none",
            transform: `translate3d(${(mg.x - mg.seite / 2).toFixed(1)}px,${(mg.y - mg.seite / 2).toFixed(1)}px,0) scale(${mg.puls.toFixed(3)})` }}>
            <FormSvg von={g.a as Gestalt} nach={g.b as Gestalt} e={0.5} hexVon={farbHex(PLAETZE[mg.a].farbe, dunkel)} hexNach={farbHex(PLAETZE[mg.b].farbe, dunkel)} dunkel={dunkel} seite={mg.seite} />
          </div>
        ) : null}
        {intro ? <Eroeffnung dunkel={dunkel} onFertig={eroeffnungFertig} /> : null}
      </div>
    </Flaeche>
  );
}

/** Sehr dezenter Farbschimmer hinter der Szene, nimmt die Farbe des Orbis in Führung auf (überblendet, 1,6 s). */
function Schimmer({ hex, an }: { hex: string; an: boolean }) {
  const [lagen, setLagen] = useState<{ id: number; hex: string; weg: boolean }[]>([{ id: 0, hex, weg: false }]);
  const nr = useRef(0);
  useEffect(() => {
    setLagen((l) => (l[l.length - 1]?.hex === hex ? l : [...l.map((x) => ({ ...x, weg: true })), { id: ++nr.current, hex, weg: false }]));
    const t = setTimeout(() => setLagen((l) => l.filter((x) => !x.weg)), 1800);
    return () => clearTimeout(t);
  }, [hex]);
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: 170, top: 20, width: 1100, height: 760, opacity: an ? 1 : 0, transition: "opacity 600ms cubic-bezier(0.22, 1, 0.36, 1)", pointerEvents: "none" }}>
      {lagen.map((l) => (
        <div key={l.id} className={l.weg ? "o-schimmer o-schimmer-weg" : "o-schimmer"} style={{ ["--c" as string]: l.hex }} />
      ))}
    </div>
  );
}

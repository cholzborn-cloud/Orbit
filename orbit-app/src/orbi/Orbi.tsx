import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Behavior, SLEEP_PERIOD, STILL, type OrbiState, type Pose } from "./behavior";
import { neutralExpression, renderGeometry, type Geometry } from "./geometry";
import {
  BASE_COLORS, EYE_DARK, EYE_LIGHT, isHex, luminance, shapeOf, type Shape,
} from "./shapes";
import { POSE_FPS, mouseLook, subscribe, trackPointer } from "./ticker";

/** Anpassung der Figur im Dienst (bots.look); fehlende Felder = Standard. */
export interface OrbiLook {
  /** Blickstärke 0 bis 1 (Standard 1). */
  gaze?: number | null;
  /** Reaktionszeit der Pupille in Sekunden, 0,04 bis 0,4 (Standard 0,11). */
  reaction?: number | null;
}

export interface OrbiProps {
  /** Einer der 25 Avatar-Namen des Dienstes (siehe AVATAR_NAMES); Unbekanntes wird stabil einer Form zugeordnet. */
  avatar: string;
  /** "#RRGGBB" des Orbis oder null = Grundfarbe der Form. */
  color?: string | null;
  look?: OrbiLook | null;
  /** Kantenlänge in px (24 bis 120). */
  size?: number;
  /** normal = ruhig, lebendig = Blick wandert und blinzelt, schlaeft = Augen zu mit z, blick = Blick zur Mitte, schwebt und blinzelt. */
  state?: OrbiState;
  dark?: boolean;
  /** Blick folgt dem Zeiger (Kopf, Panel). */
  follow?: boolean;
  /** Panel-Orbi: beim Darüberfahren erscheint die Hover-Fläche mit Stift. */
  panel?: boolean;
  /** Volle Stützpunktdichte der Konturen (Standard); false = halbe Dichte bis 100 px (schneller, Kanten gröber). */
  fine?: boolean;
  /** Optional: von außen gesetzte Blickrichtung (-1..1, y nach unten); null = kein Ziel. Hat Vorrang vor `follow`. Der Wert wird je Takt gelesen. */
  lookAt?: { current: { x: number; y: number } | null };
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const HEAD_REACH = 22, EYE_REACH = 18;
const ENGINE_SCALE = 68 / 240;      // Engine-Einheiten -> 100er-Sicht (Kugel 240 = 68)
const POSE_SCALE = 34 / 42;         // Maß des Artifacts -> Engine-Kugel
const POSE_FOOT = 84;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(query);
    const on = () => setReduced(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

function bodyColor(shape: Shape, color: string | null | undefined, dark: boolean): string {
  return isHex(color) ? color.toLowerCase() : BASE_COLORS[shape][dark ? "dark" : "light"];
}

/** Augenfarbe: hell weiß, dunkel Tinte; auf sehr hellen bzw. sehr dunklen Körpern umgekehrt. */
export function eyeColor(body: string, dark: boolean): string {
  const l = luminance(body);
  if (dark) return l < 0.3 ? EYE_LIGHT : EYE_DARK;
  return l > 0.78 ? EYE_DARK : EYE_LIGHT;
}

interface Frame {
  geo: Geometry;
  blinkValue: number;
  pose: Pose;
}

function computeFrame(shape: Shape, pose: Pose, gaze: number, fast: boolean): Frame {
  const expr = neutralExpression(shape);
  expr[0] += -pose.ly * HEAD_REACH * gaze - pose.pitch;
  expr[1] += pose.lx * HEAD_REACH * gaze;
  const blinkValue = 1 - 0.94 * pose.blink;
  const geo = renderGeometry(shape, expr, blinkValue, pose.lx * EYE_REACH * gaze, pose.ly * EYE_REACH * gaze, fast);
  return { geo, blinkValue, pose };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function SleepZ({ t, size }: { t: number; size: number }) {
  void size;
  const zs = [{ x: 68, y: 24, fs: 13, o: 0 }, { x: 76, y: 12, fs: 17, o: 0.45 }];
  return (
    <g data-part="sleep" aria-hidden="true">
      {zs.map((z, i) => {
        const u = (((t / SLEEP_PERIOD) + z.o) % 1 + 1) % 1;
        return (
          <text key={i} x={z.x} y={r2(z.y + 6 - 10 * u)} fontSize={z.fs} fontWeight={600} fontFamily="system-ui, sans-serif"
            fill="currentColor" fillOpacity={r2(0.75 * Math.sin(Math.PI * u))}>z</text>
        );
      })}
    </g>
  );
}

export function Orbi({
  avatar, color = null, look, size = 48, state = "normal", dark = false, follow = false, panel = false, fine = true, lookAt, className, style, title,
}: OrbiProps) {
  const reduced = usePrefersReducedMotion();
  const shape = shapeOf(avatar);
  const gaze = clamp(look?.gaze ?? 1, 0, 1);
  const reaction = clamp(look?.reaction ?? 0.11, 0.04, 0.4);
  const fast = !fine && size <= 100;
  const uid = useId().replace(/:/g, "");

  const behavior = useRef<Behavior | null>(null);
  if (!behavior.current) behavior.current = new Behavior(state, Math.random, reaction);
  const [pose, setPose] = useState<Pose>(() => behavior.current!.still());
  const [clock, setClock] = useState(0);
  const [visible, setVisible] = useState(true);
  const [hover, setHover] = useState(false);
  const host = useRef<HTMLSpanElement>(null);

  // Zustand/Look an die Rechnung geben; ohne Bewegung sofort das Ruhebild.
  useEffect(() => {
    const b = behavior.current!;
    b.setState(state);
    b.setReaction(reaction);
    if (reduced || state === "normal" && !follow && !lookAt) setPose(b.still());
  }, [state, reaction, reduced, follow, lookAt]);

  // Sichtbarkeit: außerhalb des Bildschirms rechnet die Figur nicht.
  useEffect(() => {
    const el = host.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setVisible(e.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const animated = !reduced && visible && (state !== "normal" || follow || !!lookAt);
  useEffect(() => {
    if (!animated) return;
    if (follow) trackPointer();
    const b = behavior.current!;
    let prev = "";
    const unsub = subscribe((now) => {
      const el = host.current;
      const m = lookAt?.current ?? (follow && el ? mouseLook(el.getBoundingClientRect()) : null);
      const p = { ...b.step(now, m) };
      const key = `${r2(p.lx)}|${r2(p.ly)}|${r2(p.tilt)}|${r2(p.blink)}|${r2(p.y)}|${r2(p.sx)}|${r2(p.sy)}|${state === "schlaeft" ? Math.round(now * 30) : 0}`;
      if (key === prev) return;
      prev = key;
      setPose(p);
      if (state === "schlaeft") setClock(now);
    }, { maxFps: POSE_FPS });
    return unsub;
  }, [animated, follow, state, lookAt]);

  const effective = reduced ? behavior.current.still() : pose;
  const frame = useMemo(() => computeFrame(shape, effective, gaze, fast), [shape, effective, gaze, fast]);

  const dk = !!dark;
  const body = bodyColor(shape, color, dk);
  const eyeFill = eyeColor(body, dk);
  const { geo } = frame;
  const clipId = `orbi-clip-${uid}`;

  // Körperbewegung: Verschiebung, Neigung um den Fuß, Stauchung.
  const body_tf = `translate(${r2(50 + effective.x * POSE_SCALE)} ${r2(POSE_FOOT + effective.y * POSE_SCALE)}) rotate(${r2(effective.tilt)}) scale(${r2(effective.sx)} ${r2(effective.sy)}) translate(-50 -${POSE_FOOT})`;
  const eng_tf = `translate(50 50) scale(${ENGINE_SCALE})`;

  const label = title ?? `Orbi ${shape}`;
  const svg = (
    <svg
      width={size} height={size} viewBox="10 10 80 80" role="img" aria-label={label}
      data-orbi={shape} data-state={state} data-body={body} data-dark={dk ? "1" : "0"}
      style={{ overflow: "visible", display: "block", color: dk ? "#aab4c4" : "#6b7585" }}
    >
      <title>{label}</title>
      <defs>
        <clipPath id={clipId}><path d={geo.head} /></clipPath>
      </defs>
      <g transform={body_tf}>
        <g transform={eng_tf} fill={body}>
          {geo.back.map((d, i) => <path key={`b${i}`} d={d} />)}
          <path d={geo.head} />
          <g clipPath={`url(#${clipId})`} fill={eyeFill} data-part="eyes">
            {geo.leftVisible && geo.left && <path d={geo.left} />}
            {geo.rightVisible && geo.right && <path d={geo.right} />}
          </g>
          {geo.front.map((d, i) => <path key={`f${i}`} d={d} />)}
        </g>
      </g>
      {state === "schlaeft" && <SleepZ t={reduced ? 0.25 * SLEEP_PERIOD : clock} size={size} />}
    </svg>
  );

  if (!panel) {
    return <span ref={host} className={className} style={{ display: "inline-block", lineHeight: 0, ...style }}>{svg}</span>;
  }
  const pad = Math.round(size * 0.05);
  return (
    <span
      ref={host} className={className} data-panel={hover ? "hover" : "normal"}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
      style={{ position: "relative", display: "inline-block", lineHeight: 0, padding: pad, ...style }}
    >
      <span aria-hidden="true" style={{
        position: "absolute", inset: 0, borderRadius: "50%", pointerEvents: "none",
        background: dk ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)", opacity: hover ? 1 : 0, transition: "opacity 150ms",
      }} />
      {svg}
      <svg aria-hidden="true" viewBox="0 0 22 22" width={size * 0.275} height={size * 0.275} style={{
        position: "absolute", left: "50%", top: "50%", marginLeft: -size * 0.1375, marginTop: -size * 0.1375,
        opacity: hover ? 1 : 0, transition: "opacity 150ms", pointerEvents: "none", color: dk ? "#fff" : "#1b1d2a",
      }}>
        <path d="M3 19l1-4L15 4l3 3L7 18z" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
        <path d="M13 6l3 3" stroke="currentColor" strokeWidth={1.8} />
      </svg>
    </span>
  );
}

export { STILL };

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Symbol, cx } from "../../ui";
import { Orbi } from "../../orbi";
import type { OrbiLook } from "../../lib/types";
import "./orbis.css";

// ---------- Hell/Dunkel ----------

function readDark(): boolean {
  if (typeof document === "undefined") return false;
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark") return true;
  if (t === "light") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Orbi kennt den Modus nur über `dark`: data-theme zuerst, sonst das System. */
export function useDark(): boolean {
  const [dark, setDark] = useState(readDark);
  useEffect(() => {
    const on = () => setDark(readDark());
    on();
    const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    mq?.addEventListener?.("change", on);
    const mo = typeof MutationObserver === "function" ? new MutationObserver(on) : null;
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq?.removeEventListener?.("change", on);
      mo?.disconnect();
    };
  }, []);
  return dark;
}

// ---------- Orbi-Farben (Figma 5.5: 14 Farben; gespeichert wird der helle Hex-Wert) ----------

export const PALETTE = [
  { id: "rot", light: "#d93a3d", dark: "#e84447" },
  { id: "orange", light: "#df6521", dark: "#e87031" },
  { id: "gelborange", light: "#cf811e", dark: "#e9993a" },
  { id: "limette", light: "#8fb82f", dark: "#a5d046" },
  { id: "gruen", light: "#43a561", dark: "#5ac078" },
  { id: "tuerkis", light: "#43a191", dark: "#55b5a4" },
  { id: "himmel", light: "#199ecd", dark: "#32b3e6" },
  { id: "blau", light: "#3378ec", dark: "#3e82f4" },
  { id: "indigo", light: "#4f5ae0", dark: "#626df5" },
  { id: "violett", light: "#8152eb", dark: "#895df3" },
  { id: "fuchsia", light: "#b53acb", dark: "#c849e4" },
  { id: "pink", light: "#de3a8e", dark: "#e74897" },
  { id: "braun", light: "#8a6038", dark: "#996e42" },
  { id: "grau", light: "#6b7483", dark: "#7d8797" },
] as const;

/** Im Dunkelmodus die dunkle Entsprechung einer gespeicherten Palettenfarbe. */
export function orbiColor(color: string | null | undefined, dark: boolean): string | null {
  if (!color) return null;
  if (!dark) return color;
  const p = PALETTE.find((x) => x.light === color.toLowerCase());
  return p ? p.dark : color;
}

export function OrbiFigur({
  avatar, color, look, size = 28, state, panel, follow, className, style,
}: {
  avatar: string;
  color?: string | null;
  look?: OrbiLook | null;
  size?: number;
  state?: "normal" | "lebendig" | "schlaeft" | "blick";
  panel?: boolean;
  follow?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const dark = useDark();
  return (
    <Orbi
      avatar={avatar}
      color={orbiColor(color, dark)}
      look={look ? { gaze: look.gaze, reaction: look.reaction } : null}
      size={size}
      state={state}
      dark={dark}
      panel={panel}
      follow={follow}
      className={className}
      style={style}
    />
  );
}

// ---------- Dialog (Figma: Radius 24, Rand 22/24, Abstand 18, Schatten 0/24/60) ----------

export function Schliessen({ onClick, groesse = 30, label = "Close" }: { onClick: () => void; groesse?: number; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{ width: groesse, height: groesse }}
      className="orbit-ui flex shrink-0 items-center justify-center rounded-full bg-o-field text-o-text transition-colors duration-[var(--orbit-dur)] hover:bg-o-selected focus-visible:outline-2 focus-visible:outline-o-focus cursor-default"
    >
      <Symbol name="x" />
    </button>
  );
}

export function Dialog({
  titel, breite, onClose, children, gap = 18,
}: {
  titel: string;
  breite: number;
  onClose: () => void;
  children: ReactNode;
  gap?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="orbit-ui fixed inset-0 z-50 flex items-center justify-center bg-[var(--oo-scrim)] p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={titel}
        tabIndex={-1}
        style={{ width: breite, maxWidth: "100%", maxHeight: "100%", boxShadow: "var(--oo-dlg-shadow)", gap }}
        className="orbit-pop flex flex-col overflow-y-auto overscroll-contain rounded-[24px] border border-solid border-o-card-border bg-o-raised px-6 py-[22px] outline-none [--pop-ursprung:center]"
      >
        <div className="flex shrink-0 items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-[17px] leading-6 font-semibold text-o-text">{titel}</h2>
          <Schliessen onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

/** Fußzeile: Knöpfe rechts, 8 Abstand. */
export function Fuss({ children, links }: { children: ReactNode; links?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {links}
      <span className="flex-1" />
      {children}
    </div>
  );
}

export function Fehlerzeile({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-[13px] leading-[18px] text-o-danger">
      {text}
    </p>
  );
}

// ---------- Reiter (Segment mit gleitendem Schieber) ----------

export function Reiter<T extends string>({
  items, value, onChange, hoehe = 32, label, className,
}: {
  items: { id: T; text: string }[];
  value: T;
  onChange: (id: T) => void;
  hoehe?: number;
  label: string;
  className?: string;
}) {
  const n = items.length;
  const i = Math.max(0, items.findIndex((x) => x.id === value));
  return (
    <div
      role="tablist"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${n}, 1fr)`, background: "var(--oo-seg)" }}
      className={cx("orbit-ui relative grid shrink-0 rounded-full p-[3px]", className)}
    >
      <span
        aria-hidden="true"
        data-schieber
        style={{
          width: `calc((100% - 6px) / ${n})`,
          height: hoehe,
          transform: `translateX(${i * 100}%)`,
          background: "var(--oo-slider)",
          boxShadow: "var(--oo-slider-shadow)",
        }}
        className="absolute top-[3px] left-[3px] rounded-full transition-transform duration-[var(--orbit-dur)] ease-[var(--orbit-ease)]"
      />
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={it.id === value}
          onClick={() => onChange(it.id)}
          style={{ height: hoehe }}
          className={cx(
            "relative z-10 rounded-full px-2.5 text-[14px] leading-5 focus-visible:outline-2 focus-visible:outline-o-focus cursor-default",
            it.id === value ? "font-medium text-o-text" : "text-o-text-2",
          )}
        >
          {it.text}
        </button>
      ))}
    </div>
  );
}

/** Auswahl in Kapselform ("Montag ⌄"), natives select darüber. */
export function PillSelect({
  value, options, onChange, label,
}: {
  value: string;
  options: { wert: string; text: string }[];
  onChange: (v: string) => void;
  label: string;
}) {
  const cur = options.find((o) => o.wert === value);
  return (
    <span className="orbit-ui relative inline-flex h-[34px] items-center gap-1 rounded-full bg-o-field px-3 text-[15px] leading-[22px] font-medium text-o-text hover:bg-o-selected transition-colors duration-[var(--orbit-dur)] focus-within:outline-2 focus-within:outline-o-focus">
      <span>{cur?.text ?? value}</span>
      <Symbol name="chevd" />
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-default opacity-0"
      >
        {options.map((o) => (
          <option key={o.wert} value={o.wert}>
            {o.text}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Kleine Kapsel (Vorschläge): Fläche 6 %, 13/18 zweitrangig. */
export function Kapsel({
  children, onClick, aktiv, pressed,
}: {
  children: ReactNode;
  onClick?: () => void;
  aktiv?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        "orbit-ui inline-flex items-center rounded-full px-2.5 py-[5px] text-[13px] leading-[18px] transition-colors duration-[var(--orbit-dur)] focus-visible:outline-2 focus-visible:outline-o-focus cursor-default",
        aktiv ? "bg-o-selected text-o-text" : "bg-o-field text-o-text-2 hover:bg-o-selected",
      )}
    >
      {children}
    </button>
  );
}

/** Statuspunkt (erledigt = grün, wartet = orange, ruhig = grau, Fehler = rot). */
export type PunktArt = "ok" | "warn" | "ruhig" | "fehler";
export function Punkt({ art, groesse = 8 }: { art: PunktArt; groesse?: number }) {
  const farbe =
    art === "ok" ? "var(--orbit-success)" : art === "warn" ? "var(--oo-warn)" : art === "fehler" ? "var(--orbit-danger)" : "var(--orbit-text-3)";
  return <span aria-hidden="true" style={{ width: groesse, height: groesse, background: farbe }} className="inline-block shrink-0 rounded-full" />;
}

/** Abschnittstitel im Panel (13/18 zweitrangig). */
export function Abschnitt({ children }: { children: ReactNode }) {
  return <h3 className="text-[13px] leading-[18px] text-o-text-2">{children}</h3>;
}

/** Weiße Karte mit Haarlinie, Zeilen durch Linien getrennt (Figma "Gruppe" im Panel, Radius 12). */
export function Liste({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "orbit-ui flex flex-col overflow-hidden rounded-o-lg border border-solid border-o-card-border bg-o-raised [&>*+*]:border-t [&>*+*]:border-solid [&>*+*]:border-o-line",
        className,
      )}
    >
      {children}
    </div>
  );
}

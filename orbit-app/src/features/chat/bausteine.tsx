// Bausteine aus Figma 03 (Komponentensätze Rundknopf, Plugins-Knopf, Kopf-Pille, Chatzeile, Live-Zeile, Systemzeile, Hauptorbi)
// plus die Aktionskarte aus 6.3. Reine Darstellung, kein Zustand des Dienstes.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Orbi, type OrbiState } from "../../orbi";
import { Knopf, Symbol, cx, type OrbiFarbe, type SymbolName } from "../../ui";
import type { Bot, OrbiLook } from "../../lib/types";
import { useDark } from "./hooks";
import type { Punkt } from "./logik";

export interface FigurDaten {
  avatar: string;
  color?: string | null;
  look?: OrbiLook | Bot["look"];
}

/** Orbi-Figur in fester Kantenlänge. */
export function Figur({ d, size, state, title, flip }: { d: FigurDaten; size: number; state?: OrbiState; title?: string; flip?: string }) {
  const dark = useDark();
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} data-figur data-flip={flip}>
      <Orbi avatar={d.avatar} color={d.color ?? null} look={d.look ? { gaze: d.look.gaze, reaction: d.look.reaction } : null} size={size} state={state} dark={dark} title={title} />
    </span>
  );
}

const TINT =
  "[background-image:linear-gradient(var(--tint),var(--tint))] [--tint:transparent] hover:[--tint:var(--orbit-hover)] data-[zustand=hover]:[--tint:var(--orbit-hover)]";
const FOKUS_RING =
  "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-o-focus";

type KnopfProps = ButtonHTMLAttributes<HTMLButtonElement> & { zustand?: "hover" };

/** Rundknopf 36 (Suche, Neu). */
export function Rundknopf({ symbol, zustand, className, ...rest }: KnopfProps & { symbol: SymbolName }) {
  return (
    <button
      type="button"
      data-zustand={zustand}
      className={cx(
        "orbit-ui flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-o-surface text-o-text cursor-default",
        TINT, FOKUS_RING, "transition-[background-color,transform] duration-[var(--orbit-dur)] ease-[var(--orbit-ease-spring)] active:scale-95", className,
      )}
      {...rest}
    >
      <Symbol name={symbol} groesse={18} />
    </button>
  );
}

/** Leiser Symbolknopf. In der breiten Leiste öffnet sich die Beschriftung nach links. */
export function PluginsKnopf({ ausklappbar = false, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { ausklappbar?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Plugins"
      title="Plugins"
      className={cx(
        "orbit-ui group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-o-text-2 cursor-default",
        ausklappbar ? cx(
          "z-10 isolate hover:text-o-text focus-visible:text-o-text",
          "before:pointer-events-none before:absolute before:inset-y-0 before:right-0 before:-z-10 before:my-auto before:h-7 before:w-28",
          "before:[background:linear-gradient(90deg,transparent,var(--orbit-sidebar)_1.5rem)]",
          "before:opacity-0 before:transition-opacity hover:before:opacity-100 focus-visible:before:opacity-100 focus-visible:before:transition-none motion-reduce:before:transition-none",
        ) : "transition-[background-color,color,transform] ease-spring hover:bg-o-hover hover:text-o-text focus-visible:bg-o-hover active:scale-90",
        FOKUS_RING, className,
      )}
      {...rest}
    >
      {ausklappbar ? (
        <span aria-hidden="true" className={cx(
          "absolute inset-y-0 right-0 my-auto flex h-7 w-22 items-center rounded-full pl-3 text-o-text",
          "[clip-path:inset(0_0_0_3.5rem_round_999px)] transition-[clip-path,background-color] ease-[var(--orbit-ease)]",
          "group-hover:bg-o-surface group-hover:[clip-path:inset(0_round_999px)] group-hover:ease-[var(--orbit-ease-out)]",
          "group-focus-visible:bg-o-surface group-focus-visible:[clip-path:inset(0_round_999px)] group-focus-visible:transition-none motion-reduce:transition-none",
        )}>
          <span className={cx(
            "-translate-x-0.5 text-[12px] leading-4 opacity-0 transition-[opacity,translate] ease-[var(--orbit-ease-out)]",
            "group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:transition-none motion-reduce:transition-none",
          )}>
            Plugins
          </span>
        </span>
      ) : null}
      <Symbol name="store" groesse={18} className="relative shrink-0" />
    </button>
  );
}

/** Die Kopf-Pille zeigt beim Zeigen und beim Tastaturfokus ihre Aktion nach rechts. */
export function KopfPille({
  daten, name, zustand, className, ...rest
}: KnopfProps & { daten: FigurDaten; name: string }) {
  return (
    <button
      type="button"
      data-kopf-pille
      data-zustand={zustand}
      {...rest}
      className={cx(
        "orbit-ui group relative isolate flex h-[34px] items-center gap-1.5 rounded-full pl-1.5 pr-3 text-o-text cursor-default",
        "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-full before:bg-o-surface before:transition-[right,background-color] before:duration-[var(--orbit-dur)] before:ease-[var(--orbit-ease-out)] hover:before:-right-4 focus-visible:before:-right-4 data-[zustand=hover]:before:-right-4 hover:before:bg-o-hover focus-visible:before:bg-o-hover data-[zustand=hover]:before:bg-o-hover",
        FOKUS_RING, className,
      )}
    >
      <Figur d={daten} size={20} />
      <span className="max-w-60 truncate text-[13px] leading-[18px] font-medium">{name}</span>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-full -ml-1.5 flex -translate-x-1 items-center pr-2 text-o-text-2 opacity-0 transition-[opacity,translate] duration-[var(--orbit-dur)] ease-[var(--orbit-ease-out)] group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 group-data-[zustand=hover]:translate-x-0 group-data-[zustand=hover]:opacity-100">
        <Symbol name="chevr" groesse={14} />
      </span>
    </button>
  );
}

/** Chatzeile 54: Figur 36, Name, Vorschau, Punkt. Die Auswahl zeichnet die Liste (gleitet). */
export function ChatZeile({
  name, vorschau, daten, punkt, ausgewaehlt, live, zustand, flip, onClick, onContextMenu,
}: {
  name: string; vorschau: string; daten: FigurDaten; punkt: Punkt; ausgewaehlt?: boolean; live?: boolean; flip?: string;
  zustand?: "hover"; onClick?: () => void; onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      data-chatzeile
      data-zustand={zustand}
      aria-current={ausgewaehlt ? "true" : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cx(
        "orbit-ui relative flex h-[58px] w-full shrink-0 items-center gap-3 rounded-[12px] px-3 py-[9px] text-left cursor-default",
        ausgewaehlt ? "[--tint:transparent]" : TINT, FOKUS_RING,
        "focus-visible:-outline-offset-2",
      )}
    >
      <Figur d={daten} size={36} state={live ? "lebendig" : "normal"} flip={flip} />
      <span data-flip-text className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] leading-5 text-o-text">{name}</span>
        <span className="truncate text-[13px] leading-[18px] text-o-text-2">{vorschau}</span>
      </span>
      {punkt ? <PunktMarke punkt={punkt} /> : null}
    </button>
  );
}

export function PunktMarke({ punkt, ring, groesse = 8 }: { punkt: Exclude<Punkt, null>; ring?: boolean; groesse?: number }) {
  return (
    <span
      data-punkt={punkt}
      aria-label={punkt === "fertig" ? "New message" : "Needs you"}
      role="img"
      className={cx("block shrink-0 rounded-full", ring && "border-2 border-solid border-o-sidebar box-content")}
      style={{ width: groesse, height: groesse, background: punkt === "fertig" ? "var(--orbit-done)" : "var(--chat-punkt-braucht)" }}
    />
  );
}

/** Hauptorbi-Kachel passt sich dem Namen an, eingeklappt bleibt nur die Figur. */
export function HauptorbiKachel({
  daten, name, ausgewaehlt, klein, punkt, onClick, onContextMenu,
}: { daten: FigurDaten; name: string; ausgewaehlt: boolean; klein?: boolean; punkt?: Punkt; onClick?: () => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  const figur = klein ? 36 : 56;
  return (
    <button
      type="button"
      data-hauptorbi
      aria-current={ausgewaehlt ? "true" : undefined}
      title={name}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cx(
        "orbit-ui relative flex shrink-0 flex-col items-center rounded-[12px] cursor-default",
        klein ? "h-[52px] w-[52px] justify-center" : "min-h-[104px] w-fit min-w-24 max-w-[min(100%,160px)] justify-center gap-2 px-3 py-[11px]",
        ausgewaehlt ? "bg-o-selected hover:bg-o-selected-hover data-[zustand=hover]:bg-o-selected-hover" : TINT, FOKUS_RING,
      )}
    >
      <span className="relative flex shrink-0 origin-top-left" style={{ width: figur, height: figur }} data-flip="haupt" data-flip-skala>
        <Figur d={daten} size={figur} />
        <span
          aria-hidden="true"
          className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-solid border-o-sidebar text-white"
          style={{ background: "var(--orbit-orbi-gelborange)", boxSizing: "border-box" }}
        >
          <Symbol name="star" groesse={10} fill="currentColor" stroke="none" />
        </span>
        {punkt && klein ? <span className="absolute -right-1 -top-1"><PunktMarke punkt={punkt} ring groesse={6} /></span> : null}
      </span>
      {klein ? null : (
        <span data-flip-text className={cx("max-w-full text-center text-[13px] leading-[18px] [overflow-wrap:anywhere]", ausgewaehlt ? "text-o-text" : "text-o-text-2")}>{name}</span>
      )}
    </button>
  );
}

/** Live-Zeile 36: Figur 20 und "<Orbi> arbeitet · …". */
export function LiveZeile({ daten, text }: { daten: FigurDaten; text: string }) {
  return (
    <div data-live role="status" className="orbit-ui flex h-9 items-center gap-2 py-[7px] text-[15px] leading-[22px] text-o-text-2">
      <Figur d={daten} size={20} state="lebendig" />
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
}

/** Systemzeile 22: Text, Symbol, Detail, mittig. */
export function Systemzeile({ text, symbol, detail }: { text: string; symbol: string; detail?: string }) {
  return (
    <div data-systemzeile className="orbit-ui flex min-h-[22px] items-center justify-center gap-1.5 py-0.5 text-[13px] leading-[18px] text-o-text-2">
      <span>{text}</span>
      <Symbol name={symbol} groesse={16} />
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

/** Karte mit Symbolkachel, Titel, Untertitel und Knöpfen (Figma 6.3: "Routine verpasst", "Bei … anmelden"). */
export function AktionsKarte({
  symbol, titel, untertitel, aktionen, farbeSymbol, rolle,
}: {
  symbol: SymbolName; titel: string; untertitel?: string; farbeSymbol?: string; rolle?: "alert" | "status";
  aktionen: { text: string; art?: "primaer" | "zweitrangig"; onClick: () => void }[];
}) {
  const knoepfe = aktionen.map((a, i) => (
    <Knopf key={a.text + i} art={a.art ?? (i === aktionen.length - 1 ? "primaer" : "zweitrangig")} onClick={a.onClick}>
      {a.text}
    </Knopf>
  ));
  const einzeln = aktionen.length === 1;
  return (
    <div
      role={rolle}
      data-aktionskarte
      className="orbit-ui flex w-full max-w-[560px] flex-col gap-3 rounded-o-dialog border border-solid border-o-card-border bg-o-raised px-4 py-3.5"
    >
      <div className="flex items-center gap-3">
        <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-o-sm border border-solid border-o-card-border", farbeSymbol ?? "text-o-text")}>
          <Symbol name={symbol} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[14px] leading-5 font-medium text-o-text">{titel}</span>
          {untertitel ? <span className="text-[13px] leading-[18px] text-o-text-2">{untertitel}</span> : null}
        </div>
        {einzeln ? knoepfe : null}
      </div>
      {einzeln ? null : <div className="flex items-center justify-end gap-2">{knoepfe}</div>}
    </div>
  );
}

export type { OrbiFarbe, ReactNode };

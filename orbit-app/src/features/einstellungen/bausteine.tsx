import { useEffect, useRef, type ReactNode } from "react";
import { Knopf, Schalter, Symbol, cx, type SymbolName } from "../../ui";
import { MARKEN_NAMEN } from "../../ui";
import "./einstellungen.css";
import { Orbi } from "../../orbi";
import { farbName, farbHex, useDunkel } from "../onboarding/dunkel";
import "../onboarding/erststart.css";

// Bausteine der Einstellungen (Figma 07): Gruppenkarte, Zeile, Pillengruppe, Auswahl-Pille, Dialog, Logo, Status.
// Eigene Bausteine, weil Figma 07 von ui/Gruppe abweicht (Karte Radius 16 mit Rand, Zeilen 12/16, Überschrift 13).

export function Abschnitt({ titel, children, className, anker }: { titel?: string; children: ReactNode; className?: string; anker?: string }) {
  return (
    <section className={cx("flex flex-col gap-2", className)} data-anchor={anker}>
      {titel ? <h2 className="text-[13px] leading-[18px] text-o-text-2">{titel}</h2> : null}
      {children}
    </section>
  );
}

export function Karte({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("overflow-hidden rounded-[16px] border border-solid border-o-card-border bg-o-raised [&>*+*]:border-t [&>*+*]:border-solid [&>*+*]:border-o-line", className)}>{children}</div>;
}

/** Zeile in einer Karte: links Titel (und Beschreibung), rechts Bedienelement. */
export function Zeile({ titel, beschreibung, symbol, vorn, children, onClick, hoehe, fokusId }: {
  titel: ReactNode; beschreibung?: ReactNode; symbol?: SymbolName; vorn?: ReactNode; children?: ReactNode; onClick?: () => void; hoehe?: number; fokusId?: string;
}) {
  const inhalt = (
    <>
      {vorn ?? (symbol ? <span className="flex h-4 w-4 shrink-0 items-center justify-center text-o-text-2"><Symbol name={symbol} /></span> : null)}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] leading-5 text-o-text">{titel}</span>
        {beschreibung ? <span className="text-[13px] leading-[18px] text-o-text-2">{beschreibung}</span> : null}
      </span>
      {children ? <span className="flex shrink-0 items-center gap-2">{children}</span> : null}
    </>
  );
  const klasse = "orbit-ui flex w-full items-center gap-3 px-4 py-3 text-left";
  const stil = hoehe ? { minHeight: hoehe } : undefined;
  if (onClick) {
    return (
      <div role="button" tabIndex={0} data-fokus={fokusId} onClick={onClick} style={stil}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
        className={cx(klasse, "cursor-default outline-none transition-colors hover:bg-o-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-o-focus")}>
        {inhalt}
      </div>
    );
  }
  return <div className={klasse} style={stil}>{inhalt}</div>;
}

export function SchalterZeile({ titel, beschreibung, an, onChange, symbol, aus }: {
  titel: string; beschreibung?: string; an: boolean; onChange: (an: boolean) => void; symbol?: SymbolName; aus?: boolean;
}) {
  return (
    <Zeile titel={titel} beschreibung={beschreibung} symbol={symbol}>
      <Schalter checked={an} onChange={onChange} aria-label={titel} disabled={aus} />
    </Zeile>
  );
}

/** Pillengruppe (D57): zarte Spur, die gewählte Pille hell und gleitend. Alle Pillen gleich breit. */
export function Pillen<T extends string>({ wert, optionen, onChange, breite = 78, label }: {
  wert: T; optionen: { wert: T; text: string }[]; onChange: (w: T) => void; breite?: number; label: string;
}) {
  const i = Math.max(0, optionen.findIndex((o) => o.wert === wert));
  return (
    <div role="tablist" aria-label={label} className="orbit-ui relative inline-flex h-[34px] shrink-0 rounded-full bg-[var(--o-spur)] p-[3px]">
      <span aria-hidden="true" className="o-schieber absolute top-[3px] h-7 rounded-full bg-[var(--o-schieber)]"
        style={{ left: 3, width: breite, transform: `translateX(${i * breite}px)`, boxShadow: "var(--o-schieber-schatten)" }} />
      {optionen.map((o) => (
        <button key={o.wert} type="button" role="tab" aria-selected={o.wert === wert} onClick={() => onChange(o.wert)} style={{ width: breite }}
          className={cx("relative z-10 h-7 rounded-full text-[14px] leading-5 outline-none focus-visible:outline-2 focus-visible:outline-o-focus cursor-default", o.wert === wert ? "font-medium text-o-text" : "text-o-text-2")}>
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** Filter-Pillen (Kategorien): nur die gewählte hat eine Fläche. */
export function Filter<T extends string>({ wert, optionen, onChange }: { wert: T; optionen: { wert: T; text: string }[]; onChange: (w: T) => void }) {
  return (
    <div role="tablist" aria-label="Category" className="flex flex-wrap gap-0.5">
      {optionen.map((o) => (
        <button key={o.wert} type="button" role="tab" aria-selected={o.wert === wert} onClick={() => onChange(o.wert)}
          className={cx("h-[30px] rounded-full px-2.5 text-[14px] leading-5 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-o-focus cursor-default", o.wert === wert ? "bg-o-selected font-medium text-o-text" : "text-o-text-2 hover:bg-o-hover")}>
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** Auswahl als gefüllte Pille (Figma „Auswahl“ in 07): natives select, Wert + Pfeil. */
export function PillenAuswahl({ wert, optionen, onChange, label, aus }: {
  wert: string; optionen: { wert: string; text: string }[]; onChange: (w: string) => void; label: string; aus?: boolean;
}) {
  return (
    <span className="orbit-ui relative inline-flex h-[30px] items-center rounded-full bg-o-field">
      <select aria-label={label} value={wert} disabled={aus} onChange={(e) => onChange(e.target.value)}
        className="h-[30px] cursor-default appearance-none rounded-full bg-transparent py-[5px] pl-2.5 pr-8 text-[14px] leading-5 text-o-text outline-none focus-visible:outline-2 focus-visible:outline-o-focus disabled:opacity-40">
        {optionen.map((o) => <option key={o.wert} value={o.wert}>{o.text}</option>)}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-2.5 text-o-text-2"><Symbol name="chevd" /></span>
    </span>
  );
}

export function Status({ ok, text }: { ok: boolean | "warn"; text: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[13px] leading-[18px] text-o-text-2">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ok === true ? "var(--orbit-success)" : ok === "warn" ? "var(--o-warn)" : "var(--orbit-text-3)" }} />
      {text}
    </span>
  );
}

export function Eingabe({ wert, onChange, onBlur, platzhalter, label, breite = 280, maxLength, onEnter }: {
  wert: string; onChange: (v: string) => void; onBlur?: () => void; platzhalter?: string; label: string; breite?: number; maxLength?: number; onEnter?: () => void;
}) {
  return (
    <input aria-label={label} value={wert} maxLength={maxLength} placeholder={platzhalter} style={{ width: breite }}
      onChange={(e) => onChange(e.target.value)} onBlur={onBlur} onKeyDown={(e) => { if (e.key === "Enter") onEnter?.(); }}
      className="orbit-ui h-9 rounded-o-control bg-o-field px-3 text-[14px] leading-5 text-o-text outline-none placeholder:text-o-text-3 focus-visible:outline-2 focus-visible:outline-o-focus" />
  );
}

export function Fehlerband({ text, onWeg }: { text: string | null; onWeg?: () => void }) {
  if (!text) return null;
  return (
    <div role="alert" className="flex items-center gap-3 rounded-[16px] bg-o-btn-danger px-4 py-3 text-[14px] leading-5 text-o-danger">
      <Symbol name="alert" />
      <span className="flex-1">{text}</span>
      {onWeg ? <button type="button" onClick={onWeg} aria-label="Close" className="cursor-default"><Symbol name="x" /></button> : null}
    </div>
  );
}

/** Dialog (Figma „Dialog“: Radius 24, Rand 24/22, dunkle Abdeckung 40 %). */
export function Dialog({ titel, children, onClose, breite = 440 }: { titel: string; children: ReactNode; onClose: () => void; breite?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const vorher = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,button")?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("keydown", esc); vorher?.focus?.(); };
  }, [onClose]);
  return (
    <div className="orbit-ui einst-abdunkeln fixed inset-0 z-50 flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={titel} style={{ width: breite }}
        className="einst-dialog orbit-pop flex [--pop-ursprung:center] flex-col gap-[18px] rounded-[24px] border border-solid border-o-card-border bg-o-raised px-6 py-[22px]">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[17px] leading-6 font-semibold text-o-text">{titel}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-o-field text-o-text outline-none hover:bg-o-selected focus-visible:outline-2 focus-visible:outline-o-focus cursor-default">
            <Symbol name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function DialogFuss({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-2">{children}</div>;
}

/** Bestätigung vor Trennen und Entfernen. */
export function Bestaetigen({ titel, text, ja, onJa, onNein, laeuft }: { titel: string; text: string; ja: string; onJa: () => void; onNein: () => void; laeuft?: boolean }) {
  return (
    <Dialog titel={titel} onClose={onNein}>
      <p className="text-[14px] leading-5 text-o-text-2">{text}</p>
      <DialogFuss>
        <Knopf art="still" onClick={onNein}>Cancel</Knopf>
        <Knopf art="gefahr" onClick={onJa} disabled={laeuft}>{ja}</Knopf>
      </DialogFuss>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Logos

/** Marken des Symbolsatzes zu Plugin-Namen (Slug oder Name, klein geschrieben). */
export function markeFuer(slug: string, name = ""): string | null {
  const t = `${slug} ${name}`.toLowerCase();
  const tabelle: [RegExp, string][] = [
    [/gmail/, "gmail"], [/calendar|kalender/, "kalender"], [/drive/, "drive"], [/github/, "github"], [/notion/, "notion"], [/slack/, "slack"],
    [/todoist/, "todoist"], [/linear/, "linear"], [/dropbox/, "dropbox"], [/figma/, "figma"], [/spotify/, "spotify"], [/obsidian/, "obsidian"],
    [/trello/, "trello"], [/whatsapp/, "whatsapp"],
  ];
  const m = tabelle.find(([re]) => re.test(t))?.[1];
  return m && MARKEN_NAMEN.includes(m) ? m : null;
}

/** Logo des Plugins 1:1 von Composio (logoUrl), ohne Fläche dahinter. Ohne Composio-Logo: eigene Marke, zuletzt der Anfangsbuchstabe. */
export function LogoFlaeche({ slug, name, logoUrl, flaeche = 32, logo = 18 }: { slug: string; name: string; logoUrl?: string | null; flaeche?: number; logo?: number }) {
  const marke = markeFuer(slug, name);
  return (
    <span className="flex shrink-0 items-center justify-center" style={{ width: flaeche, height: flaeche }}>
      {logoUrl ? <img src={logoUrl} alt="" width={flaeche} height={flaeche} style={{ width: flaeche, height: flaeche, objectFit: "contain" }} />
        : marke ? <Symbol marke={marke} groesse={Math.max(logo, Math.round(flaeche * 0.75))} />
        : <span className="text-[13px] font-medium text-o-text-2">{name.charAt(0)}</span>}
    </span>
  );
}

/** Kleine Orbi-Figur für Zeilen (Sicherheit, Plugin-Detail). */
export function OrbiKlein({ avatar, color, groesse = 28 }: { avatar: string; color?: string | null; groesse?: number }) {
  const dunkel = useDunkel();
  const n = farbName(color);
  return <Orbi avatar={avatar} color={n ? farbHex(n, dunkel) : color} size={groesse} dark={dunkel} />;
}

export { Ladeanzeige as Laedt } from "../../ui";

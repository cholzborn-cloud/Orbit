import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Symbol, cx, type SymbolName } from "../../ui";
import { Orbi, eyeColor, gestalt, mische, mischeHex, punkteZuPfad, MORPH_SKALA, type OrbiState, type Pt } from "../../orbi";
import { subscribe } from "../../orbi/ticker";
import { FARBEN, farbHex, useDunkel, useWenigBewegung, type FarbName } from "./dunkel";

// Bausteine des Erststarts (Figma 04: Orbi lebendig, Logo, Auswahlkachel, Rechtzeile, Umschalter, Farbwahl, Fortschritt, Zurück).

/** Sichtbarer Körper der Figur in px (die Orbi-Komponente zeichnet den Körper mit etwa 86 % der Kantenlänge). */
export function OrbiFigur({ avatar, farbe, koerper, zustand = "blick", titel, blick, folgen = false }: {
  avatar: string; farbe: FarbName; koerper: number; zustand?: OrbiState; titel?: string;
  /** Die Augen folgen dem Mauszeiger. */
  folgen?: boolean;
  /** Blickrichtung von außen (siehe Orbi.lookAt), z. B. von der Bühne. */
  blick?: { current: { x: number; y: number } | null };
}) {
  const dunkel = useDunkel();
  const seite = Math.round(koerper / 0.86);
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: koerper, height: koerper }}>
      <Orbi avatar={avatar} color={farbHex(farbe, dunkel)} size={seite} state={zustand} dark={dunkel} title={titel} lookAt={blick} follow={folgen}
        style={{ position: "absolute", left: "50%", top: "50%", marginLeft: -seite / 2, marginTop: -seite / 2 }} />
    </span>
  );
}

/** Eine kleine Gruppe aus dem Erststart für Anmeldung und optionale Einrichtung. */
export function AuthOrbis() {
  return (
    <div aria-hidden="true" className="mx-auto flex h-18 items-center justify-center gap-2.5">
      <span className="mt-6"><OrbiFigur avatar="freddy" farbe="braun" koerper={24} zustand="lebendig" /></span>
      <span className="mb-4"><OrbiFigur avatar="trixi" farbe="violett" koerper={31} zustand="lebendig" /></span>
      <OrbiFigur avatar="nova" farbe="tuerkis" koerper={56} zustand="lebendig" />
      <span className="mb-2"><OrbiFigur avatar="citrus" farbe="gelborange" koerper={34} zustand="lebendig" /></span>
      <span className="mt-7"><OrbiFigur avatar="mopsi" farbe="fuchsia" koerper={24} zustand="lebendig" /></span>
    </div>
  );
}

/** Orbi, dessen Form und Farbe sich beim Wechsel fließend ineinander überführen: Umriss der Engine punktweise gemischt,
 *  Farbe überblendet, Beiwerk (Augen, Hinterteile) überblendet; kritisch gedämpfte Feder, rund 0,4 s, unterbrechbar. */
export function MorphFigur({ avatar, farbe, koerper, zustand = "lebendig" }: { avatar: string; farbe: FarbName; koerper: number; zustand?: OrbiState }) {
  const wenig = useWenigBewegung();
  const dunkel = useDunkel();
  const hex = farbHex(farbe, dunkel);
  const id = useId().replace(/:/g, "");
  const seite = Math.round(koerper / 0.86);
  const jetzt = useRef<{ avatar: string; hex: string }>({ avatar, hex });
  const von = useRef<{ pts: Pt[]; extras: NonNullable<ReturnType<typeof gestalt>>["extras"]; hex: string } | null>(null);
  const nach = useRef<{ g: NonNullable<ReturnType<typeof gestalt>>; hex: string } | null>(null);
  const [e, setE] = useState<number | null>(null);
  const eRef = useRef(0);

  useEffect(() => {
    if (jetzt.current.avatar === avatar && jetzt.current.hex === hex) return;
    const alt = jetzt.current;
    jetzt.current = { avatar, hex };
    const g1 = gestalt(avatar);
    const g0 = gestalt(alt.avatar);
    if (wenig || !g1 || !g0) { setE(null); return; }
    // Unterbrechung: vom aktuell gezeigten Zwischenbild aus weitermorphen.
    if (eRef.current > 0 && eRef.current < 1 && von.current && nach.current) {
      const m = mische(von.current.pts, nach.current.g.pts, eRef.current);
      von.current = { pts: m, extras: eRef.current > 0.5 ? nach.current.g.extras : von.current.extras, hex: mischeHex(von.current.hex, nach.current.hex, eRef.current) };
    } else von.current = { pts: g0.pts, extras: g0.extras, hex: alt.hex };
    nach.current = { g: g1, hex };
    const f = { v: 0, vel: 0 };
    eRef.current = 0.0001;
    setE(0.0001);
    let letzt = 0;
    const unsub = subscribe((t) => {
      const dt = letzt ? Math.min(0.05, t - letzt) : 1 / 30;
      letzt = t;
      const w = (2 * Math.PI) / 0.3;
      for (let r = dt; r > 1e-9; ) { const h = Math.min(r, 1 / 120); f.vel += (w * w * (1 - f.v) - 2 * w * f.vel) * h; f.v += f.vel * h; r -= h; }
      if (Math.abs(1 - f.v) < 0.004 && Math.abs(f.vel) < 0.05) { eRef.current = 1; setE(null); unsub(); return; }
      eRef.current = f.v;
      setE(f.v);
    }, { maxFps: 60 });
    return () => { unsub(); };
  }, [avatar, hex, wenig]);

  const morph = e !== null && von.current && nach.current;
  let overlay = null;
  if (morph) {
    const v = von.current!, n = nach.current!;
    const pts = mische(v.pts, n.g.pts, e!);
    const d = punkteZuPfad(pts);
    const farbeM = mischeHex(v.hex, n.hex, e!);
    const aug = eyeColor(farbeM, dunkel);
    const teile = (x: string[], o: number, k: string) => x.map((p, i) => <path key={`${k}${i}`} d={p} opacity={o} />);
    overlay = (
      <svg width={seite} height={seite} viewBox="10 10 80 80" aria-hidden="true" style={{ overflow: "visible", display: "block", position: "absolute", left: "50%", top: "50%", marginLeft: -seite / 2, marginTop: -seite / 2 }}>
        <defs><clipPath id={`mo-${id}`}><path d={d} /></clipPath></defs>
        <g transform={`translate(50 50) scale(${MORPH_SKALA})`} fill={farbeM}>
          {teile(v.extras.back, 1 - e!, "vb")}{teile(n.g.extras.back, e!, "nb")}
          <path d={d} />
          <g clipPath={`url(#mo-${id})`} fill={aug}>{teile(v.extras.eyes, 1 - e!, "ve")}{teile(n.g.extras.eyes, e!, "ne")}</g>
          {teile(v.extras.front, 1 - e!, "vf")}{teile(n.g.extras.front, e!, "nf")}
        </g>
      </svg>
    );
  }
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: koerper, height: koerper }} data-morph={morph ? "an" : "aus"}>
      <span style={{ opacity: morph ? 0 : 1, display: "inline-flex" }}>
        <OrbiFigur avatar={avatar} farbe={farbe} koerper={koerper} zustand={zustand} />
      </span>
      {overlay}
    </span>
  );
}

/** Logo einer Marke (Figma „Logo“, 24 px). */
export function Logo({ marke, groesse = 24 }: { marke: string; groesse?: number }) {
  return <Symbol marke={marke} groesse={groesse} />;
}

/** Fortschritt: sechs Punkte, der aktive ist 24 breit, erledigte sind voll. */
export function Fortschritt({ aktiv }: { aktiv: number }) {
  return (
    <div className="absolute left-1/2 top-[26px] flex -translate-x-1/2 items-center gap-[6px]" role="progressbar" aria-valuemin={1} aria-valuemax={6} aria-valuenow={aktiv} aria-label="Progress">
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <span key={n} className={cx("h-2 rounded-full transition-[width,background-color] duration-[var(--orbit-dur-lang,400ms)] ease-[var(--orbit-ease)]", n === aktiv ? "w-6" : "w-2", n <= aktiv ? "bg-o-text" : "bg-o-selected")} />
      ))}
    </div>
  );
}

export function ZurueckKnopf({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Back"
      className="orbit-ui absolute z-20 left-5 top-[52px] flex h-9 w-9 items-center justify-center rounded-full bg-o-surface text-o-text outline-none transition-colors hover:bg-o-selected focus-visible:outline-2 focus-visible:outline-o-focus cursor-default">
      <Symbol name="zurueck" />
    </button>
  );
}

/** Auswahlkachel (Figma 53:102617): 190×108 breit, 126×108 schmal; An = graue Fläche, Haken gefüllt. */
export function Auswahlkachel({ marke, logoUrl, name, untertitel, an, breit, onClick, beschaeftigt, titel, disabled }: {
  marke: string; /** Logo von Composio (1:1, ohne Fläche); ohne Angabe die eigene Marke. */ logoUrl?: string | null; name: string; untertitel: string; an: boolean; breit?: boolean; onClick: () => void; beschaeftigt?: boolean; titel?: string; disabled?: boolean;
}) {
  return (
    <button type="button" role="checkbox" aria-checked={an} disabled={disabled} onClick={onClick} title={titel} data-wert={an ? "an" : "aus"}
      className={cx(
        "orbit-ui o-kachel flex h-[108px] flex-col justify-between rounded-[16px] border border-solid p-[14px] text-left outline-none cursor-default",
        "focus-visible:outline-2 focus-visible:outline-o-focus disabled:opacity-50",
        breit ? "w-[190px]" : "w-[126px]",
        an ? "border-transparent bg-o-selected" : "border-o-card-border bg-o-raised hover:bg-o-hover",
      )}>
      <span className="flex w-full items-start justify-between">
        {logoUrl ? <img src={logoUrl} alt="" width={28} height={28} style={{ width: 28, height: 28, objectFit: "contain" }} /> : <Logo marke={marke} groesse={28} />}
        <span className={cx("o-haken mt-1 flex h-5 w-5 items-center justify-center rounded-full", an ? "bg-o-btn-primary text-o-on-primary" : "border-[1.5px] border-solid border-o-check-edge")}>
          {an ? <Symbol name="check" groesse={12} /> : null}
        </span>
      </span>
      <span className="flex flex-col">
        <span className="text-[14px] leading-5 font-medium text-o-text">{name}</span>
        <span className={cx("text-[13px] leading-[18px] text-o-text-2", beschaeftigt && "animate-pulse")}>{untertitel}</span>
      </span>
    </button>
  );
}

/** Rechtzeile (Figma 53:102798): Symbolkachel, Name, rechts „Erlauben“ (offen) oder grünes „Erlaubt“. */
export function Rechtzeile({ symbol, name, erlaubt, onClick, beschaeftigt, detail }: {
  symbol: SymbolName; name: string; erlaubt: boolean; onClick: () => void; beschaeftigt?: boolean; detail?: string;
}) {
  return (
    <button type="button" onClick={onClick} data-wert={erlaubt ? "erlaubt" : "offen"} title={detail}
      className="orbit-ui flex h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors hover:bg-o-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-o-focus cursor-default">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-o-sm border border-solid border-o-card-border text-o-text">
        <Symbol name={symbol} />
      </span>
      <span className="flex-1 truncate text-[14px] leading-5 font-medium text-o-text">{name}</span>
      {erlaubt ? (
        <span className="flex h-8 items-center gap-1.5 rounded-full py-1.5 pl-1 pr-1 text-[14px] leading-5 font-medium text-o-success">
          <Symbol name="check" />
          Allowed
        </span>
      ) : (
        <span className={cx("flex h-8 items-center gap-1.5 rounded-full bg-o-selected px-[14px] text-[14px] leading-5 font-medium text-o-text", beschaeftigt && "animate-pulse")}>
          Allow
        </span>
      )}
    </button>
  );
}

/** Umschalter „Registrieren | Anmelden“ (Figma 53:102819): gleitender Schieber, Fläche 5 %. */
export function Umschalter<T extends string>({ wert, optionen, onChange, label }: {
  wert: T; optionen: { wert: T; text: string }[]; onChange: (w: T) => void; label: string;
}) {
  const i = Math.max(0, optionen.findIndex((o) => o.wert === wert));
  return (
    <div role="tablist" aria-label={label} className="orbit-ui o-umschalter relative flex h-9 w-full rounded-full bg-[var(--o-spur)] p-[3px]">
      <span aria-hidden="true" className="o-schieber absolute top-[3px] h-[30px] rounded-full bg-[var(--o-schieber)] shadow-[0_1px_3px_rgb(0_0_0/0.10)]"
        style={{ width: `calc((100% - 6px) / ${optionen.length})`, transform: `translateX(${i * 100}%)`, left: 3 }} />
      {optionen.map((o) => (
        <button key={o.wert} type="button" role="tab" aria-selected={o.wert === wert} onClick={() => onChange(o.wert)}
          className={cx("relative z-10 flex-1 rounded-full text-[14px] leading-5 outline-none focus-visible:outline-2 focus-visible:outline-o-focus cursor-default", o.wert === wert ? "font-medium text-o-text" : "text-o-text-2")}>
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** Farbwahl (Figma 53:103888): große lebendige Vorschau und 14 Punkte, der gewählte mit Ring. */
export function Farbwahl({ avatar, farbe, onChange }: { avatar: string; farbe: FarbName; onChange: (f: FarbName) => void }) {
  const dunkel = useDunkel();
  return (
    <div className="orbit-ui flex w-[442px] flex-col items-center gap-6">
      <div className="o-erster flex h-[140px] w-[140px] items-center justify-center" data-anker="orbi">
        {/* Formwechsel: die neue Figur blendet ruhig ein (key = Form); die Augen folgen dem Zeiger. */}
        <span key={avatar} className="o-orbi-wechsel inline-flex">
          <OrbiFigur avatar={avatar} farbe={farbe} koerper={122} zustand="lebendig" folgen />
        </span>
      </div>
      <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1.5">
        {FARBEN.map((f) => {
          const an = f.name === farbe;
          return (
            <button key={f.name} type="button" role="radio" aria-checked={an} aria-label={f.text} onClick={() => onChange(f.name)}
              className={cx("o-punkt flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-solid outline-none focus-visible:outline-2 focus-visible:outline-o-focus cursor-default", an ? "border-o-text" : "border-transparent")}>
              <span className="block rounded-full transition-[width,height] duration-[var(--orbit-dur)]" style={{ width: an ? 18 : 20, height: an ? 18 : 20, backgroundColor: dunkel ? f.dunkel : f.hell }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Kopf({ titel, untertitel }: { titel: string; untertitel?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <h1 className="text-[22px] leading-[28px] font-semibold tracking-[-0.01em] text-o-text">{titel}</h1>
      {untertitel ? <p className="text-[15px] leading-[22px] text-o-text-2">{untertitel}</p> : null}
    </div>
  );
}

export function Google() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.96 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export function GitHub() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="currentColor">
      <path fillRule="evenodd" d="M9 0C4.03 0 0 4.1 0 9.16c0 4.05 2.58 7.48 6.15 8.69.45.08.61-.2.61-.44 0-.22-.01-.94-.01-1.7-2.5.55-3.03-.62-3.22-1.19-.11-.28-.58-1.19-.99-1.43-.34-.19-.82-.64-.01-.65.76-.01 1.3.71 1.48 1.01.87 1.48 2.25 1.06 2.8.81.09-.64.34-1.06.61-1.31-2.14-.25-4.38-1.09-4.38-4.85 0-1.07.37-1.95 1-2.64-.1-.25-.43-1.27.09-2.64 0 0 .81-.26 2.67 1.01a9.1 9.1 0 0 1 2.43-.33c.82 0 1.65.11 2.43.33 1.85-1.28 2.66-1.01 2.66-1.01.53 1.37.2 2.39.1 2.64.62.69 1 1.57 1 2.64 0 3.77-2.25 4.6-4.4 4.85.35.3.65.9.65 1.81 0 1.31-.01 2.36-.01 2.68 0 .24.16.53.61.44A9.18 9.18 0 0 0 18 9.16C18 4.1 13.97 0 9 0z" />
    </svg>
  );
}

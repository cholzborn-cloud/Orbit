import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Feld, Knopf, Symbol, cx } from "../../ui";
import { Logo } from "./bausteine";
import { useOrbit } from "../../lib/store";
import { vorgeladen } from "../../lib/vorladen";
import { cliAbbruch, cliInstall, cliLogin, cliLoginEingabe, cliTrennen, clis, openUrl, type Cli } from "./dienst";
import { fehlerText, useWenigBewegung } from "./dunkel";

// Programme verbinden (Claude Code, Codex, Cursor, Antigravity): Status, Installieren, Anmelden, Abbrechen.
// Quelle: SCHNITTSTELLE.md 2.10 und orbitd/cli/setup.py. Fortschritt kommt aus dem Ereignis `cli-setup`
// (phase install | login | done | error); nach done/error wird der Status frisch geholt.

/** Sicherheitsnetz, falls der Ereignis-Strom gerade getrennt ist: sehr langsam nachsehen, nur solange ein Vorgang läuft. */
export const NETZ_MS = 8000;

export interface Lokal {
  /** Anfrage an den Dienst unterwegs (fängt Mehrfachklicks ab). */
  aktion?: "install" | "login" | "abbruch" | "disconnect";
  url?: string | null;
  code?: string | null;
  fehler?: string | null;
}

export type Vorgang = "install" | "login" | null;

export function vorgangVon(c: Cli | undefined, l: Lokal | undefined): Vorgang {
  if (l?.aktion === "install" || c?.busy === "install") return "install";
  if (l?.aktion === "login" || c?.busy === "login") return "login";
  if (c?.busy === "disconnect") return null;
  // Älterer Dienststand ohne Art: nur „läuft“, dann zählt die Meldung.
  if (c?.busy === true || c?.state === "laeuft") return /anmeld|sign-?in|login/.test((c.message || "").toLowerCase()) ? "login" : "install";
  return null;
}

/** Die deutsche Fehlerzeile je Programm (lokaler Fehler vor Dienststand). */
export function fehlerVon(c: Cli | undefined, l: Lokal | undefined, vorgang: Vorgang): string | null {
  if (vorgang) return null;
  if (l?.fehler) return l.fehler;
  if (c?.state === "fehler") return c.message || "That did not work.";
  return null;
}

export interface ProgrammSteuerung {
  /** Ein Klick: installieren (falls nötig), danach anmelden, danach „bereit“. */
  verbinden: (id: string) => Promise<void>;
  liste: Cli[];
  geladen: boolean;
  fehler: string | null;
  lokal: Record<string, Lokal>;
  installieren: (id: string) => Promise<void>;
  anmelden: (id: string) => Promise<void>;
  abbrechen: (id: string) => Promise<void>;
  trennen: (id: string) => Promise<void>;
  erneutVerbinden: (id: string) => Promise<void>;
  wiederholen: (id: string) => Promise<void>;
  neuLaden: () => Promise<Cli[]>;
}

/** `beiFertig(id, cli)` wird gerufen, wenn ein Vorgang erfolgreich endete und das Programm danach bereit ist. */
export function useProgramme(beiFertig?: (id: string) => void, { frisch = false, konto = false } = {}): ProgrammSteuerung {
  const ereignisse = useOrbit((s) => s.cliSetup);
  const [liste, setListe] = useState<Cli[]>([]);
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [lokal, setLokalRoh] = useState<Record<string, Lokal>>({});
  const unterwegs = useRef(new Set<string>());
  /** Laufende Kette je Programm: erst Installieren, dann Anmelden. */
  const kette = useRef<Record<string, "install" | "login">>({});
  const abgebrochen = useRef(new Set<string>());
  const listeRef = useRef<Cli[]>([]);
  const abfrage = useRef(0);
  const gesehen = useRef<Record<string, unknown>>({ ...ereignisse }); // alte Ereignisse früherer Besuche überspringen
  const fertigRef = useRef(beiFertig);
  fertigRef.current = beiFertig;
  const lebt = useRef(true);
  useEffect(() => { lebt.current = true; return () => { lebt.current = false; }; }, []);
  listeRef.current = liste;

  const setLokal = useCallback((id: string, p: Lokal | ((alt: Lokal) => Lokal)) => {
    if (!lebt.current) return;
    setLokalRoh((alt) => ({ ...alt, [id]: typeof p === "function" ? p(alt[id] ?? {}) : { ...(alt[id] ?? {}), ...p } }));
  }, []);

  const neuLaden = useCallback(async (): Promise<Cli[]> => {
    if (!lebt.current) return [];
    const nummer = ++abfrage.current;
    try {
      const r = await clis(true, konto);
      const l = r.clis ?? [];
      if (lebt.current && abfrage.current === nummer) { setListe(l); setFehler(null); setGeladen(true); }
      return l;
    } catch (x) {
      if (lebt.current && abfrage.current === nummer) { setFehler(fehlerText(x)); setGeladen(true); }
      return [];
    }
  }, [konto]);

  useEffect(() => {
    if (frisch) {
      void neuLaden();
      return;
    }
    vorgeladen("clis", () => clis(false)).then((r) => { if (lebt.current) { setListe(r.clis ?? []); setGeladen(true); } })
      .catch((x) => { if (lebt.current) { setFehler(fehlerText(x)); setGeladen(true); } });
  }, [frisch, neuLaden]);

  /** Nächster Schritt der Kette. `ende`: Ereignis „done“ kam, mehr passiert nicht von allein. */
  const voran = useCallback((id: string, l: Cli[], ende: boolean) => {
    const st = kette.current[id];
    if (!st) return;
    const c = l.find((x) => x.id === id);
    if (!c) return;
    if (c.state === "fehler" && !unterwegs.current.has(id)) {
      delete kette.current[id];
      setLokal(id, { fehler: c.message, url: null, code: null });
      return;
    }
    if (c.state === "bereit") { delete kette.current[id]; fertigRef.current?.(id); return; }
    if (st === "install" && c.installed && vorgangVon(c, undefined) === null && !unterwegs.current.has(id)) {
      kette.current[id] = "login";
      void anmeldenRef.current?.(id);
    } else if (st === "login" && (ende || !unterwegs.current.has(id)) && vorgangVon(c, undefined) === null) {
      delete kette.current[id];
      setLokal(id, { fehler: "The sign-in has not arrived yet. Try again." });
    }
  }, [setLokal]);
  const anmeldenRef = useRef<((id: string) => Promise<void>) | null>(null);

  // Ereignis `cli-setup`: Ende (done/error) -> Status frisch prüfen.
  useEffect(() => {
    for (const [id, ev] of Object.entries(ereignisse)) {
      if (gesehen.current[id] === ev) continue;
      gesehen.current[id] = ev;
      if (ev.phase === "done") {
        setLokal(id, { url: null, code: null, fehler: null });
        void neuLaden().then((l) => {
          if (l.find((c) => c.id === id)?.state === "bereit" && !kette.current[id]) fertigRef.current?.(id);
          else voran(id, l, true);
        });
      } else if (ev.phase === "error") {
        delete kette.current[id];
        const eigener = abgebrochen.current.has(id);
        setLokal(id, { url: null, code: null, fehler: eigener ? null : ev.message || "That did not work." });
        void neuLaden();
      }
    }
  }, [ereignisse, neuLaden, setLokal, voran]);

  // Falls ein Ereignis ausbleibt: jede frische Liste bringt die Kette weiter.
  useEffect(() => { for (const id of Object.keys(kette.current)) voran(id, liste, false); }, [liste, voran]);

  // Sicherheitsnetz (langsam), nur solange etwas läuft.
  const laeuftWas = liste.some((c) => vorgangVon(c, lokal[c.id]) !== null);
  useEffect(() => {
    if (!laeuftWas) return;
    const auffrischen = () => { void neuLaden(); };
    const t = setInterval(auffrischen, NETZ_MS);
    window.addEventListener("focus", auffrischen);
    return () => { clearInterval(t); window.removeEventListener("focus", auffrischen); };
  }, [laeuftWas, neuLaden]);

  /** Genau eine Anfrage je Programm gleichzeitig. */
  const einmal = useCallback(async (id: string, aktion: NonNullable<Lokal["aktion"]>, lauf: () => Promise<void>) => {
    if (unterwegs.current.has(id)) return;
    unterwegs.current.add(id);
    setLokal(id, { aktion });
    try {
      await lauf();
    } catch (x) {
      delete kette.current[id];
      if (lebt.current) setLokal(id, { fehler: fehlerText(x) });
    } finally {
      if (aktion === "disconnect") await neuLaden();
      unterwegs.current.delete(id);
      if (lebt.current) setLokal(id, { aktion: undefined });
      if (aktion !== "disconnect") await neuLaden();
    }
  }, [neuLaden, setLokal]);

  const installieren = useCallback((id: string) => einmal(id, "install", async () => {
    setLokal(id, { fehler: null });
    await cliInstall(id);
  }), [einmal, setLokal]);

  const browserAnmeldung = useCallback(async (id: string) => {
    setLokal(id, { fehler: null, url: null, code: null });
    const r = await cliLogin(id);
    if (abgebrochen.current.has(id)) return;
    setLokal(id, { url: r.url ?? null, code: r.code ?? null });
    if (r.url && !r.opensBrowser) {
      try { await openUrl(r.url); } catch { setLokal(id, { fehler: "The browser could not be opened. Copy the address and open it yourself." }); }
    }
  }, [setLokal]);

  const anmelden = useCallback((id: string) => einmal(id, "login", () => browserAnmeldung(id)), [einmal, browserAnmeldung]);
  anmeldenRef.current = anmelden;

  const abbrechen = useCallback(async (id: string) => {
    delete kette.current[id];
    abgebrochen.current.add(id);
    setLokal(id, { url: null, code: null, fehler: null });
    try { await cliAbbruch(id); }
    catch (x) { setLokal(id, { fehler: fehlerText(x) }); }
    finally { await neuLaden(); }
  }, [neuLaden, setLokal]);

  const verbinden = useCallback(async (id: string) => {
    if (unterwegs.current.has(id) || kette.current[id]) return;
    const c = listeRef.current.find((x) => x.id === id);
    abgebrochen.current.delete(id);
    if (c?.state === "bereit") { fertigRef.current?.(id); return; }
    setLokal(id, { fehler: null });
    if (!c || !c.installed) { kette.current[id] = "install"; return installieren(id); }
    kette.current[id] = "login";
    return anmelden(id);
  }, [anmelden, installieren, setLokal]);

  const wiederholen = useCallback(async (id: string) => {
    if (unterwegs.current.has(id)) return;
    delete kette.current[id];
    return verbinden(id);
  }, [verbinden]);

  const abmelden = async (id: string) => {
    setLokal(id, { fehler: null, url: null, code: null });
    await cliTrennen(id);
    abfrage.current++;
    if (lebt.current) {
      setListe((l) => l.map((c) => c.id === id
        ? { ...c, state: "abgemeldet", loggedIn: false, accountEmail: undefined, busy: null, loginUrl: null, loginCode: null, message: "" }
        : c));
    }
  };
  const trennen = (id: string) => einmal(id, "disconnect", () => abmelden(id));
  const erneutVerbinden = (id: string) => einmal(id, "disconnect", async () => {
    await abmelden(id);
    abgebrochen.current.delete(id);
    setLokal(id, { aktion: "login" });
    await browserAnmeldung(id);
  });
  return { liste, geladen, fehler, lokal, verbinden, installieren, anmelden, abbrechen, trennen, erneutVerbinden, wiederholen, neuLaden };
}

// ------------------------------------------------------------------ Anzeige

export interface Eintrag { id: string; name: string; marke: string }

const SCHRITTE = ["Install", "Sign in", "Connected"] as const;
/** Wie lange „Verbunden“ stehen bleibt, bevor die Karte in die Kachel zurückschrumpft. */
export const VERBUNDEN_MS = 800;
const DAUER = 320;
const KURVE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** Welcher der drei Schritte gerade dran ist (0 Installieren, 1 Anmelden, 2 Verbunden). */
export function schrittVon(c: Cli | undefined, vorgang: Vorgang): 0 | 1 | 2 {
  if (c?.state === "bereit" && !vorgang) return 2;
  if (vorgang === "login") return 1;
  if (vorgang === "install") return 0;
  return c?.installed ? 1 : 0;
}

/** Ein Satz, was gerade passiert. */
export function satzVon(name: string, c: Cli | undefined, vorgang: Vorgang, fehler: string | null, code: string | null): string {
  if (fehler) return "That did not work.";
  if (c?.state === "bereit" && !vorgang) return `${name} is connected.`;
  if (vorgang === "install") return `Installing ${name} for you …`;
  if (vorgang === "login") return code ? "Enter this code in the browser." : "Sign in in the browser. Orbit continues here afterwards.";
  return "One moment …";
}

/** Ruhiger Lauf-Balken mit Satz: zeigt, dass es weitergeht. Wartezeiten sind normal, der Satz sagt das. */
export function Warten({ text, hinweis = "This can take a moment." }: { text: string; hinweis?: string }) {
  return (
    <div role="status" aria-live="polite" data-warten="" className="flex flex-col gap-1.5">
      <div aria-hidden="true" className="relative h-1 w-full overflow-hidden rounded-full bg-o-line">
        <span className="o-lauf absolute inset-y-0 left-0 w-2/5 rounded-full bg-o-text" />
      </div>
      <p className="m-0 text-[13px] leading-[18px] text-o-text">{text}</p>
      <p className="m-0 text-[12px] leading-4 text-o-text-2">{hinweis}</p>
    </div>
  );
}

function Schrittanzeige({ aktuell, fehler }: { aktuell: number; fehler: boolean }) {
  return (
    <ol aria-label="Progress" className="m-0 flex list-none items-center gap-2 p-0">
      {SCHRITTE.map((t, i) => {
        const fertig = i < aktuell || (i === 2 && aktuell === 2);
        const jetzt = i === aktuell && !fertig;
        return (
          <li key={t} data-schritt={fertig ? "fertig" : jetzt ? "jetzt" : "offen"} aria-current={jetzt ? "step" : undefined}
            className="m-0 flex items-center gap-2 p-0">
            <span className={cx("flex h-4 w-4 items-center justify-center rounded-full",
              fertig ? "bg-o-btn-primary text-o-on-primary" : jetzt ? "border-[1.5px] border-solid border-o-text" : "border-[1.5px] border-solid border-o-check-edge")}>
              {fertig ? <Symbol name="check" groesse={10} /> : jetzt && !fehler ? <span className="h-1.5 w-1.5 rounded-full bg-o-text animate-pulse motion-reduce:animate-none" /> : null}
            </span>
            <span className={cx("text-[13px] leading-[18px]", fertig || jetzt ? "text-o-text" : "text-o-text-2")}>{t}</span>
            {i < SCHRITTE.length - 1 ? <span aria-hidden="true" className="h-px w-5 bg-o-line" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Die große Karte: Logo, Name, ein Satz, Schritte, Link, Code, Code-Eingabe, Abbrechen / Wiederholen. */
export function ProgrammKarte({ eintrag, cli, lokal, steuerung, zurueck }: {
  eintrag: Eintrag; cli: Cli | undefined; lokal?: Lokal; steuerung: ProgrammSteuerung; zurueck?: () => void;
}) {
  const ereignis = useOrbit((s) => s.cliSetup[eintrag.id]);
  const [kopiert, setKopiert] = useState(false);
  const [trennen, setTrennen] = useState(false);
  const [pruefend, setPruefend] = useState(false); // ein Code wurde gesendet, die Prüfung läuft
  const [nachlauf, setNachlauf] = useState(false); // kurz nach dem Ende: der Status wird noch bestätigt
  const vorgang = vorgangVon(cli, lokal);
  const vorher = useRef<Vorgang>(null);
  useEffect(() => {
    const war = vorher.current;
    vorher.current = vorgang;
    if (!vorgang) setPruefend(false);
    if (war && !vorgang && !fehlerVon(cli, lokal, vorgang)) {
      setNachlauf(true);
      const t = setTimeout(() => setNachlauf(false), 3000);
      return () => clearTimeout(t);
    }
  }, [vorgang]); // eslint-disable-line react-hooks/exhaustive-deps
  const fehler = fehlerVon(cli, lokal, vorgang);
  const belegt = lokal?.aktion !== undefined;
  const url = lokal?.url ?? cli?.loginUrl ?? null;
  const code = lokal?.code ?? cli?.loginCode ?? null;
  const art = cli?.loginKind ?? null;
  const zeigeFeld = vorgang === "login" && (art === "code-paste" || (!art && !code));
  const zeigeCode = vorgang === "login" && !!code && art !== "code-paste";
  const zeile = ereignis && (ereignis.phase === "install" || ereignis.phase === "login") ? ereignis.message : "";
  const aktuell = schrittVon(cli, vorgang);
  const fertig = aktuell === 2 || (!!cli?.loggedIn && !vorgang);
  const trennt = lokal?.aktion === "disconnect" || cli?.busy === "disconnect";
  const hilfe = zeigeFeld ? "Finish signing in in the browser. If a code appears, paste it here."
    : satzVon(eintrag.name, cli, vorgang, fehler, code);

  const kopieren = async () => {
    try { await navigator.clipboard.writeText(code ?? ""); setKopiert(true); setTimeout(() => setKopiert(false), 1500); } catch { /* ohne Zwischenablage bleibt der Code sichtbar */ }
  };
  const abbrechen = () => { if (vorgang) void steuerung.abbrechen(eintrag.id); zurueck?.(); };

  return (
    <div data-karte={eintrag.id} data-vorgang={vorgang ?? "keiner"} role="group"
      aria-label={zurueck ? `Connect ${eintrag.name}` : `Manage ${eintrag.name}`}
      className={cx("orbit-ui flex flex-col gap-3", zurueck ? "h-full min-h-[226px] p-[18px]" : "px-4 pb-4")}>
      {zurueck ? <div className="flex items-center gap-3">
        <button type="button" aria-label="Back to the selection" onClick={abbrechen}
          className="flex h-8 w-8 shrink-0 cursor-default items-center justify-center rounded-full text-o-text outline-none hover:bg-o-hover focus-visible:outline-2 focus-visible:outline-o-focus">
          <Symbol name="chevl" />
        </button>
        <Logo marke={eintrag.marke} groesse={28} />
        <div className="flex min-w-0 flex-col">
          <span className="text-[14px] font-medium leading-5 text-o-text">{eintrag.name}</span>
          <span aria-live="polite" className="text-[13px] leading-[18px] text-o-text-2">
            {hilfe}
          </span>
        </div>
      </div> : vorgang ? <p aria-live="polite" className="m-0 text-[13px] leading-[18px] text-o-text-2">{hilfe}</p> : null}

      {vorgang === "install" ? <Schrittanzeige aktuell={aktuell} fehler={!!fehler} /> : null}

      {zurueck || vorgang || nachlauf || fehler || (trennen && fertig) ? <div className="flex flex-1 flex-col justify-center gap-2">
        {vorgang === "install" ? (
          <>
            <div role="progressbar" aria-label={`Installing ${eintrag.name}`} className="h-1 w-full overflow-hidden rounded-full bg-o-line">
              <div className="h-full w-1/3 rounded-full bg-o-text animate-pulse motion-reduce:animate-none" />
            </div>
            {zeile ? <p className="m-0 truncate text-[12px] leading-4 text-o-text-2">{zeile}</p> : null}
          </>
        ) : null}
        {zeigeCode ? (
          <div className="flex items-center gap-3">
            <span aria-label="Sign-in code" className="select-text font-mono text-[28px] font-semibold leading-[34px] tracking-[0.08em] text-o-text">{code}</span>
            <Knopf art="zweitrangig" groesse="mittel" symbol="copy" onClick={() => void kopieren()}>{kopiert ? "Copied" : "Copy"}</Knopf>
          </div>
        ) : null}
        {vorgang === "login" && (url || code) && !pruefend ? <Warten text="Waiting for sign-in in the browser …" /> : null}
        {nachlauf && !vorgang && !fehler ? <Warten text={`Connecting ${eintrag.name} …`} hinweis="Almost done. The last step can take a moment too." /> : null}
        {zeigeFeld ? <CodeEingabe id={eintrag.id} neuLaden={steuerung.neuLaden} beiPruefen={setPruefend} /> : null}
        {fehler ? <p role="alert" className="m-0 text-[13px] leading-[18px] text-o-danger">{fehler}</p> : null}
        {trennen && fertig ? <p className="m-0 text-[13px] text-o-text-2">This signs the program out of the Orbit profile.</p> : null}
      </div> : null}

      {!zurueck && fertig && !trennt ? (
        <div className="min-w-0">
          <p className="m-0 text-[12px] leading-4 text-o-text-2">Account</p>
          <p className="m-0 select-text text-[14px] leading-5 text-o-text [overflow-wrap:anywhere]">
            {cli?.accountEmail ?? "Email not available"}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!zurueck && fertig && !trennt && !trennen ? (
          <Knopf art="zweitrangig" groesse="mittel" disabled={belegt} onClick={() => void steuerung.erneutVerbinden(eintrag.id)}>
            Reconnect
          </Knopf>
        ) : null}
        {vorgang === "login" && url ? <Knopf art="primaer" groesse="mittel" symbol="link" onClick={() => void openUrl(url)}>Open in browser</Knopf> : null}
        {!fertig && !vorgang && !trennt ? <Knopf art="primaer" groesse="mittel" disabled={belegt} onClick={() => void steuerung.wiederholen(eintrag.id)}>
          {fehler ? "Retry" : zurueck ? "Connect" : cli?.installed ? "Sign in" : "Install and connect"}
        </Knopf> : null}
        {fertig || trennt ? <Knopf art="still" groesse="mittel" disabled={belegt || trennt} onClick={() => {
          if (trennen) { setTrennen(false); void steuerung.trennen(eintrag.id); }
          else setTrennen(true);
        }}>{trennt ? "Disconnecting …" : trennen ? "Confirm disconnect" : "Disconnect"}</Knopf> : null}
        {trennen && fertig ? <Knopf art="still" groesse="mittel" onClick={() => setTrennen(false)}>Cancel</Knopf> : null}
        {vorgang ? <Knopf art="still" groesse="mittel" className="ml-auto" onClick={abbrechen}>Cancel</Knopf> : null}
      </div>
    </div>
  );
}

/**
 * Die Fläche der Kacheln. Ein Klick auf ein nicht verbundenes Programm startet die ganze Kette; die Kachel wächst dabei
 * zur großen Karte (nur transform/opacity), die anderen treten zurück. Nach „Verbunden“ schrumpft sie zurück.
 */
export function ProgrammFlaeche({ eintraege, liste, steuerung, kachel }: {
  eintraege: readonly Eintrag[];
  liste: Cli[];
  steuerung: ProgrammSteuerung;
  /** Zeichnet die Kachel; `klick` ruft die Fläche. */
  kachel: (e: Eintrag, klick: () => void) => ReactNode;
}) {
  return <VerbindungsFlaeche eintraege={eintraege} kachel={kachel} start={(id) => {
    const c = liste.find((x) => x.id === id);
    if (c?.state === "bereit") return "verwalten";
    if (!c && liste.length > 0) return false;
    void steuerung.verbinden(id);
    return true;
  }} istFertig={(id) => {
    const c = liste.find((x) => x.id === id);
    return c?.state === "bereit" && vorgangVon(c, steuerung.lokal[id]) === null;
  }} karteInhalt={(e, schliessen) => <ProgrammKarte eintrag={e} cli={liste.find((c) => c.id === e.id)}
    lokal={steuerung.lokal[e.id]} steuerung={steuerung} zurueck={schliessen} />} />;
}

export function VerbindungsFlaeche({ eintraege, kachel, start, istFertig, karteInhalt, dreiSpalten = false }: {
  eintraege: readonly Eintrag[];
  kachel: (e: Eintrag, klick: () => void) => ReactNode;
  start: (id: string) => boolean | "verwalten";
  istFertig: (id: string) => boolean;
  karteInhalt: (e: Eintrag, schliessen: () => void) => ReactNode;
  dreiSpalten?: boolean;
}) {
  const wenig = useWenigBewegung();
  const [aktiv, setAktiv] = useState<string | null>(null); // Kachel, die gerade groß sein soll
  const [automatik, setAutomatik] = useState(false);
  const [karte, setKarte] = useState<string | null>(null); // Karte ist eingehängt (auch beim Zurückschrumpfen)
  const buehne = useRef<HTMLDivElement>(null);
  const huelle = useRef<HTMLDivElement>(null);
  const inhalt = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation[]>([]);
  const zuletzt = useRef<string | null>(null); // diese Kachel erscheint nach dem Schrumpfen sofort, ohne Einblenden
  if (karte) zuletzt.current = karte;

  const stopp = () => { anim.current.forEach((a) => a.cancel()); anim.current = []; };
  /** Transform, der die volle Karte auf die Kachel `id` setzt. */
  const kachelAls = (id: string): string | null => {
    const k = huelle.current?.getBoundingClientRect();
    const t = Array.from(buehne.current?.querySelectorAll<HTMLElement>("[data-kachel]") ?? [])
      .find((el) => el.dataset.kachel === id)?.firstElementChild?.getBoundingClientRect();
    if (!k || !t || !k.width || !k.height) return null;
    return `translate(${t.left - k.left}px, ${t.top - k.top}px) scale(${t.width / k.width}, ${t.height / k.height})`;
  };

  // Öffnen: von der Kachel zur Karte.
  useLayoutEffect(() => {
    if (!aktiv || !huelle.current || !inhalt.current) return;
    stopp();
    const el = huelle.current, txt = inhalt.current;
    if (wenig || typeof el.animate !== "function") return;
    const von = kachelAls(aktiv);
    if (!von) return;
    const opt = { duration: DAUER, easing: KURVE, fill: "backwards" as const };
    anim.current = [
      el.animate([{ transform: von }, { transform: "none" }], opt),
      txt.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 120, easing: "ease-out", fill: "backwards" }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktiv, karte]);

  // Schließen: zurück in die Kachel, danach aushängen.
  const schliessen = useCallback(() => {
    setAktiv(null);
    const id = karte;
    const el = huelle.current, txt = inhalt.current;
    if (!id || !el || !txt || wenig || typeof el.animate !== "function") { stopp(); setKarte(null); return; }
    const nach = kachelAls(id);
    if (!nach) { stopp(); setKarte(null); return; }
    stopp();
    const a = el.animate([{ transform: "none" }, { transform: nach }], { duration: DAUER - 60, easing: KURVE, fill: "forwards" });
    const b = txt.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: "ease-in", fill: "forwards" });
    anim.current = [a, b];
    a.finished.then(() => { stopp(); setKarte(null); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [karte, wenig]);

  const klick = (e: Eintrag) => {
    if (karte) return;
    const art = start(e.id);
    if (!art) return;
    setAutomatik(art === true);
    setKarte(e.id); setAktiv(e.id);
  };

  // Nach „Verbunden“ kurz stehen lassen, dann zurück in die Kachel.
  const fertig = automatik && !!aktiv && istFertig(aktiv);
  useEffect(() => {
    if (!fertig) return;
    const t = setTimeout(schliessen, wenig ? 400 : VERBUNDEN_MS);
    return () => clearTimeout(t);
  }, [fertig, schliessen, wenig]);

  const eintrag = eintraege.find((e) => e.id === karte);
  return (
    <div ref={buehne} data-flaeche={aktiv ?? "auswahl"} className="relative grid">
      <div className={cx("col-start-1 row-start-1 grid gap-2.5", dreiSpalten ? "grid-cols-3" : "grid-cols-2")}>
        {eintraege.map((e) => {
          const gross = karte === e.id;
          return (
            <div key={e.id} data-kachel={e.id} inert={karte !== null ? true : undefined}
              style={{ opacity: karte ? 0 : 1, transform: karte && !gross ? "scale(0.96)" : "none",
                transition: wenig || gross || zuletzt.current === e.id ? "none" : "opacity 180ms ease-out, transform 220ms ease-out" }}>
              {kachel(e, () => klick(e))}
            </div>
          );
        })}
      </div>
      {eintrag ? (
        <div className="relative z-10 col-start-1 row-start-1 flex">
          <div ref={huelle} aria-hidden="true" style={{ transformOrigin: "0 0", willChange: "transform" }}
            className="absolute inset-0 rounded-[16px] border border-solid border-o-card-border bg-o-raised" />
          <div ref={inhalt} className="relative w-full">
            {karteInhalt(eintrag, schliessen)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Manche Programme zeigen nach der Browser-Anmeldung einen Code, den man im Programm eingeben muss. Hier wird er zurückgegeben. */
export function CodeEingabe({ id, neuLaden, beiPruefen }: { id: string; neuLaden: () => Promise<unknown>; beiPruefen?: (an: boolean) => void }) {
  const [text, setText] = useState("");
  const [sendet, setSendet] = useState(false);
  const [geprueft, setGeprueft] = useState(false); // Code ist raus, das Programm bestätigt noch
  const [fehler, setFehler] = useState<string | null>(null);
  const lebt = useRef(true);
  useEffect(() => { lebt.current = true; return () => { lebt.current = false; }; }, []);

  const senden = async () => {
    const t = text.trim();
    if (!t || sendet) return;
    setSendet(true); setFehler(null); beiPruefen?.(true);
    try {
      await cliLoginEingabe(id, t);
      if (lebt.current) { setText(""); setGeprueft(true); }
      await neuLaden();
    } catch (x) {
      if (lebt.current) { setFehler(fehlerText(x)); setGeprueft(false); }
      beiPruefen?.(false);
    } finally {
      if (lebt.current) setSendet(false);
    }
  };

  if (sendet || geprueft) return <Warten text="Checking code …" hinweis="Please wait. This can take a moment." />;
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void senden(); }}>
      <div className="flex items-end gap-2">
        <Feld className="flex-1" label="Paste the code from the browser" fehler={fehler ?? undefined} value={text} disabled={sendet} autoComplete="off" spellCheck={false}
          onChange={(e) => setText(e.target.value)} />
        <Knopf type="submit" art="primaer" groesse="mittel" disabled={sendet || !text.trim()}>{sendet ? "Sending …" : "Send"}</Knopf>
      </div>
    </form>
  );
}

export function statusText(c: Cli, vorgang: Vorgang): string {
  if (vorgang === "install") return "Installing …";
  if (vorgang === "login") return "Waiting for sign-in …";
  switch (c.state) {
    case "bereit": return "Connected";
    case "abgemeldet": return "Not signed in";
    case "fehlt": return "Not installed";
    case "fehler": return "Error";
    default: return "";
  }
}

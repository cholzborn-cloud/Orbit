import { useId, useRef, useState, type FormEvent } from "react";
import { Feld, Knopf, Symbol } from "../../ui";
import { getBudget, getKeys, getSettings, setBudget, setJev, setKey } from "../../lib/api";
import { openUrl } from "../../lib/tauri";
import { AuthOrbis } from "../onboarding/bausteine";
import { fehlerText } from "../onboarding/dunkel";
import { Abschnitt, Fehlerband, Karte, Laedt, SchalterZeile, Zeile } from "./bausteine";
import { useDaten } from "./store";

const DAYTONA = {
  key: "DAYTONA_API_KEY",
  name: "Daytona",
  beschreibung: "Cloud computer for your Orbis",
  symbol: "desktop",
  link: "https://app.daytona.io/dashboard/keys",
  anbieter: "Daytona",
};

const JEV = {
  key: "OPENROUTER_JEV_API_KEY",
  name: "Jev",
  beschreibung: "Automatic model selection",
  symbol: "sparkle",
  link: "https://openrouter.ai/keys",
  anbieter: "OpenRouter",
};

const BUDGET_OPTIONEN = [0, 0.5, 1, 2, 5, 10, 20, 50];
const ladeSchluessel = () => getKeys().then((r) => r.keys);

function DienstZeile({ dienst, gesetzt, offen, onOeffnen, onSchliessen, onGespeichert }: {
  dienst: typeof DAYTONA;
  gesetzt: boolean | undefined;
  offen: boolean;
  onOeffnen: () => void;
  onSchliessen: () => void;
  onGespeichert: () => Promise<void>;
}) {
  const id = useId();
  const zeile = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  function schliessen() {
    onSchliessen();
    zeile.current?.querySelector("button")?.focus();
  }

  return (
    <div ref={zeile}>
      <Zeile titel={<span className="font-medium">{dienst.name}</span>} symbol={dienst.symbol}
        beschreibung={dienst.beschreibung}>
        <Knopf art={gesetzt ? "still" : "zweitrangig"} aria-expanded={offen} aria-controls={id}
          aria-label={gesetzt ? `Key saved for ${dienst.name}` : `Add key for ${dienst.name}`}
          disabled={gesetzt === undefined || busy} onClick={offen ? schliessen : onOeffnen}>
          {gesetzt ? <><Symbol name="check" groesse={12} /> Key saved</> : "Add key"}
          <Symbol name={offen ? "chevu" : "chevd"} groesse={12} />
        </Knopf>
      </Zeile>
      <div id={id} hidden={!offen}>
        {offen ? <SchluesselFormular dienst={dienst} gesetzt={gesetzt} busy={busy} setBusy={setBusy}
          onSchliessen={schliessen} onGespeichert={onGespeichert} /> : null}
      </div>
    </div>
  );
}

function SchluesselFormular({ dienst, gesetzt, busy, setBusy, onSchliessen, onGespeichert }: {
  dienst: typeof DAYTONA;
  gesetzt?: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onSchliessen: () => void;
  onGespeichert: () => Promise<void>;
}) {
  const formular = useRef<HTMLFormElement>(null);
  const [wert, setWert] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);

  async function speichern(event: FormEvent) {
    event.preventDefault();
    if (busy || !wert.trim()) return;
    setBusy(true);
    setFehler(null);
    try {
      const result = await setKey(dienst.key, wert.trim());
      if (!result.set) throw new Error("The key could not be saved.");
      setWert("");
      await onGespeichert();
      if (formular.current) onSchliessen();
    } catch (e) {
      setFehler(fehlerText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formular} onSubmit={(e) => void speichern(e)} className="mx-3 mb-3 flex flex-col gap-3 rounded-o-control bg-o-surface p-3">
      <Feld label={gesetzt ? `Replace ${dienst.name} key` : `${dienst.name} key`} type="password" autoComplete="off"
        spellCheck={false} maxLength={4096} autoFocus value={wert} onChange={(e) => setWert(e.target.value)} disabled={busy} />
      {fehler ? <p role="alert" className="m-0 text-[13px] leading-[18px] text-o-danger">{fehler}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="text-left text-[13px] leading-[18px] text-o-text-2 underline-offset-4 hover:underline focus-visible:outline-o-focus"
          onClick={() => { setFehler(null); void openUrl(dienst.link).catch((e) => setFehler(fehlerText(e))); }}>
          Get a key from {dienst.anbieter}
        </button>
        <div className="ml-auto flex gap-1">
          <Knopf art="still" disabled={busy} onClick={onSchliessen}>Cancel</Knopf>
          <Knopf type="submit" disabled={busy || !wert.trim()}>{busy ? "Saving …" : "Save key"}</Knopf>
        </div>
      </div>
    </form>
  );
}

/** Jev-Schalter und Tagesbudget (ohne Schlüssel). */
function JevSteuerung() {
  const settings = useDaten(() => getSettings().then((r) => r.settings));
  const budget = useDaten(() => getBudget());
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = settings.daten;
  const b = budget.daten?.budget;

  const speichern = async (aktion: () => Promise<unknown>, neu: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setFehler(null);
    try {
      await aktion();
      await neu();
    } catch (e) {
      setFehler(fehlerText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!s && settings.laedt) return <Laedt />;
  if (!s) return <Fehlerband text={settings.fehler} />;

  const optionen = [...new Set([...BUDGET_OPTIONEN, b?.jevDailyUsd ?? 0.5])].sort((a, c) => a - c)
    .map((n) => ({ wert: String(n), text: n === 0 ? "Off" : `${n} $ / day` }));

  return (
    <div>
      <Fehlerband text={fehler || settings.fehler || budget.fehler} />
      <SchalterZeile titel="Jev chooses the model" beschreibung="Pick a model automatically when a chat uses Auto"
        an={s.jevAuto} onChange={(v) => void speichern(() => setJev({ auto: v }), settings.neu)} aus={busy} />
      <SchalterZeile titel="Switch programs mid-task" beschreibung="Switch to another program if the current one runs out of usage"
        an={s.jevHandoff} onChange={(v) => void speichern(() => setJev({ handoff: v }), settings.neu)} aus={busy || !s.jevAuto} />
      <Zeile titel="Daily Jev budget" beschreibung="Maximum OpenRouter spend per day" hoehe={54}>
        <select aria-label="Daily Jev budget" disabled={busy || !b} value={String(b?.jevDailyUsd ?? 0.5)}
          onChange={(e) => {
            const usd = Number(e.target.value);
            void speichern(() => setBudget({ jevDailyUsd: usd }), budget.neu);
          }}
          className="orbit-ui h-9 rounded-o-control bg-o-field px-3 text-[14px] leading-5 text-o-text outline-none focus-visible:outline-2 focus-visible:outline-o-focus">
          {optionen.map((o) => <option key={o.wert} value={o.wert}>{o.text}</option>)}
        </select>
      </Zeile>
    </div>
  );
}

/** Erststart und Workspace teilen die Schlüsselzeilen und deren Status. */
function Dienste({ onWeiter }: { onWeiter?: () => void }) {
  const keys = useDaten(ladeSchluessel);
  const [offen, setOffen] = useState<string | null>(null);
  const gesetzt = (name: string) => keys.daten?.find((k) => k.name === name)?.set ?? (keys.daten ? false : undefined);
  const zeile = (dienst: typeof DAYTONA) => (
    <DienstZeile dienst={dienst} gesetzt={gesetzt(dienst.key)} offen={offen === dienst.key}
      onOeffnen={() => setOffen(dienst.key)} onSchliessen={() => setOffen((aktuell) => aktuell === dienst.key ? null : aktuell)}
      onGespeichert={keys.neu} />
  );
  const fehler = keys.fehler ? <Fehlerband text={keys.fehler} /> : null;

  if (onWeiter) return (
    <div className="flex w-full max-w-sm flex-col gap-5">
      <header className="text-center">
        <AuthOrbis />
        <h1 className="m-0 text-[28px] leading-9 font-semibold tracking-tight text-o-text">Cloud computer &amp; Auto</h1>
        <p className="mt-1.5 text-[14px] leading-5 text-o-text-2">Optional. You can set these up later in Workspace.</p>
      </header>
      {fehler}
      <Karte>
        {zeile(DAYTONA)}
        {zeile(JEV)}
      </Karte>
      <div className="text-center">
        <Knopf groesse="gross" onClick={onWeiter}>{gesetzt(DAYTONA.key) || gesetzt(JEV.key) ? "Continue" : "Skip for now"}</Knopf>
      </div>
    </div>
  );

  return (
    <>
      {fehler}
      <Abschnitt titel="Cloud computer & Auto">
        <Karte>
          <div data-anchor="daytona">{zeile(DAYTONA)}</div>
          <div data-anchor="jev">
            {zeile(JEV)}
            <details className="group border-t border-solid border-o-line">
              <summary className="flex cursor-default list-none items-center justify-between gap-3 px-4 py-3 text-[14px] leading-5 text-o-text hover:bg-o-hover focus-visible:-outline-offset-2 focus-visible:outline-o-focus [&::-webkit-details-marker]:hidden">
                Auto settings
                <Symbol name="chevr" groesse={14} className="text-o-text-2 group-open:rotate-90" />
              </summary>
              <div className="border-t border-solid border-o-line"><JevSteuerung /></div>
            </details>
          </div>
        </Karte>
      </Abschnitt>
    </>
  );
}

export function DiensteEinstellungen() {
  return <Dienste />;
}

export function DiensteSchrittInhalt({ onWeiter }: { onWeiter: () => void }) {
  return <Dienste onWeiter={onWeiter} />;
}

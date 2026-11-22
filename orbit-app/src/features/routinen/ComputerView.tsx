import { useEffect, useState, type FormEvent } from "react";
import { Feld, Knopf, Ladeanzeige } from "../../ui";
import { getKeys } from "../../lib/api";
import { fehlerText } from "../../lib/chunks";
import { useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import { apiRequest, openUrl } from "../../lib/tauri";
import { useDaten } from "../einstellungen/store";
import { Dialog, Fehlerzeile, OrbiFigur, Punkt, type PunktArt } from "../orbis/shared";
import { useDesktop, type DesktopStatus } from "./computer";

const URL_ERNEUERN_MS = 50 * 60_000; // die signierte Adresse gilt 1 h (orbitd/tools/daytona.py)

/** Adresse des echten Bildschirms (noVNC der Sandbox). Sie trägt den Zugang: nur im Speicher dieser Ansicht, nie anzeigen oder loggen. */
function useBildschirmUrl(botId: string, mitSteuerung: boolean) {
  const [r, setR] = useState<{ url: string | null; fehler: string | null }>({ url: null, fehler: null });
  const [nochmal, setNochmal] = useState(0);
  useEffect(() => {
    let weg = false;
    let timer: ReturnType<typeof setTimeout>;
    const hole = () => {
      apiRequest<{ url?: string }>("GET", `/v1/daytona/${encodeURIComponent(botId)}/desktop-url${mitSteuerung ? "" : "?viewOnly=1"}`)
        .then((x) => { if (!weg) { setR(x.url ? { url: x.url, fehler: null } : { url: null, fehler: "The screen is unavailable right now." }); timer = setTimeout(hole, URL_ERNEUERN_MS); } })
        .catch((e) => {
          if (!weg) {
            setR({ url: null, fehler: fehlerText(e) });
            // Status nachziehen: oft ist der Computer aus, die Karte zeigte noch „läuft“.
            void useDesktop.getState().load(botId);
          }
        });
    };
    setR({ url: null, fehler: null });
    hole();
    return () => { weg = true; clearTimeout(timer); };
  }, [botId, mitSteuerung, nochmal]);
  return { ...r, nochmal: () => setNochmal((n) => n + 1) };
}

/** Der echte Bildschirm des Computers (noVNC der Daytona-Sandbox, live). Beim Zuschauen nur ansehen, nach „Übernehmen“ mit Maus und Tastatur. */
export function Bildschirm({ botId, name, mitSteuerung }: { botId: string; name: string; mitSteuerung: boolean }) {
  const { url, fehler, nochmal } = useBildschirmUrl(botId, mitSteuerung);
  const [oeffnenFehler, setOeffnenFehler] = useState<string | null>(null);
  return (
    <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-o-lg bg-o-surface">
      {/* Unter dem Bild: Ladeanzeige oder Fehler. Sobald der Bildschirm Pixel liefert, deckt er sie zu. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-[13px] leading-[18px] text-o-text-2">
        {fehler ? (
          <>
            <span className="[overflow-wrap:anywhere]">{fehler}</span>
            <Knopf art="zweitrangig" onClick={nochmal}>Try again</Knopf>
          </>
        ) : <Ladeanzeige text="Connecting screen…" />}
      </div>
      {url ? (
        <iframe src={url} title={`Screen of ${name}`} referrerPolicy="no-referrer" allow="clipboard-read; clipboard-write"
          sandbox="allow-scripts allow-same-origin" className="absolute inset-0 h-full w-full border-0" />
      ) : null}
      {url ? (
        <button type="button" title="Open in browser" aria-label="Open screen in browser"
          onClick={() => { setOeffnenFehler(null); void openUrl(url).catch((e) => setOeffnenFehler(fehlerText(e))); }}
          className="absolute right-2 top-2 flex h-7 items-center rounded-full bg-black/55 px-2.5 text-[12px] leading-4 text-white opacity-80 outline-none backdrop-blur transition-opacity duration-[var(--orbit-dur)] hover:opacity-100 focus-visible:outline-2 focus-visible:outline-o-focus cursor-default">
          {oeffnenFehler ?? "Open in browser"}
        </button>
      ) : null}
    </div>
  );
}

function Schlaeft({ titel, text }: { titel: string; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-o-lg bg-o-surface p-3.5">
      <div className="shrink-0" aria-hidden="true"><OrbiFigur avatar="grokbot" state="schlaeft" size={44} /></div>
      <div className="min-w-0">
        <h3 className="text-[15px] leading-5 font-semibold text-o-text">{titel}</h3>
        <p className="mt-0.5 text-[13px] leading-[18px] text-o-text-2">{text}</p>
      </div>
    </div>
  );
}

function Einrichtung({ botId, busy, hatComputer }: { botId: string; busy: boolean; hatComputer: boolean }) {
  const { saveKey, connect } = useDesktop.getState();
  const key = useDaten(async () => (await getKeys()).keys.some((entry) => entry.name === "DAYTONA_API_KEY" && entry.set));
  const [eingeben, setEingeben] = useState(false);
  const [linkFehler, setLinkFehler] = useState<string | null>(null);

  async function speichern(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = new FormData(form).get("daytonaKey");
    if (typeof value !== "string" || !value.trim() || busy) return;
    form.reset();
    if (await saveKey(botId, value.trim())) {
      setEingeben(false);
      await key.neu();
    }
  }

  return (
    <section aria-label="Set up Daytona" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="shrink-0" aria-hidden="true"><OrbiFigur avatar="grokbot" state="schlaeft" size={40} /></div>
        <h3 className="min-w-0 text-[15px] leading-5 font-semibold text-o-text">Connect computer with Daytona</h3>
      </div>
      {key.laedt ? <Ladeanzeige text="Loading Daytona key status…" /> : null}
      {key.fehler ? (
        <div className="flex flex-wrap items-center gap-2">
          <Fehlerzeile text={key.fehler} />
          <Knopf art="still" disabled={busy || key.laedt} onClick={() => void key.neu()}>Check key status again</Knopf>
        </div>
      ) : null}
      {key.daten === false || eingeben ? (
        <form className="flex min-w-0 flex-col gap-3" onSubmit={(event) => void speichern(event)}>
          <Feld label="Daytona key" name="daytonaKey" type="password" autoComplete="off" spellCheck={false}
            maxLength={4096} disabled={busy} required />
          <div className="flex flex-col gap-2 @xs:flex-row @xs:flex-wrap @xs:justify-end">
            <Knopf art="still" disabled={busy} onClick={() => {
              setLinkFehler(null);
              void openUrl("https://app.daytona.io/dashboard/keys").catch((e) => setLinkFehler(fehlerText(e)));
            }}>Open Daytona</Knopf>
            <Knopf type="submit" disabled={busy}>Verify and save</Knopf>
          </div>
          <Fehlerzeile text={linkFehler} />
        </form>
      ) : key.daten ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-o-lg bg-o-surface px-3 py-2">
          <span className="flex items-center gap-2 text-[13px] leading-[18px] text-o-text-2"><Punkt art="ok" />Daytona key saved</span>
          <Knopf art="still" disabled={busy} onClick={() => setEingeben(true)}>Change key</Knopf>
        </div>
      ) : null}
      {!hatComputer && key.daten && !eingeben ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 @xs:flex-row @xs:flex-wrap">
            <Knopf art="zweitrangig" className="h-auto! min-h-8 whitespace-normal! py-1" disabled={busy} onClick={() => void connect(botId, true)}>Connect existing computer</Knopf>
            <Knopf art="still" className="h-auto! min-h-8 whitespace-normal! py-1" disabled={busy} onClick={() => void connect(botId, false)}>Set up new computer</Knopf>
          </div>
          <p className="text-[13px] leading-[18px] text-o-text-2">A new computer may incur Daytona charges.</p>
        </div>
      ) : null}
    </section>
  );
}

/** Figma 5.4, 6.5, 6.6: Computer eines Orbis als Dialog. Zustand und Aktionen über die Daytona-Routen des Dienstes. */
export function ComputerView({ botId }: { botId: string }) {
  const bot = useOrbit((s) => s.bots.find((b) => b.id === botId) ?? (s.main?.id === botId ? s.main : null));
  const live = useOrbit((s) => [...s.steps].reverse().find((x) => x.botId === botId)?.label);
  const desk = useDesktop((s) => s.desk[botId]);
  const { load, retry, wake, sleep, takeover, giveBack } = useDesktop.getState();
  const go = useNav((s) => s.go);
  const zu = () => go({ kind: "chat" });

  useEffect(() => {
    void load(botId);
    // Zustand nachführen, solange der Dialog offen ist (Computer startet oder schläft ein).
    const t = setInterval(() => void useDesktop.getState().load(botId), 8000);
    return () => clearInterval(t);
  }, [botId, load]);

  const state: DesktopStatus = desk?.state ?? "laden";
  const name = bot?.name ?? "Orbi";
  const busy = !!desk?.busy;

  let bildschirm;
  let punkt: PunktArt = "ruhig";
  let text = "";
  let knoepfe;
  switch (state) {
    case "running":
      bildschirm = <Bildschirm key={`${botId}-zuschauen`} botId={botId} name={name} mitSteuerung={false} />;
      punkt = "ok";
      text = `Running · ${name}${live ? ` ${live}` : " is ready"}`;
      knoepfe = (
        <>
          <Knopf art="zweitrangig" disabled={busy} onClick={() => void takeover(botId)}>Take over</Knopf>
          <Knopf art="zweitrangig" disabled={busy} onClick={() => void sleep(botId)}>Put to sleep</Knopf>
        </>
      );
      break;
    case "taken":
      bildschirm = <Bildschirm key={`${botId}-steuern`} botId={botId} name={name} mitSteuerung />;
      punkt = "warn";
      text = `Taken over · ${name} continues when you hand it back`;
      knoepfe = <Knopf art="primaer" disabled={busy} onClick={() => void giveBack(botId)}>Hand back</Knopf>;
      break;
    case "sleeping":
    case "transitioning":
      bildschirm = state === "sleeping"
        ? <Schlaeft titel="The computer is asleep" text="It wakes on its own when an Orbi needs it." />
        : <div className="flex min-h-8 items-center"><Ladeanzeige text="The computer is starting…" /></div>;
      knoepfe = state === "sleeping" ? <Knopf art="primaer" disabled={busy} onClick={() => void wake(botId)}>Wake</Knopf> : null;
      break;
    case "unknown":
    case "fehler":
    case "unconfigured":
      bildschirm = <Einrichtung key={botId} botId={botId} busy={busy} hatComputer={state !== "unconfigured"} />;
      text = state === "unconfigured" ? "Not set up" : desk?.statusError ?? "Computer status unavailable right now";
      knoepfe = state === "unconfigured" ? null : (
        <Knopf art="zweitrangig" disabled={busy} onClick={() => void retry(botId)}>Check status again</Knopf>
      );
      break;
    default:
      bildschirm = <div className="flex min-h-8 items-center"><Ladeanzeige text="Loading computer status…" /></div>;
  }

  return (
    <Dialog titel="Computer" breite={state === "running" || state === "taken" ? 620 : 460} gap={16} onClose={zu}>
      <div className="@container flex shrink-0 flex-col gap-4">
        {bildschirm}
        <Fehlerzeile text={desk?.error} />
        {text || busy || knoepfe ? (
          <div className="flex flex-wrap items-center gap-2.5 border-t border-o-card-border pt-3">
            {busy || text ? (
              <div className="flex min-w-28 flex-1 items-center gap-2 text-[13px] leading-[18px] text-o-text-2">
                {busy ? <Ladeanzeige text="Updating Daytona…" /> : <><Punkt art={punkt} /><span className="min-w-0 [overflow-wrap:anywhere]">{text}</span></>}
              </div>
            ) : null}
            {knoepfe ? <div className="ml-auto flex flex-wrap gap-2">{knoepfe}</div> : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

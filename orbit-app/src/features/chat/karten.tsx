// Karten im Chat (Figma 6.3): Freigabe, Rückfrage; dazu Unterbrechung und Fehlerhinweis.
import { useEffect, useRef, useState } from "react";
import { Karte as KarteBaustein, Knopf, type OrbiFarbe } from "../../ui";
import type { Antwort, Entscheidung, Karte } from "../../lib/types";
import { fragenVon, freigabeText, type Frage } from "./logik";
import { AktionsKarte } from "./bausteine";
import { LogoFlaeche } from "../einstellungen/bausteine";
import { apiRequest } from "../../lib/tauri";
import { fehlerText } from "../../lib/chunks";
import { Bildschirm } from "../routinen/ComputerView";

export function FreigabeKarte({
  karte, name, onEntscheiden,
}: { karte: Karte; name: string; onEntscheiden: (id: string, e: Entscheidung) => void }) {
  return (
    <div data-karte="freigabe" className="w-full max-w-[560px]">
      <KarteBaustein
        art="freigabe"
        text={freigabeText(karte, name)}
        linkText="Always allow"
        onLink={() => onEntscheiden(karte.id, "always")}
        onAblehnen={() => onEntscheiden(karte.id, "deny")}
        onErlauben={() => onEntscheiden(karte.id, "once")}
      />
    </div>
  );
}

/**
 * Rückfrage: eine Frage nach der anderen mit antippbaren Antworten und "Andere Antwort …".
 * Wenn alle beantwortet sind, geht die Liste der Antworten an den Dienst; "Überspringen" schickt `null`.
 */
type RueckfrageProps = { karte: Karte; input?: any; farbe: OrbiFarbe; onAntwort: (id: string, a: Antwort[] | null) => void };

export function RueckfrageKarte(props: RueckfrageProps) {
  const eingabe = props.input ?? props.karte.input;
  if (eingabe?.computerTakeover) return <ComputerKarte {...props} label={String(eingabe.computerTakeover.label ?? "")} />;
  if (eingabe?.connectorConnect) return <ConnectorKarte {...props} connect={eingabe.connectorConnect} />;
  return <FrageKarte {...props} />;
}

/** Bleibt nach dem Verbinden sichtbar: Bestätigung statt Verschwinden. */
export function ConnectorStatus({ connect, status }: { connect: any; status: "connected" | "skipped" }) {
  const slug = String(connect?.slug ?? "");
  const name = String(connect?.name ?? slug) || "Plugin";
  const ok = status === "connected";
  return (
    <div
      data-karte="connector"
      data-beantwortet
      className="orbit-ui flex w-full max-w-[420px] items-center gap-3 rounded-o-dialog border border-solid border-o-card-border bg-o-raised px-4 py-3.5"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-o-field">
        <LogoFlaeche slug={slug} name={name} logoUrl={connect?.logoUrl} flaeche={26} logo={20} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] leading-5 font-medium text-o-text">{ok ? `${name} verbunden` : `${name} nicht verbunden`}</span>
        <span className="text-[13px] leading-[18px] text-o-text-2">{ok ? "Konto ist verknüpft" : "Später in den Einstellungen möglich"}</span>
      </div>
      <span className={`text-[13px] leading-[18px] font-medium ${ok ? "text-o-success" : "text-o-text-3"}`}>{ok ? "Fertig" : "Übersprungen"}</span>
    </div>
  );
}

/** Plugin verbinden: Logo + Verbinden-Knopf, öffnet Browser-Anmeldung. */
function ConnectorKarte({ karte, connect, onAntwort }: RueckfrageProps & { connect: any }) {
  const [laeuft, setLaeuft] = useState(false);
  const [warte, setWarte] = useState(false);
  const [status, setStatus] = useState<"connected" | "skipped" | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const slug = String(connect?.slug ?? "");
  const name = String(connect?.name ?? slug) || "Plugin";
  const frage = `${name} verbinden?`;
  const untertitel = String(connect?.reason || connect?.description || `Melde dich an, um ${name} mit Orbit zu verknüpfen.`);
  const antwort = (wahl: "Verbinden" | "Nicht jetzt") => {
    if (status) return;
    setStatus(wahl === "Nicht jetzt" ? "skipped" : "connected");
    if (wahl === "Nicht jetzt") onAntwort(karte.id, null);
    else onAntwort(karte.id, [{ question: frage, answers: [wahl] }]);
  };
  useEffect(() => {
    if (!warte || !slug || status) return;
    let weg = false;
    const tick = () => {
      apiRequest<{ connectionStatus?: string }>("GET", `/v1/plugins/${encodeURIComponent(slug)}/status`)
        .then((r) => {
          if (weg || r?.connectionStatus !== "connected") return;
          antwort("Verbinden");
        })
        .catch(() => { /* noch offen */ });
    };
    const t = setInterval(tick, 2500);
    window.addEventListener("focus", tick);
    tick();
    return () => { weg = true; clearInterval(t); window.removeEventListener("focus", tick); };
  }, [warte, slug, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const verbinden = async () => {
    if (laeuft || !slug || status) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const r = await apiRequest<any>("POST", `/v1/plugins/${encodeURIComponent(slug)}/connect`, {});
      const url = typeof r?.url === "string" ? r.url : typeof r?.redirectUrl === "string" ? r.redirectUrl : null;
      if (url && /^https:\/\//i.test(url)) {
        const { openUrl } = await import("../onboarding/dienst");
        void openUrl(url);
        setWarte(true);
      } else if (r?.connectionStatus === "connected") {
        antwort("Verbinden");
      } else {
        setFehler("Anmeldung ist nicht gestartet. Versuch’s noch einmal.");
      }
    } catch (e) {
      setFehler(fehlerText(e));
    } finally {
      setLaeuft(false);
    }
  };
  // Nach dem Absenden: Bestätigung bleibt stehen (auch wenn die offene Karte schließt).
  if (status) return <ConnectorStatus connect={connect} status={status} />;
  return (
    <div data-karte="connector" className="orbit-ui flex w-full max-w-[420px] flex-col gap-4 rounded-o-dialog border border-solid border-o-card-border bg-o-raised p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-o-field">
          <LogoFlaeche slug={slug} name={name} logoUrl={connect?.logoUrl} flaeche={28} logo={22} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
          <h4 className="text-[15px] leading-[22px] font-semibold text-o-text">{name} verbinden</h4>
          <p className="text-[13px] leading-[18px] text-o-text-2 [overflow-wrap:anywhere]">{untertitel}</p>
        </div>
      </div>
      {warte ? (
        <p role="status" className="rounded-[12px] bg-o-field px-3 py-2 text-[13px] leading-[18px] text-o-text-2">
          Browser ist offen — melde dich an. Orbit erkennt’s automatisch.
        </p>
      ) : null}
      {fehler ? <span role="alert" className="text-[13px] leading-[18px] text-o-danger [overflow-wrap:anywhere]">{fehler}</span> : null}
      <div className="flex items-center justify-end gap-2">
        <Knopf art="zweitrangig" disabled={laeuft} onClick={() => antwort("Nicht jetzt")}>Nicht jetzt</Knopf>
        <Knopf art="primaer" disabled={laeuft || !slug} onClick={() => void verbinden()}>
          {laeuft ? "…" : warte ? "Nochmal öffnen" : "Verbinden"}
        </Knopf>
      </div>
    </div>
  );
}

/** Computer übernehmen: echter Bildschirm in der Karte, „Übernehmen“ startet die Übernahme, „Zurückgeben“ beantwortet die Karte (Dienst: routes/daytona.py). */
function ComputerKarte({ karte, label, onAntwort }: RueckfrageProps & { label: string }) {
  const [takeoverId, setTakeoverId] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const base = `/v1/daytona/${encodeURIComponent(karte.botId)}`;
  const los = async (fn: () => Promise<void>) => {
    if (laeuft) return;
    setLaeuft(true);
    setFehler(null);
    try { await fn(); } catch (e) { setFehler(fehlerText(e)); } finally { setLaeuft(false); }
  };
  const uebernehmen = () => los(async () => {
    const r = await apiRequest<{ takeoverId: string }>("POST", `${base}/takeover`, { requestId: karte.id });
    setTakeoverId(r.takeoverId);
  });
  const zurueckgeben = () => los(async () => {
    if (takeoverId) await apiRequest("POST", `${base}/return`, { takeoverId });
    setTakeoverId(null);
  });
  return (
    <div data-karte="computer" className="orbit-ui flex w-full max-w-[560px] flex-col gap-3 rounded-o-dialog border border-solid border-o-card-border bg-o-raised px-4 py-3.5">
      <h4 className="text-[15px] leading-[22px] font-medium text-o-text-2">{label || "Take over the computer"}</h4>
      {takeoverId ? <Bildschirm botId={karte.botId} name="Computer" mitSteuerung /> : (
        <p className="text-[13px] leading-[18px] text-o-text-3">You get the screen with mouse and keyboard. Hand it back here when you are done.</p>
      )}
      {fehler ? <span className="text-[13px] leading-[18px] text-o-danger [overflow-wrap:anywhere]">{fehler}</span> : null}
      <div className="flex items-center justify-end gap-2">
        {takeoverId ? (
          <Knopf art="primaer" disabled={laeuft} onClick={() => void zurueckgeben()}>Hand back</Knopf>
        ) : (
          <>
            <Knopf art="zweitrangig" disabled={laeuft} onClick={() => onAntwort(karte.id, null)}>Skip</Knopf>
            <Knopf art="primaer" disabled={laeuft} onClick={() => void uebernehmen()}>Take over</Knopf>
          </>
        )}
      </div>
    </div>
  );
}

function FrageKarte({
  karte, input, farbe, onAntwort,
}: RueckfrageProps) {
  const fragen: Frage[] = fragenVon(input ?? karte.input, karte.text);
  const [schritt, setSchritt] = useState(0);
  const [antworten, setAntworten] = useState<Antwort[]>([]);
  const [andere, setAndere] = useState(false);
  const [freitext, setFreitext] = useState("");
  const feld = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (andere) feld.current?.focus();
  }, [andere]);

  const frage = fragen[schritt];
  if (!frage) return null;

  const weiter = (text: string) => {
    const neu = [...antworten, { question: frage.question, answers: [text] }];
    setAndere(false);
    setFreitext("");
    if (schritt + 1 >= fragen.length) onAntwort(karte.id, neu);
    else {
      setAntworten(neu);
      setSchritt(schritt + 1);
    }
  };

  return (
    <div data-karte="frage" className="relative w-full max-w-[560px]">
      {andere ? (
        <div className="orbit-ui flex flex-col gap-3.5 rounded-o-dialog border border-solid border-o-card-border bg-o-raised px-4 py-3.5">
          <h4 className="text-[15px] leading-[22px] font-medium text-o-text-2">{frage.question}</h4>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (freitext.trim()) weiter(freitext.trim());
            }}
          >
            <input
              ref={feld}
              value={freitext}
              onChange={(e) => setFreitext(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setAndere(false);
              }}
              aria-label="Other answer"
              placeholder="Your answer …"
              className="h-8 min-w-0 flex-1 rounded-o-control bg-o-field px-3 text-[14px] leading-5 text-o-text outline-none placeholder:text-o-text-3 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-o-focus"
            />
            <Knopf art="zweitrangig" type="button" onClick={() => setAndere(false)}>Back</Knopf>
            <Knopf art="primaer" type="submit" disabled={!freitext.trim()}>Send</Knopf>
          </form>
        </div>
      ) : (
        <KarteBaustein
          art="frage"
          titel={frage.question}
          antworten={frage.options.map((o) => o.label)}
          farbe={farbe}
          onAntwort={(i) => weiter(frage.options[i].label)}
          onAndere={() => setAndere(true)}
        />
      )}
      <button
        type="button"
        onClick={() => onAntwort(karte.id, null)}
        className="orbit-ui absolute right-3 top-3 rounded-o-sm px-1 text-[13px] leading-[18px] text-o-text-3 outline-none hover:text-o-text-2 hover:underline focus-visible:outline-2 focus-visible:outline-o-focus cursor-default"
      >
        Skip
      </button>
    </div>
  );
}

export function UnterbrechungKarte({ onWeiter, onVerwerfen }: { onWeiter: () => void; onVerwerfen: () => void }) {
  return (
    <AktionsKarte
      symbol="pause"
      titel="Interrupted"
      untertitel="The last reply did not finish. Continue?"
      aktionen={[
        { text: "Discard", art: "zweitrangig", onClick: onVerwerfen },
        { text: "Continue", art: "primaer", onClick: onWeiter },
      ]}
    />
  );
}

export function HinweisKarte({ text, onSchliessen }: { text: string; onSchliessen: () => void }) {
  return (
    <div className="w-full max-w-[560px]" data-karte="fehler">
      <KarteBaustein art="fehler" titel="That did not work" untertitel={text} aktionText="Close" onAktion={onSchliessen} />
    </div>
  );
}

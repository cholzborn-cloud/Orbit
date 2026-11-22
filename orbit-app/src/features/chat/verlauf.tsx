// Verlauf eines Chats: Zeitmarken, Blasen mit Markdown, Streaming, Karten, Systemzeilen, Live-Zeile, Reaktionen.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Blase, Karte as KarteUi, Ladeanzeige, Symbol, cx, type OrbiFarbe } from "../../ui";
import * as api from "../../lib/api";
import { useOrbit } from "../../lib/store";
import type { AntwortBezug, Bot, Datei, Group, Karte, Reaktion } from "../../lib/types";
import { Figur, LiveZeile, Systemzeile, type FigurDaten } from "./bausteine";
import { ConnectorStatus, FreigabeKarte, HinweisKarte, RueckfrageKarte, UnterbrechungKarte } from "./karten";
import { arbeiter, baueVerlauf, letzterSchritt, liveText, mischeKarten, nachrichtZeit, type Eintrag, type VerlaufsZeile } from "./logik";
import { Markdown } from "./markdown";

import { Dialog } from "../orbis/shared";
import { MedienKnopf, MedienVorschau, MemoSpieler, dateiName, hatMedienVorschau, oeffneSchnellansicht } from "./medien";
import { AuswahlKarte } from "./auswahl";
import { GeheimKarte } from "./geheim";
import { Nachrichtenmenue, type MenuePosition } from "./nachrichtenmenue";

const tokenFormat = new Intl.NumberFormat("de-DE");
const anzahl = (value?: number) => typeof value === "number" && Number.isFinite(value) ? tokenFormat.format(value) : "–";

type Aktion = { id: string; messageId: string; name: string; text: string; ts: number | null; typ?: string; datei?: Datei; eigene?: boolean; reaktionen: Reaktion[] };

interface Absender {
  id: string;
  name: string;
  daten: FigurDaten;
}

function Reaktionen({ liste, onEntfernen }: { liste: Reaktion[]; onEntfernen: (emoji: string) => void }) {
  const gruppen = new Map<string, { n: number; meine: boolean }>();
  for (const r of liste) {
    if (!r.emoji) continue;
    const g = gruppen.get(r.emoji) ?? { n: 0, meine: false };
    g.n++;
    if (r.actor === "user") g.meine = true;
    gruppen.set(r.emoji, g);
  }
  if (gruppen.size === 0) return null;
  return (
    <div className="flex flex-wrap gap-1" data-reaktionen>
      {[...gruppen].map(([emoji, g]) => {
        const Chip = g.meine ? "button" : "span";
        const beschriftung = `${emoji} · ${g.n} ${g.n === 1 ? "reaction" : "reactions"}`;
        return (
          <Chip
            key={emoji}
            type={g.meine ? "button" : undefined}
            aria-label={g.meine ? `${beschriftung} · Remove your reaction` : beschriftung}
            onClick={g.meine ? () => onEntfernen(emoji) : undefined}
            className={cx(
              "flex h-6 items-center gap-1 rounded-full px-2 text-[13px] leading-[18px]",
              g.meine ? "cursor-pointer bg-o-selected text-o-text hover:bg-o-selected-hover focus-visible:outline-2 focus-visible:outline-o-focus" : "bg-o-surface text-o-text-2",
            )}
          >
            <span>{emoji}</span>
            {g.n > 1 ? <span>{g.n}</span> : null}
          </Chip>
        );
      })}
    </div>
  );
}

export function Verlauf({
  chatId, gruppe, bot, mitglieder, farbe, onErneut, onAntwort, extra,
}: {
  /** Nur für die Vorschau: zusätzliche Zeilen am Anfang des Verlaufs. */
  extra?: React.ReactNode;
  chatId: string;
  gruppe: boolean;
  bot: Bot | null;
  mitglieder: Group["members"];
  farbe: OrbiFarbe;
  onErneut: (text: string, dateien: Datei[], antwort?: AntwortBezug) => void;
  onAntwort?: (antwort: AntwortBezug) => void;
}) {
  const messages = useOrbit((s) => s.messages[chatId]);
  const reactions = useOrbit((s) => s.reactions[chatId]);
  const allCards = useOrbit((s) => s.cards);
  const interrupted = useOrbit((s) => s.interrupted[chatId]);
  const notice = useOrbit((s) => s.notices[chatId]);
  const working = useOrbit((s) => s.working);
  const steps = useOrbit((s) => s.steps);
  const streaming = useOrbit((s) => s.streaming[chatId]);
  const hasMore = useOrbit((s) => s.hasMore[chatId]);
  const laden = useOrbit((s) => s.laden[chatId]);
  const bots = useOrbit((s) => s.bots);
  const { decide, answer, resume, react, dismissNotice, loadOlder } = useOrbit.getState();
  const [menue, setMenue] = useState<MenuePosition | null>(null);
  const menueZu = useCallback(() => setMenue(null), []);
  const menueAuf = (id: string, x: number, y: number) => setMenue({ id, x, y });
  const [infoFuer, setInfoFuer] = useState<string | null>(null);
  const [vorschau, setVorschau] = useState<Datei | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const vorschauOeffnen = (d: Datei) => {
    if (hatMedienVorschau(d)) setVorschau(d);
    else void oeffneSchnellansicht(d).catch(() => setVorschau(d));
  };

  const cards = useMemo(() => allCards.filter((k) => k.chatId === chatId), [allCards, chatId]);
  const eintraege = useMemo(
    () => baueVerlauf(messages ?? [], { gruppe, offeneKarten: cards.filter((k) => k.kind === "ask") }),
    [messages, gruppe, cards],
  );

  const absender = (id: string | null): Absender | null => {
    const m = mitglieder.find((x) => x.id === id) ?? bots.find((b) => b.id === id);
    if (m) return { id: m.id, name: m.name, daten: m };
    if (bot) return { id: bot.id, name: bot.name, daten: bot };
    return null;
  };
  const botVon = (id: string | null) => absender(id) ?? (bot ? { id: bot.id, name: bot.name, daten: bot as FigurDaten } : null);

  // ---- Scrollen ----
  const scroll = useRef<HTMLDivElement>(null);
  const inhalt = useRef<HTMLDivElement>(null);
  const klebt = useRef(true); // läuft mit neuen Nachrichten und dem Streaming mit, bis man selbst nach oben scrollt (ab 80 px Abstand)
  const eigeneId = useRef<string | undefined>(undefined);
  const vorherHoehe = useRef<{ h: number; erste: string | undefined } | null>(null);

  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const erste = messages?.[0]?.id;
    const v = vorherHoehe.current;
    if (v?.erste && v.erste !== erste && !klebt.current && messages?.some((m) => m.id === v.erste)) {
      el.scrollTop += el.scrollHeight - v.h; // ältere Nachrichten oben angefügt: Stelle halten
    }
    // Eigene, gerade gesendete Nachricht: immer nach unten, auch wenn man weiter oben gelesen hat.
    const letzte = messages?.[messages.length - 1];
    if (letzte?.role === "user" && letzte.metadata?.pending && letzte.id !== eigeneId.current) {
      klebt.current = true;
    }
    eigeneId.current = letzte?.id;
    if (klebt.current) el.scrollTop = el.scrollHeight;
    vorherHoehe.current = { h: el.scrollHeight, erste };
  });

  useEffect(() => {
    const el = scroll.current;
    const in_ = inhalt.current;
    if (!el || !in_ || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (klebt.current) el.scrollTop = el.scrollHeight;
      vorherHoehe.current = { h: el.scrollHeight, erste: vorherHoehe.current?.erste };
    });
    ro.observe(in_);
    el.scrollTop = el.scrollHeight;
    return () => ro.disconnect();
  }, [chatId]);

  const beimScrollen = () => {
    const el = scroll.current;
    if (!el) return;
    klebt.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 120 && hasMore && !laden) void loadOlder(chatId);
  };

  const aktionen = new Map<string, Aktion>();
  const vergebeneHauptIds = new Set<string>();
  const nachrichten = new Map(messages?.map((m) => [m.id, m]));
  const reaktionen = new Map<string, Reaktion[]>();
  for (const r of reactions ?? []) {
    const liste = reaktionen.get(r.messageId) ?? [];
    liste.push(r);
    reaktionen.set(r.messageId, liste);
  }

  const registriere = (a: Omit<Aktion, "reaktionen">): Aktion => {
    const rs = reaktionen.get(a.id) ?? [];
    const alt = a.messageId !== a.id && !vergebeneHauptIds.has(a.messageId) ? reaktionen.get(a.messageId) ?? [] : [];
    vergebeneHauptIds.add(a.messageId);
    const aktion = { ...a, reaktionen: [...rs, ...alt.filter((r) => !rs.some((neu) => neu.actor === r.actor))] };
    aktionen.set(a.id, aktion);
    return aktion;
  };

  const waehleReaktion = (aktion: Aktion, emoji: string) => {
    const meine = aktion.reaktionen.find((r) => r.actor === "user");
    if (meine?.emoji === emoji) {
      void react(chatId, meine.messageId, null);
      return;
    }
    if (meine && meine.messageId !== aktion.id) void react(chatId, meine.messageId, null);
    void react(chatId, aktion.id, emoji);
  };

  const nachrichtProps = (a: Aktion): HTMLAttributes<HTMLDivElement> => ({
    tabIndex: 0,
    role: "group",
    "aria-label": `Message from ${a.name}`,
    // Kein Auswahlrahmen; Menü nur per Rechtsklick (oder Tastatur-Kontextmenü).
    className: "chat-nachricht w-fit max-w-[min(562px,100%)] rounded-o-bubble outline-none focus-visible:outline-2 focus-visible:outline-o-focus",
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
      menueAuf(a.id, e.clientX, e.clientY);
    },
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        menueAuf(a.id, rect.left, rect.bottom);
      } else if ((e.key === "Enter" || e.key === " ") && a.datei) {
        e.preventDefault();
        vorschauOeffnen(a.datei);
      }
    },
  });

  const gezeigteFragen = new Set(eintraege.filter((e): e is Extract<Eintrag, { t: "frage" }> => e.t === "frage").map((e) => e.toolCallId));
  const freieKarten: Karte[] = cards.filter((k) => k.kind === "approval" || !gezeigteFragen.has(k.toolCallId));
  const arbeitende = arbeiter(chatId, working);

  const nameVon = (id: string | null) => botVon(id)?.name ?? bot?.name ?? "Orbi";

  const zeile = (e: VerlaufsZeile): React.ReactNode => {
    switch (e.t) {
      case "karte":
        return e.karte.kind === "approval" ? (
          <FreigabeKarte karte={e.karte} name={nameVon(e.karte.botId)} onEntscheiden={(id, d) => void decide(id, d)} />
        ) : (
          <RueckfrageKarte karte={e.karte} farbe={farbe} onAntwort={(id, a) => void answer(id, a)} />
        );
      case "zeit":
        return <div className="flex h-[18px] items-center justify-center text-[13px] leading-[18px] text-o-text-3">{e.label}</div>;
      case "system":
        return <Systemzeile text={e.text} symbol={e.symbol} detail={e.detail} />;
      case "ergebnis":
        return <KarteUi art="status" className="w-fit" symbol={e.symbol} titel={e.titel} untertitel={e.untertitel} statusText="Done" />;
      case "datei": {
        const aktion = registriere({ id: e.reaktionId, messageId: e.messageId, name: nameVon(e.botId), text: dateiName(e.datei), ts: e.ts, typ: e.datei.mediaType, datei: e.datei });
        return (
          <div className="flex flex-col items-start gap-1">
            <div {...nachrichtProps(aktion)} data-nachricht={aktion.id}>
              <MedienKnopf datei={e.datei} onOeffnen={() => vorschauOeffnen(e.datei)} />
            </div>
            <Reaktionen liste={aktion.reaktionen} onEntfernen={(emoji) => waehleReaktion(aktion, emoji)} />
          </div>
        );
      }
      case "auswahl":
        return (
          <AuswahlKarte widget={e.widget}
            onAntwort={async (selected, custom) => {
              const result = await api.answerWidget(e.toolCallId, { selected, ...(custom?.trim() ? { custom: custom.trim() } : {}) });
              if (!result.ok || !result.replyMessageId) throw new Error("Choice was not confirmed.");
            }} />
        );
      case "geheim":
        return (
          <GeheimKarte secret={e.secret}
            onAntwort={async (value) => {
              const result = await api.answerSecret(e.toolCallId, { value });
              if (!result.ok || !result.replyMessageId) throw new Error("Save was not confirmed.");
            }} />
        );
      case "memo": {
        const aktion = registriere({ id: e.reaktionId, messageId: e.messageId, name: nameVon(e.botId), text: e.memo.transcript || e.memo.title || "Voice memo", ts: e.ts, typ: e.memo.mediaType });
        return (
          <div className="flex flex-col items-start gap-1">
            <div {...nachrichtProps(aktion)} data-nachricht={aktion.id}>
              <MemoSpieler memo={e.memo} />
            </div>
            <Reaktionen liste={aktion.reaktionen} onEntfernen={(emoji) => waehleReaktion(aktion, emoji)} />
          </div>
        );
      }
      case "faden":
        return (
          <div data-faden={e.faden.messageId} className="flex min-w-0 max-w-[560px] items-center gap-1.5 text-[12px] leading-4 text-o-text-3">
            <Symbol name="reply" groesse={13} />
            <span className="truncate">Reply in thread{e.faden.name ? ` to ${e.faden.name}` : ""}{e.faden.text ? `: ${e.faden.text}` : ""}</span>
          </div>
        );
      case "ich": {
        const m = nachrichten.get(e.messageId);
        const antwort = m?.metadata?.replyTo;
        const aktion = registriere({ id: e.messageId, messageId: e.messageId, name: "You", text: e.text || e.dateien.map(dateiName).join(", "), ts: m ? nachrichtZeit(m) : e.ts, eigene: true });
        return (
          <div className="flex flex-col items-end gap-1" data-von="ich">
            <div {...nachrichtProps(aktion)} data-nachricht={aktion.id}>
              <div className="flex max-w-full flex-col items-end gap-1">
                {e.dateien.map((d, i) => <MedienKnopf key={i} datei={d} onOeffnen={() => vorschauOeffnen(d)} />)}
                {e.text || antwort ? (
                  <Blase von={gruppe ? "gruppe" : "ich"} farbe={farbe} className="max-w-full whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {antwort ? (
                      <div className={cx("flex min-w-0 items-start gap-1.5 rounded-o-control bg-white/12 px-2 py-1 text-[12px] leading-4", e.text && "mb-1.5")}>
                        <span className="shrink-0 opacity-75"><Symbol name="reply" groesse={13} /></span>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{antwort.name}</div>
                          <div className="truncate opacity-85">{antwort.text}</div>
                        </div>
                      </div>
                    ) : null}
                    {e.text}
                  </Blase>
                ) : null}
              </div>
            </div>
            <Reaktionen liste={aktion.reaktionen} onEntfernen={(emoji) => waehleReaktion(aktion, emoji)} />
            {e.failed ? (
              <span className="flex items-center gap-1.5 text-[13px] leading-[18px] text-o-danger">
                Not sent
                <button type="button" onClick={() => onErneut(e.text, e.dateien, antwort)} className="rounded-o-sm underline outline-none focus-visible:outline-2 focus-visible:outline-o-focus cursor-default">
                  Send again
                </button>
              </span>
            ) : null}
          </div>
        );
      }
      case "orbi": {
        const a = botVon(e.botId);
        const { blase: b } = e;
        const text = b.text;
        const aktion = registriere({ id: e.reaktionId, messageId: e.messageId, name: nameVon(e.botId), text, ts: e.ts });
        return (
          <div className="flex flex-col items-start gap-1" data-von="orbi">
            {e.absender && a ? (
              <div className="flex items-center gap-1.5 py-0.5" data-absender>
                <Figur d={a.daten} size={20} />
                <span className="text-[13px] leading-[18px] text-o-text-2">{a.name}</span>
              </div>
            ) : null}
            <div {...nachrichtProps(aktion)} data-nachricht={aktion.id}>
              <Blase von="orbi" className="max-w-full rounded-bl-o-sm border-0">
                <Markdown text={text} onBild={vorschauOeffnen} />
                {b.art === "text" && b.streaming ? <span className="chat-cursor" aria-hidden="true" /> : null}
              </Blase>
            </div>
            <Reaktionen liste={aktion.reaktionen} onEntfernen={(emoji) => waehleReaktion(aktion, emoji)} />
            {e.aborted ? <span className="text-[13px] leading-[18px] text-o-text-3">Stopped.</span> : null}
            {e.fehler ? <span className="text-[13px] leading-[18px] text-o-danger">{e.fehler}</span> : null}
          </div>
        );
      }
      case "frage": {
        const connect = e.input?.connectorConnect;
        const k = cards.find((c) => c.toolCallId === e.toolCallId && c.kind === "ask");
        if (e.offen && k) {
          return <RueckfrageKarte karte={k} input={e.input} farbe={farbe} onAntwort={(id, a) => void answer(id, a)} />;
        }
        if (connect) {
          if (e.output?.skipped) return <ConnectorStatus connect={connect} status="skipped" />;
          if (e.output?.answers?.length) return <ConnectorStatus connect={connect} status="connected" />;
          return null;
        }
        const antworten: { question: string; answers: string[] }[] = e.output?.answers ?? [];
        if (!antworten.length) return null;
        return (
          <>
            {antworten.map((a, i) => (
              <Systemzeile key={i} text={a.question} symbol="check" detail={a.answers.join(", ")} />
            ))}
          </>
        );
      }
    }
  };

  const items = mischeKarten(eintraege, freieKarten).map((e) => ({ key: e.key, node: zeile(e) })).filter((x) => x.node);

  const aktiv = menue ? aktionen.get(menue.id) : null;
  const info = infoFuer ? aktionen.get(infoFuer) : null;
  const infoNachricht = info && nachrichten.get(info.messageId);
  const modellInfo = infoNachricht?.role === "assistant" ? infoNachricht.metadata ?? {} : null;
  const { model, inputTokens, outputTokens, cachedTokens } = modellInfo ?? {};
  const textLaeuft = eintraege.some((e) => e.t === "orbi" && e.blase.art === "text" && e.blase.streaming);
  const schliessen = (aktion: () => void) => { menueZu(); aktion(); };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroll} onScroll={beimScrollen} className="chat-scroll min-h-0 flex-1 overflow-y-auto" aria-busy={laden || undefined} data-verlauf>
        <div className="mx-auto w-full max-w-[1104px] px-4 pb-4 @2xl:px-10 @4xl:px-[72px]">
          <div ref={inhalt} className="flex flex-col gap-3 pt-3">
            {extra}
            {items.map((x) => (
              <Fragment key={x.key}>{x.node}</Fragment>
            ))}
            {interrupted ? <UnterbrechungKarte onWeiter={() => void resume(chatId)} onVerwerfen={() => void resume(chatId, true)} /> : null}
            {notice ? <HinweisKarte text={notice} onSchliessen={() => dismissNotice(chatId)} /> : null}
            {!textLaeuft && arbeitende.map((w) => {
              const a = botVon(w.botId);
              if (!a) return null;
              const schritt = letzterSchritt(chatId, w.botId, steps);
              return <LiveZeile key={w.botId} daten={a.daten} text={liveText(a.name, w.status, w.status === "wartet" ? null : schritt?.label)} />;
            })}
            {!textLaeuft && arbeitende.length === 0 && streaming && bot ? <LiveZeile daten={bot} text={liveText(bot.name, "arbeitet")} /> : null}
          </div>
        </div>
      </div>
      {hinweis ? <HinweisKarte text={hinweis} onSchliessen={() => setHinweis(null)} /> : null}
      {menue && aktiv ? createPortal(
        <Nachrichtenmenue key={menue.id} position={menue} reaktion={aktiv.reaktionen.find((r) => r.actor === "user")?.emoji} onClose={menueZu}
          onReaktion={(emoji) => schliessen(() => waehleReaktion(aktiv, emoji))}
          onAntwort={() => schliessen(() => onAntwort?.({ id: aktiv.id, name: aktiv.name, text: aktiv.text.replace(/\s+/g, " ").slice(0, 240) }))}
          onKopieren={() => schliessen(() => {
            if (!navigator.clipboard) { setHinweis("Could not copy."); return; }
            void navigator.clipboard.writeText(aktiv.text).catch(() => setHinweis("Could not copy."));
          })}
          onInfo={aktiv.eigene ? undefined : () => schliessen(() => setInfoFuer(aktiv.id))}
        />, document.body,
      ) : null}
      {info ? createPortal(
        <Dialog titel="Message info" breite={360} onClose={() => setInfoFuer(null)}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-o-text-2">From</dt><dd>{info.name}</dd>
            <dt className="text-o-text-2">Time</dt><dd>{info.ts ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(info.ts) : "–"}</dd>
            {modellInfo ? (
              <>
                <dt className="text-o-text-2">Model</dt><dd className="[overflow-wrap:anywhere]">{model || "–"}</dd>
                <dt className="text-o-text-2">Tokens</dt>
                <dd className="flex flex-col gap-0.5 tabular-nums">
                  {inputTokens == null && outputTokens == null ? "–" : (
                    <>
                      <span>{anzahl(inputTokens)} input</span>
                      <span>{anzahl(outputTokens)} output</span>
                      {typeof cachedTokens === "number" && cachedTokens > 0 ? <span className="text-o-text-2">{anzahl(cachedTokens)} from cache</span> : null}
                    </>
                  )}
                </dd>
              </>
            ) : null}
            {info.typ ? <><dt className="text-o-text-2">File type</dt><dd className="[overflow-wrap:anywhere]">{info.typ}</dd></> : null}
          </dl>
        </Dialog>, document.body,
      ) : null}
      {vorschau ? createPortal(<MedienVorschau key={vorschau.url} datei={vorschau} onClose={() => setVorschau(null)} />, document.body) : null}
      {laden && !messages ? <Ladeanzeige text="Loading chat …" className="pointer-events-none absolute inset-0 justify-center" /> : null}
    </div>
  );
}

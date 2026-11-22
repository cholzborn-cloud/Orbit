import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Knopf, Ladeanzeige, Medienkarte, Symbol, cx } from "../../ui";
import { getLibraryFile } from "../../lib/api";
import { useNav, type PanelTab } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import { useDesktop, type DesktopStatus } from "../routinen/computer";
import { lastRunText, naechsteZeit, routineSubtitle, tagesGruppe, uhrzeit } from "../routinen/format";
import { RoutineDialog } from "../routinen/RoutineDialog";
import { Modellwahl } from "../chat/Modellwahl";
import { routineEntwurf } from "../chat/eingabe";
import { MedienVorschau, hatMedienVorschau, oeffneSchnellansicht } from "../chat/medien";
import { useOrbisData, dateiInfo, type BibDatei } from "./data";
import type { Datei, Routine } from "../../lib/types";
import { Abschnitt, Dialog, Liste, OrbiFigur, Punkt, Reiter, Schliessen, type PunktArt } from "./shared";

/** Figma 05, 5.3: rechtes Panel 340 breit mit Kopf, Reitern und Inhalt je Reiter. */
export function OrbiPanel({ botId }: { botId: string }) {
  const bot = useOrbit((s) => s.bots.find((b) => b.id === botId) ?? (s.main?.id === botId ? s.main : null));
  const panel = useNav((s) => s.panel);
  const setPanel = useNav((s) => s.setPanel);
  const openEditor = useNav((s) => s.openEditor);
  const tab: PanelTab = panel ?? "uebersicht";

  if (!bot) return null;
  return (
    <aside
      aria-label={`Details for ${bot.name}`}
      className="orbit-ui flex h-full w-full flex-col gap-3 overflow-hidden bg-o-sidebar px-4 pb-3.5 pt-3 text-o-text"
    >
      <div className="flex h-9 shrink-0 items-center justify-end">
        <Schliessen groesse={28} onClick={() => setPanel(null)} label="Close panel" />
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <button
          type="button"
          aria-label={`Edit ${bot.name}`}
          onClick={() => openEditor({ kind: "orbi", botId: bot.id })}
          className="group relative flex size-16 items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-o-focus cursor-default"
        >
          <OrbiFigur avatar={bot.avatar} color={bot.color} look={bot.look} size={60} follow />
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity duration-[var(--orbit-dur)] group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            <Symbol name="pencil" groesse={22} />
          </span>
        </button>
        <span className="max-w-full truncate text-[15px] leading-[22px] font-medium" title={bot.name}>{bot.name}</span>
        {bot.job ? <span className="max-w-full truncate text-[13px] leading-[18px] text-o-text-2" title={bot.job}>{bot.job}</span> : null}
      </div>
      <Reiter<PanelTab>
        label="Bereich"
        hoehe={26}
        className="[&_[role=tab]]:text-[13px]"
        value={tab}
        onChange={setPanel}
        items={[
          { id: "uebersicht", text: "Overview" },
          { id: "aktivitaet", text: "Activity" },
          { id: "bibliothek", text: "Library" },
        ]}
      />
      <div className="chat-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {tab === "uebersicht" ? <Uebersicht botId={bot.id} name={bot.name} /> : tab === "aktivitaet" ? <Aktivitaet botId={bot.id} /> : <Bibliothek key={bot.id} botId={bot.id} />}
      </div>
    </aside>
  );
}

// ---------- Übersicht ----------

const MAX_ROUTINEN = 3;

function Uebersicht({ botId, name }: { botId: string; name: string }) {
  const bot = useOrbit((s) => s.bots.find((b) => b.id === botId) ?? (s.main?.id === botId ? s.main : null));
  const live = useOrbit((s) => [...s.steps].reverse().find((step) => step.botId === botId)?.label);
  const routines = useOrbit((s) => s.routines);
  const runs = useOrbit((s) => s.runs);
  const state = useDesktop((s) => s.desk[botId]?.state ?? "laden");
  const loadDesk = useDesktop((s) => s.load);
  const lib = useOrbisData((s) => s.library[botId]);
  const loadLibrary = useOrbisData((s) => s.loadLibrary);
  const gedaechtnis = useOrbisData((s) => s.memory[botId]);
  const loadMemory = useOrbisData((s) => s.loadMemory);
  const eintraege = useEintraege(botId);
  const go = useNav((s) => s.go);
  const setPanel = useNav((s) => s.setPanel);
  const [offen, setOffen] = useState<Routine | null>(null);
  const [memoryOffen, setMemoryOffen] = useState(false);
  const ansicht = useNav((s) => s.main.kind);
  useEffect(() => setMemoryOffen(false), [botId, ansicht]);

  useEffect(() => {
    void loadDesk(botId);
    void loadLibrary(botId);
    void loadMemory(botId);
    // Status nachziehen (Orbi kann den Computer ausschalten, ohne dass die Karte offen ist).
    const t = setInterval(() => void useDesktop.getState().load(botId), 4000);
    return () => clearInterval(t);
  }, [botId, loadDesk, loadLibrary, loadMemory]);

  // Eigene Routinen: aktive zuerst, nach nächstem Lauf; pausierte ans Ende.
  const eigene = useMemo(() => routines
    .filter((r) => r.automation.botId === botId)
    .sort((a, b) => Number(b.automation.enabled) - Number(a.automation.enabled) || (Date.parse(a.automation.nextRunAt ?? "") || Infinity) - (Date.parse(b.automation.nextRunAt ?? "") || Infinity)), [routines, botId]);
  const zeigen = eigene.slice(0, MAX_ROUTINEN);
  const routineStatus = (r: Routine): { art: PunktArt; text: string } => {
    const a = r.automation, lauf = runs[a.id]?.status;
    if (r.blocker) return { art: "warn", text: r.blocker };
    if (lauf === "running") return { art: "ok", text: "Running now" };
    if (lauf === "waiting") return { art: "warn", text: "Waiting for you" };
    if (lauf === "error") return { art: "fehler", text: "Last run failed" };
    if (!a.enabled) return { art: "ruhig", text: a.pausedReason ? `Paused · ${a.pausedReason}` : "Paused" };
    return { art: "ok", text: a.nextRunAt ? `Next run ${naechsteZeit(a.nextRunAt)}` : routineSubtitle(a) };
  };

  const offeneAnzahl = eintraege.filter((e) => e.art === "warn" || e.sub === "Running").length;
  const zuletzt = eintraege.find((e) => e.t !== undefined);
  const dateien = lib?.files.length ?? 0;
  const eintragZahl = gedaechtnis?.entries.length ?? 0;
  const zuletztGelernt = gedaechtnis?.entries[0]?.updatedAt;

  return (
    <>
      <section aria-label="Routines" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Abschnitt>Routines</Abschnitt>
          <div className="flex items-center gap-1.5">
            {eigene.length > 0 ? (
              <button type="button" onClick={() => go({ kind: "routinen" })} className="rounded-o-sm text-[13px] leading-[18px] text-o-text-2 outline-none transition-colors duration-[var(--orbit-dur)] hover:text-o-text focus-visible:outline-2 focus-visible:outline-o-focus cursor-default">
                {eigene.length > MAX_ROUTINEN ? `All ${eigene.length}` : "Manage"}
              </button>
            ) : null}
            {bot?.chatId ? (
              <Knopf art="still" groesse="klein" className="w-6 px-0" aria-label="Create routine" title="Create routine" onClick={() => routineEntwurf(bot.chatId)}>
                <Symbol name="plus" groesse={16} />
              </Knopf>
            ) : null}
          </div>
        </div>
        {zeigen.length === 0 ? (
          <p className="text-[13px] leading-[18px] text-o-text-3">No routines yet. Tell {name} what should run regularly.</p>
        ) : (
          <Liste>
            {zeigen.map((r) => {
              const st = routineStatus(r);
              return (
                <button key={r.automation.id} type="button" onClick={() => setOffen(r)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left outline-none transition-colors duration-[var(--orbit-dur)] hover:bg-o-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-o-focus cursor-default">
                  <span className="flex h-[18px] w-2 shrink-0 items-center justify-center self-start"><Punkt art={st.art} /></span>
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="truncate text-[14px] leading-5">{r.automation.name}</span>
                    <span className="truncate text-[12px] leading-4 text-o-text-2">{st.text}</span>
                  </span>
                </button>
              );
            })}
          </Liste>
        )}
      </section>

      <div className="grid shrink-0 grid-cols-2 gap-2">
        <Kachel symbol="clock" titel="Activity" sub={offeneAnzahl > 0 ? `${offeneAnzahl} open` : zuletzt ? zuletzt.titel : "Nothing yet"} onClick={() => setPanel("aktivitaet")} />
        <Kachel symbol="folder" titel="Library" sub={lib?.error ? "Unavailable" : !lib?.loaded ? "Loading…" : dateien === 0 ? "Empty" : dateien === 1 ? "1 file" : `${dateien} files`} onClick={() => setPanel("bibliothek")} />
      </div>

      <Abschnitt>Default model</Abschnitt>
      <Liste>
        <div className="flex min-h-10 items-center gap-2.5 px-3 py-2">
          <Symbol name="sparkle" className="shrink-0 text-o-text-2" />
          <Modellwahl />
        </div>
      </Liste>
      <Liste>
        <button type="button" aria-haspopup="dialog" onClick={() => { setMemoryOffen(true); void loadMemory(botId); }}
          className="flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left outline-none hover:bg-o-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-o-focus cursor-default">
            <Symbol name="book" className="shrink-0 text-o-text-2" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14px] leading-5">Memory</span>
              <span className="truncate text-[12px] leading-4 text-o-text-2">
                {gedaechtnis?.error ? "Unavailable" : !gedaechtnis?.loaded ? "Loading…" : `${eintragZahl} ${eintragZahl === 1 ? "entry" : "entries"}${zuletztGelernt ? ` · last ${lastRunText(zuletztGelernt)}` : ""}`}
              </span>
            </span>
          <Symbol name="chevr" groesse={14} className="shrink-0 text-o-text-2" />
        </button>
      </Liste>
      {memoryOffen ? createPortal(
        <Dialog titel={`Memory of ${name}`} breite={540} onClose={() => setMemoryOffen(false)}>
          {gedaechtnis?.error ? (
            <div className="flex items-center justify-between gap-2">
              <p role="alert">Memory is unavailable right now.</p>
              <Knopf art="zweitrangig" groesse="klein" onClick={() => void loadMemory(botId)}>Reload</Knopf>
            </div>
          ) : !gedaechtnis?.loaded ? <Ladeanzeige text="Loading memory…" /> : eintragZahl === 0 ? (
            <p className="text-sm text-o-text-2">No entries yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {gedaechtnis.entries.map((eintrag) => (
                <li key={eintrag.name} className="rounded-o-card bg-o-surface px-4 py-3 [overflow-wrap:anywhere]">
                  <h3 className="text-sm font-medium">{eintrag.name}</h3>
                  <p className="text-sm text-o-text-2">{eintrag.description}</p>
                  {eintrag.body ? <p className="mt-2 whitespace-pre-wrap text-sm">{eintrag.body}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Dialog>, document.body,
      ) : null}
      <div className="mt-auto shrink-0">
        <ComputerKarte
          state={state}
          aktivitaet={live ? `${name} · ${live}` : `${name} is ready`}
          onClick={() => go({ kind: "computer", botId })}
        />
      </div>
      {offen && bot ? <RoutineDialog bot={bot} routine={offen} onClose={() => setOffen(null)} /> : null}
    </>
  );
}

/** Kachel zu einem anderen Reiter: Symbol, Name und ein Satz aus echten Daten. */
function Kachel({ symbol, titel, sub, onClick }: { symbol: string; titel: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex min-w-0 flex-col items-start gap-1.5 rounded-o-lg border border-solid border-o-card-border bg-o-raised p-3 text-left outline-none transition-colors duration-[var(--orbit-dur)] hover:bg-o-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-o-focus cursor-default">
      <span className="text-o-text-2"><Symbol name={symbol} /></span>
      <span className="flex w-full min-w-0 flex-col">
        <span className="truncate text-[14px] leading-5 font-medium">{titel}</span>
        <span className="truncate text-[12px] leading-4 text-o-text-2">{sub}</span>
      </span>
    </button>
  );
}

const COMPUTER_STATUS: Record<DesktopStatus, { titel: string; detail?: string }> = {
  laden: { titel: "Computer", detail: "Loading status…" },
  unconfigured: { titel: "Computer", detail: "Not set up" },
  sleeping: { titel: "Computer sleeping", detail: "Powered off" },
  running: { titel: "Computer running" },
  transitioning: { titel: "Computer starting", detail: "Getting ready…" },
  taken: { titel: "Computer taken over", detail: "You are in control" },
  unknown: { titel: "Computer", detail: "Status unknown right now" },
  fehler: { titel: "Computer", detail: "Status unavailable" },
};

/** Computer-Karte aus Figma 53:107337, mit Zuständen aus dem Dienst. */
export function ComputerKarte({ state, aktivitaet, onClick }: { state: DesktopStatus; aktivitaet: string; onClick: () => void }) {
  const laeuft = state === "running" || state === "taken";
  const { titel, detail } = COMPUTER_STATUS[state];
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[62px] w-full items-center gap-3 rounded-[14px] border border-solid border-o-card-border bg-o-raised px-3 py-2.5 text-left transition-colors duration-[var(--orbit-dur)] hover:bg-o-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-o-focus cursor-default"
    >
      {laeuft ? (
        <span
          aria-hidden="true"
          className="flex h-9 w-14 shrink-0 items-center justify-center rounded-md"
          style={{ background: "linear-gradient(135deg, var(--oo-screen-a), var(--oo-screen-b))" }}
        >
          <span className="h-[18px] w-[30px] rounded-[3px] bg-white/85" />
        </span>
      ) : (
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center text-o-text-2">
          <OrbiFigur avatar="grokbot" state={state === "transitioning" ? "lebendig" : "schlaeft"} size={40} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] leading-5 font-medium">{titel}</span>
        <span className="truncate text-[13px] leading-[18px] text-o-text-2">{detail ?? aktivitaet}</span>
      </span>
      {laeuft ? <Punkt art={state === "taken" ? "warn" : "ok"} /> : null}
      <span className="shrink-0 text-o-text-2"><Symbol name="chevr" /></span>
    </button>
  );
}

// ---------- Aktivität ----------

interface Eintrag {
  id: string;
  t?: number;
  titel: string;
  sub: string;
  art: PunktArt;
  taskId?: string;
}

/** Aktivität eines Orbis aus dem Zustand: offene Karten, laufende Schritte, Aufgaben und gelaufene Routinen, neueste zuerst. */
function useEintraege(botId: string): Eintrag[] {
  const routines = useOrbit((s) => s.routines);
  const cards = useOrbit((s) => s.cards);
  const tasks = useOrbit((s) => s.tasks);
  const steps = useOrbit((s) => s.steps);
  return useMemo(() => {
    const out: Eintrag[] = [];
    for (const k of cards) {
      if (k.botId !== botId) continue;
      out.push({ id: `k-${k.id}`, t: Date.parse(k.requestedAt), titel: k.text || k.reason || k.tool, sub: k.kind === "ask" ? "Waiting for your answer" : "Waiting for approval", art: "warn", taskId: k.root?.taskId });
    }
    for (const s of steps) {
      if (s.botId !== botId) continue;
      const t = typeof s.at === "number" ? s.at : Date.parse(String(s.at));
      out.push({ id: `s-${s.toolCallId}`, t: Number.isNaN(t) ? undefined : t, titel: s.label, sub: "Running", art: "ruhig" });
    }
    for (const t of Object.values(tasks)) {
      if (t.botId !== botId) continue;
      const sub = t.action === "done" ? "Done" : t.action === "stopped" ? "Stopped" : t.action === "failed" ? "Failed" : t.progress || "Running";
      out.push({ id: `t-${t.taskId}`, titel: t.title, sub, art: t.action === "done" ? "ok" : t.action === "failed" ? "fehler" : t.action === "stopped" ? "ruhig" : "warn", taskId: t.taskId });
    }
    for (const r of routines) {
      if (r.automation.botId !== botId || !r.automation.lastRunAt) continue;
      out.push({ id: `r-${r.automation.id}`, t: Date.parse(r.automation.lastRunAt), titel: r.automation.name, sub: "Routine · ran", art: "ok" });
    }
    return out.sort((a, b) => (b.t ?? Infinity) - (a.t ?? Infinity));
  }, [cards, steps, tasks, routines, botId]);
}

function Aktivitaet({ botId }: { botId: string }) {
  const go = useNav((s) => s.go);

  const eintraege = useEintraege(botId);

  if (eintraege.length === 0) {
    return <p className="text-[13px] leading-[18px] text-o-text-2">No activity yet.</p>;
  }
  const gruppen: { name: string; items: Eintrag[] }[] = [];
  for (const e of eintraege) {
    const name = e.t === undefined ? "Today" : tagesGruppe(e.t);
    const g = gruppen.find((x) => x.name === name);
    if (g) g.items.push(e);
    else gruppen.push({ name, items: [e] });
  }
  return (
    <>
      {gruppen.map((g) => (
        <section key={g.name} className="flex flex-col gap-3.5">
          <Abschnitt>{g.name}</Abschnitt>
          <Liste>
            {g.items.map((e) => {
              const inner = (
                <>
                  <span className="flex h-[18px] w-2 shrink-0 items-center justify-center self-start">
                    <Punkt art={e.art} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-px text-left">
                    <span className="truncate text-[14px] leading-5">{e.titel}</span>
                    <span className="truncate text-[12px] leading-4 text-o-text-2">{e.sub}</span>
                  </span>
                  {e.t !== undefined ? <span className="shrink-0 self-start text-[13px] leading-[18px] text-o-text-2">{uhrzeit(new Date(e.t))}</span> : null}
                </>
              );
              const cls = "flex w-full items-center gap-2.5 px-3 py-[11px]";
              return e.taskId ? (
                <button key={e.id} type="button" onClick={() => go({ kind: "aufgabe", taskId: e.taskId! })} className={cx(cls, "transition-colors duration-[var(--orbit-dur)] hover:bg-o-hover cursor-default")}>
                  {inner}
                </button>
              ) : (
                <div key={e.id} className={cls}>
                  {inner}
                </div>
              );
            })}
          </Liste>
        </section>
      ))}
    </>
  );
}

// ---------- Bibliothek ----------

type Filter = "alle" | "dokumente" | "bilder" | "links";

const istBild = (f: BibDatei) => f.kind === "image" || f.mediaType?.startsWith("image/");

async function ladeBibliotheksdatei(botId: string, f: BibDatei): Promise<Datei> {
  const { file } = await getLibraryFile(botId, f.id);
  if (typeof file?.data !== "string" || typeof file.mediaType !== "string"
      || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(file.mediaType)) {
    throw new Error("Die Datei konnte nicht geladen werden.");
  }
  return { filename: f.filename, mediaType: file.mediaType, url: `data:${file.mediaType};base64,${file.data}` };
}

function Bibliotheksbild({ botId, datei }: { botId: string; datei: BibDatei }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [bild, setBild] = useState<string>();
  useEffect(() => {
    if (!istBild(datei)) return;
    let aktiv = true;
    const laden = async () => {
      try {
        const f = await ladeBibliotheksdatei(botId, datei);
        if (!aktiv) return;
        const original = new Image();
        original.src = f.url;
        await original.decode();
        if (!aktiv) return;
        const faktor = Math.min(1, 320 / Math.max(original.naturalWidth, original.naturalHeight));
        const klein = document.createElement("canvas");
        klein.width = Math.max(1, Math.round(original.naturalWidth * faktor));
        klein.height = Math.max(1, Math.round(original.naturalHeight * faktor));
        const ctx = klein.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(original, 0, 0, klein.width, klein.height);
        setBild(klein.toDataURL("image/webp", 0.88));
      } catch { /* Bei fehlender Miniatur bleibt das Dateisymbol. */ }
    };
    let beobachter: IntersectionObserver | undefined;
    if (ref.current && typeof IntersectionObserver !== "undefined") {
      beobachter = new IntersectionObserver(([eintrag]) => {
        if (!eintrag?.isIntersecting) return;
        beobachter?.disconnect();
        void laden();
      });
      beobachter.observe(ref.current);
    } else {
      void laden();
    }
    return () => { aktiv = false; beobachter?.disconnect(); };
  }, [botId, datei]);
  return (
    <span ref={ref} className="grid size-full place-items-center overflow-hidden text-o-text-3">
      {bild ? <img src={bild} alt="" className="size-full object-contain" /> : <Symbol name={istBild(datei) ? "image" : "file"} groesse={28} />}
    </span>
  );
}

function Bibliothek({ botId }: { botId: string }) {
  const lib = useOrbisData((s) => s.library[botId]);
  const loadLibrary = useOrbisData((s) => s.loadLibrary);
  const [filter, setFilter] = useState<Filter>("alle");
  const [vorschau, setVorschau] = useState<Datei | null>(null);
  const [oeffnet, setOeffnet] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const abruf = useRef(0);
  useEffect(() => {
    void loadLibrary(botId);
    return () => { abruf.current++; };
  }, [botId, loadLibrary]);

  const oeffnen = async (f: BibDatei) => {
    if (oeffnet === f.id) return;
    const zug = ++abruf.current;
    setFehler(null);
    setOeffnet(f.id);
    try {
      const d = await ladeBibliotheksdatei(botId, f);
      if (abruf.current !== zug) return;
      if (hatMedienVorschau(d)) setVorschau(d);
      else await oeffneSchnellansicht(d).catch(() => { if (abruf.current === zug) setVorschau(d); });
    } catch (error) {
      if (abruf.current === zug) setFehler(typeof error === "string" ? error : "Could not open the file.");
    } finally {
      if (abruf.current === zug) setOeffnet(null);
    }
  };

  const files = (lib?.files ?? []).filter((f) => filter === "alle" || (filter === "bilder" && istBild(f)) || (filter === "dokumente" && !istBild(f)));
  const filters: [Filter, string][] = [["alle", "All"], ["dokumente", "Documents"], ["bilder", "Images"], ["links", "Links"]];
  return (
    <>
      <div role="group" aria-label="Filter" className="inline-flex shrink-0 gap-0.5 self-start rounded-full p-[3px]" style={{ background: "var(--oo-seg)" }}>
        {filters.map(([id, text]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            style={filter === id ? { background: "var(--oo-slider)", boxShadow: "var(--oo-slider-shadow)" } : undefined}
            className={cx(
              "h-[26px] rounded-full px-2.5 text-[13px] leading-[18px] transition-colors duration-[var(--orbit-dur)] focus-visible:outline-2 focus-visible:outline-o-focus cursor-default",
              filter === id ? "text-o-text" : "text-o-text-2",
            )}
          >
            {text}
          </button>
        ))}
      </div>
      {!lib?.loaded && !lib?.error ? <Ladeanzeige text="Loading library…" /> : files.length === 0 ? (
        <p className="text-[13px] leading-[18px] text-o-text-2">
          {lib?.error ?? (filter === "links" ? "The service does not collect links." : "No files yet.")}
        </p>
      ) : (
        <div className="grid shrink-0 grid-cols-2 gap-2">
          {files.map((f) => (
            <div key={f.id} className="relative min-w-0">
              <Medienkarte className="w-full!" titel={f.filename} beschreibung={dateiInfo(f)} bild={<Bibliotheksbild botId={botId} datei={f} />} />
              <button type="button" aria-label={`${f.filename} · Open preview`} title={f.filename}
                aria-busy={oeffnet === f.id || undefined} onClick={() => void oeffnen(f)}
                className="absolute inset-0 cursor-pointer rounded-o-dialog outline-none hover:ring-1 hover:ring-inset hover:ring-o-line-strong focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-o-focus" />
            </div>
          ))}
        </div>
      )}
      {fehler ? <p role="alert" className="text-[13px] text-o-danger">{fehler}</p> : null}
      {lib?.truncated ? <p className="text-[12px] leading-4 text-o-text-2">Only the newest files are shown.</p> : null}
      {vorschau ? createPortal(<MedienVorschau datei={vorschau} onClose={() => setVorschau(null)} />, document.body) : null}
    </>
  );
}

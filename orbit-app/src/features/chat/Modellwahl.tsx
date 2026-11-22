import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { getModels } from "../../lib/api";
import { fehlerText } from "../../lib/chunks";
import { useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import type { ModellInfo, Modellwunsch } from "../../lib/types";
import { Knopf, Ladeanzeige, Schalter, Symbol, cx } from "../../ui";
import { profilLesen, profilSchreiben } from "../onboarding/dienst";

const AUTOMATISCH: Modellwunsch = { model: "auto", effort: null, fast: false };
/** Anbieter in der Liste: Name und Markenzeichen (die Zeichen der Programme dahinter, Orbit hat keine eigenen Firmenlogos). */
const ANBIETER: Record<string, { name: string; marke: string }> = {
  anthropic: { name: "Anthropic", marke: "claude-code" },
  openai: { name: "OpenAI", marke: "codex" },
  google: { name: "Google", marke: "antigravity" },
  cursor: { name: "Cursor", marke: "cursor" },
};

const DENKTIEFE: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra", max: "Max", ultra: "Ultra" };

interface ModellDaten {
  katalog: ModellInfo[] | null;
  standard: Modellwunsch;
  laedt: boolean;
  speichert: boolean;
  fehler: string | null;
  cursorFehler: string | null;
  laden: (nurKatalog?: boolean) => Promise<void>;
  speichern: (wahl: Modellwunsch) => Promise<boolean>;
}

const useModellDaten = create<ModellDaten>((set, get) => ({
  katalog: null, standard: AUTOMATISCH, laedt: false, speichert: false, fehler: null, cursorFehler: null,
  laden: async (nurKatalog = false) => {
    if (get().laedt || get().speichert) return;
    set({ laedt: true, fehler: null });
    try {
      const [{ models, cursorError }, profil] = await Promise.all([getModels(), nurKatalog ? null : profilLesen()]);
      set({ katalog: models, cursorFehler: cursorError ?? null });
      if (profil && !get().speichert) {
        const { profile } = profil;
        set({ standard: { model: profile.defaultModel, effort: profile.defaultEffort ?? null, fast: profile.defaultFast === true } });
      }
    } catch (e) {
      set({ fehler: fehlerText(e) });
    } finally {
      set({ laedt: false });
    }
  },
  speichern: async (wahl) => {
    if (get().speichert) return false;
    set({ speichert: true, fehler: null });
    try {
      await profilSchreiben({ defaultModel: wahl.model, defaultEffort: wahl.effort, defaultFast: wahl.fast === true });
      set({ standard: wahl });
      return true;
    } catch (e) {
      set({ fehler: fehlerText(e) });
      return false;
    } finally {
      set({ speichert: false });
    }
  },
}));

function denktiefe(modell: ModellInfo, effort: string | null | undefined) {
  if (effort && modell.efforts.includes(effort)) return effort;
  return modell.efforts.includes("medium") ? "medium" : modell.efforts[0] ?? null;
}

function modellText(wahl: Modellwunsch, katalog: ModellInfo[]) {
  return wahl.model === "auto" ? "Automatic" : katalog.find((m) => m.id === wahl.model)?.label ?? wahl.model;
}

function kartenLage(anker: HTMLElement, imChat: boolean): CSSProperties {
  const r = anker.getBoundingClientRect();
  const rand = 12;
  const width = Math.min(368, window.innerWidth - 2 * rand);
  const oben = imChat || (window.innerHeight - r.bottom < 360 && r.top > window.innerHeight - r.bottom);
  return {
    width,
    left: Math.max(rand, Math.min(r.right - width, window.innerWidth - width - rand)),
    ...(oben ? { bottom: window.innerHeight - r.top + 8 } : { top: r.bottom + 8 }),
    maxHeight: Math.max(120, (oben ? r.top : window.innerHeight - r.bottom) - rand - 8),
    transformOrigin: oben ? "bottom right" : "top right",
  };
}

function Zeile({ titel, zusatz, hinweis, aktiv, waehlen }: { titel: string; zusatz?: string | null; hinweis?: string; aktiv: boolean; waehlen: () => void }) {
  return (
    <button type="button" aria-pressed={aktiv} title={hinweis} onClick={waehlen}
      className="flex h-8 w-full min-w-0 items-center gap-2 rounded-o-control px-3 text-left text-[14px] leading-5 text-o-text outline-none transition-colors duration-[var(--orbit-dur)] hover:bg-o-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-o-focus cursor-default">
      <span className="min-w-0 truncate">{titel}{zusatz ? <span className="text-o-text-2"> {zusatz}</span> : null}</span>
      {aktiv ? <span className="ml-auto shrink-0 text-o-text-2"><Symbol name="check" groesse={14} /></span> : null}
    </button>
  );
}

/** Modell-Picker im Stil der Cursor-App: Auto-Schalter, Modellliste, unten die Denktiefe als Stufenleiste (nur für Modelle mit Denktiefe). Eine Wahl gilt sofort. */
function ModellPicker({ id, anker, imChat, katalog, standard, gewaehlt, fehler, cursorFehler, schliessen, anwenden }: {
  id: string; anker: HTMLElement; imChat: boolean; katalog: ModellInfo[]; standard: Modellwunsch; gewaehlt: Modellwunsch | null;
  fehler: string | null; cursorFehler: string | null; schliessen: () => void; anwenden: (wahl: Modellwunsch | null) => void;
}) {
  const [lage, setLage] = useState(() => kartenLage(anker, imChat));
  const dialog = useRef<HTMLDivElement>(null);
  const auto = gewaehlt?.model === "auto";
  const modell = katalog.find((m) => m.id === gewaehlt?.model);
  const tiefen = modell?.efforts ?? [];
  const aktuelle = katalog.filter((m) => !m.legacy && m.cli.provider !== "cursor");
  const gruppen = [
    { id: "cursor", titel: "Cursor", symbol: ANBIETER.cursor.marke, modelle: katalog.filter((m) => m.cli.provider === "cursor") },
    { id: "alt", titel: "Older models", symbol: null, modelle: katalog.filter((m) => m.legacy && m.cli.provider !== "cursor") },
  ].filter((g) => g.modelle.length);
  const [aufgeklappt, setAufgeklappt] = useState<string[]>(() => gruppen.filter((g) => g.modelle.some((m) => m.id === gewaehlt?.model)).map((g) => g.id));

  useLayoutEffect(() => {
    const neuPositionieren = () => setLage(kartenLage(anker, imChat));
    window.addEventListener("resize", neuPositionieren);
    return () => window.removeEventListener("resize", neuPositionieren);
  }, [anker, imChat]);
  useEffect(() => { dialog.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus(); }, []);

  function taste(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      schliessen();
    }
    if (event.key !== "Tab") return;
    const knoepfe = dialog.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
    if (!knoepfe?.length) return;
    const erster = knoepfe[0], letzter = knoepfe[knoepfe.length - 1];
    if (event.shiftKey ? document.activeElement === erster : document.activeElement === letzter) {
      event.preventDefault();
      (event.shiftKey ? letzter : erster).focus();
    }
  }

  const modellWaehlen = (m: ModellInfo) => {
    anwenden({ model: m.id, effort: denktiefe(m, gewaehlt?.effort), fast: m.fast && gewaehlt?.fast === true });
    if (!m.efforts.length && !m.fast) schliessen();
  };
  const zeile = (m: ModellInfo) => (
    <Zeile key={m.id} titel={m.label} zusatz={gewaehlt?.model === m.id && gewaehlt.effort ? DENKTIEFE[gewaehlt.effort] ?? gewaehlt.effort : null} hinweis={m.description} aktiv={gewaehlt?.model === m.id} waehlen={() => modellWaehlen(m)} />
  );
  /** Modelle nach Anbieter getrennt, in der Reihenfolge der Liste: dezente Überschrift mit Marke und Name. */
  const abschnitte = (modelle: ModellInfo[]) =>
    [...new Set(modelle.map((m) => m.provider))].map((anbieter) => {
      const a = ANBIETER[anbieter];
      return (
        <div key={anbieter} role="group" aria-label={a?.name ?? anbieter} className="flex flex-col">
          <div className="flex h-6 items-center gap-1.5 px-3 pt-1 text-[12px] leading-4 text-o-text-2">
            {a ? <Symbol marke={a.marke} groesse={12} /> : null}
            {a?.name ?? anbieter}
          </div>
          {modelle.filter((m) => m.provider === anbieter).map(zeile)}
        </div>
      );
    });
  const autoSchalten = (an: boolean) => {
    const erstes = aktuelle[0] ?? katalog[0];
    if (an) anwenden(AUTOMATISCH);
    else if (imChat) anwenden(null);
    else if (erstes) anwenden({ model: erstes.id, effort: denktiefe(erstes, null), fast: false });
  };
  return createPortal(
    <div className="orbit-ui fixed inset-0 z-50" onPointerDown={(event) => { if (event.target === event.currentTarget) schliessen(); }}>
      <div ref={dialog} id={id} role="dialog" aria-modal="true" aria-label={imChat ? "Model for this chat" : "Default model"} style={lage} onKeyDown={taste}
        className="orbit-pop fixed flex flex-col rounded-o-card border border-solid border-o-card-border bg-o-raised p-2 text-o-text shadow-o-menu">
        <div className="flex h-8 shrink-0 items-center justify-between px-3 text-[14px] leading-5">
          <span className="flex items-center gap-2"><span className="text-o-text-2"><Symbol name="sparkle" groesse={14} /></span>Automatic</span>
          <Schalter aria-label="Automatic" checked={auto} onChange={autoSchalten} />
        </div>
        <div role="separator" className="shrink-0 px-3 py-1"><div className="h-px bg-o-line" /></div>
        <div role="group" aria-label="Models" aria-disabled={auto} className={cx("chat-scroll flex min-h-0 flex-col overflow-y-auto transition-opacity duration-[var(--orbit-dur)]", auto && "pointer-events-none opacity-40")}>
          {imChat ? <Zeile titel="Default" zusatz={modellText(standard, katalog)} aktiv={!gewaehlt} waehlen={() => { anwenden(null); schliessen(); }} /> : null}
          {abschnitte(aktuelle)}
          {gruppen.map((g) => {
            const auf = aufgeklappt.includes(g.id);
            return (
              <div key={g.id} className="flex flex-col">
                <button type="button" aria-expanded={auf} onClick={() => setAufgeklappt(auf ? aufgeklappt.filter((x) => x !== g.id) : [...aufgeklappt, g.id])}
                  className="flex h-8 w-full items-center gap-2 rounded-o-control px-3 text-left text-[14px] leading-5 text-o-text outline-none transition-colors duration-[var(--orbit-dur)] hover:bg-o-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-o-focus cursor-default">
                  {g.symbol ? <Symbol marke={g.symbol} groesse={14} /> : null}
                  {g.titel}
                  <span className={cx("ml-auto text-o-text-2 transition-transform duration-[var(--orbit-dur)] ease-spring", auf && "rotate-90")}><Symbol name="chevr" groesse={12} /></span>
                </button>
                {auf ? <div className="flex flex-col pl-3">{g.id === "alt" ? abschnitte(g.modelle) : g.modelle.map(zeile)}</div> : null}
              </div>
            );
          })}
        </div>
        {gewaehlt && !auto && (tiefen.length > 0 || modell?.fast) ? (
          <div className="mt-1 flex shrink-0 flex-col gap-2.5 border-t border-solid border-o-line px-3 pt-2.5 pb-1">
            {tiefen.length > 0 ? (
              <div role="group" aria-label="Reasoning effort">
                <div className="mb-1.5 text-[13px] leading-[18px] text-o-text-2">Reasoning effort</div>
                <div className="flex gap-0.5 rounded-o-control bg-o-hover p-0.5">
                  {tiefen.map((tiefe) => (
                    <button type="button" key={tiefe} aria-pressed={gewaehlt.effort === tiefe} onClick={() => anwenden({ ...gewaehlt, effort: tiefe })}
                      className={cx("h-7 flex-auto whitespace-nowrap rounded-[8px] px-1.5 text-[12px] leading-4 outline-none transition-[background-color,color] duration-[var(--orbit-dur)] focus-visible:outline-2 focus-visible:outline-o-focus cursor-default", gewaehlt.effort === tiefe ? "bg-o-selected text-o-text" : "text-o-text-2 hover:text-o-text")}>
                      {DENKTIEFE[tiefe] ?? tiefe}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {modell?.fast ? (
              <div className="flex h-7 items-center justify-between text-[14px] leading-5">
                <span>Fast <span className="text-o-text-2">Replies faster</span></span>
                <Schalter aria-label="Fast" checked={gewaehlt.fast === true} onChange={(an) => anwenden({ ...gewaehlt, fast: an })} />
              </div>
            ) : null}
          </div>
        ) : null}
        {cursorFehler ? <p role="status" className="px-3 pt-2 pb-1 text-[13px] text-o-text-2">{cursorFehler}</p> : null}
        {fehler ? <p role="alert" className="px-3 pt-2 pb-1 text-[13px] text-o-danger">{fehler}</p> : null}
      </div>
    </div>, document.body,
  );
}

/** Die Chat-Auswahl gilt für diesen Chat, der Standard wird im Profil gespeichert. */
export function Modellwahl({ chatId, className }: { chatId?: string; className?: string }) {
  const { katalog, standard, fehler, cursorFehler, laden, speichern } = useModellDaten();
  const neuverbunden = useOrbit((s) => s.neuverbunden);
  const modell = useOrbit((s) => chatId ? s.chatModelle[chatId] ?? null : null);
  const setChatModell = useOrbit((s) => s.setChatModell);
  const ansicht = useNav((s) => s.main.kind);
  const anker = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [offen, setOffen] = useState(false);
  useEffect(() => { void laden(); }, [laden, neuverbunden]);
  useEffect(() => { setOffen(false); }, [chatId, ansicht]);

  if (!katalog) return fehler ? (
    <Knopf art="still" className={className} title={fehler} onClick={() => void laden()}>Reload models</Knopf>
  ) : <Ladeanzeige text="Loading models …" className={className} />;

  const mitStufe = (wahl: Modellwunsch) => {
    const eintrag = katalog.find((m) => m.id === wahl.model);
    return eintrag ? { ...wahl, effort: denktiefe(eintrag, wahl.effort) } : wahl;
  };
  const aktuell = mitStufe(modell ?? standard);
  const name = modellText(aktuell, katalog);
  const tiefe = [aktuell.effort ? DENKTIEFE[aktuell.effort] ?? aktuell.effort : null, aktuell.fast ? "Fast" : null].filter(Boolean).join(" · ") || null;
  const schliessen = () => { setOffen(false); anker.current?.focus(); };
  const anwenden = (wahl: Modellwunsch | null) => {
    if (chatId) setChatModell(chatId, wahl);
    else if (wahl) void speichern(wahl);
  };
  return (
    <>
      <button ref={anker} type="button" aria-haspopup="dialog" aria-expanded={offen} aria-controls={offen ? id : undefined}
        aria-label={chatId ? "Model for this chat" : "Default model"}
        title={[chatId && !modell ? "Default" : null, name, tiefe].filter(Boolean).join(" · ")}
        onClick={() => { if (!offen) void laden(true); setOffen(!offen); }}
        className={cx("flex h-7 min-w-0 items-center gap-1.5 rounded-o-sm px-2 text-[12px] leading-4 font-medium text-o-text-2 outline-none transition-colors duration-[var(--orbit-dur)] hover:bg-o-hover hover:text-o-text focus-visible:outline-2 focus-visible:outline-o-focus cursor-default", offen && "bg-o-selected text-o-text", className)}>
        <span className="min-w-0 flex-1 truncate text-left">{name}{tiefe ? ` · ${tiefe}` : ""}</span>
        <Symbol name="chevd" groesse={12} />
      </button>
      {offen && anker.current ? <ModellPicker id={id} anker={anker.current} imChat={!!chatId} katalog={katalog} standard={standard} gewaehlt={chatId && !modell ? null : aktuell} fehler={chatId ? null : fehler} cursorFehler={cursorFehler} schliessen={schliessen} anwenden={anwenden} /> : null}
    </>
  );
}

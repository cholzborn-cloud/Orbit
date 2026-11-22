// Seitenleiste 336 (eingeklappt 88): Hauptorbi-Kachel, Suche, Neu, Chatliste, Profil, Plugins-Knopf (Figma 03).
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Griff, Ladeanzeige, Menue, Menuezeile, Symbol, cx, type SymbolName } from "../../ui";
import { useOrbit } from "../../lib/store";
import { LEISTE, cssBreite, maxBreite, useNav } from "../../lib/nav";
import * as api from "../../lib/api";
import type { Bot, Nachricht, SuchTreffer } from "../../lib/types";
import { ChatZeile, Figur, HauptorbiKachel, PluginsKnopf, PunktMarke, Rundknopf } from "./bausteine";
import { useProfil } from "./hooks";
import { OrbiContextMenu } from "../orbis";
import { arbeiter, chatListe, chatPunkt, vorschau, type ListenEintrag } from "./logik";
import { avatarStil, initialen } from "../../lib/profil";

const ZEILE = 58;
const LUECKE = 4;

/** Schließt ein Popover bei Klick daneben oder Escape. */
function useSchliessen(ref: React.RefObject<HTMLElement | null>, offen: boolean, zu: () => void) {
  useEffect(() => {
    if (!offen) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) zu();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") zu();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [ref, offen, zu]);
}

/** Letzte Nachricht je Chat für die Vorschau: aus dem Speicher, sonst einmal vom Dienst geholt. */
function useVorschauen(eintraege: ListenEintrag[], haupt: Bot | null, botName: (id?: string | null) => string | null) {
  const messages = useOrbit((s) => s.messages);
  const [geholt, setGeholt] = useState<Record<string, Nachricht | null>>({});
  const geladen = useRef(new Map<string, string | null>());
  const ids = useMemo(() => {
    const l = eintraege.map((e) => [e.chatId, e.letzte] as const);
    if (haupt) l.push([haupt.chatId, haupt.lastMessageAt]);
    return l;
  }, [eintraege, haupt]);
  useEffect(() => {
    let abgebrochen = false;
    for (const [id, letzte] of ids) {
      if ((messages[id] ?? []).length) continue;
      if (geladen.current.get(id) === letzte && geladen.current.has(id)) continue;
      geladen.current.set(id, letzte);
      api.getMessages(id, { limit: 1 })
        .then((r) => {
          if (!abgebrochen) setGeholt((g) => ({ ...g, [id]: r.messages?.[r.messages.length - 1] ?? null }));
        })
        .catch(() => {});
    }
    return () => {
      abgebrochen = true;
    };
  }, [ids, messages]);

  return (e: ListenEintrag): string => {
    const liste = messages[e.chatId];
    const m = liste && liste.length ? liste[liste.length - 1] : geholt[e.chatId] ?? undefined;
    if (!m) return e.bot?.job ?? e.gruppe?.members.map((x) => x.name).join(", ") ?? "";
    const von = (x: typeof m) => (e.art === "gruppe" ? (x.role === "user" ? "You" : botName(x.metadata?.botId)) : null);
    // Letzte Nachricht mit Text (reine Werkzeug-Nachrichten, etwa eine Ergebnis-Karte, bleiben ohne Vorschau).
    for (let i = (liste?.length ?? 0) - 1; i >= 0 && liste; i--) {
      const t = vorschau(liste[i], von(liste[i]));
      if (t) return t;
    }
    return vorschau(m, von(m));
  };
}

function Suche({ onZu }: { onZu: () => void }) {
  const [q, setQ] = useState("");
  const [treffer, setTreffer] = useState<SuchTreffer[] | null>(null);
  const [fehler, setFehler] = useState(false);
  const selectChat = useOrbit((s) => s.selectChat);
  const go = useNav((s) => s.go);
  const feld = useRef<HTMLInputElement>(null);
  useEffect(() => feld.current?.focus(), []);
  useEffect(() => {
    const t = q.trim();
    setTreffer(null);
    setFehler(false);
    if (t.length < 2) return;
    let weg = false;
    const id = setTimeout(() => {
      api.search(t)
        .then((r: any) => {
          if (!weg) {
            setTreffer(r.results ?? r.hits ?? r.treffer ?? []);
            setFehler(false);
          }
        })
        .catch(() => {
          if (!weg) setFehler(true);
        });
    }, 200);
    return () => {
      weg = true;
      clearTimeout(id);
    };
  }, [q]);
  return (
    <div data-suche className="orbit-pop absolute left-full top-12 z-30 ml-2 flex max-h-[calc(100%-4rem)] w-72 flex-col gap-2 rounded-o-card border border-o-card-border bg-o-sidebar p-3 shadow-o-menu">
      <input
        ref={feld}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onZu();
        }}
        placeholder="Search chats"
        aria-label="Search chats"
        className="h-9 w-full shrink-0 rounded-full bg-o-surface px-4 text-[14px] leading-5 text-o-text outline-none placeholder:text-o-text-3 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-o-focus"
      />
      <ul className="chat-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {q.trim().length >= 2 && !treffer && !fehler ? <li className="px-2.5 py-2"><Ladeanzeige text="Searching …" /></li> : null}
        {(treffer ?? []).map((t) => (
          <li key={t.messageId}>
            <button
              type="button"
              onClick={() => {
                go({ kind: "chat" });
                void selectChat(t.chatId);
                onZu();
              }}
              className="flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left outline-none hover:bg-o-hover focus-visible:outline-2 focus-visible:outline-o-focus cursor-default"
            >
              <Figur d={{ avatar: t.avatar, color: t.color }} size={28} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] leading-5 text-o-text">{t.chatName}</span>
                <span className="truncate text-[13px] leading-[18px] text-o-text-2">{t.snippet}</span>
              </span>
            </button>
          </li>
        ))}
        {treffer && treffer.length === 0 ? <li className="px-2.5 py-2 text-[13px] leading-[18px] text-o-text-2">No results.</li> : null}
        {fehler ? <li className="px-2.5 py-2 text-[13px] leading-[18px] text-o-text-2">Search is not reachable right now.</li> : null}
      </ul>
    </div>
  );
}

const PROFIL_ZEILEN: { symbol: SymbolName; text: string; seite: string }[][] = [
  [
    { symbol: "gear", text: "Settings", seite: "einstellungen" },
    { symbol: "palette", text: "Appearance", seite: "darstellung" },
    { symbol: "user", text: "Personalization", seite: "personalisierung" },
  ],
  [
    { symbol: "store", text: "Plugins", seite: "plugins" },
    { symbol: "gauge", text: "Usage", seite: "nutzung" },
  ],
  [
    { symbol: "desktop", text: "Workspace", seite: "arbeitsumgebung" },
    { symbol: "shield", text: "Security", seite: "sicherheit" },
  ],
];

function Trenner() {
  return (
    <div role="separator" className="px-2.5 py-[5px]">
      <div className="h-px bg-o-line" />
    </div>
  );
}

/** Kompaktes Menü am Profilknopf (Figma 43:281745). */
export function Profilmenue({
  id, voll, anzahl, onWaehlen, onZu, className,
}: { id: string; voll: string; anzahl: number; onWaehlen: (seite: string) => void; onZu: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true }), []);
  return (
    <div ref={ref} className={className}>
      <Menue
        id={id}
        kompakt
        className="chat-scroll max-h-[calc(100dvh-5rem)] w-56 overflow-y-auto"
        aria-label="Account"
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "Tab") {
            e.stopPropagation();
            onZu();
            return;
          }
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          const eintraege = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"));
          const index = eintraege.findIndex((element) => element === e.target);
          const richtung = e.key === "ArrowDown" ? 1 : -1;
          eintraege[(index + richtung + eintraege.length) % eintraege.length]?.focus();
        }}
      >
        <div className="flex flex-col px-2.5 py-1.5">
          <span className="truncate text-[13px] leading-[18px] font-medium text-o-text" title={voll}>{voll}</span>
          <span className="text-[12px] leading-4 text-o-text-2">Orbit · {anzahl} {anzahl === 1 ? "Orbi" : "Orbis"}</span>
        </div>
        {PROFIL_ZEILEN.map((gruppe, gi) => (
          <div key={gi}>
            <Trenner />
            {gruppe.map((z) => (
              <Menuezeile key={z.seite} tabIndex={-1} symbol={z.symbol} text={z.text} onClick={() => onWaehlen(z.seite)} />
            ))}
          </div>
        ))}
      </Menue>
    </div>
  );
}

export function NeuMenue({ onZu, className }: { onZu: () => void; className?: string }) {
  const openEditor = useNav((s) => s.openEditor);
  const ref = useRef<HTMLDivElement>(null);
  useSchliessen(ref, true, onZu);
  return (
    <div ref={ref} className={className}>
      <Menue kompakt aria-label="New" className="w-48">
        <Menuezeile symbol="bot" text="New Orbi" onClick={() => { openEditor({ kind: "orbi" }); onZu(); }} />
        <Menuezeile symbol="user" text="New group" onClick={() => { openEditor({ kind: "gruppe" }); onZu(); }} />
      </Menue>
    </div>
  );
}

/** Knopf zum Ein- und Ausklappen der linken Leiste (⌘B, ⌘\\): sitzt außen an der Leistenkante, oben links im Chatbereich, und fliegt beim Einklappen mit. */
export function LeistenKnopf() {
  const eingeklappt = useNav((s) => s.sidebarCollapsed);
  const toggle = useNav((s) => s.toggleSidebar);
  const breite = useNav((s) => s.sidebarWidth);
  const rechts = useNav((s) => (s.panel || s.main.kind === "routinen" ? s.panelWidth : 0));
  const text = eingeklappt ? "Show sidebar" : "Hide sidebar";
  const links = eingeklappt ? `${LEISTE.klein}px` : cssBreite("links", breite, rechts);
  return (
    <button
      type="button"
      data-flip="knopf"
      data-leistenknopf
      aria-label={text}
      aria-expanded={!eingeklappt}
      title={`${text} (⌘B)`}
      onClick={toggle}
      style={{ left: `calc(${links} + 12px)` }}
      className="orbit-ui absolute top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-o-text-2 outline-none cursor-default transition-[background-color,color,transform] duration-[var(--orbit-dur)] ease-[var(--orbit-ease)] hover:bg-o-hover hover:text-o-text focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-o-focus active:scale-90"
    >
      <Symbol name="panel" groesse={18} />
    </button>
  );
}

export function Seitenleiste({
  ampel, neuOffen, setNeuOffen, profilOffen: profilOffenExtern,
}: { ampel?: boolean; neuOffen: boolean; setNeuOffen: (v: boolean) => void; profilOffen?: boolean }) {
  const klein = useNav((s) => s.sidebarCollapsed);
  const breite = useNav((s) => s.sidebarWidth);
  const setBreite = useNav((s) => s.setSidebarWidth);
  const rechts = useNav((s) => (s.panel || s.main.kind === "routinen" ? s.panelWidth : 0));
  const main = useNav((s) => s.main);
  const go = useNav((s) => s.go);
  const bots = useOrbit((s) => s.bots);
  const groups = useOrbit((s) => s.groups);
  const chats = useOrbit((s) => s.chats);
  const hauptBot = useOrbit((s) => s.main);
  const gewaehlt = useOrbit((s) => s.selectedChatId);
  const selectChat = useOrbit((s) => s.selectChat);
  const unread = useOrbit((s) => s.unread);
  const cards = useOrbit((s) => s.cards);
  const working = useOrbit((s) => s.working);
  const profil = useProfil();

  const { haupt, eintraege } = useMemo(() => chatListe(bots, groups, chats, hauptBot), [bots, groups, chats, hauptBot]);
  const botName = (id?: string | null) => bots.find((b) => b.id === id)?.name ?? null;
  const vorschauVon = useVorschauen(eintraege, haupt, botName);

  const [suche, setSuche] = useState(false);
  const [profilOffen, setProfilOffen] = useState(!!profilOffenExtern);
  const profilMenuId = useId();
  const profilRef = useRef<HTMLDivElement>(null);
  const profilKnopfRef = useRef<HTMLButtonElement>(null);
  useSchliessen(profilRef, profilOffen, () => setProfilOffen(false));

  const imChat = main.kind !== "einstellungen";
  const [ctx, setCtx] = useState<null | { botId?: string; chatId: string; x: number; y: number }>(null);
  const index = imChat ? eintraege.findIndex((e) => e.chatId === gewaehlt) : -1;
  const hauptGewaehlt = imChat && !!haupt && gewaehlt === haupt.chatId;

  const waehle = (chatId: string) => {
    setSuche(false);
    go({ kind: "chat" });
    void selectChat(chatId);
  };
  const punktVon = (chatId: string) => chatPunkt(chatId, unread, cards, working);
  const live = (chatId: string) => arbeiter(chatId, working).some((w) => w.status === "arbeitet");
  const rechtsklick = (e: ListenEintrag) => (ev: React.MouseEvent) => {
    ev.preventDefault();
    setCtx({ botId: e.bot?.id, chatId: e.chatId, x: ev.clientX, y: ev.clientY });
  };
  const profilWahl = (seite: string) => {
    setProfilOffen(false);
    go({ kind: "einstellungen", page: seite === "einstellungen" ? undefined : seite });
  };

  const hauptName = haupt?.name ?? "";
  const profilKnopf = (
    <button
      ref={profilKnopfRef}
      type="button"
      aria-label="Profile menu"
      aria-haspopup="menu"
      aria-expanded={profilOffen}
      aria-controls={profilOffen ? profilMenuId : undefined}
      title={profil.voll}
      onClick={() => { setSuche(false); setProfilOffen((v) => !v); }}
      className={cx(
        "group flex items-center gap-2.5 rounded-[12px] text-left outline-none cursor-default",
        "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-o-focus",
        klein ? "h-9 w-9 shrink-0 justify-center rounded-full p-0.5" : "h-9 w-full min-w-0 py-0.5 pl-1 pr-2",
      )}
    >
      <span data-flip="profil" style={avatarStil(profil.avatarColor, profil.avatarFont)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-o-surface text-[11px] leading-4 text-o-text-2">
        {initialen(profil.name) || "?"}
      </span>
      {klein ? null : (
        <span data-flip-text className={cx(
          "min-w-0 truncate text-[13px] leading-[18px] transition-colors group-hover:text-o-text group-focus-visible:text-o-text",
          profilOffen ? "text-o-text" : "text-o-text-2",
        )}>
          {profil.name || profil.kurz}
        </span>
      )}
    </button>
  );

  const menu = profilOffen ? (
    <Profilmenue
      id={profilMenuId}
      voll={profil.voll}
      anzahl={bots.length}
      onWaehlen={profilWahl}
      onZu={() => { setProfilOffen(false); profilKnopfRef.current?.focus(); }}
      className={cx("absolute z-30", klein ? "bottom-0 left-full ml-3 origin-bottom-left" : "bottom-full left-0 mb-2 origin-bottom-left")}
    />
  ) : null;

  const ampelKopf: ReactNode = (
    <div
      data-tauri-drag-region
      className={cx("flex h-3 shrink-0 items-center gap-2", klein ? "w-[52px]" : "w-[70px] pl-1.5")}
      aria-hidden="true"
    >
      {ampel ? (
        <>
          <span className="h-3 w-3 rounded-full" style={{ background: "#ff5f57" }} />
          <span className="h-3 w-3 rounded-full" style={{ background: "#febc2e" }} />
          <span className="h-3 w-3 rounded-full" style={{ background: "#28c840" }} />
        </>
      ) : null}
    </div>
  );

  const ctxMenue = ctx ? <OrbiContextMenu botId={ctx.botId} chatId={ctx.chatId} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} /> : null;

  if (klein) {
    return (
      <aside
        data-seitenleiste="eingeklappt"
        aria-label="Chats"
        style={{ width: LEISTE.klein }}
        className={cx("orbit-ui relative isolate flex h-full shrink-0 flex-col items-center gap-0.5 p-3", (profilOffen || suche || neuOffen) && "z-20")}
      >
        <span aria-hidden="true" data-flip="bg" data-flip-skala className="pointer-events-none absolute inset-0 -z-10 origin-top-left bg-o-sidebar" />
        <div data-tauri-drag-region className="flex h-9 w-full shrink-0 items-center justify-center">{ampelKopf}</div>
        <div className="h-3 shrink-0" />
        <Rundknopf symbol="search" data-flip="suche" aria-label="Search" aria-expanded={suche} title="Search" onClick={() => setSuche((v) => !v)} />
        <div className="h-2 shrink-0" />
        <div className="relative">
          <Rundknopf symbol="plus" data-flip="neu" aria-label="New" title="New (⌘N)" onClick={() => setNeuOffen(!neuOffen)} />
          {neuOffen ? <NeuMenue onZu={() => setNeuOffen(false)} className="absolute left-11 top-0 z-20" /> : null}
        </div>
        <div className="h-4 shrink-0" />
        {haupt ? (
          <HauptorbiKachel klein daten={haupt} name={hauptName} ausgewaehlt={hauptGewaehlt} punkt={punktVon(haupt.chatId)} onClick={() => waehle(haupt.chatId)} onContextMenu={(ev) => { ev.preventDefault(); setCtx({ botId: haupt.id, chatId: haupt.chatId, x: ev.clientX, y: ev.clientY }); }} />
        ) : null}
        <div className="my-2.5 h-px w-8 shrink-0 bg-o-line-strong" role="separator" />
        <div className="chat-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {eintraege.map((e) => (
            <button
              key={e.chatId}
              type="button"
              title={e.name}
              aria-label={e.name}
              aria-current={imChat && gewaehlt === e.chatId ? "true" : undefined}
              onClick={() => waehle(e.chatId)}
              onContextMenu={rechtsklick(e)}
              className={cx(
                "relative flex h-[58px] w-14 shrink-0 items-center justify-center rounded-[12px] outline-none cursor-default",
                "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-o-focus",
                imChat && gewaehlt === e.chatId ? "bg-o-selected hover:bg-o-selected-hover" : "hover:bg-o-hover",
              )}
            >
              <span className="relative flex">
                <Figur d={e} size={36} state={live(e.chatId) ? "lebendig" : "normal"} flip={`fig-${e.chatId}`} />
                {punktVon(e.chatId) ? (
                  <span className="absolute -right-1 -top-px"><PunktMarke punkt={punktVon(e.chatId)!} ring groesse={6} /></span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
        <div className="h-2 shrink-0" />
        <PluginsKnopf data-flip="plugins" onClick={() => go({ kind: "einstellungen", page: "plugins" })} />
        <div className="h-2.5 shrink-0" />
        <div ref={profilRef} className="relative shrink-0">{profilKnopf}{menu}</div>
        {suche ? <Suche onZu={() => setSuche(false)} /> : null}
        {ctxMenue}
        <span aria-hidden="true" data-flip="linie" className="pointer-events-none absolute inset-y-0 right-0 w-px bg-o-line" />
      </aside>
    );
  }

  return (
    <aside
      data-seitenleiste="offen"
      aria-label="Chats"
      style={{ width: cssBreite("links", breite, rechts) }}
      className={cx("orbit-ui relative isolate flex h-full shrink-0 flex-col gap-0.5 p-3", (profilOffen || suche || neuOffen) && "z-20")}
    >
      <span aria-hidden="true" data-flip="bg" data-flip-skala className="pointer-events-none absolute inset-0 -z-10 origin-top-left bg-o-sidebar" />
      <div data-tauri-drag-region className="flex h-9 shrink-0 items-center gap-2">
        {ampelKopf}
        <div data-tauri-drag-region className="h-full flex-1" />
        <Rundknopf symbol="search" data-flip="suche" aria-label="Search" aria-expanded={suche} title="Search" onClick={() => setSuche((v) => !v)} />
        <div className="relative">
          <Rundknopf symbol="plus" data-flip="neu" aria-label="New" title="New (⌘N)" onClick={() => setNeuOffen(!neuOffen)} />
          {neuOffen ? <NeuMenue onZu={() => setNeuOffen(false)} className="absolute right-0 top-10 z-20" /> : null}
        </div>
      </div>
      <div className="h-3 shrink-0" />
      <div className="flex h-[116px] shrink-0 items-center justify-center py-1">
        {haupt ? (
          <HauptorbiKachel daten={haupt} name={hauptName} ausgewaehlt={hauptGewaehlt} punkt={punktVon(haupt.chatId)} onClick={() => waehle(haupt.chatId)} onContextMenu={(ev) => { ev.preventDefault(); setCtx({ botId: haupt.id, chatId: haupt.chatId, x: ev.clientX, y: ev.clientY }); }} />
        ) : null}
      </div>
      <div className="h-4 shrink-0" />
      <div className="chat-scroll relative flex min-h-0 flex-1 flex-col overflow-y-auto" role="list" aria-label="Chats">
        <div className="group/liste relative flex flex-col" style={{ gap: LUECKE }}>
          <span
            aria-hidden="true"
            data-auswahl
            className="pointer-events-none absolute inset-x-0 top-0 rounded-[12px] bg-o-selected group-has-[[aria-current=true]:hover]/liste:bg-o-selected-hover transition-[transform,opacity,background-color] duration-[260ms] ease-[var(--orbit-ease-spring)]"
            style={{ height: ZEILE, transform: `translateY(${Math.max(index, 0) * (ZEILE + LUECKE)}px)`, opacity: index >= 0 ? 1 : 0 }}
          />
          {eintraege.map((e) => (
            <ChatZeile
              key={e.chatId}
              flip={`fig-${e.chatId}`}
              name={e.name}
              vorschau={vorschauVon(e)}
              daten={e}
              punkt={punktVon(e.chatId)}
              ausgewaehlt={imChat && gewaehlt === e.chatId}
              live={live(e.chatId)}
              onClick={() => waehle(e.chatId)}
              onContextMenu={rechtsklick(e)}
            />
          ))}
        </div>
      </div>
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-0.5">
        <div ref={profilRef} className="relative flex min-w-0 flex-1">{profilKnopf}{menu}</div>
        <PluginsKnopf ausklappbar data-flip="plugins" onClick={() => go({ kind: "einstellungen", page: "plugins" })} />
      </div>
      {suche ? <Suche onZu={() => setSuche(false)} /> : null}
      {ctxMenue}
      <Griff kante="rechts" flip="linie" label="Width of the sidebar" breite={breite} min={LEISTE.links.min} max={maxBreite("links", rechts)} std={LEISTE.links.std} onFertig={setBreite} />
    </aside>
  );
}

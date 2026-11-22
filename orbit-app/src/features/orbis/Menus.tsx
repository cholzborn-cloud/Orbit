import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Knopf, Menue, Menuezeile } from "../../ui";
import * as api from "../../lib/api";
import { fehlerText } from "../../lib/chunks";
import { useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import type { Bot, Group } from "../../lib/types";
import { Dialog, Fehlerzeile, Fuss, OrbiFigur } from "./shared";
import { gruppenVorgabe } from "./vorgabe";

export type MenuAnker = { x: number; y: number; width?: number; height?: number } | DOMRect | HTMLElement;

function rechteck(a: MenuAnker): { left: number; top: number; width: number; height: number } {
  if (typeof HTMLElement !== "undefined" && a instanceof HTMLElement) {
    const r = a.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  const o = a as { x: number; y: number; width?: number; height?: number };
  return { left: o.x, top: o.y, width: o.width ?? 0, height: o.height ?? 0 };
}

type Ziel = { art: "orbi"; bot: Bot } | { art: "gruppe"; gruppe: Group };

const MENUE_B = 224;
const GRUPPENMENUE_B = 196;
const TRENNER = (
  <div role="separator" className="px-3 py-[5px]">
    <div className="h-px bg-o-line" />
  </div>
);

async function neuLaden() {
  const st = useOrbit.getState();
  await Promise.allSettled([st.loadBots(), st.loadChats()]);
}

/** Wählt den Chat des Orbis aus und zeigt den Chat, damit Panel und Routinen zum richtigen Orbi gehören. */
async function chatWaehlen(chatId: string) {
  const st = useOrbit.getState();
  if (st.selectedChatId !== chatId) await st.selectChat(chatId);
  useNav.getState().go({ kind: "chat" });
}

function GruppenMenue({ bot, links, top, onFertig, onFehler }: { bot: Bot; links: number | string; top: number; onFertig: () => void; onFehler: (t: string) => void }) {
  const groups = useOrbit((s) => s.groups);
  const openEditor = useNav((s) => s.openEditor);
  const hinzu = async (g: Group) => {
    if (g.members.some((m) => m.id === bot.id)) return;
    if (g.members.length >= 6) return onFehler("At most 6 Orbis per group");
    try {
      // PATCH ersetzt die ganze Mitgliederliste: bisherige Mitglieder plus der neue Orbi.
      await api.updateGroup(g.id, g.name, [...g.members.map((m) => m.id), bot.id]);
      await neuLaden();
      onFertig();
    } catch (e) {
      onFehler(fehlerText(e));
    }
  };
  return (
    <Menue kompakt aria-label="Groups" className="absolute" style={{ left: links, top, width: GRUPPENMENUE_B }}>
      {groups.map((g) => {
        const drin = g.members.some((m) => m.id === bot.id);
        const m0 = g.members[0];
        return (
          <button
            key={g.id}
            type="button"
            role="menuitem"
            disabled={drin}
            onClick={() => void hinzu(g)}
            className="orbit-ui flex h-8 w-full items-center gap-2 rounded-o-control px-3 text-left text-[14px] leading-5 text-o-text transition-colors duration-[var(--orbit-dur)] hover:bg-o-hover focus-visible:outline-2 focus-visible:outline-o-focus disabled:opacity-40 disabled:pointer-events-none cursor-default"
          >
            {m0 ? <OrbiFigur avatar={m0.avatar} color={m0.color} look={m0.look} size={18} /> : null}
            <span className="min-w-0 flex-1 truncate">{g.name}</span>
            {drin ? <span className="text-[13px] text-o-text-2">✓</span> : null}
          </button>
        );
      })}
      {groups.length ? <div role="separator" className="mx-3 h-px bg-o-line" /> : null}
      <Menuezeile
        text="New group…"
        symbol="plus"
        onClick={() => {
          gruppenVorgabe.botId = bot.id;
          openEditor({ kind: "gruppe" });
          onFertig();
        }}
      />
    </Menue>
  );
}

function OrbiMenue({ ziel, links, top, onClose }: { ziel: Ziel; links: number; top: number; onClose: () => void }) {
  const go = useNav((s) => s.go);
  const setPanel = useNav((s) => s.setPanel);
  const openEditor = useNav((s) => s.openEditor);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: links, top });
  const [sub, setSub] = useState<{ top: number } | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [loeschen, setLoeschen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Im Fenster halten (Rechtsklick nahe am Rand).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(links, window.innerWidth - r.width - 8));
    const t = Math.max(8, Math.min(top, window.innerHeight - r.height - 8));
    if (left !== pos.left || t !== pos.top) setPos({ left, top: t });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, top]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const n = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[n]?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const name = ziel.art === "orbi" ? ziel.bot.name : ziel.gruppe.name;
  const chatId = ziel.art === "orbi" ? ziel.bot.chatId : ziel.gruppe.id;
  const mitglieder = ziel.art === "orbi" ? [ziel.bot] : ziel.gruppe.members;

  const leeren = async () => {
    try {
      await api.clearMessages(chatId);
      await useOrbit.getState().loadMessages(chatId);
      onClose();
    } catch (e) {
      setFehler(fehlerText(e));
    }
  };
  const entfernen = async () => {
    setBusy(true);
    try {
      if (ziel.art === "orbi") await api.deleteBot(ziel.bot.id);
      else await api.deleteGroup(ziel.gruppe.id);
      await neuLaden();
      const st = useOrbit.getState();
      if (st.selectedChatId === chatId) await st.selectChat(st.main?.chatId ?? null);
      onClose();
    } catch (e) {
      setFehler(fehlerText(e));
      setBusy(false);
    }
  };

  if (loeschen) {
    return (
      <Dialog titel={`Delete ${name}?`} breite={400} onClose={onClose}>
        <p className="text-[15px] leading-[22px] text-o-text-2">
          {ziel.art === "orbi"
            ? `${name} and the chat with ${name} will be removed. This cannot be undone.`
            : `Group ${name} and its chat will be removed. The Orbis stay.`}
        </p>
        <Fehlerzeile text={fehler} />
        <Fuss>
          <Knopf art="still" onClick={onClose}>Cancel</Knopf>
          <Knopf art="gefahr" disabled={busy} onClick={() => void entfernen()}>{`Delete ${name}`}</Knopf>
        </Fuss>
      </Dialog>
    );
  }

  const rechtsPlatz = pos.left + MENUE_B + 4 + GRUPPENMENUE_B <= window.innerWidth - 8;
  return (
    <div
      className="orbit-ui fixed inset-0 z-40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div ref={ref} className="absolute" style={{ left: pos.left, top: pos.top, width: MENUE_B }}>
        <Menue kompakt aria-label={`Menu for ${name}`} className="w-full">
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            {ziel.art === "orbi" ? (
              <OrbiFigur avatar={ziel.bot.avatar} color={ziel.bot.color} look={ziel.bot.look} size={28} />
            ) : (
              <span className="flex shrink-0 -space-x-2">
                {mitglieder.slice(0, 3).map((m) => (
                  <OrbiFigur key={m.id} avatar={m.avatar} color={m.color} look={m.look} size={24} />
                ))}
              </span>
            )}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[14px] leading-5 font-medium text-o-text">{name}</span>
              <span className="truncate text-[13px] leading-[18px] text-o-text-2">
                {ziel.art === "orbi" ? ziel.bot.job : `${mitglieder.length} Orbis`}
              </span>
            </span>
          </div>
          {TRENNER}
          {ziel.art === "orbi" ? (
            <>
              <Menuezeile
                text="Details"
                symbol="info"
                onClick={async () => {
                  await chatWaehlen(ziel.bot.chatId);
                  setPanel("uebersicht");
                  onClose();
                }}
              />
              <Menuezeile text="Edit" symbol="pencil" onClick={() => { openEditor({ kind: "orbi", botId: ziel.bot.id }); onClose(); }} />
              <Menuezeile
                text="Routines"
                symbol="clock"
                onClick={async () => {
                  await chatWaehlen(ziel.bot.chatId);
                  go({ kind: "routinen" });
                  onClose();
                }}
              />
              <Menuezeile
                text="Files"
                symbol="folder"
                onClick={async () => {
                  await chatWaehlen(ziel.bot.chatId);
                  setPanel("bibliothek");
                  onClose();
                }}
              />
              {TRENNER}
              <Menuezeile
                text="Add to group"
                symbol="plus"
                rechts="›"
                aria-haspopup="menu"
                aria-expanded={!!sub}
                onClick={(e) => setSub(sub ? null : { top: e.currentTarget.offsetTop - 6 })}
                onMouseEnter={(e) => setSub({ top: e.currentTarget.offsetTop - 6 })}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") setSub({ top: e.currentTarget.offsetTop - 6 });
                }}
              />
              {TRENNER}
            </>
          ) : (
            <>
              <Menuezeile text="Edit group" symbol="pencil" onClick={() => { openEditor({ kind: "gruppe", chatId: ziel.gruppe.id }); onClose(); }} />
              {TRENNER}
            </>
          )}
          <Menuezeile text="Clear chat" symbol="undo" onMouseEnter={() => setSub(null)} onClick={() => void leeren()} />
          <Menuezeile
            text={ziel.art === "orbi" ? `Delete ${name}` : "Delete group"}
            symbol="trash"
            art="gefahr"
            onMouseEnter={() => setSub(null)}
            onClick={() => setLoeschen(true)}
          />
          {fehler ? <div className="px-2.5 pt-1 pb-1.5"><Fehlerzeile text={fehler} /></div> : null}
        </Menue>
        {sub && ziel.art === "orbi" ? (
          <GruppenMenue
            bot={ziel.bot}
            top={sub.top}
            links={rechtsPlatz ? MENUE_B + 4 : -GRUPPENMENUE_B - 4}
            onFertig={onClose}
            onFehler={setFehler}
          />
        ) : null}
      </div>
    </div>
  );
}

function zielVon(botId?: string, chatId?: string): Ziel | null {
  const st = useOrbit.getState();
  const bot = st.bots.find((b) => (botId ? b.id === botId : b.chatId === chatId)) ?? (st.main && (botId ? st.main.id === botId : st.main.chatId === chatId) ? st.main : undefined);
  if (bot) return { art: "orbi", bot };
  const gruppe = st.groups.find((g) => g.id === chatId);
  return gruppe ? { art: "gruppe", gruppe } : null;
}

/** Figma 5.1/5.1b: Orbi-Menü unter der Kopf-Pille, mittig zur Pille, 6 darunter. Der Orbi ist der des gewählten Chats. */
export function PillMenu({ anchor, onClose }: { anchor: MenuAnker; onClose: () => void }) {
  const selected = useOrbit((s) => s.selectedChatId);
  useOrbit((s) => s.bots);
  useOrbit((s) => s.groups);
  const ziel = zielVon(undefined, selected ?? undefined);
  if (!ziel) return null;
  const r = rechteck(anchor);
  return <OrbiMenue ziel={ziel} links={r.left + r.width / 2 - MENUE_B / 2} top={r.top + r.height + 6} onClose={onClose} />;
}

/** Figma 5.2/5.2b: dasselbe Menü per Rechtsklick auf eine Seitenleistenzeile, an der Mausposition. */
export function OrbiContextMenu({ botId, chatId, x, y, onClose }: { botId?: string; chatId?: string; x: number; y: number; onClose: () => void }) {
  useOrbit((s) => s.bots);
  useOrbit((s) => s.groups);
  const ziel = zielVon(botId, chatId);
  if (!ziel) return null;
  return <OrbiMenue ziel={ziel} links={x} top={y} onClose={onClose} />;
}

import emojiDaten from "../../../../orbitd/orbitd/emoji.json";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Knopf, Menue, Menuezeile, Symbol, cx } from "../../ui";

export type MenuePosition = { id: string; x: number; y: number };
const kategorien = ["Smileys", "People", "Skin tone and hair", "Animals and nature", "Food and drink", "Travel and places", "Activities", "Objects", "Symbols", "Flags"];
const schnelleEmoji = [["👍", "Thumbs up"], ["❤️", "Heart"], ["😂", "Laughing"], ["🎉", "Celebrate"], ["🙏", "Thanks"], ["👀", "Eyes"]];
const seite = 168;

export function Nachrichtenmenue({ position, reaktion, onClose, onReaktion, onAntwort, onKopieren, onInfo }: {
  position: MenuePosition;
  reaktion?: string | null;
  onClose: () => void;
  onReaktion: (emoji: string) => void;
  onAntwort: () => void;
  onKopieren: () => void;
  /** Bei eigenen Nachrichten weglassen. */
  onInfo?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [erweitert, setErweitert] = useState(false);
  const auswahlId = useId();
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    panel.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - panel.offsetHeight - 8))}px`;
  }, [position, erweitert, reaktion]);

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const vorher = document.activeElement as HTMLElement | null;
    panel.querySelector("button")?.focus({ preventScroll: true });
    const draussen = (e: PointerEvent) => {
      if (!panel.contains(e.target as Node)) onClose();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        vorher?.focus({ preventScroll: true });
        onClose();
      }
    };
    document.addEventListener("pointerdown", draussen);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", draussen);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", onClose);
    };
  }, [position, onClose]);

  const schnellKnopf = "grid size-7 shrink-0 place-items-center rounded-full text-[18px] leading-none outline-none hover:bg-o-hover focus-visible:outline-2 focus-visible:outline-o-focus aria-pressed:bg-o-selected";
  return (
    <div ref={ref} className="fixed z-50" onContextMenu={(e) => e.preventDefault()} onKeyDown={(e) => {
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const gruppe = (e.target as HTMLElement).closest("[data-nachrichten-navigation]");
      if (!gruppe) return;
      const knoepfe = Array.from(gruppe.querySelectorAll("button"));
      const i = knoepfe.indexOf(document.activeElement as HTMLButtonElement);
      const n = knoepfe.length;
      const weiter = e.key === "ArrowDown" || e.key === "ArrowRight";
      const ziel = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : i + (weiter ? 1 : -1);
      e.preventDefault();
      knoepfe[(ziel + n) % n]?.focus();
    }}>
      <Menue role="group" kompakt aria-label="Message menu"
        className={cx("max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain", erweitert ? "w-[304px]" : "w-56")}>
        <div role="group" aria-label="Quick reactions" data-nachrichten-navigation
          className="flex items-center justify-between gap-0.5 px-0.5 pb-1">
          {schnelleEmoji.map(([emoji, name]) => (
            <button key={emoji} type="button" aria-label={name} title={name} aria-pressed={reaktion === emoji}
              className={schnellKnopf} onClick={() => onReaktion(emoji)}>
              {emoji}
            </button>
          ))}
          <button type="button" aria-label="All emojis" aria-expanded={erweitert} aria-controls={erweitert ? auswahlId : undefined}
            className={cx(schnellKnopf, "bg-o-surface text-o-text-2 aria-expanded:bg-o-selected")}
            onClick={() => setErweitert((offen) => !offen)}>
            <Symbol name="plus" groesse={14} />
          </button>
        </div>
        {erweitert ? <EmojiAuswahl id={auswahlId} onWaehlen={onReaktion} /> : null}
        <div role="menu" aria-label="Message actions" data-nachrichten-navigation className="border-t border-solid border-o-line pt-1">
          <Menuezeile symbol="reply" text="Reply" onClick={onAntwort} />
          <Menuezeile symbol="copy" text="Copy" onClick={onKopieren} />
          {onInfo ? <Menuezeile symbol="info" text="Info" onClick={onInfo} /> : null}
        </div>
      </Menue>
    </div>
  );
}

// UTS #51, Emoji 17.0. Derselbe Datensatz validiert Reaktionen im Dienst.
const gruppen = Object.values(emojiDaten.groups);
const alle = gruppen.flat();

function EmojiAuswahl({ id, onWaehlen }: { id: string; onWaehlen: (emoji: string) => void }) {
  const [suche, setSuche] = useState("");
  const [gruppe, setGruppe] = useState(0);
  const [anzahl, setAnzahl] = useState(seite);
  const suchwort = suche.trim().toLowerCase();
  const treffer = useMemo(() => suchwort
    ? alle.filter(([emoji, name]) => emoji.includes(suchwort) || name.toLowerCase().includes(suchwort))
    : gruppen[gruppe], [suchwort, gruppe]);
  const emojiKnopf = (emoji: string, name: string) => (
    <button key={emoji} type="button" aria-label={`${emoji} ${name}`} title={name} onClick={() => onWaehlen(emoji)}
      className="grid size-8 place-items-center rounded-o-control text-[20px] leading-none hover:bg-o-hover focus-visible:outline-2 focus-visible:outline-o-focus">
      {emoji}
    </button>
  );
  const liste = useRef<HTMLDivElement>(null);
  const suchfeld = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { suchfeld.current?.focus({ preventScroll: true }); }, []);
  return (
    <div id={id} role="group" aria-label="Emoji picker" className="flex flex-col gap-1.5 px-1 pb-2 pt-1">
      <input ref={suchfeld} type="search" aria-label="Search emoji" placeholder="Search emoji" value={suche} onChange={(e) => {
        setSuche(e.target.value);
        setAnzahl(seite);
        if (liste.current) liste.current.scrollTop = 0;
      }} className="h-8 rounded-o-control border border-solid border-o-card-border bg-o-surface px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-o-focus" />
      {suchwort ? null : (
        <select aria-label="Emoji category" value={gruppe} onChange={(e) => {
          setGruppe(Number(e.target.value));
          setAnzahl(seite);
          if (liste.current) liste.current.scrollTop = 0;
        }} className="h-7 rounded-o-control border border-solid border-o-card-border bg-o-surface px-2 text-xs text-o-text outline-none focus-visible:outline-2 focus-visible:outline-o-focus">
          {kategorien.map((name, i) => <option key={name} value={i}>{name}</option>)}
        </select>
      )}
      <div ref={liste} className="chat-scroll max-h-[min(216px,38dvh)] overflow-auto">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(32px,1fr))] justify-items-center">
          {treffer.slice(0, anzahl).map(([emoji, name]) => emojiKnopf(emoji, name))}
        </div>
        {treffer.length === 0 ? <p className="py-4 text-center text-sm text-o-text-2">No emojis found.</p> : null}
        {treffer.length > anzahl ? <div className="mt-2 flex justify-center"><Knopf art="still" groesse="klein" onClick={() => setAnzahl((n) => n + seite)}>More emojis</Knopf></div> : null}
      </div>
    </div>
  );
}

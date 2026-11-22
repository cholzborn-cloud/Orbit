import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "./util";

interface GriffProps {
  /** An welcher Kante der Leiste der Griff sitzt: "rechts" für die linke Leiste, "links" für die rechte. */
  kante: "links" | "rechts";
  breite: number;
  min: number;
  max: number;
  /** Breite nach Doppelklick. */
  std: number;
  /** Neue Breite am Ende des Ziehens (oder per Pfeiltaste). Beim Ziehen setzt der Griff die Breite direkt im DOM, React rendert erst danach. */
  onFertig: (breite: number) => void;
  label: string;
  /** data-flip-Name der Linie (fliegt beim Ein-/Ausklappen mit). */
  flip?: string;
}

/** Dünne Trennlinie (Hairline) zwischen Leiste und Chat, zugleich Griff zum Ändern der Breite. Sitzt in der Leiste (position: relative, Breite per style). */
export function Griff({ kante, breite, min, max, std, onFertig, label, flip }: GriffProps) {
  const start = useRef<{ x: number; b: number } | null>(null);
  const live = useRef(breite);
  const richtung = kante === "rechts" ? 1 : -1;
  const klemme = (v: number) => Math.round(Math.min(max, Math.max(min, v)));
  const leiste = (el: HTMLElement) => el.parentElement as HTMLElement;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, b: leiste(e.currentTarget).getBoundingClientRect().width };
    live.current = start.current.b;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    live.current = klemme(start.current.b + (e.clientX - start.current.x) * richtung);
    leiste(e.currentTarget).style.width = `${live.current}px`;
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    start.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onFertig(live.current);
  };
  const taste = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
    if (!d) return;
    e.preventDefault();
    onFertig(klemme(breite + d * richtung));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={breite}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-griff={kante}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onDoubleClick={() => onFertig(std)}
      onKeyDown={taste}
      className={cx(
        "group/griff absolute inset-y-0 z-20 w-2 touch-none cursor-col-resize outline-none",
        kante === "rechts" ? "-right-1" : "-left-1",
      )}
    >
      <span
        aria-hidden="true"
        data-flip={flip}
        className={cx(
          "absolute inset-y-0 w-px bg-o-line transition-colors duration-[var(--orbit-dur)] group-hover/griff:bg-o-line-strong group-focus-visible/griff:bg-o-focus",
          kante === "rechts" ? "right-1" : "left-1",
        )}
      />
    </div>
  );
}

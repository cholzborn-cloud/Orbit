import type { HTMLAttributes, ReactNode } from "react";
import { Symbol, type SymbolName } from "./Symbol";
import { FOKUS, UEBERGANG, cx } from "./util";

type Props = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  symbol?: SymbolName;
  titel: string;
  beschreibung?: string;
  /** Rechts: Schalter, Auswahl, Wert, Pfeil … */
  rechts?: ReactNode;
  ausgewaehlt?: boolean;
  /** Feine Trennlinie unten (in einer Gruppe entfällt sie bei der letzten Zeile). */
  trenner?: boolean;
  zustand?: "hover" | "fokus";
};

/** Zeile: Rand 10/16, Abstand 12, Titel 14/20, Beschreibung 13/18 (Komponentensatz 43:279523). */
export function Zeile({ symbol, titel, beschreibung, rechts, ausgewaehlt, trenner = true, zustand, onClick, className, ...rest }: Props) {
  const klickbar = typeof onClick === "function";
  const Tag = klickbar ? "button" : "div";
  return (
    <Tag
      {...(klickbar ? { type: "button" as const, onClick, "aria-pressed": ausgewaehlt } : {})}
      data-zustand={zustand}
      className={cx(
        "orbit-ui relative flex w-full items-center gap-3 px-4 py-[11px] text-left",
        klickbar && "cursor-default",
        ausgewaehlt
          ? "bg-o-selected hover:bg-o-selected-hover data-[zustand=hover]:bg-o-selected-hover"
          : "hover:bg-o-hover data-[zustand=hover]:bg-o-hover",
        UEBERGANG,
        FOKUS,
        "focus-visible:-outline-offset-2",
        className,
      )}
      {...(rest as object)}
    >
      {symbol ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-o-text-2">
          <Symbol name={symbol} />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] leading-5 text-o-text">{titel}</span>
        {beschreibung ? <span className="text-[13px] leading-[18px] text-o-text-2">{beschreibung}</span> : null}
      </span>
      {rechts ? <span className="flex shrink-0 items-center gap-2">{rechts}</span> : null}
      {trenner ? <span data-sep aria-hidden="true" className="absolute inset-x-4 bottom-0 h-px bg-o-line" /> : null}
    </Tag>
  );
}

import type { HTMLAttributes, ReactNode } from "react";
import { Symbol, type SymbolName } from "./Symbol";
import { UEBERGANG, cx } from "./util";

type Props = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  symbol?: SymbolName;
  /** Markenzeichen statt Symbol. */
  marke?: string;
  titel: string;
  beschreibung?: string;
  /** Aktion unten (z. B. Knopf klein). */
  aktion?: ReactNode;
  /** Kachel 240 breit oder Panel 320 breit. */
  breite?: "kachel" | "panel";
  ausgewaehlt?: boolean;
  zustand?: "hover";
};

/** Kachel: Radius 20, Rand 16, Abstand 12, Symbolfläche 40 (Komponentensatz 43:280311). */
export function Kachel({ symbol, marke, titel, beschreibung, aktion, breite = "kachel", ausgewaehlt, zustand, className, ...rest }: Props) {
  return (
    <div
      data-zustand={zustand}
      aria-current={ausgewaehlt ? "true" : undefined}
      className={cx(
        "orbit-ui flex flex-col gap-3 rounded-o-dialog bg-o-surface p-4",
        breite === "kachel" ? "w-60" : "w-80",
        "[background-image:linear-gradient(var(--tint),var(--tint))] [--tint:transparent]",
        ausgewaehlt ? "[--tint:var(--orbit-selected)]" : "hover:[--tint:var(--orbit-hover)] data-[zustand=hover]:[--tint:var(--orbit-hover)]",
        UEBERGANG,
        className,
      )}
      {...rest}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-o-control bg-o-bg text-o-text">
        {marke ? <Symbol marke={marke} groesse={20} /> : <Symbol name={symbol ?? "plug"} groesse={20} />}
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-[14px] leading-5 font-medium text-o-text">{titel}</span>
        {beschreibung ? <span className="text-[14px] leading-5 text-o-text-2">{beschreibung}</span> : null}
      </div>
      {aktion ? <div className="flex items-center gap-2">{aktion}</div> : null}
    </div>
  );
}

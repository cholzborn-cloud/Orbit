import type { HTMLAttributes, ReactNode } from "react";
import { Symbol, type SymbolName } from "./Symbol";
import { cx } from "./util";

type Props = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  /** Vorschaubild (Adresse) oder eigener Inhalt. */
  bild?: string | ReactNode;
  bildAlt?: string;
  titel: string;
  beschreibung?: string;
  quelle?: { symbol: SymbolName; text: string };
};

/** Medienkarte: 156 breit, Bild 120 hoch, Radius 20, Text-Rand 12 (Komponentensatz 43:279766). */
export function Medienkarte({ bild, bildAlt = "", titel, beschreibung, quelle, className, ...rest }: Props) {
  return (
    <div
      className={cx(
        "orbit-ui flex w-[156px] flex-col overflow-hidden rounded-o-dialog border border-solid border-o-card-border bg-o-raised",
        className,
      )}
      {...rest}
    >
      <div className="flex h-[120px] w-full items-center justify-center bg-o-field">
        {typeof bild === "string" ? <img src={bild} alt={bildAlt} className="h-full w-full object-cover" /> : bild}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <span className="truncate text-[14px] leading-5 font-medium text-o-text">{titel}</span>
        {beschreibung ? <span className="text-[13px] leading-[18px] text-o-text-2">{beschreibung}</span> : null}
        {quelle ? (
          <span className="flex items-center gap-1.5 py-1 text-[13px] leading-[18px] text-o-text-2">
            <Symbol name={quelle.symbol} />
            {quelle.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Symbol, type SymbolName } from "./Symbol";
import { AUS, FOKUS, UEBERGANG, cx } from "./util";

export type KnopfArt = "primaer" | "zweitrangig" | "still" | "gefahr";
export type KnopfGroesse = "klein" | "mittel" | "gross";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  art?: KnopfArt;
  groesse?: KnopfGroesse;
  /** Symbol vor der Beschriftung. */
  symbol?: SymbolName;
  /** Erzwingt Hover/Fokus für die Vorschau. */
  zustand?: "hover" | "fokus";
  children?: ReactNode;
};

// Maße aus Komponentensatz "Knopf" (43:279154): 24/32/40 hoch, Kapsel, Abstand 6.
const GROESSE: Record<KnopfGroesse, string> = {
  klein: "h-6 px-2.5 text-[14px] leading-5 font-medium",
  mittel: "h-8 px-3.5 text-[14px] leading-5 font-medium",
  gross: "h-10 px-[18px] text-[15px] leading-[22px] font-normal",
};

const ART: Record<KnopfArt, string> = {
  primaer:
    "bg-o-btn-primary text-o-on-primary hover:opacity-90 data-[zustand=hover]:opacity-90",
  zweitrangig:
    "bg-o-btn-secondary text-o-text hover:bg-o-btn-secondary-hover data-[zustand=hover]:bg-o-btn-secondary-hover",
  still: "bg-transparent text-o-text hover:bg-o-hover data-[zustand=hover]:bg-o-hover",
  gefahr:
    "bg-o-btn-danger text-o-danger hover:bg-o-btn-danger-hover data-[zustand=hover]:bg-o-btn-danger-hover",
};

export function Knopf({
  art = "primaer",
  groesse = "mittel",
  symbol,
  zustand,
  type = "button",
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      data-art={art}
      data-zustand={zustand}
      className={cx(
        "orbit-ui inline-flex items-center justify-center gap-1.5 rounded-full whitespace-nowrap select-none cursor-default",
        GROESSE[groesse],
        ART[art],
        UEBERGANG,
        FOKUS,
        AUS,
        className,
      )}
      {...rest}
    >
      {symbol ? <Symbol name={symbol} /> : null}
      {children}
    </button>
  );
}

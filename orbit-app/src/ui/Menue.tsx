import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Symbol, type SymbolName } from "./Symbol";
import { FOKUS, UEBERGANG, cx } from "./util";

type ZeileProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  text: string;
  symbol?: SymbolName;
  /** Kurzbefehl oder Zusatz rechts. */
  rechts?: string;
  art?: "normal" | "gefahr";
  zustand?: "hover" | "fokus";
};

/** Menüzeile 32 hoch, Radius 10, Rand 10, Abstand 6 (Komponentensatz 43:279877). */
export function Menuezeile({ text, symbol, rechts, art = "normal", zustand, className, type = "button", ...rest }: ZeileProps) {
  return (
    <button
      type={type}
      role="menuitem"
      data-zustand={zustand}
      className={cx(
        "orbit-ui flex h-8 w-full items-center gap-1.5 rounded-o-control px-3 text-left text-[14px] leading-5 cursor-default",
        art === "gefahr" ? "text-o-danger" : "text-o-text",
        "hover:bg-o-hover data-[zustand=hover]:bg-o-hover",
        UEBERGANG,
        FOKUS,
        "disabled:opacity-40 disabled:pointer-events-none",
        className,
      )}
      {...rest}
    >
      {symbol ? (
        <span className={art === "gefahr" ? "text-o-danger" : "text-o-text-2"}>
          <Symbol name={symbol} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {rechts ? <span className="text-[13px] leading-[18px] text-o-text-2">{rechts}</span> : null}
    </button>
  );
}

export function Menuetrenner() {
  return (
    <div role="separator" className="px-3 py-1">
      <div className="h-px bg-o-line" />
    </div>
  );
}

/** Menü (Popover): erhöhte Fläche, Radius 16, Rand 8, Schatten 0/8/24 (Komponentensatz 43:279950). */
export function Menue({ children, className, kompakt, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode; kompakt?: boolean }) {
  return (
    <div
      role="menu"
      className={cx(
        "orbit-ui orbit-pop inline-flex flex-col border border-solid border-o-card-border bg-o-raised shadow-o-menu",
        kompakt
          ? "min-w-0 rounded-o-lg p-1.5 [&_[role=menuitem]]:h-7 [&_[role=menuitem]]:gap-2 [&_[role=menuitem]]:px-2.5 [&_[role=menuitem]]:text-[13px] [&_[role=menuitem]]:leading-[18px] [&_[role=menuitem]_svg]:size-3.5"
          : "min-w-[254px] rounded-o-card p-2",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

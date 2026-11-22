import type { ButtonHTMLAttributes } from "react";
import { AUS, FOKUS, UEBERGANG, cx } from "./util";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role" | "children"> & {
  checked: boolean;
  onChange?: (an: boolean) => void;
  /** Zugänglicher Name (Pflicht, der Schalter hat keinen sichtbaren Text). */
  "aria-label": string;
};

/** Schalter 32×18, Knopf 14×14, Rand 2 (Komponentensatz 43:279235). */
export function Schalter({ checked, onChange, className, disabled, ...rest }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cx(
        "orbit-ui relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full p-0.5 cursor-default",
        checked ? "bg-o-switch-on" : "bg-o-switch-off",
        UEBERGANG,
        FOKUS,
        "focus-visible:outline-offset-2",
        AUS,
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cx(
          "block h-3.5 w-3.5 rounded-full transition-transform duration-[var(--orbit-dur)] ease-[var(--orbit-ease)]",
          checked ? "translate-x-3.5 bg-o-switch-knob-on" : "translate-x-0 bg-o-switch-knob shadow-o-knob",
        )}
      />
    </button>
  );
}

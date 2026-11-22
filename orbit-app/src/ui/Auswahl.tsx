import type { SelectHTMLAttributes } from "react";
import { Symbol } from "./Symbol";
import { AUS, FOKUS, UEBERGANG, cx } from "./util";

export type AuswahlOption = { wert: string; text: string };

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "children"> & {
  optionen: AuswahlOption[];
  onChange?: (wert: string) => void;
  "aria-label": string;
};

/** Auswahl (Dropdown) 28 hoch, Radius 10, Wert + Pfeil, Text zweitrangig (43:279246). Nutzt das native select. */
export function Auswahl({ optionen, onChange, className, ...rest }: Props) {
  return (
    <span className={cx("orbit-ui relative inline-flex h-7 items-center", className)}>
      <select
        onChange={(e) => onChange?.(e.target.value)}
        className={cx(
          "h-7 appearance-none rounded-o-control bg-transparent py-1 pl-2 pr-7 text-[14px] leading-5 text-o-text-2 cursor-default",
          "hover:bg-o-hover",
          UEBERGANG,
          FOKUS,
          AUS,
        )}
        {...rest}
      >
        {optionen.map((o) => (
          <option key={o.wert} value={o.wert}>
            {o.text}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-2 text-o-text-2">
        <Symbol name="chevd" />
      </span>
    </span>
  );
}

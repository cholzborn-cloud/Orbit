import { useId, type InputHTMLAttributes } from "react";
import { AUS, UEBERGANG, cx } from "./util";

export type FeldGroesse = "klein" | "mittel" | "gross";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: string;
  hinweis?: string;
  /** Fehlertext; setzt den Fehlerzustand. */
  fehler?: string;
  groesse?: FeldGroesse;
  /** Erzwingt den Fokusring für die Vorschau. */
  zustand?: "fokus";
};

// Komponentensatz "Feld" (43:280103): Eingabe 24/32/40 hoch, Radius 10/10/12, Rand innen 8/12/16.
const GROESSE: Record<FeldGroesse, string> = {
  klein: "h-6 rounded-o-control px-2 text-[14px] leading-5",
  mittel: "h-8 rounded-o-control px-3 text-[14px] leading-5",
  gross: "h-10 rounded-o-lg px-4 text-[15px] leading-[22px]",
};

export function Feld({ label, hinweis, fehler, groesse = "mittel", zustand, className, id, ...rest }: Props) {
  const auto = useId();
  const feldId = id ?? auto;
  const hilfeId = `${feldId}-hilfe`;
  const text = fehler ?? hinweis;
  return (
    <div className={cx("orbit-ui flex flex-col gap-1.5", className)}>
      <label htmlFor={feldId} className="text-[14px] leading-5 font-medium text-o-text">
        {label}
      </label>
      <input
        id={feldId}
        data-zustand={zustand}
        aria-invalid={fehler ? true : undefined}
        aria-describedby={text ? hilfeId : undefined}
        className={cx(
          "w-full text-o-text placeholder:text-o-text-3 outline-none",
          fehler ? "bg-o-field-error" : "bg-o-field",
          GROESSE[groesse],
          UEBERGANG,
          "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-o-focus data-[zustand=fokus]:outline-2 data-[zustand=fokus]:outline-solid data-[zustand=fokus]:outline-o-focus",
          AUS,
          "disabled:cursor-not-allowed",
        )}
        {...rest}
      />
      {text ? (
        <p id={hilfeId} className={cx("text-[13px] leading-[18px]", fehler ? "text-o-danger" : "text-o-text-2")}>
          {text}
        </p>
      ) : null}
    </div>
  );
}

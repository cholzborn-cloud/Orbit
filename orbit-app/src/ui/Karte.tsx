import type { ReactNode } from "react";
import { Knopf } from "./Knopf";
import { Symbol, type SymbolName } from "./Symbol";
import { cx } from "./util";
import type { OrbiFarbe } from "./Blase";

const RAHMEN =
  "orbit-ui flex rounded-o-dialog border border-solid border-o-card-border bg-o-raised";

type Basis = { className?: string };

export type KarteProps =
  | (Basis & {
      art: "freigabe";
      text: ReactNode;
      linkText?: string;
      onLink?: () => void;
      ablehnenText?: string;
      erlaubenText?: string;
      onAblehnen?: () => void;
      onErlauben?: () => void;
    })
  | (Basis & {
      art: "frage";
      titel: string;
      antworten: string[];
      farbe?: OrbiFarbe;
      andereText?: string;
      onAntwort?: (index: number) => void;
      onAndere?: () => void;
    })
  | (Basis & {
      art: "status";
      titel: string;
      untertitel?: string;
      symbol?: SymbolName;
      statusText?: string;
    })
  | (Basis & {
      art: "fehler";
      titel: string;
      untertitel?: string;
      aktionText?: string;
      onAktion?: () => void;
    });

function Symbolkachel({ name, farbe }: { name: SymbolName; farbe?: string }) {
  return (
    <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-o-sm border border-solid border-o-card-border", farbe ?? "text-o-text")}>
      <Symbol name={name} />
    </span>
  );
}

/** Karte in vier Arten (Komponentensatz 43:279743): Radius 20, Rand 16, Abstand 14. */
export function Karte(props: KarteProps) {
  switch (props.art) {
    case "freigabe":
      return (
        <div data-art="freigabe" className={cx(RAHMEN, "flex-col gap-3.5 p-4", props.className)}>
          <p className="text-[15px] leading-[22px] text-o-text">{props.text}</p>
          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-2">
            {props.linkText ? (
              <button type="button" onClick={props.onLink} className="mr-auto whitespace-nowrap rounded-o-sm text-[14px] leading-5 text-o-text-2 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-o-focus cursor-default">
                {props.linkText}
              </button>
            ) : null}
            <Knopf art="zweitrangig" onClick={props.onAblehnen}>
              {props.ablehnenText ?? "Deny"}
            </Knopf>
            <Knopf art="primaer" onClick={props.onErlauben}>
              {props.erlaubenText ?? "Allow"}
            </Knopf>
          </div>
        </div>
      );
    case "frage": {
      const farbe = props.farbe ?? "pink";
      return (
        <div data-art="frage" className={cx(RAHMEN, "flex-col gap-3.5 px-4 py-3.5", props.className)}>
          <h4 className="text-[15px] leading-[22px] font-medium text-o-text-2">{props.titel}</h4>
          <ul className="flex flex-col gap-3">
            {props.antworten.map((a, i) => (
              <li key={a}>
                <button type="button" onClick={() => props.onAntwort?.(i)} className="flex items-center gap-2.5 rounded-o-sm text-left text-[15px] leading-[22px] text-o-text outline-none focus-visible:outline-2 focus-visible:outline-o-focus cursor-default">
                  <span
                    aria-hidden="true"
                    className="flex h-[22px] w-[22px] items-center justify-center rounded-md text-[12px] leading-4 text-white"
                    style={{ backgroundColor: `var(--orbit-blase-${farbe})` }}
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  {a}
                </button>
              </li>
            ))}
            <li>
              <button type="button" onClick={props.onAndere} className="flex items-center gap-2.5 rounded-o-sm text-left text-[15px] leading-[22px] text-o-text-2 outline-none focus-visible:outline-2 focus-visible:outline-o-focus cursor-default">
                <span aria-hidden="true" className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-o-selected">
                  <Symbol name="pencil" groesse={12} />
                </span>
                {props.andereText ?? "Other answer…"}
              </button>
            </li>
          </ul>
        </div>
      );
    }
    case "status":
      return (
        <div data-art="status" className={cx(RAHMEN, "items-center gap-3 p-4", props.className)}>
          <Symbolkachel name={props.symbol ?? "kalender"} />
          <div className="mr-9 flex min-w-0 flex-1 flex-col">
            <span className="text-[14px] leading-5 font-medium text-o-text">{props.titel}</span>
            {props.untertitel ? <span className="text-[13px] leading-[18px] text-o-text-2">{props.untertitel}</span> : null}
          </div>
          {props.statusText ? (
            <span className="flex items-center gap-1.5 text-[13px] leading-[18px] text-o-success">
              <Symbol name="check" />
              {props.statusText}
            </span>
          ) : null}
        </div>
      );
    case "fehler":
      return (
        <div data-art="fehler" role="alert" className={cx(RAHMEN, "items-center gap-3 p-4", props.className)}>
          <Symbolkachel name="alert" farbe="text-o-danger" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[14px] leading-5 font-medium text-o-text">{props.titel}</span>
            {props.untertitel ? <span className="text-[13px] leading-[18px] text-o-text-2">{props.untertitel}</span> : null}
          </div>
          {props.aktionText ? (
            <Knopf art="zweitrangig" onClick={props.onAktion}>
              {props.aktionText}
            </Knopf>
          ) : null}
        </div>
      );
  }
}

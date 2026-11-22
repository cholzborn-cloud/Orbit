// Choice widget from `tool-SendToUser` (upcoming delivery shape): 1–6 options, primary/danger styles,
// multi-select and custom input. Answering sends a normal reply through the existing send path.
import { useState } from "react";
import { Knopf, cx } from "../../ui";
import type { ChoiceOption, ChoiceWidget } from "../../lib/types";

const optionId = (o: ChoiceOption, i: number) => o.id ?? `o${i}`;

/** Reply with the configured values, followed by any custom answer. */
export function auswahlText(widget: ChoiceWidget, selected: string[], custom?: string): string {
  const werte = widget.options.filter((o, i) => selected.includes(optionId(o, i))).map((o) => o.value ?? o.label);
  const c = custom?.trim();
  return [...werte, ...(c ? [c] : [])].join("\n");
}

export function AuswahlKarte({ widget, onAntwort }: { widget: ChoiceWidget; onAntwort?: (selected: string[], custom?: string) => Promise<void> }) {
  const [gewaehlt, setGewaehlt] = useState<string[]>([]);
  const [eigene, setEigene] = useState("");
  const [gesendet, setGesendet] = useState<{ selected: string[]; custom?: string } | null>(null);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState(false);
  const antwort = widget.answer ?? gesendet;
  const titel = widget.prompt?.trim() || "Choose an option";

  if (antwort) {
    const text = auswahlText(widget, antwort.selected, antwort.custom) || antwort.selected.join(", ");
    return (
      <div data-karte="auswahl" data-beantwortet className="orbit-ui flex w-full max-w-[560px] flex-col gap-1 rounded-o-dialog border border-solid border-o-card-border bg-o-raised px-4 py-3">
        <span className="text-[13px] leading-[18px] text-o-text-2">{titel}</span>
        <span className="text-[14px] leading-5 text-o-text whitespace-pre-line [overflow-wrap:anywhere]">{text || "Continued"}</span>
      </div>
    );
  }

  const senden = async (selected: string[], custom?: string) => {
    const text = auswahlText(widget, selected, custom);
    if (!text || !onAntwort || speichert) return;
    setSpeichert(true);
    setFehler(false);
    try {
      await onAntwort(selected, custom);
      setGesendet({ selected, custom });
    } catch {
      setFehler(true);
    } finally {
      setSpeichert(false);
    }
  };
  const umschalten = (id: string) => setGewaehlt((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));
  const art = (o: ChoiceOption) => (o.style === "primary" ? "primaer" : o.style === "danger" ? "gefahr" : "zweitrangig");

  return (
    <div data-karte="auswahl" role="group" aria-label={titel}
      className="orbit-ui flex w-full max-w-[560px] flex-col gap-3 rounded-o-dialog border border-solid border-o-card-border bg-o-raised px-4 py-3.5">
      <h4 className="text-[15px] leading-[22px] font-medium text-o-text-2">{titel}</h4>
      {widget.helpText && <p className="text-[13px] leading-[18px] text-o-text-2">{widget.helpText}</p>}
      <div className="flex flex-wrap gap-2">
        {widget.options.map((o, i) => {
          const id = optionId(o, i);
          if (widget.multiple) {
            const an = gewaehlt.includes(id);
            return (
              <button key={id} type="button" role="checkbox" aria-checked={an} disabled={!onAntwort || speichert} onClick={() => umschalten(id)}
                title={o.description}
                className={cx("h-8 rounded-full px-3.5 text-[14px] leading-5 outline-none focus-visible:outline-2 focus-visible:outline-o-focus cursor-default",
                  an ? "bg-o-selected font-medium text-o-text" : "bg-o-btn-secondary text-o-text hover:bg-o-btn-secondary-hover",
                  o.style === "danger" && "text-o-danger")}>
                {o.label}
              </button>
            );
          }
          return (
            <Knopf key={id} art={art(o)} disabled={!onAntwort || speichert} title={o.description} onClick={() => senden([id])}>{o.label}</Knopf>
          );
        })}
      </div>
      {widget.allowCustom || widget.multiple ? (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); senden(gewaehlt, eigene); }}>
          {widget.allowCustom ? (
            <input value={eigene} onChange={(e) => setEigene(e.target.value)} disabled={!onAntwort || speichert}
              aria-label="Your own answer" placeholder={widget.customPlaceholder || "Your answer …"}
              className="h-8 min-w-0 flex-1 rounded-o-control bg-o-field px-3 text-[14px] leading-5 text-o-text outline-none placeholder:text-o-text-3 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-o-focus" />
          ) : <span className="flex-1" />}
          <Knopf art="primaer" type="submit" disabled={!onAntwort || speichert || (!gewaehlt.length && !eigene.trim())}>Send</Knopf>
        </form>
      ) : null}
      {fehler && <p role="alert" className="text-[13px] text-o-danger">Orbit could not confirm your choice. You can try again.</p>}
    </div>
  );
}

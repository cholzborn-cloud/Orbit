// Secure-input card from SendToUser type secret-request. Value goes to Orbit secrets; never shown after submit.
import { useState } from "react";
import { Knopf } from "../../ui";
import type { SecretRequest } from "../../lib/types";

export function GeheimKarte({ secret, onAntwort }: { secret: SecretRequest; onAntwort?: (value: string) => Promise<void> }) {
  const [wert, setWert] = useState("");
  const [gesendet, setGesendet] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState(false);
  const fertig = secret.answer?.stored || secret.answer?.movedOn || gesendet;
  const titel = secret.label.trim() || "Secure value";

  if (fertig) {
    return (
      <div data-karte="geheim" data-beantwortet className="orbit-ui flex w-full max-w-[560px] flex-col gap-1 rounded-o-dialog border border-solid border-o-card-border bg-o-raised px-4 py-3">
        <span className="text-[13px] leading-[18px] text-o-text-2">{titel}</span>
        <span className="text-[14px] leading-5 text-o-text">{secret.answer?.movedOn ? "Skipped" : "Saved securely"}</span>
      </div>
    );
  }

  return (
    <form
      data-karte="geheim"
      aria-label={titel}
      className="orbit-ui flex w-full max-w-[560px] flex-col gap-3 rounded-o-dialog border border-solid border-o-card-border bg-o-raised px-4 py-3.5"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = wert.trim();
        if (!v || !onAntwort || speichert) return;
        setSpeichert(true);
        setFehler(false);
        try {
          await onAntwort(v);
          setWert("");
          setGesendet(true);
        } catch {
          setFehler(true);
        } finally {
          setSpeichert(false);
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <h4 className="text-[15px] leading-[22px] font-medium text-o-text-2">{titel}</h4>
        {secret.description ? <p className="text-[13px] leading-[18px] text-o-text-2">{secret.description}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={wert}
          onChange={(e) => setWert(e.target.value)}
          disabled={!onAntwort || speichert}
          aria-label={titel}
          placeholder="Paste here"
          className="h-8 min-w-0 flex-1 rounded-o-control bg-o-field px-3 text-[14px] leading-5 text-o-text outline-none placeholder:text-o-text-3 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-o-focus"
        />
        <Knopf art="primaer" type="submit" disabled={!onAntwort || speichert || !wert.trim()}>{speichert ? "Saving…" : "Save"}</Knopf>
      </div>
      {fehler && <p role="alert" className="text-[13px] text-o-danger">Orbit could not confirm the save. You can try again.</p>}
    </form>
  );
}

import type { AntwortBezug } from "../../lib/types";
// Eingabe 44 (Figma 03): Plus (Anhang), Textfeld, Modellwahl, Senden/Stopp. Enter sendet, Shift+Enter bricht um.
import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Symbol, cx } from "../../ui";
import type { Datei } from "../../lib/types";
import { sendeTaste } from "./logik";
import { Modellwahl } from "./Modellwahl";

const MAX_BYTES = 10 * 1024 * 1024;
const ROUTINEN_AUFGABE = "[task]";
const ROUTINEN_TEXT = `Please create a routine for me.

Do ${ROUTINEN_AUFGABE}.
Run it [when and how often].
Send me the result [here in this chat or in a new chat].

Ask briefly if anything is missing before you set it up.`;
const useEntwuerfe = create<{ texte: Record<string, string>; routineChat: string | null }>(() => ({ texte: {}, routineChat: null }));

export function routineEntwurf(chatId: string) {
  useEntwuerfe.setState(({ texte }) => {
    const vorhanden = texte[chatId] ?? "";
    const text = vorhanden.endsWith(ROUTINEN_TEXT) ? vorhanden : [vorhanden, ROUTINEN_TEXT].filter(Boolean).join("\n\n");
    return { texte: { ...texte, [chatId]: text }, routineChat: chatId };
  });
}

function alsDatei(f: File): Promise<Datei> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ url: String(r.result), mediaType: f.type || "application/octet-stream", filename: f.name });
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

export function Eingabe({
  chatId, ziel, gruppe, sendeFarbe, laeuft, onSenden, onStopp, antwort, onAntwortZu, zustand,
}: {
  chatId: string;
  /** Name für "Nachricht an …". */
  ziel: string;
  gruppe: boolean;
  /** CSS-Farbe des Senden-Knopfes im 1:1-Chat (Blasenfarbe des Orbis). */
  sendeFarbe: string;
  laeuft: boolean;
  onSenden: (text: string, dateien: Datei[]) => void;
  onStopp: () => void;
  antwort?: AntwortBezug | null;
  onAntwortZu?: () => void;
  /** Nur für die Vorschau: Text vorbelegen. */
  zustand?: { text?: string };
}) {
  const text = useEntwuerfe((s) => s.texte[chatId] ?? zustand?.text ?? "");
  const routineChat = useEntwuerfe((s) => s.routineChat);
  const setText = (value: string) => useEntwuerfe.setState((s) => ({ texte: { ...s.texte, [chatId]: value } }));
  const [dateien, setDateien] = useState<Datei[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const feld = useRef<HTMLTextAreaElement>(null);
  const datei = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (routineChat !== chatId || !feld.current) return;
    feld.current.focus();
    const aufgabe = text.lastIndexOf(ROUTINEN_AUFGABE);
    if (aufgabe >= 0) feld.current.setSelectionRange(aufgabe, aufgabe + ROUTINEN_AUFGABE.length);
    useEntwuerfe.setState({ routineChat: null });
  }, [chatId, routineChat, text]);

  const passeHoeheAn = useCallback(() => {
    const el = feld.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);
  useEffect(passeHoeheAn, [text, passeHoeheAn]);
  // Breite ändert den Umbruch (auch der Platzhalter): Höhe neu messen.
  useEffect(() => {
    const el = feld.current?.parentElement;
    if (!el || typeof ResizeObserver === "undefined") return;
    let breite = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== breite) {
        breite = el.clientWidth;
        passeHoeheAn();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [passeHoeheAn]);
  useEffect(() => {
    feld.current?.focus();
  }, [chatId]);
  useEffect(() => {
    if (antwort) feld.current?.focus();
  }, [antwort]);

  const leer = !text.trim() && dateien.length === 0;

  const senden = () => {
    if (leer) return;
    onSenden(text.trim(), dateien);
    setText("");
    setDateien([]);
    setFehler(null);
  };

  const anhaengen = async (liste: FileList | File[] | null) => {
    if (!liste) return;
    const neu: Datei[] = [];
    for (const f of Array.from(liste)) {
      if (f.size > MAX_BYTES) {
        setFehler(`“${f.name}” is larger than 10 MB.`);
        continue;
      }
      try {
        neu.push(await alsDatei(f));
      } catch {
        setFehler(`“${f.name}” could not be read.`);
      }
    }
    if (neu.length) setDateien((d) => [...d, ...neu]);
  };

  const stopp = laeuft && leer;
  const knopfStil = gruppe
    ? { background: "var(--orbit-btn-primary)", color: "var(--orbit-text-on-primary)" }
    : { background: sendeFarbe, color: "#fff" };

  return (
    <div className="orbit-ui flex w-full flex-col gap-2" data-eingabe>
      {dateien.length > 0 ? (
        <ul className="flex flex-wrap gap-2 px-1" aria-label="Attachments">
          {dateien.map((d, i) => (
            <li key={d.url.slice(-24) + i} className="flex h-7 max-w-[240px] items-center gap-1.5 rounded-full bg-o-surface pl-2.5 pr-1 text-[13px] leading-[18px] text-o-text">
              {d.mediaType.startsWith("image/") ? <img src={d.url} alt="" className="h-4 w-4 rounded-[4px] object-cover" /> : <Symbol name="file" />}
              <span className="truncate">{d.filename ?? "File"}</span>
              <button
                type="button"
                aria-label={`Remove ${d.filename ?? "attachment"}`}
                onClick={() => setDateien((x) => x.filter((_, j) => j !== i))}
                className="flex h-5 w-5 items-center justify-center rounded-full text-o-text-2 outline-none hover:bg-o-hover focus-visible:outline-2 focus-visible:outline-o-focus cursor-default"
              >
                <Symbol name="x" groesse={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {antwort ? (
        <div className="flex items-center gap-2 rounded-o-control bg-o-surface px-3 py-1.5 text-[12px] leading-4">
          <span className="text-o-text-2"><Symbol name="reply" groesse={15} /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-o-text">{antwort.name}</div>
            <div className="truncate text-o-text-2">{antwort.text}</div>
          </div>
          <button type="button" aria-label="Remove reply reference" onClick={onAntwortZu}
            className="grid size-6 place-items-center rounded-full text-o-text-2 hover:bg-o-hover focus-visible:outline-2 focus-visible:outline-o-focus">
            <Symbol name="x" groesse={14} />
          </button>
        </div>
      ) : null}
      {fehler ? <p role="alert" className="px-1 text-[13px] leading-[18px] text-o-danger">{fehler}</p> : null}
      <div className="flex min-h-11 items-end gap-2.5 rounded-[22px] border border-solid border-o-card-border bg-o-surface px-2 py-[7px]">
        <input ref={datei} type="file" multiple hidden onChange={(e) => { void anhaengen(e.target.files); e.target.value = ""; }} />
        <button
          type="button"
          aria-label="Attach file"
          title="Attach file"
          onClick={() => datei.current?.click()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-o-selected text-o-text outline-none transition-[background-color] duration-[var(--orbit-dur)] hover:bg-o-selected-hover focus-visible:outline-2 focus-visible:outline-o-focus cursor-default"
        >
          <Symbol name="plus" />
        </button>
        <textarea
          ref={feld}
          rows={1}
          value={text}
          placeholder={`Message ${ziel}`}
          aria-label={`Message ${ziel}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (sendeTaste({ key: e.key, shiftKey: e.shiftKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) {
              e.preventDefault();
              senden();
            }
          }}
          onPaste={(e) => {
            const fs = Array.from(e.clipboardData.files);
            if (fs.length) {
              e.preventDefault();
              void anhaengen(fs);
            }
          }}
          className="max-h-40 min-h-7 min-w-0 flex-1 resize-none self-center border-0 bg-transparent px-0 py-[3px] text-[15px] leading-[22px] text-o-text outline-none placeholder:text-o-text-3"
        />
        <Modellwahl chatId={chatId} className="max-w-36 shrink-0 @sm:max-w-52" />
        <button
          type="button"
          aria-label={stopp ? "Stop" : "Send"}
          title={stopp ? "Stop reply" : "Send"}
          disabled={!stopp && leer}
          onClick={stopp ? onStopp : senden}
          data-senden={stopp ? "stopp" : "senden"}
          style={knopfStil}
          className={cx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full outline-none transition-opacity duration-[var(--orbit-dur)] focus-visible:outline-2 focus-visible:outline-o-focus cursor-default",
            !stopp && leer ? "opacity-50" : "opacity-100",
          )}
        >
          <Symbol name={stopp ? "stop" : "arrowup"} groesse={16} />
        </button>
      </div>
    </div>
  );
}

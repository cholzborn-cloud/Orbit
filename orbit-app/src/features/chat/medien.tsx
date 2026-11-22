import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Knopf, Symbol } from "../../ui";
import type { Datei, MemoPart } from "../../lib/types";
import { Dialog } from "../orbis/shared";

export const dateiName = (d: Datei) => d.filename || (d.mediaType.startsWith("image/") ? "Image" : "File");
const lokal = (d: Datei) => /^data:[^,]*;base64,/i.test(d.url);
const externesBild = (d: Datei) => d.mediaType === "image/*" && /^https:\/\//i.test(d.url);
const bild = (d: Datei) => d.mediaType.startsWith("image/") && (lokal(d) || externesBild(d));

export function MedienKnopf({ datei, onOeffnen }: { datei: Datei; onOeffnen: () => void }) {
  const name = dateiName(datei);
  const [fehler, setFehler] = useState(false);
  return (
    <button type="button" aria-label={`${datei.alt ?? name} · Open preview`} onClick={onOeffnen}
      className="chat-media-button max-w-full rounded-o-card outline-none focus-visible:outline-2 focus-visible:outline-o-focus">
      {bild(datei) && lokal(datei) && !fehler ? (
        <img src={datei.url} alt={datei.alt ?? name} onError={() => setFehler(true)} className="max-h-[320px] max-w-full rounded-o-card border border-solid border-o-card-border object-contain" />
      ) : (
        <span className="flex h-9 max-w-full items-center gap-2 rounded-o-card bg-o-surface px-3 text-[14px] text-o-text">
          <Symbol name="file" /><span className="truncate">{name}</span>
        </span>
      )}
    </button>
  );
}

export function oeffneSchnellansicht(d: Datei): Promise<void> {
  if (!lokal(d)) return Promise.reject(new Error("The file is not available locally."));
  return invoke("preview_attachment", { base64: d.url.slice(d.url.indexOf(",") + 1), filename: dateiName(d), mediaType: d.mediaType });
}

export function MedienVorschau({ datei, onClose }: { datei: Datei; onClose: () => void }) {
  const [fehler, setFehler] = useState(false);
  const name = dateiName(datei);
  const typ = datei.mediaType.toLowerCase();
  return (
    <Dialog titel={name} breite={820} onClose={onClose}>
      <div className="flex min-w-0 flex-col items-center gap-3">
        {!fehler && bild(datei) ? (
          <img src={datei.url} alt={datei.alt ?? name} referrerPolicy="no-referrer" onError={() => setFehler(true)}
            className="max-h-[70dvh] max-w-full rounded-o-lg object-contain" />
        ) : !fehler && lokal(datei) && typ.startsWith("audio/") ? (
          <audio controls src={datei.url} onError={() => setFehler(true)} aria-label={name} className="w-full" />
        ) : !fehler && lokal(datei) && typ.startsWith("video/") ? (
          <video controls src={datei.url} onError={() => setFehler(true)} aria-label={name} className="max-h-[70dvh] max-w-full rounded-o-lg" />
        ) : (
          <p className="py-5 text-sm text-o-text-2">{fehler ? "This preview could not be loaded." : "Quick Look is available for this file type."}</p>
        )}
      </div>
      {lokal(datei) ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Knopf art="zweitrangig" onClick={() => void oeffneSchnellansicht(datei).catch(() => setFehler(true))}>Quick Look</Knopf>
          <a href={datei.url} download={name} className="rounded-o-control bg-o-surface px-3 py-2 text-sm text-o-text hover:bg-o-hover">Download file</a>
        </div>
      ) : null}
    </Dialog>
  );
}

export function hatMedienVorschau(d: Datei) {
  return bild(d) || (lokal(d) && /^(audio|video)\//i.test(d.mediaType));
}

/** "1:05" from milliseconds. */
export function dauerText(ms: number): string {
  const sek = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sek / 60)}:${String(sek % 60).padStart(2, "0")}`;
}

/**
 * Voice memo (upcoming `memo` part): play/pause, replay and duration. Plays only local audio (data: URLs),
 * like the audio preview above; anything else shows a clear "not available" line.
 */
export function MemoSpieler({ memo }: { memo: Omit<MemoPart, "type"> }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fertig, setFertig] = useState(false);
  const [fehler, setFehler] = useState(false);
  const [dauer, setDauer] = useState<number | null>(memo.durationMs ?? null);
  const [pos, setPos] = useState(0);
  const titel = memo.title?.trim() || "Voice memo";
  const ok = /^data:audio\/[^,]*;base64,/i.test(memo.url) || (/^data:[^,]*;base64,/i.test(memo.url) && (memo.mediaType ?? "").startsWith("audio/"));
  useEffect(() => () => audio.current?.pause?.(), []);

  if (!ok || fehler) {
    return (
      <div data-memo="fehlt" className="flex h-10 items-center gap-2 rounded-o-card bg-o-surface px-3 text-[14px] text-o-text-2">
        <Symbol name="file" /><span>{titel} · {fehler ? "This memo could not be played." : "Audio is not available locally."}</span>
      </div>
    );
  }

  const spielen = () => {
    const a = audio.current;
    if (!a) return;
    if (laeuft) { a.pause(); setLaeuft(false); return; }
    if (fertig) { a.currentTime = 0; setFertig(false); }
    void Promise.resolve(a.play()).then(() => setLaeuft(true)).catch(() => setFehler(true));
  };
  const nochmal = () => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = 0;
    setFertig(false);
    void Promise.resolve(a.play()).then(() => setLaeuft(true)).catch(() => setFehler(true));
  };

  return (
    <div data-memo className="flex max-w-full flex-col gap-1">
      <div className="flex h-10 items-center gap-2 rounded-o-card bg-o-surface px-2 text-[14px] text-o-text">
        <audio ref={audio} src={memo.url} preload="metadata" aria-label={titel}
          onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDauer(d * 1000); }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime * 1000)}
          onPause={() => setLaeuft(false)}
          onEnded={() => { setLaeuft(false); setFertig(true); }}
          onError={() => setFehler(true)} />
        <button type="button" onClick={spielen} aria-label={laeuft ? `Pause ${titel}` : `Play ${titel}`}
          className="flex size-7 items-center justify-center rounded-full bg-o-btn-secondary outline-none hover:bg-o-btn-secondary-hover focus-visible:outline-2 focus-visible:outline-o-focus cursor-default">
          <Symbol name={laeuft ? "pause" : "play"} groesse={14} />
        </button>
        <span className="truncate">{titel}</span>
        <span className="tabular-nums text-o-text-2" data-dauer>{dauer != null ? (laeuft || pos > 0 ? `${dauerText(pos)} / ${dauerText(dauer)}` : dauerText(dauer)) : "–:–"}</span>
        <button type="button" onClick={nochmal} aria-label={`Replay ${titel}`}
          className="ml-auto rounded-o-sm px-1.5 text-[13px] leading-[18px] text-o-text-2 outline-none hover:text-o-text hover:underline focus-visible:outline-2 focus-visible:outline-o-focus cursor-default">
          Replay
        </button>
      </div>
      {dauer != null && dauer > 0 && <input type="range" aria-label={`Seek in ${titel}`}
        min={0} max={dauer} step={100} value={Math.min(pos, dauer)} className="mx-2 accent-current"
        onChange={(event) => {
          const position = Number(event.target.value);
          if (audio.current && audio.current.readyState >= 1) {
            audio.current.currentTime = position / 1000;
            setPos(position);
            setFertig(false);
          }
        }} />}
      {memo.transcript ? <p className="px-1 text-[13px] leading-[18px] text-o-text-2 [overflow-wrap:anywhere]">{memo.transcript}</p> : null}
    </div>
  );
}

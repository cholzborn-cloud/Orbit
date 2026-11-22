import { useMemo, useState } from "react";
import { Feld, Knopf, Symbol } from "../../ui";
import { fehlerText } from "../../lib/chunks";
import { useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import type { Bot, Routine, RoutineInput, Schedule } from "../../lib/types";
import { Dialog, Fehlerzeile, Fuss, Kapsel, OrbiFigur, PillSelect, Reiter } from "../orbis/shared";
import { WOCHENTAGE, hm, nextOccurrence, nextRunText, scheduleSentence, type Zeitplan } from "./format";

type Art = "once" | "daily" | "weekly" | "monthly";

const VORSCHLAEGE: { text: string; prompt: string; art: Art; wd?: string; at: string }[] = [
  { text: "Plan the week", prompt: "Every Monday, plan my week in three blocks and send me the plan.", art: "weekly", wd: "1", at: "08:00" },
  { text: "Summarize mail", prompt: "Every evening, summarize my mail and flag what is urgent.", art: "daily", at: "18:00" },
  { text: "Week review", prompt: "Every Friday, send me a short review of my week.", art: "weekly", wd: "5", at: "17:00" },
  { text: "Birthday reminders", prompt: "Every morning, remind me of today's birthdays.", art: "daily", at: "08:00" },
];

const ZEITEN = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const heute = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Figma 6.2/6.2b "Neue Routine". Der Dienst legt Routinen nur über das Orbi-Werkzeug `automation_create` an
 * (POST /v1/automations antwortet immer 400). "Routine erstellen" schickt deshalb eine Nachricht an den Orbi.
 * Mit `routine` ist es derselbe Dialog zum Ändern (PATCH), mit "Jetzt ausführen" und Papierkorb.
 */
export function RoutineDialog({ bot, routine, onClose }: { bot: Bot; routine?: Routine; onClose: () => void }) {
  const a = routine?.automation;
  const s0 = a?.schedule as Zeitplan | undefined;
  const istEreignis = s0?.kind === "event";

  const [prompt, setPrompt] = useState(a?.prompt ?? "");
  const [name, setName] = useState(a?.name ?? "");
  const [art, setArt] = useState<Art>(s0 && s0.kind !== "weekdays" && s0.kind !== "event" ? s0.kind : "weekly");
  const [wd, setWd] = useState(s0?.kind === "weekdays" ? "wd" : String(s0?.weekday ?? 1));
  const [at, setAt] = useState(s0?.at && /^\d{2}:\d{2}$/.test(s0.at) ? s0.at : "08:00");
  const [tag, setTag] = useState(s0?.day ?? 1);
  const [datum, setDatum] = useState(s0?.date ?? (() => { const d = new Date(Date.now() + 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })());
  const [target, setTarget] = useState<"same" | "new">(a?.target ?? "same");
  const [notify, setNotify] = useState<"app" | "none">(a?.notify ?? "app");
  const [mehr, setMehr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const zeitplan: Zeitplan = useMemo(() => {
    if (istEreignis && s0) return s0;
    if (art === "daily") return { kind: "daily", at };
    if (art === "monthly") return { kind: "monthly", at, day: tag };
    if (art === "once") return { kind: "once", at, date: datum };
    return wd === "wd" ? { kind: "weekdays", at } : { kind: "weekly", at, weekday: Number(wd) };
  }, [istEreignis, s0, art, at, tag, datum, wd]);
  const naechster = useMemo(() => nextOccurrence(zeitplan), [zeitplan]);
  const zeiten = ZEITEN.includes(at) ? ZEITEN : [...ZEITEN, at].sort();

  const vorschlag = (v: (typeof VORSCHLAEGE)[number]) => {
    setPrompt(v.prompt);
    setArt(v.art);
    if (v.wd) setWd(v.wd);
    setAt(v.at);
  };

  const pruefen = (): string | null => {
    if (!prompt.trim()) return a ? "The task cannot be empty." : `Tell ${bot.name} what should run regularly.`;
    if (a && name.trim().length < 2) return "Name needs at least 2 characters.";
    if (!istEreignis && art === "once" && !naechster) return "That time is in the past.";
    return null;
  };

  const erstellen = () => {
    const f = pruefen();
    if (f) return setFehler(f);
    const text =
      `Please create a routine: ${prompt.trim()} ` +
      `Schedule: ${scheduleSentence(zeitplan)}. Result: ${target === "same" ? "in this chat" : "in a new chat"}.` +
      (notify === "none" ? " No notification." : "");
    onClose();
    const st = useOrbit.getState();
    void (async () => {
      if (st.selectedChatId !== bot.chatId) await st.selectChat(bot.chatId);
      useNav.getState().go({ kind: "chat" });
      await st.send(bot.chatId, text, [], bot.id);
    })();
  };

  const speichern = async () => {
    const f = pruefen();
    if (f) return setFehler(f);
    setBusy(true);
    setFehler(null);
    try {
      const input: Partial<RoutineInput> = { name: name.trim(), prompt: prompt.trim(), target, notify };
      if (!istEreignis) input.schedule = zeitplan as Schedule;
      await useOrbit.getState().updateRoutine(a!.id, input);
      onClose();
    } catch (e) {
      setFehler(fehlerText(e));
      setBusy(false);
    }
  };

  const aktion = async (fn: (id: string) => Promise<void>) => {
    setBusy(true);
    await fn(a!.id);
    onClose();
  };

  return (
    <Dialog titel={a ? "Edit routine" : "New routine"} breite={560} gap={20} onClose={onClose}>
      <div className="flex flex-col gap-2.5">
        {a ? <Feld label="Name" groesse="gross" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /> : null}
        <div className="flex items-start gap-3 rounded-[16px] bg-o-field px-4 py-3.5">
          <OrbiFigur avatar={bot.avatar} color={bot.color} look={bot.look} size={28} />
          <textarea
            aria-label="What should happen regularly?"
            rows={2}
            value={prompt}
            maxLength={4000}
            placeholder={`What should ${bot.name} do regularly?`}
            onChange={(e) => setPrompt(e.target.value)}
            className="min-h-[44px] w-full resize-none bg-transparent text-[15px] leading-[22px] text-o-text outline-none placeholder:text-o-text-3"
            autoFocus
          />
        </div>
        {!a ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {VORSCHLAEGE.map((v) => (
              <Kapsel key={v.text} onClick={() => vorschlag(v)}>{v.text}</Kapsel>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-[14px] leading-5 font-medium text-o-text">When?</span>
        {istEreignis ? (
          <p className="text-[15px] leading-[22px] text-o-text-2">Runs when the computer is handed back.</p>
        ) : (
          <>
            <Reiter<Art>
              label="When"
              value={art}
              onChange={setArt}
              items={[
                { id: "once", text: "Once" },
                { id: "daily", text: "Daily" },
                { id: "weekly", text: "Weekly" },
                { id: "monthly", text: "Monthly" },
              ]}
            />
            <div className="flex flex-wrap items-center gap-2 text-[15px] leading-[22px] text-o-text-2">
              {art === "daily" ? <span>Every day at</span> : null}
              {art === "weekly" ? (
                <>
                  <span>Every</span>
                  <PillSelect
                    label="Weekday"
                    value={wd}
                    onChange={setWd}
                    options={[...[1, 2, 3, 4, 5, 6, 0].map((i) => ({ wert: String(i), text: WOCHENTAGE[i] })), { wert: "wd", text: "Weekday" }]}
                  />
                  <span>at</span>
                </>
              ) : null}
              {art === "monthly" ? (
                <>
                  <span>On</span>
                  <PillSelect label="Day of month" value={String(tag)} onChange={(v) => setTag(Number(v))} options={Array.from({ length: 31 }, (_, i) => ({ wert: String(i + 1), text: `${i + 1}` }))} />
                  <span>at</span>
                </>
              ) : null}
              {art === "once" ? (
                <>
                  <span>On</span>
                  <input
                    type="date"
                    aria-label="Date"
                    value={datum}
                    min={heute()}
                    onChange={(e) => setDatum(e.target.value)}
                    className="h-[34px] rounded-full bg-o-field px-3 text-[15px] leading-[22px] font-medium text-o-text outline-none focus-visible:outline-2 focus-visible:outline-o-focus"
                  />
                  <span>at</span>
                </>
              ) : null}
              <PillSelect label="Time" value={at} onChange={setAt} options={zeiten.map((z) => ({ wert: z, text: hm(z) }))} />
            </div>
          </>
        )}
      </div>

      <div className="flex items-start gap-3 rounded-[16px] bg-o-field px-3.5 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-o-control border border-solid border-o-card-border bg-o-raised text-o-text">
          <Symbol name="clock" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[14px] leading-5 text-o-text">{`${bot.name} will do this ${scheduleSentence(zeitplan)}.`}</span>
          <span className="text-[13px] leading-[18px] text-o-text-2">
            {`${istEreignis ? "Next run after hand-back" : `Next run ${nextRunText(naechster)}`} · Result ${target === "same" ? "in chat" : "in a new chat"}`}
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={mehr}
          onClick={() => setMehr((m) => !m)}
          className="flex w-full items-center gap-2 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-o-focus cursor-default"
        >
          <span className="flex-1 text-[14px] leading-5 text-o-text">More options</span>
          <span className="text-[13px] leading-[18px] text-o-text-2">{`${target === "same" ? "In chat" : "New chat"} · Automatic`}</span>
          <span className="text-o-text-2"><Symbol name={mehr ? "chevd" : "chevr"} /></span>
        </button>
        {mehr ? (
          <div className="flex flex-col gap-2 pl-0.5">
            <div className="flex items-center gap-2 text-[14px] leading-5 text-o-text-2">
              <span className="w-[140px]">Result</span>
              <PillSelect label="Result" value={target} onChange={(v) => setTarget(v as "same" | "new")} options={[{ wert: "same", text: "In chat" }, { wert: "new", text: "In a new chat" }]} />
            </div>
            <div className="flex items-center gap-2 text-[14px] leading-5 text-o-text-2">
              <span className="w-[140px]">Notification</span>
              <PillSelect label="Notification" value={notify} onChange={(v) => setNotify(v as "app" | "none")} options={[{ wert: "app", text: "In the app" }, { wert: "none", text: "None" }]} />
            </div>
          </div>
        ) : null}
      </div>

      <Fehlerzeile text={fehler} />
      <Fuss
        links={
          a ? (
            <>
              <Knopf art="zweitrangig" disabled={busy} onClick={() => void aktion((id) => useOrbit.getState().runRoutine(id))}>Run now</Knopf>
              <Knopf art="gefahr" disabled={busy} onClick={() => void aktion((id) => useOrbit.getState().trashRoutine(id))}>Move to trash</Knopf>
            </>
          ) : undefined
        }
      >
        <Knopf art="still" onClick={onClose}>Cancel</Knopf>
        <Knopf art="primaer" disabled={busy} onClick={() => (a ? void speichern() : erstellen())}>{a ? "Save" : "Create routine"}</Knopf>
      </Fuss>
    </Dialog>
  );
}

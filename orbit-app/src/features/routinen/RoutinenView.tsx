import { useMemo, useState, type ReactNode } from "react";
import { Knopf, Schalter, Symbol } from "../../ui";
import { useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import type { Routine } from "../../lib/types";
import { Abschnitt, Liste, Punkt } from "../orbis/shared";
import { RoutineDialog } from "./RoutineDialog";
import { lastRunText, routineSubtitle, scheduleLabel, type Zeitplan } from "./format";

/** Figma 6.1: Routinen des gewählten Orbis im 340 breiten rechten Panel (Aktiv, Pausiert, Zuletzt gelaufen, dazu Papierkorb). */
export function RoutinenView() {
  const bots = useOrbit((s) => s.bots);
  const main = useOrbit((s) => s.main);
  const selected = useOrbit((s) => s.selectedChatId);
  const routines = useOrbit((s) => s.routines);
  const trash = useOrbit((s) => s.routineTrash);
  const runs = useOrbit((s) => s.runs);
  const setEnabled = useOrbit((s) => s.setRoutineEnabled);
  const restore = useOrbit((s) => s.restoreRoutine);
  const go = useNav((s) => s.go);
  const [dialog, setDialog] = useState<null | { routine?: Routine }>(null);

  const bot = bots.find((b) => b.chatId === selected) ?? (main?.chatId === selected ? main : null) ?? main ?? bots[0] ?? null;
  const eigene = useMemo(() => routines.filter((r) => r.automation.botId === bot?.id), [routines, bot?.id]);
  const aktiv = eigene.filter((r) => r.automation.enabled);
  const pausiert = eigene.filter((r) => !r.automation.enabled);
  const gelaufen = useMemo(
    () => eigene.filter((r) => r.automation.lastRunAt).sort((a, b) => Date.parse(b.automation.lastRunAt!) - Date.parse(a.automation.lastRunAt!)).slice(0, 3),
    [eigene],
  );
  const papierkorb = trash.filter((r) => r.automation.botId === bot?.id);

  if (!bot) return null;

  const zeile = (r: Routine): ReactNode => (
    <div key={r.automation.id} className="flex items-center gap-2.5 px-3 py-2.5">
      <button
        type="button"
        onClick={() => setDialog({ routine: r })}
        className="flex min-w-0 flex-1 flex-col gap-px text-left focus-visible:outline-2 focus-visible:outline-o-focus cursor-default"
      >
        <span className="truncate text-[14px] leading-5">{r.automation.name}</span>
        <span className="truncate text-[12px] leading-4 text-o-text-2">
          {r.blocker ? r.blocker : r.automation.pausedReason && !r.automation.enabled ? r.automation.pausedReason : routineSubtitle(r.automation)}
        </span>
      </button>
      <Schalter
        aria-label={`${r.automation.name} ${r.automation.enabled ? "turn off" : "turn on"}`}
        checked={r.automation.enabled}
        disabled={!!r.blocker}
        onChange={(an) => void setEnabled(r.automation.id, an)}
      />
    </div>
  );

  return (
    <aside
      aria-label={`Routines of ${bot.name}`}
      className="orbit-ui flex h-full w-full flex-col gap-3 overflow-y-auto overscroll-contain bg-o-sidebar px-4 pb-3.5 pt-3 text-o-text"
    >
      <div className="flex h-9 shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label="Back to chat"
          onClick={() => go({ kind: "chat" })}
          className="flex h-7 w-7 items-center justify-center rounded-full text-o-text-2 transition-colors duration-[var(--orbit-dur)] hover:bg-o-hover focus-visible:outline-2 focus-visible:outline-o-focus cursor-default"
        >
          <Symbol name="chevl" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-[14px] leading-5 font-medium">{`Routines of ${bot.name}`}</h2>
        <button
          type="button"
          aria-label="New routine"
          onClick={() => setDialog({})}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-o-field transition-colors duration-[var(--orbit-dur)] hover:bg-o-selected focus-visible:outline-2 focus-visible:outline-o-focus cursor-default"
        >
          <Symbol name="plus" />
        </button>
      </div>

      {eigene.length === 0 && papierkorb.length === 0 ? (
        <p className="text-[13px] leading-[18px] text-o-text-2">
          {`No routines yet. Use + to tell ${bot.name} what should run regularly, and ${bot.name} will create the routine.`}
        </p>
      ) : null}

      {aktiv.length ? (
        <>
          <Abschnitt>Active</Abschnitt>
          <Liste>{aktiv.map(zeile)}</Liste>
        </>
      ) : null}
      {pausiert.length ? (
        <>
          <Abschnitt>Paused</Abschnitt>
          <Liste>{pausiert.map(zeile)}</Liste>
        </>
      ) : null}
      {gelaufen.length ? (
        <>
          <Abschnitt>Recently run</Abschnitt>
          <Liste>
            {gelaufen.map((r) => {
              const fehlerhaft = runs[r.automation.id]?.status === "error";
              return (
                <div key={r.automation.id} className="flex items-center gap-2.5 px-3 py-[9px]">
                  <Punkt art={fehlerhaft ? "warn" : "ok"} />
                  <span className="min-w-0 flex-1 truncate text-[14px] leading-5">{r.automation.name}</span>
                  <span className="shrink-0 text-[13px] leading-[18px] text-o-text-2">
                    {lastRunText(r.automation.lastRunAt)}
                    {fehlerhaft ? " · Error" : ""}
                  </span>
                </div>
              );
            })}
          </Liste>
        </>
      ) : null}
      {papierkorb.length ? (
        <>
          <Abschnitt>Trash</Abschnitt>
          <Liste>
            {papierkorb.map((r) => (
              <div key={r.automation.id} className="flex items-center gap-2.5 px-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-[14px] leading-5 text-o-text-2">{r.automation.name}</span>
                  <span className="truncate text-[12px] leading-4 text-o-text-3">{scheduleLabel(r.automation.schedule as Zeitplan)}</span>
                </span>
                <Knopf art="zweitrangig" groesse="klein" onClick={() => void restore(r.automation.id)}>Restore</Knopf>
              </div>
            ))}
          </Liste>
        </>
      ) : null}

      {dialog ? <RoutineDialog bot={bot} routine={dialog.routine} onClose={() => setDialog(null)} /> : null}
    </aside>
  );
}

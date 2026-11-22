import { Knopf } from "../../ui";
import * as api from "../../lib/api";
import { fehlerText } from "../../lib/chunks";
import { useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import { useState } from "react";
import { Dialog, Fehlerzeile, Fuss, Punkt, type PunktArt } from "../orbis/shared";
import { seitText, uhrzeit } from "./format";

const STATUS: Record<string, { text: string; art: PunktArt }> = {
  start: { text: "Running", art: "warn" },
  progress: { text: "Running", art: "warn" },
  done: { text: "Done", art: "ok" },
  stopped: { text: "Stopped", art: "ruhig" },
  failed: { text: "Failed", art: "fehler" },
};

/** Figma 6.4: Task dialog with status, steps, stop and approve. Close returns to chat. */
export function TaskView({ taskId }: { taskId: string }) {
  const task = useOrbit((s) => s.tasks[taskId]);
  const cards = useOrbit((s) => s.cards);
  const steps = useOrbit((s) => s.steps);
  const decide = useOrbit((s) => s.decide);
  const go = useNav((s) => s.go);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const zu = () => go({ kind: "chat" });

  if (!task) {
    return (
      <Dialog titel="Task" breite={560} onClose={zu}>
        <p className="text-[14px] leading-5 text-o-text-2">This task is gone.</p>
        <Fuss>
          <Knopf art="primaer" onClick={zu}>Close</Knopf>
        </Fuss>
      </Dialog>
    );
  }

  const karten = cards.filter((k) => k.root?.taskId === taskId);
  const wartet = karten[0];
  const laufend = task.action === "start" || task.action === "progress";
  const status = wartet
    ? { text: `Waiting for your approval · ${seitText(wartet.requestedAt)}`, art: "warn" as PunktArt }
    : { text: task.progress && laufend ? `${STATUS[task.action].text} · ${task.progress}` : STATUS[task.action]?.text ?? "Running", art: STATUS[task.action]?.art ?? "warn" };

  // Steps: live Orbi steps in the task chat plus open approvals. The service does not return a finished step list.
  const zeilen = [
    ...steps
      .filter((s) => s.botId === task.botId && s.chatId === task.chatId)
      .map((s) => ({ id: s.toolCallId, titel: s.label, sub: "Running", art: "ruhig" as PunktArt, t: typeof s.at === "number" ? s.at : Date.parse(String(s.at)) })),
    ...karten.map((k) => ({ id: k.id, titel: k.text || k.reason || k.tool, sub: "Waiting for approval", art: "warn" as PunktArt, t: Date.parse(k.requestedAt) })),
  ];

  const stoppen = async () => {
    setBusy(true);
    try {
      await api.stopTask(taskId);
      zu();
    } catch (e) {
      setFehler(fehlerText(e));
      setBusy(false);
    }
  };

  return (
    <Dialog titel={task.title} breite={560} onClose={zu}>
      <div className="flex items-center gap-2">
        <Punkt art={status.art} />
        <span className="text-[14px] leading-5 text-o-text-2">{status.text}</span>
      </div>
      {task.brief ? <p className="text-[14px] leading-5 text-o-text-2">{task.brief}</p> : null}
      {zeilen.length ? (
        <ol className="flex flex-col" aria-label="Steps">
          {zeilen.map((z, i) => (
            <li key={z.id} className="flex items-stretch gap-3">
              <span className="flex w-4 shrink-0 flex-col items-center gap-[3px] py-1" aria-hidden="true">
                <Punkt art={z.art} groesse={10} />
                {i < zeilen.length - 1 ? <span className="min-h-[30px] w-0.5 flex-1 rounded bg-o-line-strong" /> : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5 pb-2.5">
                <span className="truncate text-[14px] leading-5 text-o-text">{z.titel}</span>
                <span className="text-[12px] leading-4 text-o-text-2">{z.sub}</span>
              </span>
              {!Number.isNaN(z.t) ? <span className="shrink-0 text-[13px] leading-[18px] text-o-text-2">{uhrzeit(new Date(z.t))}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      <Fehlerzeile text={fehler} />
      <Fuss>
        {laufend || wartet ? (
          <Knopf art="gefahr" disabled={busy} onClick={() => void stoppen()}>Stop</Knopf>
        ) : null}
        {wartet ? (
          <Knopf
            art="primaer"
            disabled={busy}
            onClick={async () => {
              await decide(wartet.id, "once");
              zu();
            }}
          >
            Approve
          </Knopf>
        ) : (
          <Knopf art="zweitrangig" onClick={zu}>Close</Knopf>
        )}
      </Fuss>
    </Dialog>
  );
}

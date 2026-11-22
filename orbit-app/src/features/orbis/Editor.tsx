import { useMemo, useState } from "react";
import { Feld, Knopf, Schalter, Symbol, cx } from "../../ui";
import { SHAPES } from "../../orbi";
import * as api from "../../lib/api";
import { fehlerText } from "../../lib/chunks";
import { useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import type { Bot } from "../../lib/types";
import { Dialog, Fehlerzeile, Fuss, OrbiFigur, PALETTE, Reiter, useDark } from "./shared";
import { gruppenVorgabe } from "./vorgabe";

async function neuLaden() {
  const st = useOrbit.getState();
  await Promise.allSettled([st.loadBots(), st.loadChats()]);
}

/** Liest nav.editor und zeigt den passenden Dialog: Orbi bearbeiten/neu (5.5, 5.6, 5.7) oder Gruppe (5.8). */
export function EditorDialogs() {
  const editor = useNav((s) => s.editor);
  const openEditor = useNav((s) => s.openEditor);
  if (!editor) return null;
  const zu = () => openEditor(null);
  if (editor.kind === "orbi") {
    return <OrbiEditor key={`o-${editor.botId ?? "neu"}`} botId={editor.botId} tab={editor.tab} onClose={zu} />;
  }
  return <GruppeEditor key={`g-${editor.chatId ?? "neu"}`} chatId={editor.chatId} onClose={zu} />;
}

// ---------- Orbi: Form und Personalisieren ----------

const SHAPE_NAME: Record<string, string> = { grokbot: "Grok" };

function OrbiEditor({ botId, tab: start, onClose }: { botId?: string; tab?: "form" | "personalisieren"; onClose: () => void }) {
  const bot = useOrbit((s) => (botId ? s.bots.find((b) => b.id === botId) ?? (s.main?.id === botId ? s.main : undefined) : undefined));
  const main = useOrbit((s) => s.main);
  const dark = useDark();
  const neu = !bot;

  const [tab, setTab] = useState<"form" | "personalisieren">(start ?? "form");
  const [name, setName] = useState(bot?.name ?? "");
  const [job, setJob] = useState(bot?.job ?? "");
  const [avatar, setAvatar] = useState(bot?.avatar ?? "strobi");
  const [color, setColor] = useState<string | null>(bot?.color ?? null);
  const [isMain, setIsMain] = useState(bot?.isMain ?? false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bestaetigen, setBestaetigen] = useState(false);
  const [loeschen, setLoeschen] = useState(false);

  const titel = neu ? "New Orbi" : `Edit ${bot!.name}`;
  const look = bot?.look ?? null; // Look wird in diesem Editor nicht verändert
  // Der bisherige Hauptorbi, wenn dieser Orbi es erst werden soll.
  const altMain = isMain && main && main.id !== bot?.id ? main : null;

  const speichern = async () => {
    setFehler(null);
    if (!name.trim()) return setFehler("Give your Orbi a name");
    if (!job.trim()) return setFehler("Give your Orbi a job");
    setBusy(true);
    try {
      const input = { name: name.trim(), job: job.trim(), avatar, color, isMain };
      if (neu) await api.createBot(input);
      else await api.updateBot(bot!.id, input);
      await neuLaden();
      onClose();
    } catch (e) {
      setFehler(fehlerText(e));
      setBusy(false);
      setBestaetigen(false);
    }
  };
  const loeschenJa = async () => {
    setBusy(true);
    try {
      await api.deleteBot(bot!.id);
      await neuLaden();
      const st = useOrbit.getState();
      if (st.selectedChatId === bot!.chatId) await st.selectChat(st.main?.chatId ?? null);
      onClose();
    } catch (e) {
      setFehler(fehlerText(e));
      setBusy(false);
      setLoeschen(false);
    }
  };

  if (bestaetigen && altMain) {
    return (
      <Dialog titel={`Make ${name.trim() || "this Orbi"} the main Orbi?`} breite={400} onClose={() => setBestaetigen(false)}>
        <div className="flex items-center justify-center gap-2.5">
          <OrbiFigur avatar={altMain.avatar} color={altMain.color} look={altMain.look} size={48} />
          <span className="text-o-text-2"><Symbol name="arrowright" /></span>
          <OrbiFigur avatar={avatar} color={color} look={look} size={48} />
        </div>
        <p className="text-[15px] leading-[22px] text-o-text-2">
          {`${name.trim()} will take new tasks and hand them out. ${altMain.name} stays your Orbi for ${altMain.job}.`}
        </p>
        <Fehlerzeile text={fehler} />
        <Fuss>
          <Knopf art="still" onClick={() => setBestaetigen(false)}>Cancel</Knopf>
          <Knopf art="primaer" disabled={busy} onClick={() => void speichern()}>{`Make ${name.trim()} main`}</Knopf>
        </Fuss>
      </Dialog>
    );
  }
  if (loeschen && bot) {
    return (
      <Dialog titel={`Delete ${bot.name}?`} breite={400} onClose={() => setLoeschen(false)}>
        <p className="text-[15px] leading-[22px] text-o-text-2">{`${bot.name} and the chat with ${bot.name} will be removed. This cannot be undone.`}</p>
        <Fehlerzeile text={fehler} />
        <Fuss>
          <Knopf art="still" onClick={() => setLoeschen(false)}>Cancel</Knopf>
          <Knopf art="gefahr" disabled={busy} onClick={() => void loeschenJa()}>{`Delete ${bot.name}`}</Knopf>
        </Fuss>
      </Dialog>
    );
  }

  return (
    <Dialog titel={titel} breite={520} onClose={onClose}>
      <Reiter<"form" | "personalisieren">
        label="Section"
        hoehe={34}
        value={tab}
        onChange={setTab}
        items={[
          { id: "form", text: "Form" },
          { id: "personalisieren", text: "Personalize" },
        ]}
      />
      {tab === "form" ? (
        <div className="flex flex-col items-center gap-[18px]">
          <OrbiFigur avatar={avatar} color={color} look={look} size={112} follow />
          <div role="radiogroup" aria-label="Form" className="flex max-w-[400px] flex-wrap justify-center gap-1">
            {SHAPES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={avatar === s}
                aria-label={SHAPE_NAME[s] ?? s[0].toUpperCase() + s.slice(1)}
                onClick={() => setAvatar(s)}
                className={cx(
                  "flex h-11 w-11 items-center justify-center rounded-o-control transition-[background-color,opacity] duration-[var(--orbit-dur)] focus-visible:outline-2 focus-visible:outline-o-focus cursor-default",
                  avatar === s ? "bg-o-selected" : "opacity-60 hover:bg-o-hover hover:opacity-100",
                )}
              >
                <OrbiFigur avatar={s} color={color} look={look} size={30} />
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Color" className="flex w-full max-w-[400px] items-center justify-center gap-[5px]">
            {PALETTE.map((p) => {
              const sel = color?.toLowerCase() === p.light;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={sel}
                  aria-label={p.id}
                  onClick={() => setColor(sel ? null : p.light)}
                  className="flex h-[22px] w-[22px] items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-o-focus cursor-default"
                  style={sel ? { boxShadow: "inset 0 0 0 2px var(--orbit-text)" } : undefined}
                >
                  <span
                    className="rounded-full"
                    style={{ width: 18, height: 18, background: dark ? p.dark : p.light, transform: sel ? "scale(0.7778)" : "none", transition: "transform var(--orbit-dur) var(--orbit-ease)" }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <Feld label="Name" groesse="gross" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus={neu} />
          <Feld label="Job" groesse="gross" value={job} maxLength={60} onChange={(e) => setJob(e.target.value)} />
          <div className="flex items-center gap-3 rounded-o-card bg-o-surface px-3.5 py-3" style={{ borderRadius: 14 }}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[14px] leading-5 font-medium text-o-text">Main Orbi</span>
              <span className="text-[13px] leading-[18px] text-o-text-2">
                Your first contact: takes new tasks, hands them to the right Orbis, and reports when something is done.
              </span>
            </div>
            <Schalter aria-label="Main Orbi" checked={isMain} onChange={setIsMain} />
          </div>
          {!neu ? (
            <Knopf art="gefahr" className="self-start" onClick={() => setLoeschen(true)}>{`Delete ${bot!.name}`}</Knopf>
          ) : null}
        </>
      )}
      <Fehlerzeile text={fehler} />
      <Fuss>
        <Knopf art="still" onClick={onClose}>Cancel</Knopf>
        <Knopf
          art="primaer"
          disabled={busy}
          onClick={() => {
            if (altMain && name.trim() && job.trim()) setBestaetigen(true);
            else void speichern();
          }}
        >
          {neu ? "Create" : "Save"}
        </Knopf>
      </Fuss>
    </Dialog>
  );
}

// ---------- Gruppe (5.8) ----------

function GruppeEditor({ chatId, onClose }: { chatId?: string; onClose: () => void }) {
  const bots = useOrbit((s) => s.bots);
  const main = useOrbit((s) => s.main);
  const gruppe = useOrbit((s) => (chatId ? s.groups.find((g) => g.id === chatId) : undefined));
  const alle = useMemo(() => (main && !bots.some((b) => b.id === main.id) ? [main, ...bots] : bots), [main, bots]);
  const [name, setName] = useState(gruppe?.name ?? "");
  const [ids, setIds] = useState<string[]>(() => {
    if (gruppe) return gruppe.members.map((m) => m.id);
    const v = gruppenVorgabe.botId;
    gruppenVorgabe.botId = null;
    return v ? [v] : [];
  });
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loeschen, setLoeschen] = useState(false);

  const gewaehlt = ids.map((id) => alle.find((b) => b.id === id)).filter((b): b is Bot => !!b);
  const umschalten = (id: string) =>
    setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 6 ? cur : [...cur, id]));

  const speichern = async () => {
    setFehler(null);
    if (!name.trim()) return setFehler("Give the group a name");
    if (ids.length < 1) return setFehler("Select at least one Orbi");
    setBusy(true);
    try {
      if (gruppe) await api.updateGroup(gruppe.id, name.trim(), ids);
      else await api.createGroup(name.trim(), ids);
      await neuLaden();
      onClose();
    } catch (e) {
      setFehler(fehlerText(e));
      setBusy(false);
    }
  };
  const entfernen = async () => {
    setBusy(true);
    try {
      await api.deleteGroup(gruppe!.id);
      await neuLaden();
      const st = useOrbit.getState();
      if (st.selectedChatId === gruppe!.id) await st.selectChat(st.main?.chatId ?? null);
      onClose();
    } catch (e) {
      setFehler(fehlerText(e));
      setBusy(false);
      setLoeschen(false);
    }
  };

  if (loeschen && gruppe) {
    return (
      <Dialog titel={`Delete ${gruppe.name}?`} breite={400} onClose={() => setLoeschen(false)}>
        <p className="text-[15px] leading-[22px] text-o-text-2">The group and its chat will be removed. The Orbis stay.</p>
        <Fehlerzeile text={fehler} />
        <Fuss>
          <Knopf art="still" onClick={() => setLoeschen(false)}>Cancel</Knopf>
          <Knopf art="gefahr" disabled={busy} onClick={() => void entfernen()}>Delete group</Knopf>
        </Fuss>
      </Dialog>
    );
  }

  return (
    <Dialog titel={gruppe ? `Edit ${gruppe.name}` : "New group"} breite={440} onClose={onClose}>
      <div className="flex h-[50px] items-center justify-center -space-x-2.5" aria-hidden="true">
        {gewaehlt.slice(0, 4).map((b) => (
          <span key={b.id} className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-o-raised">
            <OrbiFigur avatar={b.avatar} color={b.color} look={b.look} size={44} />
          </span>
        ))}
      </div>
      <Feld label="Name" groesse="gross" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
      <div role="group" aria-label="Orbis in the group" className="flex max-h-[264px] flex-col overflow-y-auto overscroll-contain rounded-o-card bg-o-surface" style={{ borderRadius: 14 }}>
        {alle.map((b) => {
          const an = ids.includes(b.id);
          return (
            <button
              key={b.id}
              type="button"
              role="checkbox"
              aria-checked={an}
              disabled={!an && ids.length >= 6}
              onClick={() => umschalten(b.id)}
              className="flex h-11 shrink-0 items-center gap-3 px-3.5 py-2 text-left transition-colors duration-[var(--orbit-dur)] hover:bg-o-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-o-focus disabled:opacity-40 cursor-default"
            >
              <OrbiFigur avatar={b.avatar} color={b.color} look={b.look} size={28} />
              <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-o-text">{b.name}</span>
              <span
                aria-hidden="true"
                className={cx(
                  "flex h-5 w-5 items-center justify-center rounded-full transition-colors duration-[var(--orbit-dur)]",
                  an ? "bg-o-btn-primary text-o-on-primary" : "border-[1.5px] border-solid border-o-check-edge",
                )}
              >
                {an ? <Symbol name="check" groesse={13} /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <Fehlerzeile text={fehler} />
      <Fuss links={gruppe ? <Knopf art="gefahr" onClick={() => setLoeschen(true)}>Delete group</Knopf> : undefined}>
        <Knopf art="still" onClick={onClose}>Cancel</Knopf>
        <Knopf art="primaer" disabled={busy} onClick={() => void speichern()}>{gruppe ? "Save" : "Create group"}</Knopf>
      </Fuss>
    </Dialog>
  );
}

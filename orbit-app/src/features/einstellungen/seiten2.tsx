import { useId, useState } from "react";
import { Knopf, Ladeanzeige, Symbol, cx } from "../../ui";
import { deleteRule, getBudget, getRules, getUsage } from "../../lib/api";
import { useOrbit } from "../../lib/store";
import { Modellwahl } from "../chat/Modellwahl";
import { fehlerText, useDunkel } from "../onboarding/dunkel";
import { Logo, Rechtzeile } from "../onboarding/bausteine";
import { macAnfrage, macSchalter, macZugriff, profilLesen, profilSchreiben, verlauf, type Profil } from "../onboarding/dienst";
import { ProgrammKarte, useProgramme, vorgangVon } from "../onboarding/programme";
import { profilNebenwirkungen } from "../../lib/einstellungen-wirken";
import { Abschnitt, Fehlerband, Karte, Laedt, OrbiKlein, Pillen, PillenAuswahl, SchalterZeile, Zeile } from "./bausteine";
import { DiensteEinstellungen } from "./dienste";
import { euro, mio, useDaten, useEinst, zahl } from "./store";

// ---------------------------------------------------------------- Nutzung

const ANBIETER = [
  { id: "claude", usage: "claude", name: "Claude Code", marke: "claude-code", farbe: "#d97757" },
  { id: "codex", usage: "codex", name: "Codex", marke: "codex", farbe: "#4c8df6" },
  { id: "cursor", usage: "cursor", name: "Cursor", marke: "cursor", farbe: "#a1a1aa" },
  { id: "agy", usage: "antigravity", name: "Antigravity", marke: "antigravity", farbe: "#34a853" },
] as const;

const WOCHENTAG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function neuText(ms: number): string {
  const d = new Date(ms);
  const uhr = d.toLocaleTimeString("de-DE", { hour: "numeric", minute: "2-digit" });
  const heute = new Date();
  return d.toDateString() === heute.toDateString() ? `Resets at ${uhr}` : `Resets ${WOCHENTAG[d.getDay()]}, ${uhr}`;
}

function Grenzen() {
  const u = useDaten(() => getUsage());
  if (!u.daten) return <><Fehlerband text={u.fehler} />{u.laedt ? <Laedt /> : null}</>;
  return (
    <Abschnitt titel="Limits per provider" anker="limits">
      <div className="grid grid-cols-2 gap-2.5">
        {ANBIETER.map((a) => {
          const p = u.daten!.providers.find((x: any) => x.provider === a.usage);
          const fenster: { name: string; used: number; resetAt: number }[] = (p?.accounts ?? []).flatMap((k: any) => k.windows ?? []);
          const pausiert = p?.status === "limit";
          return (
            <div key={a.id} className="flex flex-col gap-3 rounded-[16px] border border-solid border-o-card-border bg-o-raised px-4 py-3.5" data-anbieter={a.id}>
              <div className="flex items-center gap-2"><Symbol marke={a.marke} groesse={20} /><span className="flex-1 text-[14px] leading-5 font-medium text-o-text">{a.name}</span></div>
              {fenster.length ? fenster.map((w) => {
                const prozent = Math.min(100, Math.round(w.used * 100));
                const warn = w.used >= 0.8;
                return (
                  <div key={w.name} className="flex flex-col gap-1.5">
                    <div className="flex gap-2 text-[13px] leading-[18px]"><span className="flex-1 text-o-text-2">{w.name}</span><span className={warn ? "text-o-attention" : "text-o-text"}>{prozent} %</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--o-spur)]"><div className="h-full rounded-full" style={{ width: `${prozent}%`, backgroundColor: warn ? "var(--o-warn)" : "var(--orbit-text)" }} /></div>
                    <span className="text-[12px] leading-4 text-o-text-3">{w.used >= 1 ? `Paused until ${new Date(w.resetAt).toLocaleTimeString("de-DE", { hour: "numeric", minute: "2-digit" })}, Orbis are waiting` : w.resetAt ? neuText(w.resetAt) : ""}</span>
                  </div>
                );
              }) : <p className="text-[13px] leading-[18px] text-o-text-2">{p?.note ?? (pausiert ? "Paused" : "No values yet.")}</p>}
            </div>
          );
        })}
      </div>
    </Abschnitt>
  );
}

function Verbrauch() {
  const st = useEinst();
  const { zeitraum, einheit } = st;
  const v = useDaten(() => verlauf(zeitraum), [zeitraum]);
  const b = useDaten(() => getBudget());
  const [tipp, setTipp] = useState<number | null>(null);
  const tage = v.daten?.days ?? [];
  const euroOk = !!v.daten?.fxConfigured;
  const wert = (e: { input: number; output: number; costEur: number | null }) => (einheit === "tokens" ? e.input + e.output : e.costEur ?? 0);
  const summe = (f: (e: any) => number) => tage.reduce((s, t) => s + Object.values(t.entries).reduce((a, e: any) => a + f(e), 0), 0);
  const ein = summe((e) => (einheit === "tokens" ? e.input : e.inputEur ?? 0));
  const aus = summe((e) => (einheit === "tokens" ? e.output : e.outputEur ?? 0));
  const gesamt = ein + aus;
  const proTag = tage.length ? gesamt / tage.length : 0;
  const fmt = (n: number) => (einheit === "tokens" ? mio(n) : euro(n));
  const tagSumme = tage.map((t) => Object.values(t.entries).reduce((s, e: any) => s + wert(e), 0));
  const max = Math.max(1, ...tagSumme);
  const schritt = einheit === "tokens" ? Math.pow(10, Math.floor(Math.log10(max / 1_000_000))) * 1_000_000 : Math.pow(10, Math.floor(Math.log10(max)));
  const obere = Math.ceil(max / (schritt * 2)) * schritt * 2 || schritt * 2;
  const achse = [0, obere / 2, obere];
  const achsText = (n: number) => (einheit === "tokens" ? `${zahl(n / 1_000_000)} M` : `${zahl(n)} €`);
  const monat = zeitraum === "month";
  const tagName = (d: string) => (monat ? String(new Date(d).getDate()) : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][new Date(d).getDay()]);
  const jev = b.daten;
  return (
    <Abschnitt titel="Consumption">
      <Fehlerband text={v.fehler} />
      <div className="flex flex-col gap-4 rounded-[16px] border border-solid border-o-card-border bg-o-raised px-[18px] py-4">
        <div className="flex items-center gap-2">
          <Pillen label="Period" wert={zeitraum} breite={82} onChange={(z) => st.set({ zeitraum: z })} optionen={[{ wert: "week", text: "Week" }, { wert: "month", text: "Month" }]} />
          <span className="flex-1" />
          <Pillen label="Unit" wert={einheit} breite={82} onChange={(e) => st.set({ einheit: e })} optionen={[{ wert: "tokens", text: "Tokens" }, { wert: "euro", text: "Euro" }]} />
        </div>
        <div className="flex gap-2.5">
          {[[einheit === "tokens" ? "Total tokens" : "Total API value", gesamt], ["Input", ein], ["Output", aus], ["Per day", proTag]].map(([n, x]) => (
            <div key={n as string} className="flex flex-1 flex-col gap-0.5"><span className="text-[12px] leading-4 text-o-text-2">{n}</span><span className="text-[20px] leading-[26px] font-semibold text-o-text">{einheit === "euro" && !euroOk ? "–" : fmt(x as number)}</span></div>
          ))}
        </div>
        <Diagramm tage={tage} achse={achse} obere={obere} achsText={achsText} tagName={tagName} wert={wert} monat={monat} tipp={tipp} setTipp={setTipp} fmt={fmt} euroKaputt={einheit === "euro" && !euroOk} einheit={einheit} />
        <div className="flex flex-wrap gap-3.5">
          {ANBIETER.map((a) => <span key={a.id} className="flex items-center gap-1.5 text-[13px] leading-[18px] text-o-text-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: a.farbe }} />{a.name}</span>)}
        </div>
        <p className="text-[12px] leading-4 text-o-text-3">
          {einheit === "tokens" ? "Hover over a bar for details. With “Euro” you see what the tokens would cost through the API."
            : `${euroOk ? "Converted with the providers' API prices." : "No exchange rate is stored, so the euro amounts are missing."} With a subscription you only pay the subscription price${jev ? `, paid API usage: ${zahl(jev.jev.spentUsd, 2)} $ of ${zahl(jev.budget.jevDailyUsd)} $ per day` : ""}.`}
        </p>
      </div>
    </Abschnitt>
  );
}

function Diagramm({ tage, achse, obere, achsText, tagName, wert, monat, tipp, setTipp, fmt, euroKaputt, einheit }: {
  tage: any[]; achse: number[]; obere: number; achsText: (n: number) => string; tagName: (d: string) => string; wert: (e: any) => number; monat: boolean;
  tipp: number | null; setTipp: (i: number | null) => void; fmt: (n: number) => string; euroKaputt: boolean; einheit: "tokens" | "euro";
}) {
  // Figma 07: Säule 64 (Woche) und Säule 16 (Monat): Hover-Fläche 64×136 bzw. 16×136, Stapel 30 bzw. 10 breit, Segmente mit 1 px Abstand und Radius 3.
  const hoehe = 130;
  const spalte = monat ? 16 : 64;
  const stapel = monat ? 10 : 30;
  return (
    <div className="relative" style={{ height: 152 }} data-diagramm>
      {achse.map((a) => (
        <div key={a} className="absolute left-0 right-0 flex h-4 items-center" style={{ bottom: 13.5 + (a / obere) * hoehe }}>
          <span className="w-10 text-[12px] leading-4 text-o-text-3">{achsText(a)}</span><span className="h-px flex-1 bg-o-line" />
        </div>
      ))}
      <div className="absolute flex items-end justify-between" style={{ left: 40, right: 0, bottom: 22, height: hoehe }}>
        {tage.map((t, i) => {
          const segmente = ANBIETER.map((a) => ({ a, w: euroKaputt ? 0 : wert(t.entries[a.id] ?? { input: 0, output: 0, costEur: 0 }) })).filter((s) => s.w > 0);
          const gesamt = segmente.reduce((s, x) => s + x.w, 0);
          const eur = Object.values(t.entries).reduce((s: number, e: any) => s + (e.costEur ?? 0), 0);
          const tok = Object.values(t.entries).reduce((s: number, e: any) => s + e.input + e.output, 0);
          const d = new Date(t.date);
          const tag = d.toLocaleDateString("de-DE", monat ? { day: "numeric", month: "long" } : { weekday: "long", day: "numeric", month: "short" });
          return (
            <div key={t.date} className="relative flex flex-1 flex-col items-center justify-end" style={{ height: hoehe }} onMouseEnter={() => setTipp(i)} onMouseLeave={() => setTipp(null)}>
              <span aria-hidden="true" className={cx("pointer-events-none absolute -bottom-[3px] -top-[3px] left-1/2 -translate-x-1/2", monat ? "rounded-[5.33px]" : "rounded-[8px]", tipp === i ? "bg-o-hover" : "")} style={{ width: spalte }} />
              <div className="relative flex flex-col-reverse gap-px" style={{ width: stapel }} data-saeule>
                {segmente.map((s) => { const h = (s.w / obere) * hoehe; return <div key={s.a.id} style={{ height: h, backgroundColor: s.a.farbe, borderRadius: Math.min(3, h / 2) }} />; })}
              </div>
              {tipp === i ? (
                <div role="tooltip" className="absolute left-1/2 z-10 flex w-[150px] -translate-x-1/2 flex-col gap-0.5 rounded-o-control border border-solid border-o-card-border bg-o-raised px-[10px] py-2 shadow-[0_4px_12px_rgb(0_0_0/0.12)]" style={{ top: -70 }}>
                  <div className="whitespace-nowrap text-[12px] leading-4 text-o-text-2">{tag}</div>
                  {gesamt > 0 ? (
                    <>
                      <div className="text-[14px] leading-5 font-medium text-o-text">{einheit === "tokens" ? `${fmt(gesamt)} Tokens` : `≈ ${fmt(gesamt)}`}</div>
                      {einheit === "tokens" ? (eur > 0 ? <div className="text-[12px] leading-4 text-o-text-2">≈ {euro(eur)} API value</div> : null) : <div className="text-[12px] leading-4 text-o-text-2">{mio(tok)} Tokens</div>}
                    </>
                  ) : <div className="text-[14px] leading-5 font-medium text-o-text">No usage</div>}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="absolute flex justify-between" style={{ left: 40, right: 0, bottom: -2 }}>
        {tage.map((t, i) => <span key={t.date} className="flex-1 text-center text-[12px] leading-4 text-o-text-3">{!monat || i === 0 || (i + 1) % 5 === 0 ? tagName(t.date) : ""}</span>)}
      </div>
    </div>
  );
}

export function Nutzung() {
  return <><Grenzen /><Verbrauch /></>;
}

// ---------------------------------------------------------------- Arbeitsumgebung

const SCHLAF = [5, 10, 15, 30, 60];

export function Arbeitsumgebung() {
  const profil = useDaten(() => profilLesen().then((r) => r.profile));
  const programme = useProgramme(undefined, { frisch: true, konto: true });
  const dunkel = useDunkel();
  const [offen, setOffen] = useState<string | null>(null);
  const kartenId = useId();
  const [fehler, setFehler] = useState<string | null>(null);
  const aendern = (p: Partial<Profil>) => {
    const alt = profil.daten;
    if (alt) profil.setDaten({ ...alt, ...p });
    profilSchreiben(p)
      .then(() => profilNebenwirkungen(p, alt))
      .catch((e) => { profil.setDaten(alt); setFehler(fehlerText(e)); });
  };
  const p = profil.daten;
  return (
    <>
      <Fehlerband text={fehler ?? profil.fehler ?? programme.fehler} onWeg={() => setFehler(null)} />
      <Abschnitt titel="Programs" anker="programs">
        <div className="grid gap-2.5">
          {programme.liste.map((cli) => {
            const eintrag = ANBIETER.find((anbieter) => anbieter.id === cli.id) ?? { id: cli.id, name: cli.label, marke: cli.id };
            const lokal = programme.lokal[cli.id];
            const aktiv = offen === cli.id;
            const detailsId = `${kartenId}-${cli.id}`;
            const vorgang = vorgangVon(cli, lokal);
            const trennt = cli.busy === "disconnect" || lokal?.aktion === "disconnect";
            const verbunden = cli.state === "bereit" && !vorgang && !trennt;
            const status = trennt ? "Disconnecting …" : vorgang === "install" ? "Installing …" : vorgang === "login" ? "Signing in …"
              : verbunden ? `Connected${cli.version ? ` · Version ${cli.version}` : ""}`
                : cli.state === "abgemeldet" ? "Signed out" : cli.state === "fehlt" ? "Not installed" : "Check status";
            return (
              <div key={cli.id} className="overflow-hidden rounded-o-card border border-solid border-o-card-border bg-o-raised">
                <button type="button" aria-expanded={aktiv} aria-controls={detailsId}
                  onClick={() => setOffen(aktiv ? null : cli.id)}
                  className="orbit-ui group flex min-h-[72px] w-full items-center gap-3 px-4 py-3 text-left cursor-default outline-none transition-colors hover:bg-o-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-o-focus">
                  <span className={cx("flex size-9 shrink-0 items-center justify-center", eintrag.id === "cursor" && dunkel && "[&_svg]:invert")}>
                    <Logo marke={eintrag.marke} groesse={28} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[14px] font-medium leading-5 text-o-text">{eintrag.name}</span>
                    <span className="text-[13px] leading-[18px] text-o-text-2">{status}</span>
                  </span>
                  {verbunden ? (
                    <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-o-btn-primary text-o-on-primary">
                      <Symbol name="check" groesse={12} />
                    </span>
                  ) : null}
                  <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-full bg-o-surface text-o-text-2 transition-colors group-hover:bg-o-selected", aktiv && "bg-o-selected text-o-text")}>
                    <Symbol name="chevr" groesse={14} className={cx("transition-transform motion-reduce:transition-none", aktiv && "rotate-90")} />
                  </span>
                </button>
                <div id={detailsId} aria-hidden={!aktiv} inert={!aktiv}
                  className={cx("grid transition-[grid-template-rows,opacity] duration-[var(--orbit-dur)] ease-[var(--orbit-ease-out)] motion-reduce:transition-none",
                    aktiv ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                  <div className="min-h-0 overflow-hidden">
                    <div className="mx-3 mb-3 rounded-o-control bg-o-surface pt-4">
                      <ProgrammKarte key={aktiv || vorgang === "login" ? "offen" : "zu"} eintrag={eintrag} cli={cli} lokal={lokal} steuerung={programme} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {!programme.geladen ? <Ladeanzeige text="Checking programs …" className="px-4 py-3" /> : null}
        </div>
      </Abschnitt>
      <DiensteEinstellungen />
      {p ? (
        <>
          <Abschnitt titel="Computer" anker="computer">
            <Karte>
              <SchalterZeile symbol="desktop" titel="Computer in the cloud" beschreibung="For long tasks while your Mac sleeps" an={p.cloud} onChange={(v) => aendern({ cloud: v })} />
              <Zeile symbol="moon" titel="Sleep after" hoehe={54}>
                <PillenAuswahl label="Sleep after" wert={String(p.sleepMinutes)} onChange={(v) => aendern({ sleepMinutes: Number(v) })}
                  optionen={[...new Set([...SCHLAF, p.sleepMinutes])].sort((a, b) => a - b).map((m) => ({ wert: String(m), text: m === 60 ? "1 hour" : `${m} minutes` }))} />
              </Zeile>
            </Karte>
          </Abschnitt>
          <Abschnitt titel="Default model" anker="default-model">
            <Karte>
              <Zeile symbol="sparkle" titel="For all chats" beschreibung="Applies in chat unless you choose something else" hoehe={64}>
                <Modellwahl className="max-w-48" />
              </Zeile>
            </Karte>
          </Abschnitt>
        </>
      ) : profil.laedt ? <Laedt /> : null}
    </>
  );
}

// ---------------------------------------------------------------- Sicherheit

const RECHT_SYMBOL: Record<string, string> = {
  accessibility: "desktop", screen: "image", full_disk: "folder", automation_calendar: "kalender", automation_reminders: "check",
  automation_contacts: "user", automation_notes: "notiz", automation_system_events: "cmd", automation_safari: "globe", automation_finder: "folder",
};
const RECHT_NAME: Record<string, string> = {
  accessibility: "Control apps", screen: "See the screen", full_disk: "Files", automation_calendar: "Calendar", automation_reminders: "Reminders",
  automation_contacts: "Contacts", automation_notes: "Notes", automation_system_events: "Keyboard and apps", automation_safari: "Safari", automation_finder: "Finder",
};
const AKTION_NAME: Record<string, string> = {
  calendar_write: "Add calendar events", brain_write: "Change files in the Brain", mail_draft: "Save emails as drafts", mail_send: "Send emails",
  file_delete: "Delete files", mac_shell: "Run commands on the Mac",
};

export function Sicherheit() {
  const bots = useOrbit((s) => s.bots);
  const regeln = useDaten(() => getRules().then((r) => r.rules));
  const mac = useDaten(() => macZugriff());
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  // Reihenfolge wie in Figma 07 Sicherheit: Apps, Bildschirm, Kontakte, Dateien, danach die übrigen Rechte.
  const FOLGE = ["accessibility", "screen", "automation_contacts", "full_disk"];
  const rang = (id: string) => { const i = FOLGE.indexOf(id); return i < 0 ? FOLGE.length : i; };
  const rechte = [...(mac.daten?.permissions ?? [])].sort((a, b) => rang(a.id) - rang(b.id));

  const entfernen = (id: string) => deleteRule(id).then(() => regeln.neu()).catch((e) => setFehler(fehlerText(e)));
  const anfragen = async (id: string) => {
    setFehler(null);
    setLaeuft(id);
    try {
      if (!mac.daten?.enabled) await macSchalter(true);
      const r = await macAnfrage(id);
      if (r.permission && r.permission.status !== "granted" && r.permission.detail) setFehler(r.permission.detail);
      await mac.neu();
    } catch (e) { setFehler(fehlerText(e)); } finally { setLaeuft(null); }
  };
  const schalter = (an: boolean) => {
    if (mac.daten) mac.setDaten({ ...mac.daten, enabled: an });
    macSchalter(an).catch((e) => { setFehler(fehlerText(e)); void mac.neu(); });
  };
  return (
    <>
      <Fehlerband text={fehler ?? regeln.fehler ?? mac.fehler} onWeg={() => setFehler(null)} />
      <div className="flex items-start gap-3 rounded-[16px] bg-[var(--o-hinweis)] px-4 py-3.5">
        <span className="mt-0.5 text-o-text-2"><Symbol name="lock" /></span>
        <p className="text-[14px] leading-5 text-o-text">Orbit always asks before deleting, sending in your name and paying. This cannot be turned off.</p>
      </div>
      <Abschnitt titel="Always allowed" anker="rules">
        <Karte>
          {(regeln.daten ?? []).map((r) => {
            const bot = bots.find((b) => b.id === r.botId);
            return (
              <Zeile key={r.id} hoehe={64} titel={AKTION_NAME[r.tool] ?? r.tool} beschreibung={r.botId ? r.botName ?? bot?.name ?? "An Orbi" : "All Orbis"}
                vorn={bot ? <OrbiKlein avatar={bot.avatar} color={bot.color} groesse={24} /> : <span className="flex h-6 w-6 items-center justify-center text-o-text-2"><Symbol name="shield" /></span>}>
                <Knopf art="still" onClick={() => void entfernen(r.id)}>Remove</Knopf>
              </Zeile>
            );
          })}
          {regeln.daten && !regeln.daten.length ? <Zeile titel="Nothing is permanently allowed yet" beschreibung="When you choose “Always” on a question, it appears here." symbol="shield" /> : null}
          {!regeln.daten && regeln.laedt ? <Ladeanzeige className="px-4 py-3" /> : null}
        </Karte>
      </Abschnitt>
      <Abschnitt titel="Mac access" anker="mac-access">
        <Karte>
          <SchalterZeile symbol="desktop" titel="Orbis may control apps on the Mac" beschreibung="When off, no Mac tools run" an={!!mac.daten?.enabled} onChange={schalter} aus={!mac.daten} />
          {rechte.map((r) => (
            <Rechtzeile key={r.id} symbol={(RECHT_SYMBOL[r.id] ?? "shield") as never} name={RECHT_NAME[r.id] ?? r.label} erlaubt={r.status === "granted"} detail={r.detail}
              beschaeftigt={laeuft === r.id} onClick={() => { if (r.status !== "granted") void anfragen(r.id); }} />
          ))}
        </Karte>
        <p className="text-[13px] leading-[18px] text-o-text-2">You revoke permissions in System Settings under Privacy &amp; Security.</p>
      </Abschnitt>
    </>
  );
}

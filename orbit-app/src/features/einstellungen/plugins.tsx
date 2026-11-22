import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Knopf, Symbol } from "../../ui";
import type { McpServer } from "../../lib/types";
import { addMcpServer, connectPlugin, deleteMcpServer, deletePluginAccounts, getMcpServers, getPluginAccounts, getPluginSetup, getPluginStatus, getPlugins, testMcpServer } from "../../lib/api";
import { useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import { fehlerText } from "../onboarding/dunkel";
import { openUrl, pluginAktionen, pluginEntry, pluginOrbis, pluginOrbisSetzen } from "../onboarding/dienst";
import {
  Abschnitt, Bestaetigen, Dialog, DialogFuss, Fehlerband, Filter, Karte, Laedt, LogoFlaeche, OrbiKlein, Pillen, Status, Zeile,
} from "./bausteine";
import { Schalter } from "../../ui";
import { useDaten, useEinst } from "./store";
import { EinrichtenKarte, KatalogAbschnitte, SetupDialog, anmeldeAdresse, brauchtEigeneApp, getSkills } from "./marktplatz";

const geheZuPlugin = (slug?: string) => useNav.getState().go({ kind: "einstellungen", page: "plugins", pluginId: slug });

// ---------------------------------------------------------------- Verbinden (Browser-Anmeldung) und Rückkehr

/** Startet die Anmeldung im Browser und merkt sich das Konto, damit die Rückkehr genau dieses Konto zeigt. */
export async function verbinden(slug: string, weiteres = false): Promise<string | null> {
  const r = await connectPlugin(slug, weiteres ? true : undefined);
  const url = anmeldeAdresse(r);
  useEinst.getState().set({ liste: null });
  if (url) {
    void openUrl(url);
    if (r.accountId) useEinst.getState().set({ ausstehend: { slug, accountId: r.accountId, seit: Date.now() } });
    return null;
  }
  return r?.connectionStatus === "connected" ? "The plugin is already connected." : null;
}

/**
 * Wartet nach der Browser-Anmeldung: beim Zurückkehren (Fokus, Fenster-Ereignis `orbit:auth-callback`, abgeholte Rückkehr der Hülle)
 * und alle 3 Sekunden fragt es genau dieses Konto ab. Die Rückkehr-Adresse selbst wird nie ausgewertet, nur der Status neu geladen.
 */
export function useRueckkehr(beiFertig?: () => void) {
  const aus = useEinst((s) => s.ausstehend);
  useEffect(() => {
    if (!aus) return;
    let weg = false;
    const unlisten: (() => void)[] = [];
    const pruefen = () => {
      if (Date.now() - aus.seit > 10 * 60_000) { useEinst.getState().set({ ausstehend: null }); return; }
      getPluginStatus(aus.slug, aus.accountId).then((r) => {
        if (weg || r?.connectionStatus !== "connected") return;
        useEinst.getState().set({ ausstehend: null, hervor: aus.accountId, liste: null });
        geheZuPlugin(aus.slug);
        beiFertig?.();
      }).catch(() => { /* noch nicht fertig */ });
    };
    const abholenUndPruefen = () => {
      Promise.resolve().then(() => invoke("take_pending_auth_callback")).catch(() => null).then(() => { if (!weg) pruefen(); });
    };
    const t = setInterval(pruefen, 3000);
    window.addEventListener("focus", abholenUndPruefen);
    window.addEventListener("orbit:auth-callback", abholenUndPruefen);
    document.addEventListener("visibilitychange", pruefen);
    try {
      void Promise.resolve(listen("orbit:auth-callback", abholenUndPruefen)).then((u) => { if (typeof u !== "function") return; if (weg) u(); else unlisten.push(u); }).catch(() => { /* ohne Hülle (Vorschau, Tests) */ });
    } catch { /* ohne Hülle */ }
    abholenUndPruefen();
    return () => {
      weg = true; clearInterval(t);
      window.removeEventListener("focus", abholenUndPruefen); window.removeEventListener("orbit:auth-callback", abholenUndPruefen); document.removeEventListener("visibilitychange", pruefen);
      unlisten.forEach((u) => { try { u(); } catch { /* egal */ } });
    };
  }, [aus, beiFertig]);
}

/** Zeigt, dass die Anmeldung im Browser noch offen ist, und lässt sie abbrechen. */
function WarteHinweis({ slug }: { slug?: string }) {
  const aus = useEinst((s) => s.ausstehend);
  if (!aus || (slug && aus.slug !== slug)) return null;
  return (
    <div role="status" className="flex items-center gap-3 rounded-[16px] border border-solid border-o-card-border bg-o-raised px-4 py-3 text-[14px] leading-5 text-o-text-2">
      <span className="flex-1">Waiting for sign-in in the browser. Orbit continues here automatically.</span>
      <Knopf art="still" groesse="klein" onClick={() => useEinst.getState().set({ ausstehend: null })}>Cancel</Knopf>
    </div>
  );
}

// ---------------------------------------------------------------- Liste

const verbunden = (e: any) => e?.connectionStatus === "connected";

export function PluginListe() {
  const st = useEinst();
  const { suche, tab, kategorie } = st;
  const [suchtext, setSuchtext] = useState(suche);
  const schluessel = `${suche}|${tab}|${kategorie}`;
  const stand = useEinst.getState().liste?.schluessel === schluessel ? useEinst.getState().liste : null;
  const [eintraege, setEintraege] = useState<any[]>(stand?.eintraege ?? []);
  const [vorschlaege, setVorschlaege] = useState<any[]>([]);
  const [kategorien, setKategorien] = useState<string[]>(stand?.kategorien ?? []);
  const [weiter, setWeiter] = useState<string | null>(stand?.weiter ?? null);
  const [konfiguriert, setKonfiguriert] = useState(stand?.konfiguriert ?? true);
  const [laedt, setLaedt] = useState(!stand);
  const [fehler, setFehler] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [aktiv, setAktiv] = useState<string | null>(null);
  const [eigene, setEigene] = useState<{ slug: string; name: string } | null>(null);
  const [vorgabe, setVorgabe] = useState<{ name: string; ziel: string } | null>(null);
  const server = useDaten(() => getMcpServers().then((r) => r.servers));
  const skills = useDaten(() => getSkills().then((r) => r.skills));
  const geladen = useRef(stand);

  const laden = useCallback((cursor?: string) => {
    setLaedt(true);
    return getPlugins({ limit: 50, cursor, search: suche || undefined, category: kategorie !== "alle" ? kategorie : undefined, connected: tab === "verbunden" ? true : undefined })
      .then((r) => {
        setKonfiguriert(!!r.configured);
        setEintraege((alt) => (cursor ? [...alt, ...(r.entries ?? [])] : r.entries ?? []));
        setWeiter(r.nextCursor ?? null);
        if (!cursor && r.categories?.length) setKategorien(r.categories.map((c: any) => (typeof c === "string" ? c : c.name ?? c.id)).filter(Boolean));
        setFehler(null);
      })
      .catch((e) => setFehler(fehlerText(e)))
      .finally(() => setLaedt(false));
  }, [suche, kategorie, tab]);
  useEffect(() => {
    if (geladen.current) { geladen.current = null; return; } // Rückkehr aus dem Detail: gemerkte Liste behalten
    void laden();
  }, [laden]);
  useEffect(() => {
    if (!laedt && !fehler) useEinst.getState().set({ liste: { schluessel, eintraege, kategorien, weiter, konfiguriert } });
  }, [laedt, fehler, schluessel, eintraege, kategorien, weiter, konfiguriert]);
  useEffect(() => {
    if (tab !== "alle" || suche || kategorie !== "alle") { setVorschlaege([]); return; }
    getPlugins({ limit: 3, category: "recommended" }).then((r) => setVorschlaege((r.entries ?? []).filter((e: any) => !verbunden(e)).slice(0, 3))).catch(() => setVorschlaege([]));
  }, [tab, suche, kategorie]);
  useEffect(() => { const t = setTimeout(() => st.set({ suche: suchtext }), 250); return () => clearTimeout(t); }, [suchtext]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zurück aus dem Detail: Fokus auf die Karte, die es geöffnet hat.
  useLayoutEffect(() => {
    const id = useEinst.getState().fokus;
    if (id && !laedt) document.querySelector<HTMLElement>(`[data-fokus="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }, [laedt]);

  useRueckkehr(() => void laden());
  const oeffnen = (slug: string) => { st.set({ fokus: slug }); geheZuPlugin(slug); };
  const klickVerbinden = (e: any) => {
    setAktiv(e.slug);
    verbinden(e.slug).then(() => void laden()).catch((x) => {
      const t = fehlerText(x);
      if (brauchtEigeneApp(t)) setEigene({ slug: e.slug, name: e.name });
      setFehler(`${e.name}: ${t}`);
    }).finally(() => setAktiv(null));
  };

  const zeile = (e: any, mitStatus = true) => (
    <Zeile key={e.slug} fokusId={e.slug} onClick={() => oeffnen(e.slug)} titel={e.name} beschreibung={e.description}
      vorn={<LogoFlaeche slug={e.slug} name={e.name} logoUrl={e.logoUrl} />}>
      {mitStatus ? (verbunden(e) ? <Status ok text="Connected" /> :
        <Knopf art="zweitrangig" groesse="klein" className="w-[90px]" disabled={aktiv === e.slug} onClick={(ev) => { ev.stopPropagation(); klickVerbinden(e); }}>{aktiv === e.slug ? "…" : "Connect"}</Knopf>) : <Symbol name="chevr" />}
    </Zeile>
  );

  const kategorieOptionen = [{ wert: "alle", text: "All" }, ...kategorien.map((k) => ({ wert: k, text: k }))];
  return (
    <>
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-[22px] leading-7 font-semibold text-o-text">Plugins</h1>
        <label className="flex h-[34px] w-[220px] items-center gap-2 rounded-full bg-o-field px-3 text-o-text-3 focus-within:outline-2 focus-within:outline-o-focus">
          <Symbol name="search" />
          <input aria-label="Search plugins" placeholder="Search" value={suchtext} onChange={(e) => setSuchtext(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[14px] leading-5 text-o-text outline-none placeholder:text-o-text-3" />
        </label>
        <button type="button" aria-label="Add your own server" onClick={() => setDialog(true)}
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-o-field text-o-text outline-none hover:bg-o-selected focus-visible:outline-2 focus-visible:outline-o-focus cursor-default"><Symbol name="plus" /></button>
      </div>
      <div><Pillen label="Filter plugins" wert={tab} breite={107} onChange={(t) => st.set({ tab: t })} optionen={[{ wert: "alle", text: "All" }, { wert: "verbunden", text: "Connected" }]} /></div>
      <Fehlerband text={fehler} onWeg={() => setFehler(null)} />
      <WarteHinweis />
      {!konfiguriert && !laedt ? <EinrichtenKarte onFertig={() => { useEinst.getState().set({ liste: null }); void laden(); }} /> : null}

      {tab === "alle" && vorschlaege.length ? (
        <Abschnitt titel="Suggestions for you">
          <div className="flex gap-2.5">
            {vorschlaege.map((e) => (
              <div key={e.slug} className="flex min-w-0 flex-1 flex-col gap-2.5 rounded-[16px] border border-solid border-o-card-border bg-o-raised p-4">
                <LogoFlaeche slug={e.slug} name={e.name} logoUrl={e.logoUrl} flaeche={40} logo={22} />
                <div className="flex min-w-0 flex-col gap-0.5"><span className="truncate text-[14px] leading-5 font-medium text-o-text">{e.name}</span><span className="truncate text-[13px] leading-[18px] text-o-text-2">{e.description}</span></div>
                <div><Knopf art="zweitrangig" groesse="klein" className="w-[90px]" onClick={() => klickVerbinden(e)} disabled={aktiv === e.slug}>Connect</Knopf></div>
              </div>
            ))}
          </div>
        </Abschnitt>
      ) : null}

      {tab === "alle" ? (
        <Abschnitt titel="All plugins">
          <Filter wert={kategorie} optionen={kategorieOptionen} onChange={(k) => st.set({ kategorie: k })} />
          {eintraege.length ? <Karte>{eintraege.map((e) => zeile(e))}</Karte> : laedt ? <Laedt /> : <p className="text-[14px] leading-5 text-o-text-2">No plugins found.</p>}
          {weiter ? <div><Knopf art="zweitrangig" onClick={() => void laden(weiter)} disabled={laedt}>Load more</Knopf></div> : null}
        </Abschnitt>
      ) : (
        <VerbundenListe eintraege={eintraege} laedt={laedt} zeile={zeile} server={server} />
      )}
      {tab === "alle" && kategorie === "alle" ? <KatalogAbschnitte suche={suche} skills={skills} /> : null}
      {dialog || vorgabe ? <ServerDialog vorgabe={vorgabe} onClose={() => { setDialog(false); setVorgabe(null); }} onFertig={() => void server.neu()} /> : null}
      {eigene ? <SetupDialog slug={eigene.slug} name={eigene.name} onClose={() => setEigene(null)} onFertig={() => void laden()} /> : null}
    </>
  );
}

function VerbundenListe({ eintraege, laedt, zeile, server }: { eintraege: any[]; laedt: boolean; zeile: (e: any, s?: boolean) => React.ReactNode; server: ReturnType<typeof useDaten<McpServer[]>> }) {
  const bots = useOrbit((s) => s.bots);
  const [nutzer, setNutzer] = useState<Record<string, string>>({});
  const slugs = eintraege.map((e) => e.slug).join(",");
  useEffect(() => {
    let weg = false;
    Promise.all(eintraege.map((e) => pluginOrbis(e.slug).then((r) => [e.slug, r.botIds] as const).catch(() => [e.slug, null] as const))).then((paare) => {
      if (weg) return;
      const m: Record<string, string> = {};
      for (const [slug, ids] of paare) {
        const namen = ids === null ? bots.map((b) => b.name) : bots.filter((b) => ids.includes(b.id)).map((b) => b.name);
        m[slug] = namen.length ? `Used by ${namen.length > 2 ? `${namen.slice(0, -1).join(", ")} and ${namen[namen.length - 1]}` : namen.join(" and ")}` : "Not used by any Orbi";
      }
      setNutzer(m);
    });
    return () => { weg = true; };
  }, [slugs, bots]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Abschnitt titel={`${eintraege.length} connected`}>
        {eintraege.length ? <Karte>{eintraege.map((e) => zeile({ ...e, description: nutzer[e.slug] ?? e.description }, false))}</Karte> : laedt ? <Laedt /> : <p className="text-[14px] leading-5 text-o-text-2">Nothing connected yet.</p>}
      </Abschnitt>
      {server.daten?.length ? (
        <Abschnitt titel="Your own servers">
          <Karte>
            {server.daten.map((s) => (
              <Zeile key={s.name} symbol="plug" titel={s.name} beschreibung={s.url ?? [s.command, ...s.args].join(" ")}>
                <Status ok={s.status === "verbunden"} text={s.status === "verbunden" ? `${s.tools.length} tools` : s.error ?? s.status} />
                <Knopf art="still" groesse="klein" onClick={() => testMcpServer(s.name).then(() => server.neu()).catch(() => server.neu())}>Test</Knopf>
                <Knopf art="still" groesse="klein" onClick={() => deleteMcpServer(s.name).then(() => server.neu())}>Remove</Knopf>
              </Zeile>
            ))}
          </Karte>
        </Abschnitt>
      ) : null}
      <p className="text-[13px] leading-[18px] text-o-text-2">Find more plugins under “All”.</p>
    </>
  );
}

function ServerDialog({ onClose, vorgabe, onFertig }: { onClose: () => void; vorgabe?: { name: string; ziel: string } | null; onFertig?: () => void }) {
  const [name, setName] = useState(vorgabe?.name ?? "");
  const [ziel, setZiel] = useState(vorgabe?.ziel ?? "");
  const [token, setToken] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const http = /^https?:\/\//i.test(ziel.trim());
  const hinzu = () => {
    const t = ziel.trim();
    const teile = t.split(/\s+/).filter(Boolean);
    setFehler(null);
    setLaeuft(true);
    addMcpServer(http ? { name: name.trim(), transport: "http", url: t, ...(token.trim() ? { token: token.trim() } : {}) } : { name: name.trim(), transport: "stdio", command: teile[0] ?? "", args: teile.slice(1) })
      .then(() => { setToken(""); onFertig?.(); onClose(); }).catch((e) => setFehler(fehlerText(e))).finally(() => setLaeuft(false));
  };
  const feld = "orbit-ui h-8 w-full rounded-o-control bg-o-field px-3 text-[14px] leading-5 text-o-text outline-none placeholder:text-o-text-3 focus-visible:outline-2 focus-visible:outline-o-focus";
  return (
    <Dialog titel="Add your own server" onClose={onClose}>
      <p className="text-[14px] leading-5 text-o-text-2">Any MCP server can be connected, locally as a command or through an address.</p>
      <label className="flex flex-col gap-1.5 text-[14px] leading-5 font-medium text-o-text">Name<input className={feld} value={name} onChange={(e) => setName(e.target.value)} placeholder="My server" /></label>
      <label className="flex flex-col gap-1.5 text-[14px] leading-5 font-medium text-o-text">Command or address<input className={feld} value={ziel} onChange={(e) => setZiel(e.target.value)} placeholder="npx my-server or https://…" /></label>
      {http ? <label className="flex flex-col gap-1.5 text-[14px] leading-5 font-medium text-o-text">Access key (if needed)<input type="password" autoComplete="off" className={feld} value={token} onChange={(e) => setToken(e.target.value)} /></label> : null}
      {fehler ? <p role="alert" className="text-[13px] leading-[18px] text-o-danger">{fehler}</p> : null}
      <DialogFuss>
        <Knopf art="still" onClick={onClose}>Cancel</Knopf>
        <Knopf art="primaer" onClick={hinzu} disabled={laeuft}>Add</Knopf>
      </DialogFuss>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Detail

const STATUS_TEXT: Record<string, string> = { ACTIVE: "Active", INITIALIZING: "Setting up", INITIATED: "Sign-in pending", EXPIRED: "Expired", FAILED: "Failed", DISABLED: "Turned off", INACTIVE: "Inactive" };
const WERKZEUG_STATUS: Record<string, string> = { not_checked: "Not checked yet", ready: "Ready", error: "Error" };
const ZUGRIFF: Record<string, string> = { individual_actions: "Individual actions" };

/** Symbol je Aktion wie in Figma 07 Gmail: suchen, lesen, auflisten, schreiben, sonst ändern. */
function aktionsSymbol(slug: string, a: { id?: string; label?: string; readOnly?: boolean }): string {
  const n = `${a.id ?? ""} ${a.label ?? ""}`.toLowerCase();
  if (/search|such/.test(n)) return "search";
  if (/(^|[\s_])(get|read|fetch)([\s_]|$)|lesen/.test(n)) return /mail|gmail|outlook/.test(slug) ? "mail" : "file";
  if (/(^|[\s_])list([\s_]|$)|anzeigen|auflisten/.test(n)) return "folder";
  if (/create|draft|write|compose|send|post|add|insert|schreiben|anlegen/.test(n)) return "pencil";
  return a.readOnly ? "search" : "wrench";
}

export function PluginDetail({ slug }: { slug: string }) {
  const bots = useOrbit((s) => s.bots);
  const hervor = useEinst((s) => s.hervor);
  const eintrag = useDaten(() => pluginEntry(slug).then((r) => r.entry), [slug]);
  const konten = useDaten(() => getPluginAccounts(slug).then((r) => r.accounts), [slug]);
  const status = useDaten(() => getPluginStatus(slug), [slug]);
  const aktionen = useDaten(() => pluginAktionen(slug).then((r) => r.actions), [slug]);
  const orbis = useDaten(() => pluginOrbis(slug).then((r) => r.botIds), [slug]);
  const einr = useDaten(() => getPluginSetup(slug), [slug]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [trennen, setTrennen] = useState<string[] | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const neuLaden = useCallback(() => { void eintrag.neu(); void konten.neu(); void status.neu(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useRueckkehr(neuLaden);

  const e = eintrag.daten;
  const kontenListe = konten.daten ?? [];
  const aktive = kontenListe.filter((k) => k.status === "ACTIVE");
  const ok = verbunden(e) || aktive.length > 0;

  const [eigene, setEigene] = useState(false);
  const verbindeEins = (weiteres: boolean) => {
    setFehler(null);
    verbinden(slug, weiteres).then((t) => t && setHinweis(t)).catch((x) => { const t = fehlerText(x); if (brauchtEigeneApp(t)) setEigene(true); setFehler(t); });
  };
  const trenneWirklich = () => {
    if (!trennen) return;
    setLaeuft(true);
    deletePluginAccounts(slug, trennen).then((r) => { useEinst.getState().set({ liste: null }); setHinweis(r.notice || null); setTrennen(null); neuLaden(); })
      .catch((x) => setFehler(fehlerText(x))).finally(() => setLaeuft(false));
  };
  const botAn = (id: string) => orbis.daten === null || orbis.daten === undefined || orbis.daten.includes(id);
  const botSchalten = (id: string, an: boolean) => {
    const alle = bots.map((b) => b.id);
    const jetzt = orbis.daten ?? alle;
    const neu = an ? Array.from(new Set([...jetzt, id])) : jetzt.filter((x) => x !== id);
    orbis.setDaten(neu);
    pluginOrbisSetzen(slug, neu.length === alle.length && alle.every((x) => neu.includes(x)) ? null : neu).catch((x) => { setFehler(fehlerText(x)); void orbis.neu(); });
  };

  if (!e && eintrag.laedt) return <Laedt />;
  const name = e?.name ?? slug;
  return (
    <>
      <button type="button" onClick={() => geheZuPlugin()} className="orbit-ui flex w-fit items-center gap-1.5 rounded-o-sm py-0.5 text-[14px] leading-5 text-o-text-2 outline-none hover:text-o-text focus-visible:outline-2 focus-visible:outline-o-focus cursor-default">
        <Symbol name="chevl" />Plugins
      </button>
      <Fehlerband text={fehler ?? eintrag.fehler} onWeg={() => setFehler(null)} />
      <div className="flex items-center gap-3.5">
        <LogoFlaeche slug={slug} name={name} logoUrl={e?.logoUrl} flaeche={56} logo={32} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-[22px] leading-7 font-semibold text-o-text">{name}</h1>
          <Status ok={ok} text={ok ? (aktive.length > 1 ? `Connected with ${aktive.length} accounts` : "Connected") : "Not connected"} />
        </div>
        {ok ? <Knopf art="zweitrangig" onClick={() => setTrennen(aktive.map((k) => k.id))} disabled={!aktive.length}>Disconnect</Knopf> : <Knopf art="primaer" onClick={() => verbindeEins(false)}>Connect</Knopf>}
      </div>
      {e?.description ? <p className="text-[15px] leading-[22px] text-o-text-2">{e.description}</p> : null}
      {hinweis ? <p className="text-[13px] leading-[18px] text-o-text-2" role="status">{hinweis}</p> : null}
      <WarteHinweis slug={slug} />

      <Abschnitt titel="Accounts">
        <Karte>
          {kontenListe.length ? kontenListe.map((k, i) => (
            <Zeile key={k.id} titel={`Account ${i + 1}`} beschreibung={k.id === hervor ? "Just connected" : STATUS_TEXT[k.status] ?? k.status}
              symbol="user">
              <Status ok={k.status === "ACTIVE"} text={STATUS_TEXT[k.status] ?? k.status} />
              <Knopf art="still" groesse="klein" onClick={() => setTrennen([k.id])}>Disconnect</Knopf>
            </Zeile>
          )) : <Zeile titel="No account connected yet" beschreibung="When connecting, you sign in in the browser." symbol="user" />}
          <Zeile titel="Connect another account" symbol="plus" onClick={() => verbindeEins(true)} />
        </Karte>
      </Abschnitt>

      <Abschnitt titel="Setup">
        <Karte>
          <Zeile titel="Tool status" beschreibung={`${WERKZEUG_STATUS[status.daten?.toolsStatus] ?? "Unknown"} · ${ZUGRIFF[status.daten?.accessMode] ?? status.daten?.accessMode ?? "–"}`} symbol="wrench">
            <Status ok={status.daten?.connectionStatus === "connected"} text={status.daten?.connectionStatus === "connected" ? "Connected" : "Open"} />
          </Zeile>
          {einr.daten?.notice ? <Zeile titel="Note from the service" beschreibung={einr.daten.notice} symbol="info" /> : null}
          {einr.daten?.schemes?.length ? <Zeile titel="Set up your own app" beschreibung="When the provider requires its own app" symbol="gear" onClick={() => setEigene(true)}><Symbol name="chevr" /></Zeile> : null}
          {einr.daten?.guideUrl ? <Zeile titel="Provider guide" symbol="book" onClick={() => void openUrl(einr.daten.guideUrl)}><Symbol name="chevr" /></Zeile> : null}
        </Karte>
      </Abschnitt>

      <Abschnitt titel="Tools · what Orbis may do without asking">
        <Karte>
          {(aktionen.daten ?? []).map((a) => (
            <Zeile key={a.id} symbol={aktionsSymbol(slug, a)} titel={a.label} beschreibung={a.description} hoehe={64}>
              <span className="flex h-[30px] items-center gap-2 rounded-full bg-o-field pl-2.5 pr-1.5 text-[14px] leading-5 text-o-text">{a.readOnly ? "Allowed" : "Always ask"}<Symbol name="chevd" /></span>
            </Zeile>
          ))}
          {!aktionen.daten?.length ? <Zeile titel={aktionen.laedt ? <Laedt text="Loading tools …" /> : aktionen.fehler ?? "No tools reported"} symbol="wrench" /> : null}
        </Karte>
        <p className="text-[13px] leading-[18px] text-o-text-2">Orbit decides by risk: reading is allowed, writing and sending ask first.</p>
      </Abschnitt>

      <Abschnitt titel="Which Orbis">
        <Karte>
          {bots.map((b) => (
            <Zeile key={b.id} vorn={<OrbiKlein avatar={b.avatar} color={b.color} />} titel={b.name} beschreibung={b.job} hoehe={64}>
              <Schalter checked={botAn(b.id)} onChange={(v) => botSchalten(b.id, v)} aria-label={`${b.name} may use ${name}`} />
            </Zeile>
          ))}
          {!bots.length ? <Zeile titel="No Orbi yet" /> : null}
        </Karte>
      </Abschnitt>
      {eigene ? <SetupDialog slug={slug} name={name} onClose={() => setEigene(false)} onFertig={neuLaden} /> : null}
      {trennen ? (
        <Bestaetigen titel={`Disconnect ${name}?`} ja="Disconnect" laeuft={laeuft} onNein={() => setTrennen(null)} onJa={trenneWirklich}
          text={trennen.length > 1 ? "All connected accounts are disconnected. Revoke permissions at the provider yourself." : "This account is disconnected. Revoke permissions at the provider yourself."} />
      ) : null}
    </>
  );
}

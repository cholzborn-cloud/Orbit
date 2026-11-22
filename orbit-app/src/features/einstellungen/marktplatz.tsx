import { useState } from "react";
import { Knopf } from "../../ui";
import { apiRequest } from "../../lib/tauri";
import { getPluginSetup, postPluginSetup, reloadPlugins, verifyPlugins } from "../../lib/api";
import type { MarktplatzEintrag } from "../../lib/types";
import { fehlerText } from "../onboarding/dunkel";
import { openUrl } from "../onboarding/dienst";
import { Abschnitt, Dialog, DialogFuss, Karte, Laedt, PillenAuswahl, Status, Zeile } from "./bausteine";
import { useDaten, useEinst } from "./store";

// Einrichten von Composio (Projektschlüssel prüfen), Einrichten eigener Apps und der Katalog aus /v1/marketplace (MCP-Server und Skills).

const feld = "orbit-ui h-9 w-full rounded-o-control bg-o-field px-3 text-[14px] leading-5 text-o-text outline-none placeholder:text-o-text-3 focus-visible:outline-2 focus-visible:outline-o-focus";

/** Der Dienst meldet „Dieser Dienst braucht eine eigene App beim Anbieter …“, wenn die verwaltete Anmeldung fehlt. */
export const brauchtEigeneApp = (text: string) => /eigene app/i.test(text);

/** Anmelde-Adresse aus der Antwort von connect/setup (Feinform unbelegt, daher mehrere Namen). */
export const anmeldeAdresse = (r: any): string | null => {
  const u = r?.url ?? r?.redirectUrl ?? r?.redirect_url ?? r?.connectUrl;
  return typeof u === "string" && /^https:\/\//i.test(u) ? u : null;
};

// ---------------------------------------------------------------- Composio einrichten

export function EinrichtenKarte({ onFertig }: { onFertig: () => void }) {
  const [schluessel, setSchluessel] = useState("");
  const [kennung, setKennung] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const pruefen = () => {
    if (laeuft || !schluessel.trim() || !kennung.trim()) return;
    setFehler(null);
    setLaeuft(true);
    verifyPlugins(schluessel.trim(), kennung.trim())
      .then(() => reloadPlugins().catch(() => null))
      .then(() => { setSchluessel(""); onFertig(); })
      .catch((e) => setFehler(fehlerText(e)))
      .finally(() => setLaeuft(false));
  };
  return (
    <Abschnitt titel="Set up plugins">
      <form className="flex flex-col gap-3.5 rounded-[16px] border border-solid border-o-card-border bg-o-raised p-4" onSubmit={(e) => { e.preventDefault(); pruefen(); }}>
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] leading-5 font-medium text-o-text">Composio is not set up yet</span>
          <span className="text-[13px] leading-[18px] text-o-text-2">For plugins the service needs a project key and a user ID. Orbit checks both before using them.</span>
        </div>
        <label className="flex flex-col gap-1.5 text-[14px] leading-5 font-medium text-o-text">Project key
          <input type="password" autoComplete="off" spellCheck={false} maxLength={4096} className={feld} value={schluessel} onChange={(e) => setSchluessel(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-[14px] leading-5 font-medium text-o-text">User ID
          <input autoComplete="off" spellCheck={false} className={feld} value={kennung} onChange={(e) => setKennung(e.target.value)} placeholder="A unique ID for you" />
        </label>
        {fehler ? <p role="alert" className="text-[13px] leading-[18px] text-o-danger">{fehler}</p> : null}
        <div><Knopf art="primaer" type="submit" disabled={laeuft || !schluessel.trim() || !kennung.trim()}>{laeuft ? "Checking …" : "Check and save"}</Knopf></div>
      </form>
    </Abschnitt>
  );
}

// ---------------------------------------------------------------- Eigene App einrichten

const schemeId = (s: any): string => (typeof s === "string" ? s : String(s?.scheme ?? s?.name ?? s?.id ?? s?.mode ?? ""));
const schemeFelder = (s: any): { name: string; label: string; geheim: boolean }[] | null =>
  Array.isArray(s?.fields) && s.fields.length
    ? s.fields.map((f: any) => { const name = String(f.name ?? f.id); return { name, label: String(f.displayName ?? f.label ?? name), geheim: /secret|key|token|password/i.test(name) }; })
    : null;
const STANDARD_FELDER = [{ name: "client_id", label: "Client-ID", geheim: false }, { name: "client_secret", label: "Client secret", geheim: true }];

export function SetupDialog({ slug, name, onClose, onFertig }: { slug: string; name: string; onClose: () => void; onFertig?: () => void }) {
  const einr = useDaten(() => getPluginSetup(slug), [slug]);
  const [wahl, setWahl] = useState<string | null>(null);
  const [werte, setWerte] = useState<Record<string, string>>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const schemes: any[] = einr.daten?.schemes ?? [];
  const aktiv = schemes.find((s) => schemeId(s) === (wahl ?? schemeId(schemes[0])));
  const felder = schemeFelder(aktiv) ?? STANDARD_FELDER;
  const senden = () => {
    if (!aktiv) return;
    setFehler(null);
    setLaeuft(true);
    const fields: Record<string, string> = {};
    for (const f of felder) fields[f.name] = (werte[f.name] ?? "").trim();
    postPluginSetup(slug, schemeId(aktiv), fields)
      .then((r) => {
        const u = anmeldeAdresse(r);
        if (u) {
          void openUrl(u);
          if (r?.accountId) useEinst.getState().set({ ausstehend: { slug, accountId: r.accountId, seit: Date.now() } });
        }
        setWerte({});
        onFertig?.();
        onClose();
      })
      .catch((e) => setFehler(fehlerText(e)))
      .finally(() => setLaeuft(false));
  };
  return (
    <Dialog titel={`${name}: set up your own app`} onClose={onClose}>
      {einr.laedt && !einr.daten ? <Laedt /> : null}
      {einr.fehler ? <p role="alert" className="text-[13px] leading-[18px] text-o-danger">{einr.fehler}</p> : null}
      {einr.daten ? (
        <>
          <p className="text-[14px] leading-5 text-o-text-2">{einr.daten.notice || "This service needs its own app at the provider. Enter its credentials here."}</p>
          {einr.daten.oauthRedirectUrl ? <p className="text-[13px] leading-[18px] text-o-text-2">Redirect address at the provider: <span className="select-text break-all text-o-text">{einr.daten.oauthRedirectUrl}</span></p> : null}
          {einr.daten.guideUrl ? <div><Knopf art="still" groesse="klein" onClick={() => void openUrl(einr.daten.guideUrl)}>Provider guide</Knopf></div> : null}
          {schemes.length ? (
            <>
              {schemes.length > 1 ? <PillenAuswahl label="Sign-in method" wert={wahl ?? schemeId(schemes[0])} optionen={schemes.map((s) => ({ wert: schemeId(s), text: schemeId(s) }))} onChange={setWahl} /> : null}
              {felder.map((f) => (
                <label key={f.name} className="flex flex-col gap-1.5 text-[14px] leading-5 font-medium text-o-text">{f.label}
                  <input type={f.geheim ? "password" : "text"} autoComplete="off" spellCheck={false} className={feld} value={werte[f.name] ?? ""} onChange={(e) => setWerte((w) => ({ ...w, [f.name]: e.target.value }))} />
                </label>
              ))}
            </>
          ) : <p className="text-[14px] leading-5 text-o-text-2">This service has no sign-in method to set up.</p>}
        </>
      ) : null}
      {fehler ? <p role="alert" className="text-[13px] leading-[18px] text-o-danger">{fehler}</p> : null}
      <DialogFuss>
        <Knopf art="still" onClick={onClose}>Cancel</Knopf>
        <Knopf art="primaer" onClick={senden} disabled={laeuft || !aktiv || felder.some((f) => !(werte[f.name] ?? "").trim())}>{laeuft ? "…" : "Save and connect"}</Knopf>
      </DialogFuss>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Katalog (MCP und Skills)

export interface Skill { id: string; name: string; description: string }
export const getSkills = () => apiRequest<{ ok: boolean; skills: Skill[] }>("GET", "/v1/skills");
export const createSkill = (s: { name: string; description: string; body: string }) => apiRequest<{ ok: boolean; skill: Skill }>("POST", "/v1/skills", s);
export const getKatalog = () => apiRequest<{ ok: boolean; entries: MarktplatzEintrag[] }>("GET", "/v1/marketplace");

const risiko = (e: MarktplatzEintrag) => (e.risk === "write" ? "Can write" : "Read only");

export function KatalogAbschnitte({ suche, skills }: {
  suche: string;
  skills: { daten: Skill[] | null; neu: () => unknown };
}) {
  const katalog = useDaten(() => getKatalog().then((r) => r.entries ?? []), []);
  const [aktiv, setAktiv] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const s = suche.trim().toLowerCase();
  const passt = (e: MarktplatzEintrag) => !s || `${e.name} ${e.description}`.toLowerCase().includes(s);
  const faehigkeiten = (katalog.daten ?? []).filter((e) => e.type === "skill" && passt(e));
  if (katalog.fehler) return <Abschnitt titel="Skills"><p role="alert" className="text-[13px] leading-[18px] text-o-danger">{katalog.fehler}</p></Abschnitt>;
  if (!faehigkeiten.length) return null;

  const skillDa = (e: MarktplatzEintrag) => (skills.daten ?? []).some((x) => x.name === e.skillName);
  const skillHinzu = (e: MarktplatzEintrag) => {
    setAktiv(e.id);
    setFehler(null);
    createSkill({ name: String(e.skillName), description: String(e.skillDescription ?? e.description), body: String(e.skillBody ?? "") })
      .then(() => skills.neu()).catch((x) => setFehler(`${e.name}: ${fehlerText(x)}`)).finally(() => setAktiv(null));
  };
  return (
    <>
      {fehler ? <p role="alert" className="text-[13px] leading-[18px] text-o-danger">{fehler}</p> : null}
      <Abschnitt titel="Skills from the catalogue">
        <Karte>
          {faehigkeiten.map((e) => (
            <Zeile key={e.id} symbol="book" titel={e.name} beschreibung={`${e.description} · ${risiko(e)}`}>
              {skillDa(e) ? <Status ok text="Added" /> : <Knopf art="zweitrangig" groesse="klein" className="w-[90px]" disabled={aktiv === e.id} onClick={() => skillHinzu(e)}>{aktiv === e.id ? "…" : "Add"}</Knopf>}
            </Zeile>
          ))}
        </Karte>
      </Abschnitt>
    </>
  );
}

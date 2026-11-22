import { useEffect, useState } from "react";
import { Feld, Knopf, Symbol, cx } from "../../ui";
import { getDefaultInstructions, getHealthChecks, getSettings, setInstructions, setTheme } from "../../lib/api";
import { fehlerText } from "../onboarding/dunkel";
import {
  kontoStatus, profilLesen, profilSchreiben, type Profil,
} from "../onboarding/dienst";
import { Abschnitt, Eingabe, Fehlerband, Karte, Laedt, PillenAuswahl, Pillen, SchalterZeile, Status, Zeile, Bestaetigen } from "./bausteine";
import { useDaten, useEinst } from "./store";
import { accountChangePassword, accountStatus, accountUpdateProfile, type KontoInfo } from "../../lib/tauri";
import { useAuth } from "../../lib/auth";
import { bewegungAnwenden, profilNebenwirkungen } from "../../lib/einstellungen-wirken";

// ---------------------------------------------------------------- Design anwenden

export type Design = "light" | "dark" | "system";
/** Setzt data-theme am Wurzelelement (system = Systemeinstellung). Auch für die Hülle beim Start nutzbar. */
export function designAnwenden(t: Design) {
  if (typeof document === "undefined") return;
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

// ---------------------------------------------------------------- Allgemein

function useProfil() {
  const d = useDaten(() => profilLesen().then((r) => r.profile));
  const aendern = (p: Partial<Profil>) => {
    const alt = d.daten;
    if (alt) d.setDaten({ ...alt, ...p });
    if (p.reducedMotion !== undefined) bewegungAnwenden(p.reducedMotion);
    profilSchreiben(p)
      .then(() => profilNebenwirkungen(p, alt))
      .catch((e) => {
        d.setDaten(alt);
        if (alt?.reducedMotion !== undefined) bewegungAnwenden(alt.reducedMotion);
        d.setFehler(fehlerText(e));
      });
  };
  return { ...d, profil: d.daten, aendern };
}

export function Allgemein() {
  const { profil, aendern, fehler, setFehler, laedt } = useProfil();
  const konto = useDaten(() => kontoStatus());
  const [abmelden, setAbmelden] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [sb, setSb] = useState<KontoInfo | null>(null); // Supabase-Konto der Hülle
  const [nameEntwurf, setNameEntwurf] = useState("");
  const [passwortNeu, setPasswortNeu] = useState("");
  const [passwortGespeichert, setPasswortGespeichert] = useState(false);
  const [kontoBusy, setKontoBusy] = useState(false);
  useEffect(() => {
    accountStatus().then((k) => { setSb(k); setNameEntwurf(k.displayName || ""); }).catch(() => {});
  }, []);
  if (!profil) return <><Fehlerband text={fehler} />{laedt ? <Laedt /> : null}</>;
  const k = konto.daten;
  const mitClerk = k?.mode === "clerk";
  const sbAn = sb?.signedIn === true;
  const anmeldeart = sb?.signInMethod ? { email: "E-Mail", google: "Google", github: "GitHub" }[sb.signInMethod] : "Unbekannt";
  const mitKonto = mitClerk || sbAn || k?.mode === "supabase";
  const name = sb?.displayName || profil.name || "You";
  const speichernName = () => {
    if (kontoBusy || !nameEntwurf.trim()) return;
    setKontoBusy(true); setFehler(null);
    accountUpdateProfile(nameEntwurf.trim())
      .then((info) => { setSb(info); setNameEntwurf(info.displayName || nameEntwurf.trim()); })
      .catch((e) => setFehler(fehlerText(e)))
      .finally(() => setKontoBusy(false));
  };
  const speichernPasswort = () => {
    if (kontoBusy || passwortNeu.length < 6) return;
    setKontoBusy(true); setFehler(null);
    setPasswortGespeichert(false);
    accountChangePassword(passwortNeu)
      .then(() => { setPasswortNeu(""); setPasswortGespeichert(true); })
      .catch((e) => setFehler(fehlerText(e)))
      .finally(() => setKontoBusy(false));
  };
  return (
    <>
      <Fehlerband text={fehler} onWeg={() => setFehler(null)} />
      <Abschnitt titel="Orbit" anker="app">
        <Karte>
          <SchalterZeile titel="Keep working in the background" beschreibung="Orbis keep doing their tasks even when the window is closed" an={profil.backgroundWork} onChange={(v) => aendern({ backgroundWork: v })} />
          <SchalterZeile titel="Open at login" an={profil.loginOpen} onChange={(v) => aendern({ loginOpen: v })} />
          <Zeile titel="Language" hoehe={54}>
            <PillenAuswahl label="Language" wert="de" optionen={[{ wert: "de", text: "Deutsch" }]} onChange={() => {}} />
          </Zeile>
        </Karte>
      </Abschnitt>
      <Abschnitt titel="Notifications" anker="notifications">
        <Karte>
          <SchalterZeile titel="When an Orbi is done" an={profil.notificationsDone} onChange={(v) => aendern({ notificationsDone: v })} />
          <SchalterZeile titel="When an Orbi needs you" beschreibung="Approvals and questions" an={profil.notificationsApprovals}
            onChange={(v) => aendern({ notificationsApprovals: v, notificationsAttention: v })} />
          <SchalterZeile titel="Sound" an={profil.sound} onChange={(v) => aendern({ sound: v })} />
        </Karte>
      </Abschnitt>
      <Abschnitt titel="Account" anker="account">
        <Karte>
          <Zeile hoehe={64} titel={name} beschreibung={sb?.email || k?.email || (k?.mode === "local" ? "Local profile without an account" : "Not signed in")}
            vorn={<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-o-selected text-[12px] leading-4 text-o-text-2">{name.slice(0, 2).toUpperCase()}</span>}>
            {mitKonto ? <Knopf art="zweitrangig" onClick={() => setAbmelden(true)}>Sign out</Knopf> : null}
          </Zeile>
          {sbAn ? (
            <>
              <Zeile titel="Anmeldeart" hoehe={54}><span className="text-o-text-2">{anmeldeart}</span></Zeile>
              <Zeile titel="Display name" hoehe={54}>
                <div className="flex items-center gap-2">
                  <Eingabe label="Display name" wert={nameEntwurf} onChange={setNameEntwurf} onEnter={speichernName} breite={200} maxLength={120} />
                  <Knopf art="zweitrangig" disabled={kontoBusy || !nameEntwurf.trim()} onClick={speichernName}>Save</Knopf>
                </div>
              </Zeile>
              <details className="group">
                <summary className="flex cursor-default list-none items-center justify-between px-4 py-3 text-[14px] leading-5 text-o-text hover:bg-o-hover focus-visible:outline-o-focus [&::-webkit-details-marker]:hidden">
                  Change password
                  <Symbol name="chevr" groesse={14} className="text-o-text-2 group-open:rotate-90" />
                </summary>
                <form className="mx-3 mb-3 flex flex-col items-start gap-3 rounded-o-control bg-o-surface p-3"
                  onSubmit={(event) => { event.preventDefault(); speichernPasswort(); }}>
                  <Feld label="New password" type="password" autoComplete="new-password" value={passwortNeu}
                    onChange={(event) => { setPasswortNeu(event.target.value); setPasswortGespeichert(false); }} disabled={kontoBusy} />
                  <Knopf type="submit" art="zweitrangig" disabled={kontoBusy || passwortNeu.length < 6}>Update password</Knopf>
                  {passwortGespeichert ? <span role="status" className="text-[13px] text-o-text-2">Password updated</span> : null}
                </form>
              </details>
            </>
          ) : null}
        </Karte>
      </Abschnitt>
      {abmelden ? (
        <Bestaetigen titel="Sign out?" text="Orbit disconnects this profile from your account. Your Orbis and chats stay on this Mac. You need to sign in again to continue." ja="Sign out" laeuft={laeuft}
          onNein={() => setAbmelden(false)}
          onJa={() => {
            setLaeuft(true);
            useAuth.getState().abmelden()
              .then(() => { setAbmelden(false); setSb(null); void konto.neu(); })
              .catch((e) => setFehler(fehlerText(e)))
              .finally(() => setLaeuft(false));
          }} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- Darstellung

export function Darstellung() {
  const { profil, aendern, fehler, setFehler, laedt } = useProfil();
  const einst = useDaten(() => getSettings().then((r) => r.settings));
  useEffect(() => {
    if (einst.daten) designAnwenden(einst.daten.theme);
  }, [einst.daten]);

  const theme = einst.daten?.theme ?? "system";
  const waehleDesign = (t: Design) => {
    designAnwenden(t);
    if (einst.daten) einst.setDaten({ ...einst.daten, theme: t });
    setTheme(t).catch((e) => { setFehler(fehlerText(e)); if (einst.daten) designAnwenden(einst.daten.theme); });
  };

  if (!profil || !einst.daten) return <><Fehlerband text={fehler ?? einst.fehler} />{laedt || einst.laedt ? <Laedt /> : null}</>;
  return (
    <>
      <Fehlerband text={fehler ?? einst.fehler} onWeg={() => setFehler(null)} />
      <Abschnitt titel="Look" anker="look">
        <Karte>
          <Zeile titel="Theme" hoehe={58}>
            <Pillen label="Theme" wert={theme} onChange={waehleDesign} breite={78}
              optionen={[{ wert: "light", text: "Light" }, { wert: "dark", text: "Dark" }, { wert: "system", text: "System" }]} />
          </Zeile>
          <Zeile titel="Accent colour" beschreibung="Follows the colour of the open Orbi">
            <PillenAuswahl label="Accent colour" wert="orbi" optionen={[{ wert: "orbi", text: "Orbi colour" }]} onChange={() => {}} />
          </Zeile>
          <SchalterZeile titel="Reduce motion" beschreibung="Follows the Mac setting" an={profil.reducedMotion === "on"} onChange={(v) => aendern({ reducedMotion: v ? "on" : "system" })} />
        </Karte>
      </Abschnitt>
    </>
  );
}

// ---------------------------------------------------------------- Personalisierung

const ANLEITUNG_GRENZE_ANZEIGE = 8000;

export function Personalisierung() {
  const { profil, aendern, fehler, setFehler, laedt } = useProfil();
  const st = useEinst();
  const einst = useDaten(() => getSettings().then((r) => r.settings));
  const standard = useDaten(() => getDefaultInstructions());
  const brain = useDaten(() => getHealthChecks().then((r) => r.checks?.find((c) => c.id === "brain") ?? null));
  const [gespeichert, setGespeichert] = useState(false);
  const [fehlerA, setFehlerA] = useState<string | null>(null);

  const grenze = standard.daten?.limit ?? ANLEITUNG_GRENZE_ANZEIGE;
  const aktuell = einst.daten ? (einst.daten.baseInstructions ?? standard.daten?.text ?? "") : null;
  const text = st.anleitung ?? aktuell ?? "";
  const person = st.person ?? profil?.name ?? "";
  const beruf = st.beruf ?? profil?.occupation ?? "";

  const speichereProfil = (p: Partial<Profil>) => aendern(p);
  const anleitungSpeichern = () => {
    setFehlerA(null);
    setInstructions(text).then(() => { setGespeichert(true); st.set({ anleitung: null }); void einst.neu(); setTimeout(() => setGespeichert(false), 1800); }).catch((e) => setFehlerA(fehlerText(e)));
  };
  const zuruecksetzen = () => {
    setFehlerA(null);
    setInstructions(null).then(() => { st.set({ anleitung: null }); void einst.neu(); }).catch((e) => setFehlerA(fehlerText(e)));
  };

  if (!profil) return <><Fehlerband text={fehler} />{laedt ? <Laedt /> : null}</>;
  const zuLang = text.length > grenze;
  return (
    <>
      <Fehlerband text={fehler} onWeg={() => setFehler(null)} />
      <Abschnitt titel="About you" anker="about-you">
        <Karte>
          <Zeile titel="Name" beschreibung="How Orbis address you" hoehe={64}>
            <Eingabe label="Name" wert={person} maxLength={40} onChange={(v) => st.set({ person: v })}
              onBlur={() => { if (st.person !== null && st.person.trim() !== profil.name) speichereProfil({ name: st.person.trim() }); }} onEnter={() => (document.activeElement as HTMLElement | null)?.blur()} />
          </Zeile>
          <Zeile titel="Occupation" beschreibung="Helps Orbis choose fitting examples" hoehe={64}>
            <Eingabe label="Occupation" wert={beruf} maxLength={120} platzhalter="e.g. student, designer, developer" onChange={(v) => st.set({ beruf: v })}
              onBlur={() => { if (st.beruf !== null && st.beruf.trim() !== profil.occupation) speichereProfil({ occupation: st.beruf.trim() }); }} onEnter={() => (document.activeElement as HTMLElement | null)?.blur()} />
          </Zeile>
          <Zeile titel="Reply length" hoehe={58}>
            <Pillen label="Reply length" wert={profil.answerLength} breite={98} onChange={(answerLength) => aendern({ answerLength })}
              optionen={[{ wert: "short", text: "Shorter" }, { wert: "standard", text: "Standard" }, { wert: "long", text: "Longer" }]} />
          </Zeile>
        </Karte>
      </Abschnitt>
      <Abschnitt titel="Shared instructions" anker="instructions">
        <Fehlerband text={fehlerA ?? einst.fehler} onWeg={() => setFehlerA(null)} />
        <Karte>
          <div className="flex flex-col gap-2.5 px-4 py-3.5">
            <textarea aria-label="Shared instructions" value={text} onChange={(e) => st.set({ anleitung: e.target.value })} rows={4}
              className="orbit-ui h-[112px] w-full resize-none rounded-[12px] bg-o-field px-3.5 py-3 text-[15px] leading-[22px] text-o-text outline-none focus-visible:outline-2 focus-visible:outline-o-focus" />
            <div className="flex items-center gap-2">
              <span className={cx("flex-1 text-[13px] leading-[18px]", zuLang ? "text-o-danger" : "text-o-text-2")}>
                Applies to all Orbis · {text.length.toLocaleString("de-DE")} of {grenze.toLocaleString("de-DE")} characters
              </span>
              <Knopf art="still" onClick={zuruecksetzen}>Reset</Knopf>
              <Knopf art="primaer" onClick={anleitungSpeichern} disabled={zuLang || st.anleitung === null}>{gespeichert ? "Saved" : "Save"}</Knopf>
            </div>
          </div>
        </Karte>
      </Abschnitt>
      <Abschnitt titel="Memory" anker="memory">
        <Karte>
          <Zeile titel="Brain folder" symbol="notiz" hoehe={64}
            beschreibung={brain.daten ? (brain.daten.state === "ok" ? "Found" : brain.daten.fix ?? "Not found") : "Checking …"}>
            <Status ok={brain.daten?.state === "ok"} text={brain.daten?.state === "ok" ? "Ready" : "Open"} />
          </Zeile>
          <SchalterZeile titel="Orbis learn quietly" beschreibung="Each Orbi also has its own memory" an={profil.learn} onChange={(v) => aendern({ learn: v })} />
        </Karte>
      </Abschnitt>
    </>
  );
}

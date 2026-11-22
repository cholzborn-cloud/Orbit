import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Feld, Knopf, Symbol, cx } from "../../ui";
import { accountCancel, accountConfirmPasswordReset, accountResendOtp, accountResetPassword, accountSignIn, accountSignInOAuth, accountSignOut, accountSignUp, accountStatus, accountVerifyOtp, type KontoInfo, type OAuthAnbieter } from "../../lib/tauri";
import { useAuth } from "../../lib/auth";
import { getPlugins, connectPlugin, getPluginStatus, getPluginAccounts, deletePluginAccounts } from "../../lib/api";
import { initialen, AVATAR_FARBEN, AVATAR_SCHRIFTEN, avatarStil } from "../../lib/profil";
import { vorgeladen } from "../../lib/vorladen";
import { anmeldeAdresse } from "../einstellungen/marktplatz";
import {
  AuthOrbis, Auswahlkachel, Farbwahl, GitHub, Google, Kopf, Logo, OrbiFigur, Rechtzeile, Umschalter,
} from "./bausteine";
import {
  entwurfSpeichern, ersterOrbi, kontoAktion, macAnfrage, macSchalter, macZugriff, openUrl,
  FENSTER_RECHTE, FORTSETZEN, NEU_GESTARTET, appNeustart, profilLesen, profilSchreiben, type Cli, type MacRecht,
} from "./dienst";
import { FORMEN, farbHex, fehlerText, useDunkel } from "./dunkel";
import { namensVorschlag } from "./namen";
import { ProgrammFlaeche, VerbindungsFlaeche, Warten, useProgramme, vorgangVon } from "./programme";
import { DiensteSchrittInhalt } from "../einstellungen/dienste";
import { useErststart } from "./store";

// Die Schritte 1 bis 9 des Erststarts (Figma 04). Jeder Schritt liest und schreibt nur den Erststart-Speicher.

const ERSTER_JOB = "Your first contact"; // Pflichtfeld des Dienstes (1–60 Zeichen), im Erststart gibt es keine Eingabe dafür

const Spalte = ({ children, breit = 400, className }: { children: React.ReactNode; breit?: number; className?: string }) => (
  <div className={cx("orbit-ui flex flex-col items-stretch gap-7", className)} style={{ width: breit }}>{children}</div>
);

const AUTH_FORM = "orbit-ui o-auth-form pointer-events-auto flex w-full max-w-sm flex-col gap-4 text-o-text";

function AuthKopf({ titel, children }: { titel: string; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2 text-center">
      <AuthOrbis />
      <h1 className="m-0 text-balance text-[30px] leading-9 font-semibold tracking-tight text-o-text">{titel}</h1>
      {children ? <p className="m-0 text-pretty text-[14px] leading-5 text-o-text-2">{children}</p> : null}
    </header>
  );
}

/** Kleine Markierung auf der zuletzt benutzten Anmeldeart. */
const Zuletzt = () => (
  <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] leading-4 opacity-75">
    Zuletzt genutzt
  </span>
);

const Fehlerzeile = ({ text }: { text: string | null }) =>
  text ? <p role="alert" className="text-center text-[13px] leading-[18px] text-o-danger">{text}</p> : null;

// ---------------------------------------------------------------- 1 Start

const LETZTE_ANMELDUNG = "orbit.letzteAnmeldung";
const MAIL_PAUSE_MS = 60_000;

function mailSperren(email: string, beibehalten = false) {
  const jetzt = Date.now();
  const adresse = email.trim().toLowerCase();
  const sperren = useErststart.getState().mailSperren;
  if (beibehalten && sperren[adresse] > jetzt) return;
  const aktiv = Object.entries(sperren).filter(([, bis]) => bis > jetzt);
  useErststart.setState({ mailSperren: { ...Object.fromEntries(aktiv), [adresse]: jetzt + MAIL_PAUSE_MS } });
}

function useMailSekunden(email: string) {
  const bis = useErststart((s) => s.mailSperren[email.trim().toLowerCase()] ?? 0);
  const [jetzt, setJetzt] = useState(Date.now);
  useEffect(() => {
    if (bis <= Date.now()) return;
    const timer = window.setInterval(() => {
      const zeit = Date.now();
      setJetzt(zeit);
      if (zeit >= bis) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [bis]);
  return Math.max(0, Math.ceil((bis - Math.max(jetzt, Date.now())) / 1000));
}

function mailLimitErreicht(fehler: unknown) {
  return typeof fehler === "object" && fehler !== null && "code" in fehler && fehler.code === "rate_limited";
}
type Anmeldeart = "email" | OAuthAnbieter;

const OAUTH: { id: OAuthAnbieter; text: string; Icon: () => ReactNode }[] = [
  { id: "google", text: "Mit Google fortfahren", Icon: Google },
  { id: "github", text: "Mit GitHub fortfahren", Icon: GitHub },
];

export function StartKarte({ onAngemeldet }: { onAngemeldet?: () => void } = {}) {
  const s = useErststart();
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [browser, setBrowser] = useState<OAuthAnbieter | null>(null);
  const [konto, setKonto] = useState<KontoInfo | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [vergessen, setVergessen] = useState(false);
  const [letzte, setLetzte] = useState(() => {
    try { return localStorage.getItem(LETZTE_ANMELDUNG); } catch { return null; }
  });
  const abgebrochen = useRef(false);
  const registrieren = s.tab === "registrieren";
  const eingerichtet = konto?.configured !== false;

  const weiter = useCallback((art?: Anmeldeart) => {
    if (art) {
      try { localStorage.setItem(LETZTE_ANMELDUNG, art); } catch { /* Browser-Speicher kann deaktiviert sein */ }
      setLetzte(art);
    }
    const st = useErststart.getState();
    st.set({ passwort: "", code: "" });
    if (onAngemeldet) { onAngemeldet(); return; }
    st.gehe("name");
  }, [onAngemeldet]);

  const zumCode = useCallback((email: string | null | undefined, art: typeof s.otpArt) => {
    const st = useErststart.getState();
    const adresse = (email ?? st.email).trim();
    mailSperren(adresse, art === "login-wartet");
    st.set({ email: adresse, passwort: "", code: "", otpArt: art });
    if (onAngemeldet) {
      st.set({ warteAufCode: true });
      return;
    }
    st.gehe("code");
  }, [onAngemeldet]);

  const fehlerZeigen = (x: unknown) => {
    const problem = typeof x === "object" && x ? x as { code?: string; email?: string } : null;
    if (problem?.code === "login_otp_rate_limited") {
      zumCode(problem.email, "login-wartet");
      return;
    }
    if (problem?.code === "otp_required" || problem?.code === "login_otp_required") {
      zumCode(problem.email, problem.code === "login_otp_required" ? "login" : "signup");
      return;
    }
    if (problem?.code === "email_exists" || problem?.code === "google_conflict") {
      s.set({ tab: "anmelden", passwort: "", ...(problem.email ? { email: problem.email } : {}) });
      setHinweis(problem.code === "email_exists"
        ? "Zu dieser E-Mail-Adresse gibt es schon ein Konto. Bitte melde dich an."
        : "Für dieses Konto ist eine andere Anmeldeart hinterlegt.");
      return;
    }
    setFehler(fehlerText(x));
  };

  useEffect(() => {
    let weg = false;
    vorgeladen("konto", () => accountStatus()).then((k) => { if (!weg) setKonto(k); }).catch(() => {});
    return () => { weg = true; };
  }, []);

  const abschicken = (e: FormEvent) => {
    e.preventDefault();
    if (laeuft) return;
    setFehler(null);
    setHinweis(null);
    setLaeuft(true);
    (registrieren ? accountSignUp : accountSignIn)(s.email.trim(), s.passwort)
      .then(() => weiter("email"))
      .catch(fehlerZeigen)
      .finally(() => setLaeuft(false));
  };
  const oauth = (anbieter: OAuthAnbieter) => {
    if (laeuft) return;
    setFehler(null);
    setHinweis(null);
    abgebrochen.current = false;
    setLaeuft(true);
    setBrowser(anbieter);
    accountSignInOAuth(anbieter)
      .then(() => weiter(anbieter))
      .catch((x) => { if (!abgebrochen.current) fehlerZeigen(x); })
      .finally(() => { setLaeuft(false); setBrowser(null); });
  };
  const abbrechen = () => { abgebrochen.current = true; setFehler(null); void accountCancel().catch(() => {}); };
  const lokal = () => {
    setFehler(null);
    kontoAktion("local").then(() => weiter()).catch((x) => setFehler(fehlerText(x)));
  };
  const anderesKonto = () => {
    setLaeuft(true); setFehler(null);
    accountSignOut().then(() => { setKonto(null); s.set({ email: "", passwort: "", tab: "anmelden" }); })
      .catch(fehlerZeigen).finally(() => setLaeuft(false));
  };

  if (s.warteAufCode) {
    return (
      <CodeSchritt

        onFertig={() => {
          useErststart.getState().set({ warteAufCode: false, code: "", passwort: "" });
          void useAuth.getState().laden();
          weiter("email");
        }}
        onZurueck={() => useErststart.getState().set({ warteAufCode: false, code: "" })}
      />
    );
  }

  if (vergessen && !konto?.signedIn && eingerichtet) {
    return <PasswortVergessen email={s.email} onEmail={(email) => s.set({ email })} zurueck={() => setVergessen(false)} />;
  }

  return (
    <form onSubmit={abschicken} noValidate className={AUTH_FORM}>
      <AuthKopf titel={konto?.signedIn ? "Du bist angemeldet" : browser ? "Im Browser fortfahren" : registrieren ? "Orbit-Konto erstellen" : "Bei Orbit anmelden"}>
        {browser ? (
          <span role="status">Melde dich im Browser mit {browser === "google" ? "Google" : "GitHub"} an. Danach geht es hier weiter.</span>
        ) : null}
      </AuthKopf>
      {konto?.signedIn ? <>
        <div className="flex items-center gap-3 rounded-[10px] bg-o-field px-4 py-3.5">
          <Symbol name="checkc" className="text-o-success" />
          <span className="min-w-0 truncate text-[14px] leading-5 font-medium text-o-text">{konto.email || konto.displayName}</span>
        </div>
        <Knopf art="primaer" groesse="gross" className="w-full" onClick={() => weiter()}>Orbit öffnen</Knopf>
        <Knopf art="still" groesse="gross" className="w-full" disabled={laeuft} onClick={anderesKonto}>Mit anderem Konto anmelden</Knopf>
      </> : browser ? (
        <Knopf art="zweitrangig" className="self-center" onClick={abbrechen}>Abbrechen</Knopf>
      ) : eingerichtet ? <>
      <Umschalter
        wert={s.tab}
        label="Konto erstellen oder anmelden"
        onChange={(tab) => { if (!laeuft) { s.set({ tab, passwort: "" }); setFehler(null); setHinweis(null); } }}
        optionen={[{ wert: "registrieren", text: "Konto erstellen" }, { wert: "anmelden", text: "Anmelden" }]}
      />
      <div className="flex flex-col gap-3.5">
        <Feld label="E-Mail" groesse="gross" type="email" autoComplete="email" placeholder="name@example.com" value={s.email}
          disabled={laeuft} onChange={(e) => s.set({ email: e.target.value })} />
        <Feld label="Passwort" groesse="gross" type="password" autoComplete={registrieren ? "new-password" : "current-password"} placeholder="••••••••••••"
          value={s.passwort} disabled={laeuft} onChange={(e) => s.set({ passwort: e.target.value })} />
        {!registrieren ? (
          <div className="-mt-1 flex justify-end">
            <Knopf art="still" groesse="klein" disabled={laeuft} onClick={() => { setFehler(null); setHinweis(null); setVergessen(true); }}>
              Passwort vergessen?
            </Knopf>
          </div>
        ) : null}
        {hinweis ? <p role="status" className="m-0 text-[13px] leading-[18px] text-o-text-2">{hinweis}</p> : null}
        <div className="relative">
          <Knopf art="primaer" groesse="gross" type="submit" className="w-full" disabled={laeuft}>
            {laeuft ? "Einen Moment …" : registrieren ? "Konto erstellen" : "Anmelden"}
          </Knopf>
          {!registrieren && letzte === "email" ? <Zuletzt /> : null}
        </div>
        <div className="flex items-center gap-2.5" aria-hidden="true">
          <span className="h-px flex-1 bg-o-line" />
          <span className="text-[13px] leading-[18px] text-o-text-2">oder</span>
          <span className="h-px flex-1 bg-o-line" />
        </div>
        <div className="flex flex-col gap-2">
          {OAUTH.map(({ id, text, Icon }) => (
            <div key={id} className="relative">
              <Knopf art="zweitrangig" groesse="gross" className="w-full" onClick={() => oauth(id)} disabled={laeuft}>
                <Icon />
                {text}
              </Knopf>
              {letzte === id ? <Zuletzt /> : null}
            </div>
          ))}
        </div>
      </div>
      </> : (
        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="text-[13px] leading-[18px] text-o-text-2">Die Anmeldung ist in dieser App-Version nicht verfügbar. Du kannst Orbit lokal einrichten.</p>
          <Knopf groesse="gross" onClick={lokal}>Ohne Konto fortfahren</Knopf>
        </div>
      )}
      <Fehlerzeile text={fehler} />
    </form>
  );
}

/** Eigene Seite: Passwort vergessen. Die Antwort verrät nie, ob zur Adresse ein Konto besteht. */
function PasswortVergessen({ email, onEmail, zurueck }: { email: string; onEmail: (e: string) => void; zurueck: () => void }) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [gesendet, setGesendet] = useState(false);
  const [fertig, setFertig] = useState(false);
  const [code, setCode] = useState("");
  const [passwort, setPasswort] = useState("");
  const mailSekunden = useMailSekunden(email);

  const ausfuehren = async (aktion: () => Promise<void>, erledigt: () => void) => {
    if (laeuft) return;
    setFehler(null);
    setLaeuft(true);
    try {
      await aktion();
      erledigt();
    } catch (e) {
      setFehler(fehlerText(e));
    } finally {
      setLaeuft(false);
    }
  };
  const senden = () => {
    if (!email.trim() || mailSekunden > 0) return;
    void ausfuehren(async () => {
      try {
        await accountResetPassword(email.trim());
        mailSperren(email);
      } catch (e) {
        if (mailLimitErreicht(e)) mailSperren(email);
        throw e;
      }
    }, () => {
      setCode("");
      setGesendet(true);
    });
  };
  const absenden = (event: FormEvent) => {
    event.preventDefault();
    if (!gesendet) {
      senden();
      return;
    }
    if (code.length !== 6 || passwort.length < 6) return;
    void ausfuehren(() => accountConfirmPasswordReset(email.trim(), code, passwort), () => {
      setPasswort("");
      setCode("");
      setFertig(true);
    });
  };

  return (
    <form onSubmit={absenden} noValidate className={AUTH_FORM}>
      {fertig ? (
        <AuthKopf titel="Passwort geändert">Melde dich jetzt mit deinem neuen Passwort an.</AuthKopf>
      ) : gesendet ? (
        <>
          <AuthKopf titel="Passwort zurücksetzen">
            <span role="status">Wenn die Adresse zu einem Konto gehört, bekommst du einen Code per E-Mail.</span>
          </AuthKopf>
          <Feld label="Code aus der E-Mail" inputMode="numeric" autoComplete="one-time-code" autoFocus key="code"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} disabled={laeuft} />
          <Feld label="Neues Passwort" type="password" autoComplete="new-password" maxLength={1024}
            value={passwort} onChange={(e) => setPasswort(e.target.value)} disabled={laeuft} />
          <Fehlerzeile text={fehler} />
          <Knopf groesse="gross" type="submit" disabled={laeuft || code.length !== 6 || passwort.length < 6}>
            {laeuft ? "Einen Moment …" : "Passwort speichern"}
          </Knopf>
          <Knopf art="still" disabled={laeuft || mailSekunden > 0} onClick={senden}>
            {mailSekunden > 0 ? `Neuer Code in ${mailSekunden} s` : "Code erneut anfordern"}
          </Knopf>
        </>
      ) : (
        <>
          <AuthKopf titel="Passwort vergessen?" />
          <Feld label="E-Mail" groesse="gross" type="email" autoComplete="email" autoFocus placeholder="name@example.com" key="email"
            value={email} onChange={(e) => onEmail(e.target.value)} disabled={laeuft} />
          <Fehlerzeile text={fehler} />
          <Knopf groesse="gross" type="submit" disabled={laeuft || mailSekunden > 0 || !email.trim()}>
            {laeuft ? "Einen Moment …" : mailSekunden > 0 ? `Neuer Code in ${mailSekunden} s` : "Code anfordern"}
          </Knopf>
        </>
      )}
      <Knopf art={fertig ? "primaer" : "still"} groesse="gross" disabled={laeuft} onClick={zurueck}>Zurück zur Anmeldung</Knopf>
    </form>
  );
}

// ---------------------------------------------------------------- 3 Code

export function CodeSchritt({ onFertig, onZurueck }: { onFertig?: () => void; onZurueck?: () => void } = {}) {
  const s = useErststart();
  const [fehler, setFehler] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sendet, setSendet] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const eingabe = useRef<HTMLInputElement>(null);
  const mailSekunden = useMailSekunden(s.email);
  useEffect(() => { eingabe.current?.focus(); }, []);
  const aktiv = Math.min(s.code.length, 5);
  const art = s.otpArt === "signup" ? "signup" : "login";
  const absenden = (e?: FormEvent) => {
    e?.preventDefault();
    if (laeuft || sendet || s.code.length < 6) return;
    setFehler(null);
    setLaeuft(true);
    accountVerifyOtp(s.email.trim(), s.code, art)
      .then((info) => {
        useAuth.getState().setzen(info);
        try { localStorage.setItem(LETZTE_ANMELDUNG, "email"); } catch { /* ok */ }
        useErststart.getState().set({ code: "", passwort: "", warteAufCode: false });
        if (onFertig) onFertig();
        else useErststart.getState().gehe("name");
      })
      .catch((x) => setFehler(fehlerText(x)))
      .finally(() => setLaeuft(false));
  };
  const neu = () => {
    if (sendet || laeuft || mailSekunden > 0 || !s.email.trim()) return;
    setFehler(null);
    setInfo(null);
    setSendet(true);
    accountResendOtp(s.email.trim(), art)
      .then(() => {
        mailSperren(s.email);
        s.set({ otpArt: art });
        setInfo("Schau nach der neuesten E-Mail.");
      })
      .catch((x) => {
        if (mailLimitErreicht(x)) mailSperren(s.email);
        setFehler(fehlerText(x));
      })
      .finally(() => setSendet(false));
  };
  const inhalt = (
    <>
      <AuthKopf titel="E-Mail bestätigen">
        {s.otpArt === "login-wartet"
          ? "Der Maildienst braucht noch einen Moment. Falls du bereits einen gültigen Code hast, kannst du ihn eingeben."
          : <>Gib den Code aus der E-Mail an <strong className="break-all font-medium text-o-text">{s.email}</strong> ein.</>}
      </AuthKopf>
      <div className="flex flex-col gap-4">
        <div className="relative mx-auto flex w-full justify-between gap-2" onClick={() => eingabe.current?.focus()}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} data-ziffer={i}
              className={cx("flex h-16 min-w-0 flex-1 items-center justify-center rounded-[14px] bg-o-field text-[22px] leading-7 font-semibold text-o-text", i === 3 && "ml-2", i === aktiv && "outline-2 outline-solid outline-o-focus -outline-offset-2")}>
              {s.code[i] ?? ""}
            </div>
          ))}
          <input ref={eingabe} aria-label="Code aus der E-Mail" inputMode="numeric" autoComplete="one-time-code"
            className="absolute inset-0 h-full w-full cursor-default opacity-0" value={s.code}
            onChange={(e) => s.set({ code: e.target.value.replace(/\D/g, "").slice(0, 6) })} />
        </div>
        <Fehlerzeile text={fehler} />
        {info ? <p role="status" className="text-center text-[13px] leading-[18px] text-o-text-2">{info}</p> : null}
        <Knopf art="primaer" groesse="gross" type="submit" className="w-full" disabled={laeuft || sendet || s.code.length < 6}>E-Mail bestätigen</Knopf>
        <Knopf art="still" groesse="gross" className="w-full" onClick={neu} disabled={laeuft || sendet || mailSekunden > 0 || !s.email.trim()}>
          {sendet ? "Code wird angefordert …" : mailSekunden > 0 ? `Neuer Code in ${mailSekunden} s` : "Code erneut anfordern"}
        </Knopf>
      </div>
      {onZurueck ? (
        <button type="button" onClick={onZurueck} className="m-0 text-center text-[13px] leading-[18px] text-o-text-2 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-o-focus cursor-default">
          Andere E-Mail-Adresse verwenden
        </button>
      ) : null}
    </>
  );
  return (
    <form onSubmit={absenden} noValidate className={AUTH_FORM}>
      {inhalt}
    </form>
  );
}

// ---------------------------------------------------------------- 4 Name

export function NameSchritt() {
  const s = useErststart();
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const weiter = (e: FormEvent) => {
    e.preventDefault();
    if (laeuft) return;
    setFehler(null);
    const name = s.person.trim();
    if (!initialen(name)) { setFehler("Enter your name."); return; }
    const los = () => { void entwurfSpeichern({ step: 1, person: name }).catch(() => {}); useErststart.getState().gehe("modelle"); };
    setLaeuft(true);
    profilSchreiben({ name, occupation: s.beruf.trim(), avatarColor: s.avatarFarbe, avatarFont: s.avatarSchrift })
      .then(los).catch((x) => setFehler(fehlerText(x))).finally(() => setLaeuft(false));
  };
  // Vorbelegung aus dem Google-Konto (nur angemeldet, nur mit Namen, nur einmal). Getippter Text wird nie überschrieben.
  useEffect(() => {
    if (useErststart.getState().nameVorbelegt) return;
    let weg = false;
    Promise.all([
      profilLesen().then((r) => r.profile).catch(() => null),
      accountStatus().catch(() => null),
    ]).then(([profil, k]) => {
      if (weg) return;
      const st = useErststart.getState();
      if (st.nameVorbelegt) return;
      const googleName = k?.signedIn ? (k.displayName ?? "").trim().slice(0, 40) : "";
      st.set({
        person: st.person || profil?.name || googleName,
        beruf: st.beruf || profil?.occupation || "",
        avatarFarbe: profil?.avatarColor || st.avatarFarbe,
        avatarSchrift: profil?.avatarFont || st.avatarSchrift,
        nameVorbelegt: true,
      });
    }).catch(() => {});
    return () => { weg = true; };
  }, []);
  const initiale = initialen(s.person);
  return (
    <form onSubmit={weiter}>
      <Spalte className="gap-4!">
        <Kopf titel="What is your name?" />
        <div style={avatarStil(s.avatarFarbe, s.avatarSchrift)} className="mx-auto flex h-[64px] w-[64px] items-center justify-center rounded-full bg-o-selected text-[22px] leading-7 font-semibold text-o-text" aria-hidden="true">
          {initiale || "?"}
        </div>
        <Feld label="Name" groesse="gross" autoFocus autoComplete="name" required value={s.person} maxLength={40}
          onChange={(e) => s.set({ person: e.target.value, nameVorbelegt: true })} fehler={fehler ?? undefined} />
        <Feld label="Occupation (optional)" groesse="gross" autoComplete="organization-title" value={s.beruf} maxLength={120}
          onChange={(e) => s.set({ beruf: e.target.value })} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Avatar colour" className="flex gap-2">
            {Object.entries(AVATAR_FARBEN).map(([farbe, { label }]) => (
              <button key={farbe} type="button" aria-label={label} aria-pressed={s.avatarFarbe === farbe}
                className="h-7 w-7 rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-o-focus aria-pressed:ring-2 aria-pressed:ring-o-text"
                style={avatarStil(farbe)} onClick={() => s.set({ avatarFarbe: farbe, nameVorbelegt: true })} />
            ))}
          </div>
          <div role="group" aria-label="Avatar font" className="flex gap-2">
            {Object.entries(AVATAR_SCHRIFTEN).map(([schrift, { label }]) => (
              <button key={schrift} type="button" aria-label={label} aria-pressed={s.avatarSchrift === schrift}
                className="h-7 w-8 rounded-md text-o-text focus-visible:outline-2 focus-visible:outline-o-focus aria-pressed:bg-o-selected"
                style={avatarStil(undefined, schrift)} onClick={() => s.set({ avatarSchrift: schrift, nameVorbelegt: true })}>Aa</button>
            ))}
          </div>
        </div>
        <Knopf art="primaer" groesse="gross" type="submit" className="w-full" disabled={laeuft}>Continue</Knopf>
      </Spalte>
    </form>
  );
}

// ---------------------------------------------------------------- 5 Modelle

const PROGRAMME = [
  { id: "claude", name: "Claude Code", marke: "claude-code" },
  { id: "codex", name: "Codex", marke: "codex" },
  { id: "cursor", name: "Cursor", marke: "cursor" },
  { id: "agy", name: "Antigravity", marke: "antigravity" },
] as const;

export function ModelleSchritt() {
  const s = useErststart();
  const p = useProgramme();
  const { liste } = p;
  const laeuft = liste.some((c) => c.state === "bereit");
  const weiter = () => { void entwurfSpeichern({ step: 2 }).catch(() => {}); s.gehe("dienste"); };

  return (
    <Spalte>
      <Kopf titel="What do your Orbis work with?" untertitel="Pick a program to connect or manage." />
      <ProgrammFlaeche eintraege={PROGRAMME} liste={liste} steuerung={p}
        kachel={(pr, klick) => {
          const c = liste.find((x) => x.id === pr.id);
          const an = c?.state === "bereit";
          const arbeit = c ? vorgangVon(c, p.lokal[pr.id]) !== null : false;
          return (
            <Auswahlkachel breit marke={pr.marke} name={pr.name} an={an} beschaeftigt={arbeit}
              untertitel={arbeit ? "Running …" : untertitel(c)} titel={c?.message} disabled={!c} onClick={klick} />
          );
        }} />
      <Fehlerzeile text={p.fehler} />
      <div className="flex flex-col gap-2.5">
        {laeuft
          ? <Knopf art="primaer" groesse="gross" className="w-full" onClick={weiter}>Continue</Knopf>
          : <Knopf art="still" groesse="gross" className="w-full" onClick={weiter}>Later</Knopf>}
      </div>
    </Spalte>
  );
}

/** Optionale Schlüssel für Daytona und Jev. */
export function DiensteSchritt() {
  const s = useErststart();
  const weiter = () => { void entwurfSpeichern({ step: 3 }).catch(() => {}); s.gehe("plugins"); };
  return <DiensteSchrittInhalt onWeiter={weiter} />;
}

function untertitel(cli: Cli | undefined): string {
  if (!cli) return "Checking status …";
  if (cli.state === "bereit") return "Connected";
  return cli.state === "fehler" ? "Check status" : "Connect";
}

// ---------------------------------------------------------------- 6 Plugins

const VORSCHLAG = [
  { id: "gmail", name: "Gmail", marke: "gmail" },
  { id: "googlecalendar", name: "Calendar", marke: "kalender" },
  { id: "googledrive", name: "Drive", marke: "drive" },
  { id: "notion", name: "Notion", marke: "notion" },
  { id: "slack", name: "Slack", marke: "slack" },
  { id: "github", name: "GitHub", marke: "github" },
] as const;

export function PluginsSchritt() {
  const s = useErststart();
  const [eintraege, setEintraege] = useState<any[]>([]);
  const [konfiguriert, setKonfiguriert] = useState<boolean | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [anmeldung, setAnmeldung] = useState<{ slug: string; accountId?: string; url?: string; fehler?: string } | null>(null);
  const [bestaetigen, setBestaetigen] = useState<string | null>(null);
  const versuch = useRef(0);
  useEffect(() => {
    vorgeladen("plugins", () => getPlugins({ limit: 100 })).then((r) => { setEintraege(r.entries ?? []); setKonfiguriert(!!r.configured); }).catch((x) => { setFehler(fehlerText(x)); setKonfiguriert(false); });
    return () => { versuch.current++; };
  }, []);

  const alsVerbunden = (slug: string) => {
    setEintraege((alt) => alt.map((e) => e.slug === slug ? { ...e, connectionStatus: "connected" } : e));
    setAnmeldung(null);
  };
  const starten = async (slug: string) => {
    const ticket = ++versuch.current;
    setAnmeldung({ slug });
    try {
      const r = await connectPlugin(slug);
      if (ticket !== versuch.current) return;
      if (r.connectionStatus === "connected") { alsVerbunden(slug); return; }
      const url = anmeldeAdresse(r);
      if (!url || !r.accountId) throw new Error("This plugin has no sign-in link. Check the setup under Plugins.");
      setAnmeldung({ slug, accountId: r.accountId, url });
      await openUrl(url).catch(() => {});
    } catch (e) {
      if (ticket === versuch.current) setAnmeldung({ slug, fehler: fehlerText(e) });
    }
  };
  useEffect(() => {
    if (!anmeldung?.accountId) return;
    const { slug, accountId } = anmeldung;
    let weg = false;
    let fragt = false;
    const pruefen = async () => {
      if (weg || fragt) return;
      fragt = true;
      try {
        const r = await getPluginStatus(slug, accountId);
        if (weg) return;
        if (r.connectionStatus === "connected") alsVerbunden(slug);
        else if (r.connectionStatus === "not_connected") {
          setAnmeldung({ slug, fehler: "Sign-in was not completed at the provider." });
        }
      } catch { /* Der Browser-Vorgang kann noch laufen. */ }
      finally { fragt = false; }
    };
    const intervall = setInterval(() => void pruefen(), 3000);
    const frist = setTimeout(() => setAnmeldung({ slug, fehler: "Sign-in took too long." }), 10 * 60_000);
    window.addEventListener("focus", pruefen);
    window.addEventListener("orbit:auth-callback", pruefen);
    void pruefen();
    return () => {
      weg = true;
      clearInterval(intervall);
      clearTimeout(frist);
      window.removeEventListener("focus", pruefen);
      window.removeEventListener("orbit:auth-callback", pruefen);
    };
  }, [anmeldung]);

  const verbunden = (slug: string) => eintraege.some((e) => e.slug === slug && e.connectionStatus === "connected");
  const trennen = async (slug: string) => {
    const ticket = ++versuch.current;
    setBestaetigen(null);
    setAnmeldung({ slug });
    try {
      const { accounts } = await getPluginAccounts(slug);
      if (ticket !== versuch.current) return;
      if (accounts.length) {
        const r = await deletePluginAccounts(slug, accounts.map((a) => a.id));
        if (r.failedIds?.length) throw new Error("Some accounts could not be disconnected.");
      }
      if (ticket !== versuch.current) return;
      setEintraege((alt) => alt.map((e) => e.slug === slug ? { ...e, connectionStatus: "none" } : e));
      setAnmeldung(null);
    } catch (e) {
      if (ticket === versuch.current) setAnmeldung({ slug, fehler: fehlerText(e) });
    }
  };
  const weiter = () => {
    void entwurfSpeichern({ step: 4 }).catch(() => {});
    s.gehe("mac");
  };

  return (
    <Spalte>
      <Kopf titel="Suggested plugins" untertitel="Find more later under Plugins." />
      <VerbindungsFlaeche dreiSpalten eintraege={VORSCHLAG} istFertig={verbunden}
        start={(id) => {
          if (!konfiguriert) return false;
          if (verbunden(id)) return "verwalten";
          void starten(id);
          return true;
        }}
        kachel={(v, klick) => <Auswahlkachel marke={v.marke} logoUrl={eintraege.find((e) => e.slug === v.id)?.logoUrl} name={v.name} an={verbunden(v.id)}
          untertitel={verbunden(v.id) ? "Connected" : "Connect"} onClick={klick}
          disabled={!konfiguriert} />}
        karteInhalt={(v, schliessen) => {
          const abbruch = () => { versuch.current++; setBestaetigen(null); setAnmeldung(null); schliessen(); };
          return <div role="group" aria-label={`Connect ${v.name}`} className="flex min-h-[226px] flex-col gap-4 p-[18px]">
            <div className="flex items-center gap-3">
              <button type="button" aria-label="Back to the selection" onClick={abbruch} className="grid h-8 w-8 place-items-center rounded-full hover:bg-o-hover focus-visible:outline-2 focus-visible:outline-o-focus">
                <Symbol name="chevl" />
              </button>
              {eintraege.find((e) => e.slug === v.id)?.logoUrl
                ? <img src={eintraege.find((e) => e.slug === v.id)!.logoUrl!} alt="" width={28} height={28} style={{ width: 28, height: 28, objectFit: "contain" }} />
                : <Logo marke={v.marke} groesse={28} />}
              <span className="font-medium">{v.name}</span>
            </div>
            <div className="flex flex-1 flex-col justify-center gap-3">
              {anmeldung?.fehler ? <Fehlerzeile text={anmeldung.fehler} /> :
                <p role="status" className="m-0 text-[14px] text-o-text-2">{bestaetigen === v.id ? "Disconnect all accounts of this plugin from Orbit?" : verbunden(v.id) ? "Connected." : anmeldung?.url ? "Finish signing in in the browser." : anmeldung ? "Preparing sign-in …" : "Ready to connect."}</p>}
            </div>
            <div className="flex gap-2">
              {anmeldung?.url ? <Knopf art="primaer" symbol="link" onClick={() => void openUrl(anmeldung.url!).catch(() => {})}>Open in browser</Knopf> : null}
              {!verbunden(v.id) && (!anmeldung || anmeldung.fehler) ? <Knopf art="primaer" onClick={() => void starten(v.id)}>{anmeldung?.fehler ? "Retry" : "Connect"}</Knopf> : null}
              {verbunden(v.id) ? <Knopf art="still" disabled={!!anmeldung && !anmeldung.fehler} onClick={() => {
                if (bestaetigen === v.id) void trennen(v.id);
                else setBestaetigen(v.id);
              }}>{anmeldung && !anmeldung.fehler ? "Disconnecting …" : bestaetigen === v.id ? "Confirm disconnect" : "Disconnect"}</Knopf> : null}
              {bestaetigen === v.id ? <Knopf art="still" onClick={() => setBestaetigen(null)}>Cancel</Knopf> :
                !verbunden(v.id) && anmeldung && !anmeldung.fehler ? <Knopf art="still" onClick={abbruch}>Cancel</Knopf> : null}
            </div>
          </div>;
        }} />
      {konfiguriert === false ? <p className="text-center text-[13px] leading-[18px] text-o-text-2">Plugins need marketplace access. You can set it up later under Plugins.</p> : null}
      <Fehlerzeile text={fehler} />
      <div className="flex flex-col gap-2.5">
        <Knopf art="primaer" groesse="gross" className="w-full" disabled={!!anmeldung} onClick={weiter}>Continue</Knopf>
      </div>
    </Spalte>
  );
}

// ---------------------------------------------------------------- 7 Mac

// Reihenfolge = Reihenfolge von „Alle erlauben“: erst alles, was ein Klick auf „Erlauben“ im Dialog erledigt, dann die Rechte mit Fenster.
const RECHTE: { name: string; symbol: string; id: string | null }[] = [
  { name: "Calendar", symbol: "kalender", id: "automation_calendar" },
  { name: "Reminders", symbol: "check", id: "automation_reminders" },
  { name: "Contacts", symbol: "user", id: "automation_contacts" },
  { name: "Notifications", symbol: "bell", id: null }, // der Dienst kennt kein Mitteilungs-Recht: wird als Profil-Einstellung gespeichert
  { name: "Control apps", symbol: "desktop", id: "accessibility" },
  { name: "See the screen", symbol: "auge", id: "screen" },
  { name: "Files", symbol: "folder", id: "full_disk" },
];
const FENSTER_WARTEN_MS = 120_000;

export function MacSchritt() {
  const s = useErststart();
  const [rechte, setRechte] = useState<MacRecht[]>([]);
  const [an, setAn] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  useEffect(() => {
    let weg = false;
    const lesen = (frisch = false) => (frisch ? macZugriff() : vorgeladen("mac", () => macZugriff())).then((r) => { if (!weg) { setRechte(r.permissions ?? []); setAn(!!r.enabled); } })
      .catch((x) => { if (!weg) setFehler(fehlerText(x)); });
    void lesen();
    const beiFokus = () => { void lesen(true); };
    window.addEventListener("focus", beiFokus);
    return () => { weg = true; window.removeEventListener("focus", beiFokus); };
  }, []);

  // „bestaetigt“: Mensch hat in den Systemeinstellungen erlaubt, macOS meldet es erst nach einem Neustart (Bildschirm, Dateien).
  const [bestaetigt, setBestaetigt] = useState<string[]>([]);
  const [warte, setWarte] = useState<string | null>(null);
  const [neustart, setNeustart] = useState(false);
  const erledigt = useRef(false);
  const erlaubt = (id: string | null) => (id === null ? s.mitteilungen : rechte.find((r) => r.id === id)?.status === "granted" || bestaetigt.includes(id));
  const nochOffen = bestaetigt.filter((id) => rechte.find((r) => r.id === id)?.status !== "granted");
  const anfragen = async (id: string | null) => {
    if (laeuft !== null) return;
    if (id === null) { s.set({ mitteilungen: !s.mitteilungen }); return; }
    if (erlaubt(id)) return; // macOS-Rechte lassen sich nur in den Systemeinstellungen zurücknehmen
    setFehler(null);
    setLaeuft(id);
    try {
      if (!an) { await macSchalter(true); setAn(true); }
      const r = await macAnfrage(id);
      const p = r.permission;
      if (p) {
        setRechte((alt) => alt.some((x) => x.id === id) ? alt.map((x) => (x.id === id ? p : x)) : [...alt, p]);
        if (p.status !== "granted" && p.detail) setFehler(p.detail);
      }
    } catch (x) {
      setFehler(fehlerText(x));
    } finally {
      setLaeuft(null);
    }
  };
  const alle = RECHTE.every((r) => erlaubt(r.id));
  const [serie, setSerie] = useState(false);
  // Wartet, bis ein Recht mit Fenster erlaubt ist: macOS meldet es (alle 1,5 s frisch gelesen) oder der Mensch tippt „Erledigt“.
  const wartenBis = async (id: string): Promise<"erlaubt" | "bestaetigt" | "zeit"> => {
    const ende = Date.now() + FENSTER_WARTEN_MS;
    erledigt.current = false;
    setWarte(id);
    try {
      while (Date.now() < ende) {
        await new Promise((ok) => setTimeout(ok, 1500));
        try {
          const r = (await macZugriff()).permissions ?? [];
          setRechte(r);
          if (r.find((x) => x.id === id)?.status === "granted") return "erlaubt";
        } catch { /* nächster Versuch */ }
        if (erledigt.current) return "bestaetigt";
      }
      return "zeit";
    } finally { setWarte(null); }
  };
  const alleErlauben = async () => {
    if (serie) return;
    setSerie(true);
    try {
      // 1. Alles mit einfachem Dialog, nacheinander. 2. Danach die Rechte mit Fenster, eins nach dem anderen. Erkennt macOS ein Recht
      // nicht sofort (Bildschirm, Dateien gelten erst nach Neustart), reicht „Erledigt“, und die Reihe geht weiter.
      for (const r of RECHTE) if (!FENSTER_RECHTE.includes(r.id ?? "") && !erlaubt(r.id)) await anfragen(r.id);
      for (const r of RECHTE) {
        if (!r.id || !FENSTER_RECHTE.includes(r.id)) continue;
        const frisch = (await macZugriff().catch(() => ({ permissions: [] as MacRecht[] }))).permissions ?? [];
        if (frisch.find((x) => x.id === r.id)?.status === "granted" || bestaetigt.includes(r.id)) continue;
        await anfragen(r.id);
        const ergebnis = await wartenBis(r.id);
        if (ergebnis === "bestaetigt") setBestaetigt((alt) => alt.includes(r.id!) ? alt : [...alt, r.id!]);
        else if (ergebnis === "zeit") { setFehler(`${r.name}: Allow Orbit in System Settings, then tap “Allow all” again.`); return; }
      }
      const letzte = (await macZugriff().catch(() => ({ permissions: [] as MacRecht[] }))).permissions ?? [];
      if (letzte.length) setRechte(letzte);
      if (bestaetigtOffen(letzte)) setNeustart(true);
    } finally { setSerie(false); }
  };
  const bestaetigtOffen = (liste: MacRecht[], extra: string[] = []) =>
    [...bestaetigt, ...extra].some((id) => liste.find((r) => r.id === id)?.status !== "granted");
  const [startetNeu, setStartetNeu] = useState(false);
  const neuStarten = async () => {
    setFehler(null);
    setStartetNeu(true); // sofort sichtbar: das Fenster zeigt „startet neu“, bevor die App sich schließt
    try { localStorage.setItem(FORTSETZEN, "mac"); localStorage.setItem(NEU_GESTARTET, "1"); } catch { /* ohne Speicher geht es nach dem Neustart am Anfang weiter */ }
    await new Promise((ok) => setTimeout(ok, 1400));
    try { await appNeustart(); }
    catch (x) {
      try { localStorage.removeItem(FORTSETZEN); localStorage.removeItem(NEU_GESTARTET); } catch { /* egal */ }
      setStartetNeu(false); setNeustart(false); setFehler(fehlerText(x));
    }
  };
  // Nach dem Neustart: kurz zeigen, dass es geklappt hat.
  const [willkommenZurueck, setWillkommenZurueck] = useState(() => { try { return localStorage.getItem(NEU_GESTARTET) === "1"; } catch { return false; } });
  useEffect(() => {
    if (!willkommenZurueck) return;
    try { localStorage.removeItem(NEU_GESTARTET); } catch { /* egal */ }
    const t = setTimeout(() => setWillkommenZurueck(false), 5000);
    return () => clearTimeout(t);
  }, [willkommenZurueck]);
  const weiter = async (ohneFrage = false) => {
    if (!ohneFrage && nochOffen.length > 0) { setNeustart(true); return; }
    setNeustart(false);
    const eins = rechte.some((r) => r.status === "granted") || bestaetigt.length > 0;
    try { await macSchalter(eins || an); } catch { /* Mac-Zugriff lässt sich später in Sicherheit ändern */ }
    void profilSchreiben({ notificationsDone: s.mitteilungen, notificationsAttention: s.mitteilungen, notificationsApprovals: s.mitteilungen }).catch(() => {});
    void entwurfSpeichern({ step: 5, macEnabled: String(eins || an) }).catch(() => {});
    s.gehe("orbi");
  };

  return (
    <Spalte>
      <Kopf titel="What may Orbit do on your Mac?" untertitel="Orbit always asks before deleting, sending and paying." />
      <div className="overflow-hidden rounded-[20px] border border-solid border-o-card-border bg-o-raised">
        {RECHTE.map((r, i) => (
          <div key={r.name} className="relative">
            <Rechtzeile symbol={r.symbol} name={r.name} erlaubt={!!erlaubt(r.id)} beschaeftigt={laeuft === r.id} onClick={() => void anfragen(r.id)}
              detail={rechte.find((x) => x.id === r.id)?.detail} />
            {i < RECHTE.length - 1 ? <span className="pointer-events-none absolute inset-x-px bottom-0 h-px bg-o-line" /> : null}
          </div>
        ))}
      </div>
      <Fehlerzeile text={fehler} />
      {warte ? (
        <div role="status" className="flex items-center justify-between gap-3 rounded-[16px] bg-o-surface px-4 py-3">
          <p className="m-0 text-[13px] leading-[18px] text-o-text">Turn on Orbit under “{RECHTE.find((r) => r.id === warte)?.name}”. Then tap here:</p>
          <Knopf art="primaer" groesse="mittel" onClick={() => { erledigt.current = true; }}>Done</Knopf>
        </div>
      ) : null}
      {willkommenZurueck ? <p role="status" className="o-blende m-0 text-center text-[13px] leading-[18px] text-o-text-2">Orbit restarted. Checking permissions …</p> : null}
      {neustart ? <NeustartFenster laeuft={startetNeu} beiNeustart={() => void neuStarten()} beiSpaeter={() => { setNeustart(false); }} nochDabei={nochOffen.length > 0} beiWeiter={() => void weiter(true)} /> : null}
      <div className="flex flex-col gap-2.5">
        <Knopf art="zweitrangig" groesse="gross" className="w-full" disabled={alle || laeuft !== null || serie} onClick={() => void alleErlauben()}>{alle ? "All allowed" : serie ? "Running …" : "Allow all"}</Knopf>
        <Knopf art="primaer" groesse="gross" className="w-full" onClick={() => void weiter()}>Continue</Knopf>
      </div>
    </Spalte>
  );
}

/** Fenster „Neustart nötig“: einige Mac-Rechte gelten erst nach einem Neustart. Danach geht es an derselben Stelle weiter. */
function NeustartFenster({ laeuft, beiNeustart, beiSpaeter, beiWeiter, nochDabei }: { laeuft: boolean; beiNeustart: () => void; beiSpaeter: () => void; beiWeiter: () => void; nochDabei: boolean }) {
  return (
    <div className="o-blende fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div role="dialog" aria-modal="true" aria-label="Restart needed" className="o-karte-ein orbit-ui flex w-[360px] flex-col gap-4 rounded-[24px] border border-solid border-o-card-border bg-o-raised p-6" style={{ boxShadow: "var(--o-karte-schatten)" }}>
        {laeuft ? (
          <>
            <h2 className="m-0 text-[20px] leading-7 font-semibold text-o-text">Orbit is restarting …</h2>
            <Warten text="The window closes and opens again in a moment." hinweis="You continue right here afterwards. This can take a moment." />
          </>
        ) : (
          <>
            <h2 className="m-0 text-[20px] leading-7 font-semibold text-o-text">Orbit needs to restart</h2>
            <p className="m-0 text-[14px] leading-5 text-o-text-2">Screen and files only apply after a restart. You continue right here afterwards.</p>
            <Knopf art="primaer" groesse="gross" className="w-full" onClick={beiNeustart}>Restart now</Knopf>
            <Knopf art="still" groesse="gross" className="w-full" onClick={nochDabei ? beiWeiter : beiSpaeter}>{nochDabei ? "Later, continue without restart" : "Later"}</Knopf>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 8 Orbi

export function OrbiSchritt() {
  const s = useErststart();
  const dunkel = useDunkel();
  const [feldFehler, setFeldFehler] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const name = s.orbiName.trim();

  // Ein Vorschlag bleibt beim Wechsel von Farbe und Form stehen.
  useEffect(() => {
    const st = useErststart.getState();
    if (!st.orbiName) st.set({ orbiName: namensVorschlag() });
  }, []);

  const erstellen = (e: FormEvent) => {
    e.preventDefault();
    if (laeuft) return;
    setFehler(null);
    if (!name) return setFeldFehler("Give your Orbi a name");
    if (name.length > 40) return setFeldFehler("The name can be at most 40 characters long.");
    setFeldFehler(null);
    setLaeuft(true);
    const hex = farbHex(s.farbe, false);
    ersterOrbi({ name, job: ERSTER_JOB, avatar: s.form, color: hex })
      .then((r) => {
        useErststart.getState().set({ botId: r.id, chatId: r.chatId, orbiName: name });
        void entwurfSpeichern({ step: 6, name, avatar: s.form, color: hex }).catch(() => {});
        useErststart.getState().gehe("fertig");
      })
      .catch((x) => {
        const t = fehlerText(x);
        if (/name/i.test(t)) setFeldFehler(t); else setFehler(t);
      })
      .finally(() => setLaeuft(false));
  };

  return (
    <form onSubmit={erstellen}>
      <Spalte>
        <Kopf titel="Your first Orbi" untertitel="Tap a colour." />
        <div className="flex justify-center"><Farbwahl avatar={s.form} farbe={s.farbe} onChange={(farbe) => s.set({ farbe })} /></div>
        <div role="radiogroup" aria-label="Shape" className="mx-auto flex flex-wrap justify-center gap-1.5" style={{ width: 400 }}>
          {FORMEN.map((f) => {
            const an = f.avatar === s.form;
            return (
              <button key={f.avatar} type="button" role="radio" aria-checked={an} aria-label={f.figma} data-form={f.avatar} onClick={() => s.set({ form: f.avatar })}
                className={cx("flex h-11 w-11 items-center justify-center rounded-[12px] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-o-focus cursor-default", an ? "bg-o-selected" : "hover:bg-o-hover")}>
                <span style={{ opacity: an ? 1 : 0.55 }}>
                  <OrbiFigur avatar={f.avatar} farbe={s.farbe} koerper={26} zustand="normal" />
                </span>
              </button>
            );
          })}
        </div>
        <Feld label="Name" groesse="gross" autoComplete="off" value={s.orbiName} maxLength={40} data-dunkel={dunkel ? "1" : undefined}
          onChange={(e) => { s.set({ orbiName: e.target.value }); setFeldFehler(null); }} fehler={feldFehler ?? undefined} />
        <Fehlerzeile text={fehler} />
        <Knopf art="primaer" groesse="gross" type="submit" className="w-full" disabled={laeuft}>
          {laeuft ? "Creating …" : `Create ${name || "Orbi"}`}
        </Knopf>
      </Spalte>
    </form>
  );
}

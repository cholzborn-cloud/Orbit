import { useEffect, useState } from "react";
import { Knopf } from "../../ui";
import { useOrbit } from "../../lib/store";
import { useNav } from "../../lib/nav";
import { Fortschritt, Kopf, OrbiFigur, ZurueckKnopf } from "./bausteine";
import { FORTSETZEN, erststartAbschliessen, profilStatus } from "./dienst";
import { accountStatus } from "../../lib/tauri";
import { farbName, fehlerText, useWenigBewegung } from "./dunkel";
import { CodeSchritt, DiensteSchritt, MacSchritt, ModelleSchritt, NameSchritt, OrbiSchritt, PluginsSchritt, StartKarte } from "./schritte";
import { PUNKT, ZURUECK, useErststart } from "./store";
import { Buehne } from "./buehne";
import { ERSTER_SPLIT } from "./form";
import { starteMessung } from "./perf";
import { Flaeche } from "./szene";
import { Laden } from "./Laden";
import "./erststart.css";

/** Erststart (Figma 04 Erststart). Wird gezeigt, solange es keinen Orbi gibt. Ruft onDone, wenn fertig. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const s = useErststart();
  const [leer, setLeer] = useState(true); // erst nach der Antwort des Dienstes zeigen: kein Aufblitzen für Nutzer mit Orbi
  const wenig = useWenigBewegung();
  const [ladeEnde, setLadeEnde] = useState(false); // das Ladebild ist fertig ausgespielt (Endanimation), erst dann kommt die erste Seite

  useEffect(() => starteMessung(), []);

  useEffect(() => {
    let weg = false;
    profilStatus()
      .then((p) => {
        if (weg) return;
        const d = p.draft ?? {};
        const st = useErststart.getState();
        const vorbelegt: Partial<typeof st> = {};
        if (typeof d.person === "string" && !st.person) vorbelegt.person = d.person;
        if (typeof d.name === "string" && !st.orbiName) vorbelegt.orbiName = d.name;
        if (typeof d.avatar === "string" && FORM_OK(d.avatar)) vorbelegt.form = d.avatar;
        const f = farbName(typeof d.color === "string" ? d.color : null);
        if (f) vorbelegt.farbe = f;
        // Nach einem Neustart wegen Mac-Rechten: genau dort weitermachen.
        try {
          if (p.required && localStorage.getItem(FORTSETZEN) === "mac") { localStorage.removeItem(FORTSETZEN); vorbelegt.schritt = "mac"; vorbelegt.szene = "start"; }
        } catch { /* ohne Speicher: normaler Start */ }
        if (p.required && p.completedChat) { vorbelegt.chatId = p.completedChat; vorbelegt.schritt = "fertig"; }
        useErststart.setState(vorbelegt);
        setLeer(!p.required);
      })
      .catch(() => { if (!weg) setLeer(false); }); // Dienst nicht erreichbar: App zeigt den Fehler, hier normal starten
    return () => { weg = true; };
  }, []);

  // 0 A → 0 B: nach 0,3 s federn die Orbis in den Kreis.
  useEffect(() => {
    if (leer || s.schritt !== "willkommen" || s.szene !== "mitte") return;
    // Eröffnung (Lichtpunkt, Morph durch mehrere Formen) dauert ERSTER_SPLIT Sekunden, dann teilt sich die Schar auf.
    // Das Ladebild hat die Eröffnung schon gespielt: die Schar teilt sich sofort aus der Mitte.
    const t = setTimeout(() => useErststart.setState({ szene: "ring" }), wenig || ladeEnde ? 40 : Math.round(ERSTER_SPLIT * 1000));
    return () => clearTimeout(t);
  }, [leer, s.schritt, s.szene, wenig, ladeEnde]);

  // Die Orbis bleiben nur bei Willkommen und Start sichtbar; kehrt man zu Start zurück, gleiten sie dorthin.
  useEffect(() => {
    if (s.schritt === "start" && s.szene !== "start" && s.szene !== "zusammen") useErststart.setState({ szene: "start" });
    // „Los geht’s“: die Schar zieht sich in einer Bewegung zusammen (zusammen), danach gibt die Szene den Platz frei.
    if (s.szene === "zusammen") {
      const t = setTimeout(() => useErststart.setState({ szene: "start" }), wenig ? 0 : 420);
      return () => clearTimeout(t);
    }
  }, [s.schritt, s.szene, wenig]);

  if (leer || !ladeEnde) return <Laden fertig={!leer} onEnde={() => setLadeEnde(true)} />;

  const zurueck = ZURUECK[s.schritt];
  const punkt = PUNKT[s.schritt];
  const auth = s.schritt === "start" || s.schritt === "code";

  const los = () => {
    // Nach Login-Gate oft schon angemeldet → Konto-Karte überspringen.
    void accountStatus()
      .then((k) => {
        if (k.signedIn) useErststart.getState().set({ schritt: "name", szene: "mitte" });
        else useErststart.getState().set({ schritt: "start", szene: "start" });
      })
      .catch(() => useErststart.getState().set({ schritt: "start", szene: "start" }));
  };

  return (
    <div className="orbit-ui relative h-screen w-full overflow-hidden bg-o-bg text-o-text" data-schritt={s.schritt} data-richtung={s.richtung}>
      {!auth ? <Buehne schritt={s.schritt} szene={s.szene} ohneIntro /> : null}
      {s.schritt === "willkommen" ? (
        <Flaeche className="pointer-events-none">
          <Willkommen sichtbar={s.szene === "ring"} onLos={los} wenig={wenig} />
        </Flaeche>
      ) : null}
      {auth ? (
        <div className="o-auth-viewport absolute inset-0">
          {s.schritt === "start" ? <StartKarte /> : <CodeSchritt />}
        </div>
      ) : null}
      {zurueck ? <ZurueckKnopf onClick={() => s.gehe(zurueck)} /> : null}
      {punkt ? <Fortschritt aktiv={punkt} /> : null}
      {!auth && s.schritt !== "willkommen" && s.schritt !== "fertig" ? (
        <div key={s.schritt} className={`${s.schritt === "orbi" ? "o-schritt-sanft" : "o-schritt"} absolute inset-0 ${s.schritt === "dienste" ? "o-auth-viewport z-0" : "flex items-center justify-center pt-[14px]"}`}>
          {s.schritt === "name" ? <NameSchritt /> : null}
          {s.schritt === "modelle" ? <ModelleSchritt /> : null}
          {s.schritt === "dienste" ? <DiensteSchritt /> : null}
          {s.schritt === "plugins" ? <PluginsSchritt /> : null}
          {s.schritt === "mac" ? <MacSchritt /> : null}
          {s.schritt === "orbi" ? <OrbiSchritt /> : null}
        </div>
      ) : null}
      {s.schritt === "fertig" ? <Fertig onDone={onDone} wenig={wenig} /> : null}
    </div>
  );
}

const FORM_OK = (a: string) => ["strobi", "freddy", "citrus", "nova", "grokbot", "sunee", "kirby", "cloudee", "cubee", "onee", "rauti", "trixi", "tropi", "mopsi"].includes(a);

/** 0 Willkommen: Titel gleitet 24 pt nach oben und blendet ein (nach 250 ms), „Los geht’s“ führt zur Anmeldung. */
function Willkommen({ sichtbar, onLos, wenig }: { sichtbar: boolean; onLos: () => void; wenig: boolean }) {
  const stil = (verz: number, klick = false) => ({
    opacity: sichtbar ? 1 : 0,
    transform: sichtbar ? "none" : "translateY(24px)",
    transition: wenig ? "opacity 200ms linear" : `opacity 400ms cubic-bezier(0.22,1,0.36,1) ${verz}ms, transform 500ms cubic-bezier(0.22,1,0.36,1) ${verz}ms`,
    pointerEvents: klick && sichtbar ? ("auto" as const) : ("none" as const), // Text lässt Zeiger zu den Orbis durch
  });
  const wort = (w: string, n: number) => (
    <span key={w} style={{
      display: "inline-block", marginRight: "0.28em", opacity: sichtbar ? 1 : 0,
      transform: sichtbar || wenig ? "none" : "translateY(10px)",
      transition: wenig ? "opacity 200ms linear" : `opacity 500ms cubic-bezier(0.22,1,0.36,1) ${150 + n * 90}ms, transform 600ms cubic-bezier(0.22,1,0.36,1) ${150 + n * 90}ms`,
    }}>{w}</span>
  );
  return (
    <>
      <h1 className="pointer-events-none absolute left-0 w-full text-center text-[44px] leading-[52px] font-semibold tracking-[-0.015em] text-o-text" style={{ top: 390 }}>
        <span className="sr-only">Welcome to Orbit</span>
        <span aria-hidden="true">{["Welcome", "to", "Orbit"].map(wort)}</span>
      </h1>
      <p className="absolute left-0 w-full text-center text-[15px] leading-[22px] text-o-text-2" style={{ top: 454, ...stil(420) }}>Your team is already here.</p>
      <div className="absolute left-1/2 w-[180px] -translate-x-1/2" style={{ top: 506, ...stil(540, true) }}>
        <Knopf art="primaer" groesse="gross" className="w-full" onClick={onLos} tabIndex={sichtbar ? 0 : -1}>Let’s go</Knopf>
      </div>
    </>
  );
}

/** Der erste Orbi feiert kurz. Die Übersicht öffnet sich erst nach Bestätigung. */
function Fertig({ onDone, wenig }: { onDone: () => void; wenig: boolean }) {
  const s = useErststart();
  const [b, setB] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [weg, setWeg] = useState(false); // Orbi und Text steigen nach oben aus dem Bild, danach schiebt sich die Übersicht von unten herein
  useEffect(() => {
    const t = setTimeout(() => setB(true), wenig ? 0 : 250);
    return () => clearTimeout(t);
  }, [wenig]);
  const name = s.orbiName.trim() || "Your Orbi";
  const oeffnen = async () => {
    if (laeuft) return;
    setFehler(null);
    setLaeuft(true);
    try {
      await erststartAbschliessen();
      await useOrbit.getState().loadBots(); // erst jetzt kennt der Speicher den Orbi; App.tsx wechselt danach zum Hauptfenster
      await useOrbit.getState().selectChat(s.chatId ?? useOrbit.getState().main?.chatId ?? null);
      const nav = useNav.getState();
      nav.go({ kind: "chat" });
      nav.setPanel("uebersicht");
      if (!wenig) {
        setWeg(true);
        await new Promise((ok) => setTimeout(ok, 420));
      }
      useErststart.getState().zuruecksetzen();
      onDone();
    } catch (x) {
      setWeg(false);
      setFehler(fehlerText(x));
      setLaeuft(false);
    }
  };
  return (
    <Flaeche>
      <div className="absolute inset-0" style={{ transform: weg ? "translateY(-140px)" : "none", opacity: weg ? 0 : 1, transition: weg ? "transform 420ms cubic-bezier(0.64,0,0.78,0), opacity 360ms ease-in" : "none" }}>
      <div className="absolute flex items-center justify-center" style={{ left: 720 - 75, top: 330 - 75, width: 150, height: 150, transform: `scale(${b ? 1 : 0.8})`, transition: wenig ? "none" : "transform 500ms cubic-bezier(0.22,1,0.36,1)" }}>
        {b && !wenig ? <span className="o-fertig-funken" aria-hidden="true"><i /><i /><i /></span> : null}
        <span className={b && !wenig ? "o-winken" : undefined} style={{ display: "inline-flex" }}>
          <OrbiFigur avatar={s.form} farbe={s.farbe} koerper={Math.round(150 * 0.86)} zustand="lebendig" titel={name} />
        </span>
      </div>
      <div className="absolute left-[520px] flex w-[400px] flex-col gap-7" style={{ top: 470, opacity: b ? 1 : 0, transition: "opacity 400ms ease" }}>
        <Kopf titel={`${name} is ready.`} untertitel="Your Orbi is waiting in the overview." />
        {fehler ? <p role="alert" className="text-center text-[13px] leading-[18px] text-o-danger">{fehler}</p> : null}
        <Knopf art="primaer" groesse="gross" className="w-full" disabled={laeuft} onClick={() => void oeffnen()}>Go to overview</Knopf>
      </div>
      </div>
    </Flaeche>
  );
}

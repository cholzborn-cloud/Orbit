import { useEffect, useState } from "react";
import { useOrbit } from "./lib/store";
import { useAuth } from "./lib/auth";
import { useProfilName } from "./lib/profil";
import { MainWindow } from "./features/chat";
import { Onboarding } from "./features/onboarding";
import { LoginGate } from "./features/onboarding/LoginGate";
import { profilStatus } from "./features/onboarding/dienst";
import { startVorladen } from "./lib/vorladen";
import { starteEinstellungsWirkung } from "./lib/einstellungen-wirken";
import { Laden } from "./features/onboarding/Laden";

export default function App() {
  const connect = useOrbit((s) => s.connect);
  const bereit = useOrbit((s) => s.bereit);
  const fehler = useOrbit((s) => s.verbindungsfehler);
  const botCount = useOrbit((s) => s.bots.length + (s.main ? 1 : 0));
  const auth = useAuth();
  const [erststart, setErststart] = useState<boolean | null>(null);
  const [geschoben, setGeschoben] = useState(false);

  useEffect(() => {
    const webMenueUnterdruecken = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", webMenueUnterdruecken);
    return () => document.removeEventListener("contextmenu", webMenueUnterdruecken);
  }, []);
  useEffect(() => { void connect(); }, [connect]);
  useEffect(() => { if (bereit) void useAuth.getState().laden(); }, [bereit]);
  useEffect(() => { if (bereit && auth.signedIn) void useProfilName.getState().laden(); }, [bereit, auth.signedIn]);
  useEffect(() => { if (bereit && auth.signedIn) startVorladen(); }, [bereit, auth.signedIn]);
  useEffect(() => { if (bereit && auth.signedIn) starteEinstellungsWirkung(); }, [bereit, auth.signedIn]);
  useEffect(() => {
    if (!bereit || !auth.signedIn) return;
    let aktiv = true;
    profilStatus().then((p) => { if (aktiv) setErststart(p.required); })
      .catch(() => { if (aktiv) setErststart(useOrbit.getState().bots.length + Number(!!useOrbit.getState().main) === 0); });
    return () => { aktiv = false; };
  }, [bereit, auth.signedIn]);

  if (!bereit) return <Laden text={fehler} />;
  if (auth.signedIn === null) return <Laden />;

  // Mit Supabase-Config: ohne Anmeldung geht nichts. Ohne Config (Dev) bleibt die App nutzbar.
  if (auth.configured && !auth.signedIn) {
    return (
      <LoginGate onDone={() => {
        void useAuth.getState().laden().then(() => {
          setErststart(null);
        });
      }} />
    );
  }

  if (erststart === null) return <Laden />;
  if (erststart) return <Onboarding onDone={() => { setGeschoben(true); setErststart(false); }} />;
  return <div className={geschoben ? "o-uebersicht-schieben" : botCount > 0 ? "o-uebersicht-ein" : undefined}><MainWindow /></div>;
}

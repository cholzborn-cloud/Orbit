import { useEffect, useRef, useState } from "react";
import { Orbi, gestalt } from "../../orbi";
import { subscribe } from "../../orbi/ticker";
import { FormSvg, KETTE } from "./form";
import { farbHex, useDunkel, useWenigBewegung } from "./dunkel";
import { Flaeche } from "./szene";
import "./erststart.css";

/** Ladebild beim ersten Öffnen. Ein Orbi fließt ohne Pause von Form zu Form und von Farbe zu Farbe (Endlosschleife, nie ein Sprung).
 *  Die Zeit läuft global (nicht je Bauteil): wechselt die App zwischen den Ladeständen, läuft die Schleife nahtlos weiter.
 *  Ist alles geladen (`fertig`), spielt eine Endanimation (Orbi weitet sich und blendet in Licht aus), danach ruft `onEnde` die erste Seite.
 *  Dauert das Laden über 20 s, erscheint ein kleiner Hinweis. */
const T0 = typeof performance !== "undefined" ? performance.now() : 0;
const jetzt = () => (performance.now() - T0) / 1000;
const SEGMENT = 1.1;       // Sekunden je Form
const DAUER_ENDE = 0.6;    // Endanimation
const HINWEIS_NACH = 20;   // Sekunden
const SEITE = 190;

const sanft = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2); // ease-in-out
const auslauf = (u: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 4);

export function Laden({ fertig = false, onEnde, text }: { fertig?: boolean; onEnde?: () => void; text?: string | null }) {
  const dunkel = useDunkel();
  const wenig = useWenigBewegung();
  const [t, setT] = useState(jetzt);
  const ende = useRef<number | null>(null);
  const gemeldet = useRef(false);
  useEffect(() => subscribe(() => setT(jetzt()), { maxFps: 60 }), []);
  if (fertig && ende.current === null) ende.current = t;
  const u = ende.current === null ? 0 : Math.min(1, (t - ende.current) / DAUER_ENDE);
  useEffect(() => {
    if (!fertig || gemeldet.current) return;
    if (wenig) { gemeldet.current = true; onEnde?.(); return; }
    if (u >= 1) { gemeldet.current = true; onEnde?.(); }
  }, [fertig, u, wenig, onEnde]);

  // Ablauf: Form i → Form i+1, kurz verweilen (25 %), dann weich überblenden.
  const lauf = t / SEGMENT;
  const i = Math.floor(lauf) % KETTE.length;
  const rest = lauf - Math.floor(lauf);
  const e = sanft(Math.min(1, Math.max(0, (rest - 0.25) / 0.75)));
  const a = KETTE[i], b = KETTE[(i + 1) % KETTE.length];
  const gA = wenig ? null : gestalt(a[0]), gB = wenig ? null : gestalt(b[0]);
  const hexA = farbHex(a[1], dunkel), hexB = farbHex(b[1], dunkel);
  const atmen = 1 + 0.03 * Math.sin(t * 2.4);
  const aus = auslauf(u);
  const satz = text || (t > HINWEIS_NACH ? "Orbit is still loading. This is taking a little longer." : null);

  return (
    <div role="status" aria-label="Orbit is loading" className="orbit-ui relative h-screen w-full overflow-hidden bg-o-bg text-o-text">
      <Flaeche>
        <div aria-hidden="true" style={{ position: "absolute", left: 720 - 150, top: 450 - 150, width: 300, height: 300, pointerEvents: "none" }}>
          {!wenig && fertig ? (
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", opacity: 0.55 * aus * (1 - aus * 0.6), transform: `scale(${0.4 + aus * 1.6})`,
              background: `radial-gradient(closest-side, ${dunkel ? "rgba(255,255,255,0.9)" : hexA} 0%, ${hexA}55 35%, transparent 100%)` }} />
          ) : null}
          <div
            className="grid place-content-center"
            style={{ position: "absolute", left: 150 - SEITE / 2, top: 150 - SEITE / 2, width: SEITE, height: SEITE, opacity: 1 - aus, transform: wenig ? undefined : `scale(${atmen * (1 + 0.18 * aus)})` }}
          >
            {gA && gB ? (
              <FormSvg von={gA} nach={gB} e={e} hexVon={hexA} hexNach={hexB} dunkel={dunkel} seite={SEITE} />
            ) : (
              <Orbi avatar={KETTE[0][0]} color={farbHex(KETTE[0][1], dunkel)} dark={dunkel} size={SEITE * 1.25} />
            )}
          </div>
        </div>
      </Flaeche>
      {satz && !fertig ? <p key={satz} className="o-blende absolute inset-x-0 bottom-[14%] m-0 px-6 text-center text-[13px] leading-[18px] text-o-text-2">{satz}</p> : null}
    </div>
  );
}

import { useState, type ReactNode } from "react";
import { Auswahl } from "./Auswahl";
import { Blase, ORBI_FARBEN } from "./Blase";
import { Feld } from "./Feld";
import { Gruppe } from "./Gruppe";
import { Kachel } from "./Kachel";
import { Karte } from "./Karte";
import { Knopf, type KnopfArt } from "./Knopf";
import { Medienkarte } from "./Medienkarte";
import { Menue, Menuetrenner, Menuezeile } from "./Menue";
import { Schalter } from "./Schalter";
import { MARKEN_NAMEN, Symbol, SYMBOL_NAMEN } from "./Symbol";
import { Zeile } from "./Zeile";

const ARTEN: KnopfArt[] = ["primaer", "zweitrangig", "still", "gefahr"];

function Abschnitt({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[17px] leading-[22px] font-semibold text-o-text">{titel}</h2>
      {children}
    </section>
  );
}

function Inhalt() {
  const [an, setAn] = useState(true);
  const [wahl, setWahl] = useState("auto");
  return (
    <div className="flex flex-col gap-8">
      <Abschnitt titel="Icon">
        <div className="flex flex-wrap gap-3 text-o-text-2">
          {SYMBOL_NAMEN.map((n) => (
            <span key={n} title={n}>
              <Symbol name={n} />
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {MARKEN_NAMEN.map((n) => (
            <span key={n} title={n}>
              <Symbol marke={n} groesse={20} />
            </span>
          ))}
        </div>
      </Abschnitt>

      <Abschnitt titel="Button (4 kinds × Normal, Hover, Focus, Disabled)">
        <div className="grid grid-cols-4 items-center gap-3">
          {ARTEN.flatMap((art) => [
            <Knopf key={`${art}n`} art={art}>Normal</Knopf>,
            <Knopf key={`${art}h`} art={art} zustand="hover">Hover</Knopf>,
            <Knopf key={`${art}f`} art={art} zustand="fokus">Focus</Knopf>,
            <Knopf key={`${art}d`} art={art} disabled>Off</Knopf>,
          ])}
        </div>
        <div className="flex items-center gap-3">
          <Knopf groesse="klein">Small</Knopf>
          <Knopf groesse="mittel" symbol="plus">Medium</Knopf>
          <Knopf groesse="gross">Large</Knopf>
        </div>
      </Abschnitt>

      <Abschnitt titel="Switch and select">
        <div className="flex items-center gap-4">
          <Schalter aria-label="Example" checked={an} onChange={setAn} />
          <Schalter aria-label="Off" checked={false} />
          <Schalter aria-label="Disabled" checked disabled />
          <Auswahl
            aria-label="Appearance"
            value={wahl}
            onChange={setWahl}
            optionen={[
              { wert: "auto", text: "Automatic" },
              { wert: "hell", text: "Light" },
              { wert: "dunkel", text: "Dark" },
            ]}
          />
        </div>
      </Abschnitt>

      <Abschnitt titel="Field">
        <div className="grid grid-cols-2 gap-4">
          <Feld label="Name" defaultValue="Mira" hinweis="How the Orbi appears in chat." />
          <Feld label="Name" defaultValue="Mira" hinweis="How the Orbi appears in chat." zustand="fokus" />
          <Feld label="Name" defaultValue="Mira" fehler="Use at most 40 characters." groesse="klein" />
          <Feld label="Name" defaultValue="Mira" hinweis="How the Orbi appears in chat." groesse="gross" disabled />
        </div>
      </Abschnitt>

      <Abschnitt titel="Menu row and menu">
        <Menue>
          <Menuezeile symbol="pen" text="Edit" rechts="⌘E" zustand="hover" />
          <Menuezeile symbol="copy" text="Copy" rechts="⌘C" />
          <Menuezeile symbol="reply" text="Reply" disabled />
          <Menuetrenner />
          <Menuezeile symbol="trash" text="Delete" art="gefahr" />
        </Menue>
      </Abschnitt>

      <Abschnitt titel="Bubble">
        <div className="flex flex-col items-start gap-2">
          <Blase von="orbi">Yes, please.</Blase>
          <Blase von="ich">Yes, please.</Blase>
          <Blase von="gruppe">Yes, please.</Blase>
          <div className="flex flex-wrap gap-1.5">
            {ORBI_FARBEN.map((f) => (
              <Blase key={f} von="ich" farbe={f} className="text-[13px]">{f}</Blase>
            ))}
          </div>
        </div>
      </Abschnitt>

      <Abschnitt titel="Card">
        <div className="flex flex-col gap-3">
          <Karte art="freigabe" text="Mira wants to add three events to your calendar." linkText="Always allow" />
          <Karte art="frage" titel="How should I answer you?" antworten={["Short and crisp", "Detailed with reasons", "Depends on the topic"]} />
          <Karte art="status" titel="Three events added" untertitel="Apple Calendar" statusText="Done" />
          <Karte art="fehler" titel="Calendar unavailable" untertitel="Apple Calendar · nothing changed" aktionText="Try again" />
        </div>
      </Abschnitt>

      <Abschnitt titel="Row and group">
        <Gruppe titel="Group heading">
          <Zeile symbol="palette" titel="Appearance" beschreibung="Light, dark, or match the system." rechts={<Schalter aria-label="a" checked />} />
          <Zeile symbol="gauge" titel="Reduce motion" beschreibung="Follows the Mac setting." zustand="hover" rechts={<Schalter aria-label="b" checked={false} />} />
          <Zeile symbol="panel" titel="Menu bar" beschreibung="Show Orbit in the top right." ausgewaehlt onClick={() => {}} rechts={<Symbol name="chevr" />} />
        </Gruppe>
      </Abschnitt>

      <Abschnitt titel="Tile and media card">
        <div className="flex flex-wrap items-start gap-3">
          <Kachel marke="slack" titel="Slack" beschreibung="Read and send messages. Orbis ask first." aktion={<Knopf art="zweitrangig" groesse="klein">Connect</Knopf>} />
          <Kachel symbol="kalender" titel="Calendar" beschreibung="Read and create events." ausgewaehlt breite="panel" aktion={<Knopf art="zweitrangig" groesse="klein">Connect</Knopf>} />
          <Medienkarte titel="Week plan.pdf" beschreibung="3 pages · created today by Mira" quelle={{ symbol: "file", text: "Files" }} />
        </div>
      </Abschnitt>
    </div>
  );
}

/** Preview of all building blocks, light and dark side by side. */
export function Gallery() {
  return (
    <div className="orbit-ui grid grid-cols-1 gap-0 lg:grid-cols-2">
      {(["light", "dark"] as const).map((t) => (
        <div key={t} data-theme={t} className="orbit-ui bg-o-bg p-8 text-o-text">
          <h1 className="mb-6 text-[24px] leading-[30px] font-semibold">{t === "light" ? "Light" : "Dark"}</h1>
          <Inhalt />
        </div>
      ))}
    </div>
  );
}

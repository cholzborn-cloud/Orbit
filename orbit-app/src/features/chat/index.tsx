/** Figma 03: Hauptfenster (Seitenleiste, Chat, Kopf-Pille, Eingabe, Karten). Besitzt den Rahmen und zeigt useNav().main. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./chat.css";
import { LEISTE, cssBreite, maxBreite, useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import type { AntwortBezug, Datei } from "../../lib/types";
import { BASE_COLORS, shapeOf } from "../../orbi";
import { EditorDialogs, OrbiPanel, PillMenu } from "../orbis";
import { SettingsView } from "../einstellungen";
import { ComputerView, RoutinenView, TaskView } from "../routinen";
import { Griff, cx } from "../../ui";
import { KopfPille } from "./bausteine";
import { Eingabe } from "./eingabe";
import { arbeiter, farbeVonHex, kurzbefehl } from "./logik";
import { LeistenKnopf, Seitenleiste } from "./seitenleiste";
import { DAUER, FEDER, fliege, geist, geistAusblenden, messe, reduziert, type Stellen } from "../../lib/flip";
import { Verlauf } from "./verlauf";

function ChatAnsicht({ pilleHover, extra }: { pilleHover?: boolean; extra?: React.ReactNode }) {
  const chatId = useOrbit((s) => s.selectedChatId);
  const bots = useOrbit((s) => s.bots);
  const groups = useOrbit((s) => s.groups);
  const streaming = useOrbit((s) => (chatId ? s.streaming[chatId] : false));
  const working = useOrbit((s) => s.working);
  const panelOffen = useNav((s) => !!s.panel);
  const setPanel = useNav((s) => s.setPanel);
  const [antworten, setAntworten] = useState<Record<string, AntwortBezug | null>>({});
  const [pille, setPille] = useState<HTMLElement | null>(null);

  const bot = bots.find((b) => b.chatId === chatId) ?? null;
  const gruppe = groups.find((g) => g.id === chatId) ?? null;
  if (!chatId || (!bot && !gruppe)) return <div className="flex-1" />;

  const istGruppe = !!gruppe;
  const name = bot?.name ?? gruppe!.name;
  const daten = bot ?? { avatar: gruppe!.members[0]?.avatar ?? "universi", color: gruppe!.members[0]?.color ?? null, look: gruppe!.members[0]?.look ?? null };
  const farbe = farbeVonHex(bot ? (bot.color ?? BASE_COLORS[shapeOf(bot.avatar)].light) : null);
  const laeuft = !!streaming || arbeiter(chatId, working).some((w) => w.status === "arbeitet");

  const antwortSetzen = (antwort: AntwortBezug | null) => setAntworten((alt) => ({ ...alt, [chatId]: antwort }));
  const senden = (text: string, dateien: Datei[], antwort?: AntwortBezug) => void useOrbit.getState().send(chatId, text, dateien, undefined, antwort);

  return (
    <>
      <header data-tauri-drag-region className="flex h-[60px] shrink-0 items-start justify-center pt-2.5">
        {/* Orbi: Klick schaltet die rechte Leiste um, Rechtsklick öffnet das Menü. Gruppe hat kein Panel: Klick öffnet das Menü. */}
        <KopfPille
          daten={daten}
          name={name}
          zustand={pilleHover ? "hover" : undefined}
          aria-expanded={istGruppe ? !!pille : panelOffen}
          title={istGruppe ? undefined : panelOffen ? "Hide details" : "Show details"}
          onClick={(e) => (istGruppe ? setPille(pille ? null : e.currentTarget) : setPanel(panelOffen ? null : "uebersicht"))}
          onContextMenu={(e) => {
            e.preventDefault();
            setPille(e.currentTarget as HTMLElement);
          }}
        />
        {pille ? <PillMenu anchor={pille} onClose={() => setPille(null)} /> : null}
      </header>
      <Verlauf
        key={chatId}
        chatId={chatId}
        gruppe={istGruppe}
        bot={bot}
        mitglieder={gruppe?.members ?? []}
        farbe={farbe}
        onErneut={senden}
        onAntwort={antwortSetzen}
        extra={extra}
      />
      <div className="mx-auto w-full max-w-[1104px] shrink-0 px-4 pb-3.5 pt-2 @2xl:px-10 @4xl:px-[72px]">
        <Eingabe
          key={chatId}
          chatId={chatId}
          ziel={name}
          gruppe={istGruppe}
          sendeFarbe={`var(--orbit-blase-${farbe})`}
          laeuft={laeuft}
          antwort={antworten[chatId] ?? null}
          onAntwortZu={() => antwortSetzen(null)}
          onSenden={(text, dateien) => {
            senden(text, dateien, antworten[chatId] ?? undefined);
            if (antworten[chatId]) antwortSetzen(null);
          }}
          onStopp={() => void useOrbit.getState().stop(chatId)}
        />
      </div>
    </>
  );
}

/** Rechte Leiste: gleitet mit derselben Feder wie die linke (lib/flip) herein und hinaus. Beim Schließen hält sie dem Chat keinen Platz; der gleitet per FLIP im gleichen Takt mit. */
function RechteLeiste({ offen, breite, children }: { offen: boolean; breite: string; children: ReactNode }) {
  const [phase, setPhase] = useState<"zu" | "offen" | "geht">(offen ? "offen" : "zu");
  const zuletzt = useRef<ReactNode>(children);
  const el = useRef<HTMLDivElement>(null);
  const kommt = useRef(false);
  if (offen) {
    zuletzt.current = children;
    if (phase !== "offen") {
      kommt.current = phase === "zu" && !reduziert();
      setPhase("offen");
    }
  } else if (phase === "offen") {
    setPhase(reduziert() ? "zu" : "geht");
  }
  useLayoutEffect(() => {
    if (phase === "offen" && kommt.current) {
      kommt.current = false;
      el.current?.animate?.({ transform: ["translateX(100%)", "none"] }, { duration: DAUER, easing: FEDER });
      el.current?.animate?.({ opacity: [0, 1] }, { duration: 200, easing: "ease-out" });
    }
    if (phase !== "geht") return;
    const bewegung = el.current?.animate?.({ transform: ["none", "translateX(100%)"] }, { duration: DAUER, easing: FEDER, fill: "forwards" });
    if (!bewegung) { setPhase("zu"); return; }
    el.current?.animate?.({ opacity: [1, 0] }, { duration: 220, easing: "ease-in", fill: "forwards" });
    bewegung.finished.then(() => setPhase("zu"), () => {});
    return () => el.current?.getAnimations?.().forEach((x) => x.cancel());
  }, [phase]);
  if (phase === "zu") return null;
  return (
    <div
      ref={el}
      data-rechte-leiste={phase}
      className={cx("orbit-ui h-full shrink-0 bg-o-sidebar", phase === "offen" ? "relative" : "pointer-events-none absolute right-0 top-0 z-10")}
      style={{ width: breite }}
    >
      {zuletzt.current}
    </div>
  );
}

/** Die Zusatzfelder (ampel, pilleHover, profilOffen, vorschauExtra) dienen nur der Vorschau im Browser. */
export function MainWindow({ ampel = false, pilleHover = false, profilOffen = false, vorschauExtra }: { ampel?: boolean; pilleHover?: boolean; profilOffen?: boolean; vorschauExtra?: React.ReactNode } = {}) {
  const main = useNav((s) => s.main);
  const go = useNav((s) => s.go);
  const panel = useNav((s) => s.panel);
  const toggleSidebar = useNav((s) => s.toggleSidebar);
  const panelBreite = useNav((s) => s.panelWidth);
  const setPanelBreite = useNav((s) => s.setPanelWidth);
  const linksBreite = useNav((s) => (s.sidebarCollapsed ? LEISTE.klein : s.sidebarWidth));
  const bereit = useOrbit((s) => s.bereit);
  const bots = useOrbit((s) => s.bots);
  const groups = useOrbit((s) => s.groups);
  const hauptBot = useOrbit((s) => s.main);
  const gewaehlt = useOrbit((s) => s.selectedChatId);
  const [neuOffen, setNeuOffen] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const einst = main.kind === "einstellungen";

  // Beim Start den Hauptorbi öffnen; verschwindet der gewählte Chat, zurück zum Hauptorbi.
  useEffect(() => {
    const haupt = hauptBot ?? bots.find((b) => b.isMain) ?? bots[0];
    if (!haupt) return;
    const da = gewaehlt && (bots.some((b) => b.chatId === gewaehlt) || groups.some((g) => g.id === gewaehlt));
    if (!da && (bereit || bots.length)) void useOrbit.getState().selectChat(haupt.chatId);
  }, [bereit, bots, groups, hauptBot, gewaehlt]);

  // Kurzbefehle: ⌘, Einstellungen, ⌘N neuer Chat, ⌘\ Seitenleiste.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = kurzbefehl(e);
      if (!k) return;
      e.preventDefault();
      if (k === "einstellungen") go({ kind: "einstellungen" });
      else if (k === "neu") setNeuOffen(true);
      else toggleSidebar();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [go, toggleSidebar]);

  // Der Chat bleibt in den Einstellungen eingehängt (Entwurf, Scrollposition), ist aber unsichtbar und nicht bedienbar.
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    if (einst) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [einst]);

  const bot = bots.find((b) => b.chatId === gewaehlt) ?? null;
  const klein = useNav((s) => s.sidebarCollapsed);
  const rechtsOffen = main.kind === "routinen" || (!!panel && !!bot);

  // FLIP: vor einer Änderung von Leisten messen (der Store meldet vor dem Zeichnen), danach alles an die neue Stelle fliegen lassen.
  const alt = useRef<{ stellen: Stellen; geist: HTMLElement | null; klein: boolean } | null>(null);
  useEffect(() => useNav.subscribe((s, p) => {
    const kleinWechsel = s.sidebarCollapsed !== p.sidebarCollapsed;
    const rechtsWechsel = !!s.panel !== !!p.panel || (s.main.kind === "routinen") !== (p.main.kind === "routinen");
    const root = chatRef.current;
    if (!root || (!kleinWechsel && !rechtsWechsel) || reduziert() || p.main.kind === "einstellungen") return;
    const seitenleiste = root.querySelector<HTMLElement>("aside[data-seitenleiste]");
    alt.current = { stellen: messe(root), geist: kleinWechsel && seitenleiste ? geist(seitenleiste, root) : null, klein: kleinWechsel };
  }), []);
  useLayoutEffect(() => {
    const a = alt.current;
    const root = chatRef.current;
    alt.current = null;
    if (!a || !root) return;
    fliege(root, a.stellen, a.klein && !klein);
    if (a.geist) geistAusblenden(a.geist, root);
  }, [klein, rechtsOffen]);

  return (
    <div className="orbit-ui relative h-screen w-screen overflow-hidden bg-o-bg text-o-text" data-hauptfenster>
      <div ref={chatRef} aria-hidden={einst || undefined} className={einst ? "invisible absolute inset-0 flex" : "absolute inset-0 flex"}>
        <Seitenleiste ampel={ampel} neuOffen={neuOffen} setNeuOffen={setNeuOffen} profilOffen={profilOffen} />
        <main data-flip="chat" className="@container relative flex min-w-0 flex-1 flex-col">
          <ChatAnsicht pilleHover={pilleHover} extra={vorschauExtra} />
        </main>
        <RechteLeiste offen={rechtsOffen} breite={cssBreite("rechts", panelBreite, linksBreite)}>
          {main.kind === "routinen" ? <RoutinenView /> : bot ? <OrbiPanel botId={bot.id} /> : null}
          <Griff kante="links" label="Width of the right sidebar" breite={panelBreite} min={LEISTE.rechts.min} max={maxBreite("rechts", linksBreite)} std={LEISTE.rechts.std} onFertig={setPanelBreite} />
        </RechteLeiste>
        <LeistenKnopf />
      </div>
      {einst ? (
        <div className="absolute inset-0 z-30 bg-o-bg">
          <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-10 h-9" />
          <SettingsView page={main.page} pluginId={main.pluginId} />
        </div>
      ) : null}
      {main.kind === "aufgabe" ? <TaskView taskId={main.taskId} /> : null}
      {main.kind === "computer" ? <ComputerView botId={main.botId} /> : null}
      <EditorDialogs />
    </div>
  );
}

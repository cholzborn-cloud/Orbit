import { useLayoutEffect, useRef } from "react";
import { Symbol, cx, type SymbolName } from "../../ui";
import { useNav } from "../../lib/nav";
import "../onboarding/erststart.css";
import { Allgemein, Darstellung, Personalisierung, designAnwenden, type Design } from "./seiten1";
import { PluginDetail, PluginListe } from "./plugins";
import { Arbeitsumgebung, Nutzung, Sicherheit } from "./seiten2";
import { seiteVon, useEinst, type Seite } from "./store";

export { designAnwenden, type Design };

const GRUPPEN: { titel: string; seiten: { id: Seite; text: string; symbol: SymbolName }[] }[] = [
  { titel: "Orbit", seiten: [{ id: "allgemein", text: "General", symbol: "gear" }, { id: "darstellung", text: "Appearance", symbol: "palette" }, { id: "personalisierung", text: "Personalization", symbol: "user" }] },
  { titel: "Services and usage", seiten: [{ id: "plugins", text: "Plugins", symbol: "store" }, { id: "nutzung", text: "Usage", symbol: "gauge" }] },
  { titel: "System and access", seiten: [{ id: "arbeitsumgebung", text: "Workspace", symbol: "desktop" }, { id: "sicherheit", text: "Security", symbol: "shield" }] },
];

const TITEL: Record<Seite, string> = {
  allgemein: "General", darstellung: "Appearance", personalisierung: "Personalization", plugins: "Plugins",
  nutzung: "Usage", arbeitsumgebung: "Workspace", sicherheit: "Security",
};

/** Figma 07: Einstellungen (Orbit, Dienste und Nutzung, System und Zugriff) und Plugin-Detail. Füllt den Platz, den der Chat-Rahmen vergibt. */
export function SettingsView({ page, pluginId }: { page?: string; pluginId?: string }) {
  const seite = pluginId ? "plugins" : seiteVon(page);
  const schluessel = pluginId ? `plugin:${pluginId}` : seite;
  const rolle = useRef<HTMLDivElement>(null);
  const ankerZiel = useEinst((s) => s.anker);

  // Leseposition: je Seite gemerkt, beim Zurückkehren (auch aus dem Chat) wiederhergestellt.
  useLayoutEffect(() => {
    const el = rolle.current;
    if (!el) return;
    // Sprung aus einem orbit://-Link: der Abschnitt gewinnt gegen die gemerkte Leseposition.
    const anker = useEinst.getState().anker;
    if (anker) {
      const springe = () => {
        const ziel = rolle.current?.querySelector<HTMLElement>(`[data-anchor="${anker.replace(/[^a-z0-9-]/gi, "")}"]`);
        if (ziel) ziel.scrollIntoView?.({ block: "start" });
        return !!ziel;
      };
      springe();
      const t = setTimeout(() => { springe(); useEinst.setState({ anker: null }); }, 250);
      return () => clearTimeout(t);
    }
    el.scrollTop = useEinst.getState().scroll[schluessel] ?? 0;
    // Inhalte laden nach; ein zweiter Versuch nach dem Laden hält die Position.
    const t = setTimeout(() => { if (rolle.current) rolle.current.scrollTop = useEinst.getState().scroll[schluessel] ?? 0; }, 250);
    return () => clearTimeout(t);
  }, [schluessel, ankerZiel]);

  const geheZu = (s: Seite) => useNav.getState().go({ kind: "einstellungen", page: s });

  return (
    <div className="orbit-ui flex h-full min-h-0 w-full bg-o-bg text-o-text" data-seite={schluessel}>
      <nav aria-label="Settings" className="flex w-[260px] shrink-0 flex-col gap-1 border-r border-solid border-o-line bg-o-sidebar px-3 py-3.5">
        <div className="h-7" />
        <button type="button" onClick={() => useNav.getState().go({ kind: "chat" })}
          className="flex h-9 items-center gap-2 rounded-o-control px-2.5 text-left text-[14px] leading-5 text-o-text-2 outline-none hover:bg-o-hover focus-visible:outline-2 focus-visible:outline-o-focus cursor-default">
          <Symbol name="chevl" />Back to chat
        </button>
        {GRUPPEN.map((g) => (
          <div key={g.titel} className="flex flex-col gap-1">
            <div className="px-2.5 pb-1 pt-[18px] text-[12px] leading-4 text-o-text-3">{g.titel}</div>
            {g.seiten.map((s) => {
              const an = s.id === seite;
              return (
                <button key={s.id} type="button" aria-current={an ? "page" : undefined} onClick={() => geheZu(s.id)}
                  className={cx("flex h-9 items-center gap-2.5 rounded-o-control px-2.5 text-left text-[14px] leading-5 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-o-focus cursor-default", an ? "bg-o-selected font-medium text-o-text" : "text-o-text-2 hover:bg-o-hover")}>
                  <span className={an ? "text-o-text" : "text-o-text-2"}><Symbol name={s.symbol} /></span>{s.text}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div ref={rolle} className="min-w-0 flex-1 overflow-y-auto overscroll-contain" data-rolle
        onScroll={(e) => { const y = e.currentTarget.scrollTop; useEinst.setState((s) => ({ scroll: { ...s.scroll, [schluessel]: y } })); }}>
        <main className="mx-auto flex w-[640px] max-w-full flex-col gap-[22px] px-0 pb-14 pt-14">
          {seite !== "plugins" ? <h1 className="text-[22px] leading-7 font-semibold text-o-text">{TITEL[seite]}</h1> : null}
          {seite === "allgemein" ? <Allgemein /> : null}
          {seite === "darstellung" ? <Darstellung /> : null}
          {seite === "personalisierung" ? <Personalisierung /> : null}
          {seite === "plugins" ? (pluginId ? <PluginDetail key={pluginId} slug={pluginId} /> : <PluginListe />) : null}
          {seite === "nutzung" ? <Nutzung /> : null}
          {seite === "arbeitsumgebung" ? <Arbeitsumgebung /> : null}
          {seite === "sicherheit" ? <Sicherheit /> : null}
        </main>
      </div>
    </div>
  );
}

// Opens orbit:// product links from chat Markdown inside Orbit (never in the browser).
import { openResolved, resolveOrbitLink, type DestinationEffects, type LinkResolution } from "../../lib/destinations";
import { useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import { useEinst } from "../einstellungen/store";

export function resolveInApp(href: string): LinkResolution {
  const s = useOrbit.getState();
  return resolveOrbitLink(href, { bots: s.bots, main: s.main, groups: s.groups });
}

export const appEffects = (): DestinationEffects => ({
  goChat: () => useNav.getState().go({ kind: "chat" }),
  goSettings: (page, anchor) => {
    useEinst.setState({ anker: anchor ?? null });
    useNav.getState().go({ kind: "einstellungen", page });
  },
  goRoutines: () => useNav.getState().go({ kind: "routinen" }),
  goComputer: (botId) => useNav.getState().go({ kind: "computer", botId }),
  selectChat: (chatId) => useOrbit.getState().selectChat(chatId),
  setPanel: (tab) => useNav.getState().setPanel(tab),
  openOrbiEditor: (botId) => useNav.getState().openEditor({ kind: "orbi", botId }),
  openGroupEditor: (chatId) => useNav.getState().openEditor({ kind: "gruppe", chatId }),
});

/** Resolves and opens a link. Returns the resolution so the caller can show "not available" states. */
export async function openOrbitLink(href: string): Promise<LinkResolution> {
  const r = resolveInApp(href);
  if (r.kind === "ok") await openResolved(r, appEffects());
  return r;
}

// Registry of real Orbit destinations (contract 1.9 and "deep links").
// Built from the actual navigation in nav.ts, the settings pages (features/einstellungen) and the Orbi panel.
// The registry itself is plain JSON-serialisable data; availability is evaluated separately against app state.
// Product links (`orbit://…`) are handled only inside Orbit (chat Markdown). They are never handed to the OS
// and never mixed with the OAuth callback (`orbit-rust://auth/callback`, src-tauri/src/deeplink.rs).

/** Where a destination leads. `page` values are the internal settings page ids (store.ts `Seite`). */
export type DestinationTarget =
  | { view: "settings"; page: "allgemein" | "darstellung" | "personalisierung" | "plugins" | "nutzung" | "arbeitsumgebung" | "sicherheit"; anchor?: string }
  | { view: "routines" }
  | { view: "orbi"; tab: "overview" | "activity" | "library" | "computer" | "profile"; anchor?: string }
  | { view: "group"; tab: "members" }
  | { view: "none" };

export interface Destination {
  /** Stable key the service may use (never translated, never renamed). */
  key: string;
  /** English label shown in the product. */
  label: string;
  /** Link path below `orbit://`. `{id}` stands for an Orbi id (or group chat id). */
  path: string;
  /** What must exist for the link to open: an Orbi or a group owned by this profile. */
  requires: "orbi" | "group" | null;
  status: "available" | "unavailable";
  /** Why an unavailable destination cannot open in this build. */
  reason?: string;
  target: DestinationTarget;
}

const S = (key: string, label: string, path: string, page: Extract<DestinationTarget, { view: "settings" }>["page"], anchor?: string): Destination =>
  ({ key, label, path, requires: null, status: "available", target: anchor ? { view: "settings", page, anchor } : { view: "settings", page } });
const O = (key: string, label: string, path: string, tab: Extract<DestinationTarget, { view: "orbi" }>["tab"], anchor?: string): Destination =>
  ({ key, label, path, requires: "orbi", status: "available", target: anchor ? { view: "orbi", tab, anchor } : { view: "orbi", tab } });
const U = (key: string, label: string, path: string, reason: string, requires: Destination["requires"] = null): Destination =>
  ({ key, label, path, requires, status: "unavailable", reason, target: { view: "none" } });

/** Every destination Orbit knows. Order = display order. */
export const DESTINATIONS: readonly Destination[] = [
  // Settings: General
  S("settings.general", "General", "settings/general", "allgemein"),
  S("settings.app", "Orbit app behaviour", "settings/app", "allgemein", "app"),
  S("settings.language", "Language", "settings/language", "allgemein", "app"),
  S("settings.notifications", "Notifications", "settings/notifications", "allgemein", "notifications"),
  S("settings.sounds", "Notification sounds", "settings/sounds", "allgemein", "notifications"),
  S("settings.account", "Account", "settings/account", "allgemein", "account"),
  // Settings: Appearance
  S("settings.appearance", "Appearance", "settings/appearance", "darstellung"),
  S("settings.theme", "Theme", "settings/theme", "darstellung", "look"),
  S("settings.accent", "Accent colour", "settings/accent", "darstellung", "look"),
  // Settings: Personalization
  S("settings.personalization", "Personalization", "settings/personalization", "personalisierung"),
  S("settings.about-you", "About you", "settings/about-you", "personalisierung", "about-you"),
  S("settings.instructions", "Shared instructions", "settings/instructions", "personalisierung", "instructions"),
  S("settings.memory", "Memory", "settings/memory", "personalisierung", "memory"),
  // Settings: Services and usage
  S("settings.connectors", "Plugins and connectors", "settings/connectors", "plugins"),
  S("settings.marketplace", "Plugin marketplace", "settings/marketplace", "plugins"),
  S("settings.usage", "Usage", "settings/usage", "nutzung"),
  S("settings.limits", "Limits per provider", "settings/limits", "nutzung", "limits"),
  // Settings: System and access
  S("settings.workspace", "Workspace", "settings/workspace", "arbeitsumgebung"),
  S("settings.programs", "Programs", "settings/programs", "arbeitsumgebung", "programs"),
  S("settings.computer", "Computer (local execution)", "settings/computer", "arbeitsumgebung", "computer"),
  S("settings.default-model", "Default model", "settings/default-model", "arbeitsumgebung", "default-model"),
  S("settings.security", "Security", "settings/security", "sicherheit"),
  S("settings.rules", "Review rules (always allowed)", "settings/rules", "sicherheit", "rules"),
  S("settings.mac-access", "Mac access", "settings/mac-access", "sicherheit", "mac-access"),
  // Main views
  { key: "routines", label: "Routines", path: "routines", requires: null, status: "available", target: { view: "routines" } },
  // Orbi details (right panel, computer view, editor)
  O("orbi.overview", "Orbi overview", "orbi/{id}", "overview"),
  O("orbi.routines", "Orbi routines", "orbi/{id}/routines", "overview", "routines"),
  O("orbi.activity", "Orbi activity", "orbi/{id}/activity", "activity"),
  O("orbi.library", "Orbi library", "orbi/{id}/library", "library"),
  O("orbi.media", "Orbi media", "orbi/{id}/media", "library"),
  O("orbi.computer", "Orbi computer", "orbi/{id}/computer", "computer"),
  O("orbi.profile", "Orbi profile", "orbi/{id}/profile", "profile"),
  { key: "group.members", label: "Group members", path: "group/{id}/members", requires: "group", status: "available", target: { view: "group", tab: "members" } },
  // Destinations without a surface in this build (release blockers, see report)
  U("settings.microphone", "Microphone", "settings/microphone", "Orbit has no microphone settings in this build."),
  U("settings.timezone", "Time zone", "settings/timezone", "Orbit uses the Mac time zone; there is no time zone setting in this build."),
  U("settings.spelling", "Spelling", "settings/spelling", "Orbit has no spelling settings in this build."),
  U("settings.updates", "Updates", "settings/updates", "Orbit has no update settings in this build."),
  U("settings.network", "Network diagnostics", "settings/network", "Orbit has no network diagnostics in this build."),
  U("settings.restart", "Acceleration and restart", "settings/restart", "Orbit has no acceleration or restart settings in this build."),
  U("settings.billing", "Plan and billing", "settings/billing", "Orbit has no plan or billing page in this build."),
  U("settings.security-key", "Security key", "settings/security-key", "Orbit has no security key settings in this build."),
  U("settings.computer-recovery", "Computer update and recovery", "settings/computer-recovery", "Orbit has no computer update or recovery page in this build."),
  U("templates.shared", "Shared template", "templates/{id}", "Shared templates are not available in this build."),
  U("orbi.members", "Orbi members", "orbi/{id}/members", "Orbis have no member list in this build; group members are under group/{id}/members.", "orbi"),
];

/** Copy of the registry for the service or for tests (plain JSON, no functions). */
export function getDestinationRegistry(): Destination[] {
  return JSON.parse(JSON.stringify(DESTINATIONS));
}

/** Keys of the destinations that can open in this build (what the service may link to). */
export function destinationKeys(opts: { includeUnavailable?: boolean } = {}): string[] {
  return DESTINATIONS.filter((d) => opts.includeUnavailable || d.status === "available").map((d) => d.key);
}

export function destinationByKey(key: string): Destination | undefined {
  return DESTINATIONS.find((d) => d.key === key);
}

/** Link for a destination, e.g. `orbit://orbi/mira/routines`. */
export function destinationLink(key: string, id?: string): string | null {
  const d = destinationByKey(key);
  if (!d) return null;
  if (d.path.includes("{id}")) {
    if (!id) return null;
    return `orbit://${d.path.replace("{id}", encodeURIComponent(id))}`;
  }
  return `orbit://${d.path}`;
}

// ---------- Link handling ----------

/** Minimal state needed to check ownership (subset of the Orbit store). */
export interface DestinationState {
  bots: { id: string; chatId: string; name?: string }[];
  main?: { id: string; chatId: string; name?: string } | null;
  groups: { id: string; name?: string }[];
}

export type LinkResolution =
  | { kind: "ok"; destination: Destination; id?: string; chatId?: string }
  | { kind: "unavailable"; destination?: Destination; message: string }
  | { kind: "unknown"; message: string };

export const NOT_AVAILABLE = "Not available in this build.";

export const isOrbitLink = (href: string) => /^orbit:\/\//i.test(href.trim());

function segmente(href: string): string[] | null {
  const m = /^orbit:\/\/([^?#]*)/i.exec(href.trim());
  if (!m) return null;
  try {
    return m[1].split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
}

/** Matches a link to a registry entry and checks that the Orbi or group belongs to this profile. */
export function resolveOrbitLink(href: string, state: DestinationState): LinkResolution {
  const teile = segmente(href);
  if (!teile || teile.length === 0) return { kind: "unknown", message: `Unknown Orbit link. ${NOT_AVAILABLE}` };
  let gefunden: { d: Destination; id?: string } | null = null;
  for (const d of DESTINATIONS) {
    const muster = d.path.split("/");
    if (muster.length !== teile.length) continue;
    let id: string | undefined;
    const passt = muster.every((p, i) => {
      if (p === "{id}") { id = teile[i]; return true; }
      return p.toLowerCase() === teile[i].toLowerCase();
    });
    if (passt) { gefunden = { d, id }; break; }
  }
  if (!gefunden) return { kind: "unknown", message: `Unknown Orbit link. ${NOT_AVAILABLE}` };
  const { d, id } = gefunden;
  if (d.status !== "available") return { kind: "unavailable", destination: d, message: `${d.label}: ${d.reason ?? NOT_AVAILABLE}` };
  if (d.requires === "orbi") {
    const alle = [...(state.main ? [state.main] : []), ...state.bots];
    const bot = alle.find((b) => b.id === id || b.chatId === id);
    if (!bot) return { kind: "unavailable", destination: d, message: `${d.label}: this Orbi was not found. ${NOT_AVAILABLE}` };
    return { kind: "ok", destination: d, id: bot.id, chatId: bot.chatId };
  }
  if (d.requires === "group") {
    const g = state.groups.find((x) => x.id === id);
    if (!g) return { kind: "unavailable", destination: d, message: `${d.label}: this group was not found. ${NOT_AVAILABLE}` };
    return { kind: "ok", destination: d, id: g.id, chatId: g.id };
  }
  return { kind: "ok", destination: d };
}

/** Side effects needed to show a destination; injected so the logic stays testable without the real stores. */
export interface DestinationEffects {
  goChat: () => void;
  goSettings: (page: string, anchor?: string) => void;
  goRoutines: () => void;
  goComputer: (botId: string) => void;
  selectChat: (chatId: string) => Promise<void> | void;
  setPanel: (tab: "uebersicht" | "aktivitaet" | "bibliothek") => void;
  openOrbiEditor: (botId: string) => void;
  openGroupEditor: (chatId: string) => void;
}

const PANEL = { overview: "uebersicht", activity: "aktivitaet", library: "bibliothek" } as const;

/** Opens a resolved destination. Returns false when nothing could be opened. */
export async function openResolved(r: LinkResolution, fx: DestinationEffects): Promise<boolean> {
  if (r.kind !== "ok") return false;
  const t = r.destination.target;
  switch (t.view) {
    case "settings":
      fx.goSettings(t.page, t.anchor);
      return true;
    case "routines":
      fx.goRoutines();
      return true;
    case "orbi": {
      if (!r.id || !r.chatId) return false;
      if (t.tab === "computer") {
        await fx.selectChat(r.chatId);
        fx.goComputer(r.id);
        return true;
      }
      fx.goChat();
      await fx.selectChat(r.chatId);
      if (t.tab === "profile") {
        fx.openOrbiEditor(r.id);
        return true;
      }
      fx.setPanel(PANEL[t.tab]);
      return true;
    }
    case "group":
      if (!r.chatId) return false;
      fx.goChat();
      await fx.selectChat(r.chatId);
      fx.openGroupEditor(r.chatId);
      return true;
    case "none":
      return false;
  }
}

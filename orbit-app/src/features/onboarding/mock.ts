// Gespielter Dienst für Vorschauseiten und Tests (nur Mock-Antworten, nichts Echtes: weder Schlüssel noch Konten).
// Ersetzt invoke("api_request") der Tauri-Hülle; der Produktionscode bleibt unverändert.
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

type Q = URLSearchParams;
export type Handler = (body: any, query: Q, teile: string[]) => unknown;
export interface MockOptionen {
  /** Zusätzliche oder überschriebene Routen: Schlüssel "GET /v1/x" oder "GET /v1/plugins/*". */
  routen?: Record<string, Handler>;
  /** Aufrufprotokoll für Tests. */
  log?: { methode: string; pfad: string; body: unknown }[];
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export const BOTS = [
  { id: "b1", chatId: "c1", name: "Mira", avatar: "strobi", color: "#de3a8e", job: "Hauptorbi", instructions: "", isMain: true, onboardingDone: true, look: null, lastMessageAt: null },
  { id: "b2", chatId: "c2", name: "Nova", avatar: "nova", color: "#df6521", job: "Gliederungen", instructions: "", isMain: false, onboardingDone: true, look: null, lastMessageAt: null },
];

const PERMS = [
  ["accessibility", "Bedienungshilfen"], ["screen", "Bildschirmaufnahme"], ["full_disk", "Festplattenvollzugriff"],
  ["automation_calendar", "Kalender"], ["automation_reminders", "Erinnerungen"], ["automation_contacts", "Kontakte"],
  ["automation_notes", "Notizen"], ["automation_system_events", "System Events"], ["automation_safari", "Safari"], ["automation_finder", "Finder"],
];

const PLUGINS = [
  ["gmail", "Gmail", "Mails lesen, suchen und entwerfen", "connected", ["Nachrichten"]],
  ["googlecalendar", "Google Kalender", "Termine lesen und eintragen", "connected", ["Planung"]],
  ["googledrive", "Google Drive", "Dateien finden und ablegen", "none", ["Dateien"]],
  ["github", "GitHub", "Issues und Pull Requests", "connected", ["Entwicklung"]],
  ["notion", "Notion", "Seiten lesen und schreiben", "none", ["Wissen"]],
  ["slack", "Slack", "Kanäle lesen und zusammenfassen", "none", ["Nachrichten"]],
  ["todoist", "Todoist", "Aufgaben anlegen und abhaken", "none", ["Planung"]],
  ["linear", "Linear", "Tickets anlegen und verwalten", "none", ["Entwicklung"]],
  ["dropbox", "Dropbox", "Dateien finden und teilen", "none", ["Dateien"]],
  ["figma", "Figma", "Entwürfe lesen und kommentieren", "none", ["Design"]],
  ["spotify", "Spotify", "Musik abspielen und finden", "none", ["Musik"]],
].map(([slug, name, description, connectionStatus, categories]) => ({
  id: `composio:${slug}`, slug, name, description, logoUrl: null, categories, authSchemes: ["OAUTH2"], managedAuthSchemes: ["OAUTH2"],
  authMode: "managed", connectionStatus, source: "Composio",
}));

/** Zustand, den Tests und Vorschauen auslesen können. */
export function neuerZustand() {
  return {
    konto: { ok: true, configured: true, mode: null as null | string, email: null as null | string, phase: "start" as string },
    supabase: { signedIn: false, configured: true, email: null as null | string, displayName: null as null | string, photoUrl: null as null | string, userId: null as null | string,
      signInMethod: null as null | string,
      signupFehler: null as null | { code: string; message: string },
      googleFehler: null as null | { code: string; message: string; email?: string },
      otpEmail: null as null | string, otpArt: "signup" as "signup" | "login",
      abbruch: undefined as undefined | (() => void), fertig: undefined as undefined | (() => void) },
    keys: { daytona: false, jev: false },
    jevAuto: true,
    jevHandoff: false,
    budget: { jevDailyUsd: 0.5, maxSandboxes: 3 },
    profilRequired: true,
    perms: PERMS.map(([id, label]) => ({ id, label, status: "unknown" as string, settingsUrl: "x-apple.systempreferences:", detail: `Noch nicht geprüft: ${label}.` })),
    macAn: false,
    clis: [
      { id: "claude", label: "Claude Code", installed: true, version: "2.4.1", loggedIn: true, state: "bereit", message: "Angemeldet · Version 2.4" },
      { id: "codex", label: "Codex", installed: true, version: "0.163.0", loggedIn: true, state: "bereit", message: "Angemeldet mit ChatGPT" },
      { id: "cursor", label: "Cursor", installed: false, version: null, loggedIn: false, state: "fehlt", message: "Nicht installiert" },
      { id: "agy", label: "Antigravity", installed: true, version: "1.5.6", loggedIn: false, state: "abgemeldet", message: "Abgemeldet" },
    ] as any[],
    profil: {
      name: "Consti", occupation: "", answerLength: "standard", learn: true, backgroundWork: true, loginOpen: false, language: "de",
      notificationsDone: true, notificationsAttention: true, notificationsApprovals: true, sound: false, reducedMotion: "system",
      defaultModel: "auto", defaultEffort: null as string | null, defaultFast: false, cloud: true, sleepMinutes: 10,
    } as any,
    bots: clone(BOTS),
    entwurf: {} as Record<string, unknown>,
    theme: "light",
    instructions: null as null | string,
    icon: null as any,
    rules: [
      { id: "r1", tool: "calendar_write", botId: "b1", botName: "Mira", mode: "allow" },
      { id: "r2", tool: "brain_write", botId: null, botName: null, mode: "allow" },
      { id: "r3", tool: "mail_draft", botId: "b1", botName: "Mira", mode: "allow" },
    ] as any[],
    pluginOrbis: {} as Record<string, string[] | null>,
    plugins: clone(PLUGINS) as any[],
    mcp: [] as any[],
  };
}
export type MockZustand = ReturnType<typeof neuerZustand>;

const STANDARD_ANLEITUNG = "Antworte auf Deutsch, kurz und einfach. Frag nach, bevor du etwas löschst, sendest oder bezahlst.";
function fehler(t: string): never { throw t; }

function wochen(tage: number) {
  const heute = new Date("2026-11-18T12:00:00");
  const out = [];
  for (let i = tage - 1; i >= 0; i--) {
    const d = new Date(heute); d.setDate(heute.getDate() - i);
    const k = (n: number) => Math.round(n * (0.4 + ((i * 7 + 3) % 10) / 10));
    out.push({
      date: d.toISOString().slice(0, 10),
      entries: {
        claude: { input: k(1_400_000), output: k(190_000), costEur: 5.1, inputEur: 3, outputEur: 2.1, missingCost: false },
        codex: { input: k(900_000), output: k(120_000), costEur: 3.2, inputEur: 1.9, outputEur: 1.3, missingCost: false },
        cursor: { input: k(300_000), output: k(40_000), costEur: 1.1, inputEur: 0.7, outputEur: 0.4, missingCost: false },
        agy: { input: k(120_000), output: k(20_000), costEur: 0.4, inputEur: 0.2, outputEur: 0.2, missingCost: false },
      },
    });
  }
  return out;
}

export function routen(z: MockZustand): Record<string, Handler> {
  return {
    "GET /v1/health": (_b, q) => q.get("checks") ? { ok: true, checks: [
      { id: "claude", label: "Claude", optional: false, state: "ok" },
      { id: "codex", label: "Codex", optional: false, state: "ok" },
      { id: "cursor", label: "Cursor", optional: true, state: "fehlt", fix: "Install cursor-agent and sign in." },
      { id: "agy", label: "Antigravity", optional: true, state: "fehler", fix: "Melde dich selbst bei Antigravity an." },
      { id: "brain", label: "Brain", optional: true, state: "ok" },
    ] } : { ok: true },
    "GET /v1/setup/profile": () => ({ ok: true, required: z.profilRequired, draft: z.entwurf }),
    "PUT /v1/setup/profile": (b) => { z.entwurf = { ...z.entwurf, ...b }; return { ok: true }; },
    "POST /v1/setup/profile/finish": () => ({ ok: true }),
    "GET /v1/setup/account": () => z.konto,
    "POST /v1/setup/account/*": (b, _q, t) => {
      const a = t[t.length - 1];
      if (a === "signup" || a === "signin") {
        if (!b.email || !/@/.test(b.email) || !b.password) fehler("E-Mail und Passwort eingeben.");
        return { ok: true, phase: "code", email: b.email };
      }
      if (a === "verify") { if (b.code !== "123456") fehler("That code is wrong. Check it and try again."); z.konto.phase = "done"; return { ok: true, phase: "done" }; }
      if (a === "local") { z.konto.mode = "local"; z.konto.phase = "done"; return { ok: true, phase: "done" }; }
      if (a === "supabase") {
        if (!b.id) fehler("Die Supabase-Anmeldung hat keine gültige Kennung geliefert.");
        z.konto.mode = "supabase"; z.konto.email = b.email ?? null; z.konto.phase = "done";
        return { ok: true, phase: "done", email: b.email };
      }
      if (a === "google") return { ok: true, phase: "browser", url: "https://accounts.example.test/oauth" };
      if (a === "logout") { z.konto.phase = "start"; z.konto.mode = null; z.konto.email = null; return { ok: true, phase: "start" }; }
      return { ok: true, phase: "code" };
    },
    "GET /v1/clis": () => ({ ok: true, clis: clone(z.clis) }),
    "POST /v1/clis/*/*": (_b, _q, t) => {
      const id = t[t.length - 2], a = t[t.length - 1];
      const c = z.clis.find((x) => x.id === id);
      if (!c) fehler("Programm nicht gefunden.");
      if (a === "login" && id === "agy") fehler("Antigravity has no separate sign-in command. Open Antigravity once and sign in there in the browser.");
      if (a === "install") { c.state = "laeuft"; c.message = "Installation in progress."; }
      if (a === "login") return { ok: true, url: "https://login.example.test/code", code: null };
      return { ok: true };
    },
    "GET /v1/mac/access": () => ({ enabled: z.macAn, permissions: z.perms }),
    "POST /v1/mac/access": (b) => { z.macAn = !!b.enabled; return { ok: true, enabled: z.macAn }; },
    "POST /v1/mac/permissions/request": (b) => {
      const p = z.perms.find((x) => x.id === b.id);
      if (!p) fehler("Unbekannte Berechtigung.");
      if (b.id === "full_disk") return { ok: true, permission: { ...p, detail: "Fehlt: geschützte Ordner lesen. Erlaube „Python“ in den Systemeinstellungen unter Datenschutz & Sicherheit › Festplattenvollzugriff." } };
      p.status = "granted"; p.detail = `Erlaubt: ${p.label}.`;
      return { ok: true, permission: p };
    },
    "GET /v1/plugins": (_b, q) => {
      let l = z.plugins;
      const s = (q.get("search") ?? "").toLowerCase(), c = q.get("category"), v = q.get("connected");
      if (s) l = l.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(s));
      if (c && c !== "recommended") l = l.filter((p) => p.categories.includes(c));
      if (v === "true") l = l.filter((p) => p.connectionStatus === "connected");
      return { ok: true, configured: true, entries: l, nextCursor: null, totalItems: l.length, recommendedCount: 3,
        categories: ["Nachrichten", "Planung", "Dateien", "Wissen", "Entwicklung", "Design", "Musik"].map((name) => ({ id: name, name })) };
    },
    "POST /v1/plugins/*/connect": (_b, _q, t) => ({ ok: true, url: "https://connect.example.test/link", accountId: "ca_demo", connectionStatus: "pending", slug: t[t.length - 2] }),
    "GET /v1/plugins/*/entry": (_b, _q, t) => ({ ok: true, entry: z.plugins.find((p) => p.slug === t[t.length - 2]) ?? fehler("Dienst nicht gefunden.") }),
    "GET /v1/plugins/*/status": () => ({ ok: true, connectionStatus: "connected", toolsEnabled: false, toolsStatus: "not_checked", accessMode: "individual_actions" }),
    "GET /v1/plugins/*/accounts": () => ({ ok: true, accounts: [{ id: "ca_demo", status: "ACTIVE" }] }),
    "DELETE /v1/plugins/*/accounts": (b) => ({ ok: true, deletedIds: b.accountIds, failedIds: [], notice: "Die Verbindung ist getrennt. Rechte beim Anbieter widerrufst du dort." }),
    "GET /v1/plugins/*/setup": (_b, _q, t) => ({ ok: true, slug: t[t.length - 2], name: "Dienst", guideUrl: "https://docs.example.test/setup", schemes: [], credentialDestination: "composio", connectionFieldsHosted: [], oauthRedirectUrl: "https://example.test/cb", notice: "" }),
    "GET /v1/plugins/*/orbis": (_b, _q, t) => ({ ok: true, botIds: z.pluginOrbis[t[t.length - 2]] ?? null }),
    "PUT /v1/plugins/*/orbis": (b, _q, t) => { z.pluginOrbis[t[t.length - 2]] = b.botIds; return { ok: true, botIds: b.botIds }; },
    "GET /v1/plugins/*/actions": () => ({ ok: true, executed: false, nextCursor: null, actions: [
      { id: "GMAIL_SEARCH", label: "Mails suchen", description: "search_threads", readOnly: true },
      { id: "GMAIL_GET", label: "Mail lesen", description: "get_thread", readOnly: true },
      { id: "GMAIL_LABELS", label: "Labels anzeigen", description: "list_labels", readOnly: true },
      { id: "GMAIL_DRAFT", label: "Entwurf schreiben", description: "create_draft", readOnly: false },
      { id: "GMAIL_LABEL", label: "Labels ändern", description: "label_thread", readOnly: false },
    ] }),
    "GET /v1/mcp-servers": () => ({ ok: true, servers: z.mcp }),
    "POST /v1/mcp-servers": (b) => {
      if (!b.name || b.name.length < 2) fehler("Name: 2–40 Zeichen, nur Kleinbuchstaben, Ziffern und Bindestriche.");
      const s = { name: b.name, transport: b.transport, url: b.url ?? null, command: b.command ?? null, args: b.args ?? [], enabled: true, hasToken: false, status: "verbunden", error: null, tools: [] };
      z.mcp.push(s); return { ok: true, server: s };
    },
    "DELETE /v1/mcp-servers/*": (_b, _q, t) => { z.mcp = z.mcp.filter((s) => s.name !== t[t.length - 1]); return { ok: true }; },
    "POST /v1/mcp-servers/*/test": () => ({ ok: true, count: 0, tools: [] }),
    "GET /v1/settings": () => ({ ok: true, settings: { theme: z.theme, jevAuto: z.jevAuto ?? true, jevHandoff: z.jevHandoff ?? false, baseInstructions: z.instructions } }),
    "PUT /v1/settings/jev": (b) => {
      if (typeof b.auto === "boolean") z.jevAuto = b.auto;
      if (typeof b.handoff === "boolean") z.jevHandoff = b.handoff;
      return { ok: true };
    },
    "GET /v1/keys": () => ({ ok: true, keys: [
      { name: "DAYTONA_API_KEY", label: "Daytona", set: !!z.keys?.daytona, source: z.keys?.daytona ? "schluesselbund" : null, liveReload: true },
      { name: "OPENROUTER_JEV_API_KEY", label: "Jev", set: !!z.keys?.jev, source: z.keys?.jev ? "schluesselbund" : null, liveReload: true },
    ] }),
    "PUT /v1/keys/*": (b, _q, t) => {
      const name = t[t.length - 1];
      if (!b.key || typeof b.key !== "string") fehler("Gib einen gültigen Schlüssel ein.");
      z.keys = z.keys ?? { daytona: false, jev: false };
      if (name === "DAYTONA_API_KEY") z.keys.daytona = true;
      else if (name === "OPENROUTER_JEV_API_KEY") z.keys.jev = true;
      else fehler("Unbekannter Schlüssel.");
      return { ok: true, set: true };
    },
    "PUT /v1/budget": (b) => {
      z.budget = { ...(z.budget ?? { jevDailyUsd: 0.5, maxSandboxes: 3 }), ...b };
      return { ok: true, budget: z.budget, jev: { spentUsd: 0, state: "ok", percent: 0 }, sandboxes: { active: 0, max: z.budget.maxSandboxes, waiting: 0 }, tokens: [] };
    },
    "PUT /v1/settings/theme": (b) => { z.theme = b.theme; return { ok: true }; },
    "GET /v1/settings/profile": () => ({ ok: true, profile: z.profil }),
    "PUT /v1/settings/profile": (b) => {
      if (typeof b.name === "string" && b.name.trim().length > 40) fehler("Use at most 40 characters.");
      z.profil = { ...z.profil, ...b }; return { ok: true };
    },
    "GET /v1/settings/icon": () => ({ ok: true, icon: z.icon }),
    "PUT /v1/settings/icon": (b) => { z.icon = b; return { ok: true, icon: b }; },
    "DELETE /v1/settings/icon": () => { z.icon = null; return { ok: true }; },
    "PUT /v1/settings/instructions": (b) => { if ((b.instructions ?? "").length > 8000) fehler("Die Anleitung darf höchstens 8.000 Zeichen lang sein."); z.instructions = b.instructions || null; return { ok: true }; },
    "GET /v1/settings/instructions/default": () => ({ ok: true, text: STANDARD_ANLEITUNG, limit: 8000 }),
    "GET /v1/settings/rules": () => ({ ok: true, rules: z.rules }),
    "DELETE /v1/settings/rules/*": (_b, _q, t) => { z.rules = z.rules.filter((r) => r.id !== t[t.length - 1]); return { ok: true }; },
    "GET /v1/budget": () => ({ ok: true, budget: z.budget ?? { jevDailyUsd: 2, maxSandboxes: 3 }, jev: { spentUsd: 0.4, state: "ok", percent: 20 }, sandboxes: { active: 0, max: 3, waiting: 0 }, tokens: [] }),
    "GET /v1/models": () => ({ ok: true, modelsAvailable: true, models: [
      { id: "opus", label: "Claude Opus", description: "Stark für schwierige Aufgaben", provider: "anthropic", efforts: ["low", "medium", "high", "xhigh", "max"], fast: false, legacy: false, cli: { provider: "claude", model: "opus" } },
      { id: "gpt", label: "GPT-6.1 Terra", description: "Schnell und günstig", provider: "openai", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], fast: true, legacy: false, cli: { provider: "codex", model: "gpt" } },
      { id: "gpt-alt", label: "GPT-6 Sol", description: "Für schwere Aufgaben", provider: "openai", efforts: ["low", "high"], fast: true, legacy: true, cli: { provider: "codex", model: "gpt-alt" } },
      { id: "flash", label: "Gemini 3.8 Flash", description: "Schnell, mit wählbarem Denken", provider: "google", efforts: ["low", "medium", "high"], fast: false, legacy: false, cli: { provider: "agy", model: "flash" } },
      { id: "cursor:composer-test[fast=true]", label: "Cursor Composer Fast", description: "composer-test[fast=true]", provider: "cursor", efforts: [], fast: false, legacy: false, cli: { provider: "cursor", model: "composer-test[fast=true]" } },
      { id: "cursor-auto", label: "Cursor Auto", description: "Cursor wählt selbst", provider: "cursor", efforts: [], fast: false, legacy: false, cli: { provider: "cursor", model: "auto" } },
    ] }),
    "GET /v1/usage": () => ({ ok: true, fetchedAt: 1, providers: [
      { provider: "claude", status: "ok", accounts: [{ id: "cli", label: "Claude", status: "ok", windows: [
        { name: "5 Stunden", used: 0.43, resetAt: Date.parse("2026-11-18T16:20:00") }, { name: "Woche", used: 0.62, resetAt: Date.parse("2026-11-23T09:00:00") } ] }] },
      { provider: "codex", status: "ok", accounts: [{ id: "cli", label: "Codex", status: "ok", windows: [
        { name: "5 Stunden", used: 0.18, resetAt: Date.parse("2026-11-18T15:05:00") }, { name: "Woche", used: 0.28, resetAt: Date.parse("2026-11-19T11:00:00") } ] }] },
      { provider: "cursor", status: "limit", note: "Pausiert bis 14:00", accounts: [{ id: "cli", label: "Cursor", status: "limit", windows: [
        { name: "5 Stunden", used: 1, resetAt: Date.parse("2026-11-18T14:00:00") }, { name: "Woche", used: 0.71, resetAt: Date.parse("2026-11-22T20:00:00") } ] }] },
      { provider: "antigravity", status: "error", note: "Noch keine Werte. Sie kommen mit der nächsten Antwort.", accounts: [] },
    ] }),
    "GET /v1/usage/history": (_b, q) => ({ ok: true, days: wochen(q.get("period") === "month" ? 30 : 7), fxConfigured: true, priceDate: "2026-11-01", estimated: true, currency: "EUR" }),
    "POST /v1/bots": (b) => {
      if (!b.name || !String(b.name).trim()) fehler("Gib deinem Orbi einen Namen");
      return { ok: true, id: "neu1", chatId: "neuchat" };
    },
    "GET /v1/bots": () => ({ ok: true, groups: [], main: z.bots[0] ?? null, bots: z.bots }),
    "GET /v1/chats": () => ({ ok: true, chats: [] }),
  };
}

function finde(tab: Record<string, Handler>, methode: string, pfad: string): [Handler | undefined, string[]] {
  const teile = pfad.split("/").filter(Boolean);
  const direkt = tab[`${methode} ${pfad}`];
  if (direkt) return [direkt, teile];
  for (const [k, h] of Object.entries(tab)) {
    const [m, muster] = k.split(" ");
    if (m !== methode || !muster.includes("*")) continue;
    const mt = muster.split("/").filter(Boolean);
    if (mt.length !== teile.length) continue;
    if (mt.every((x, i) => x === "*" || x === teile[i])) return [h, teile];
  }
  return [undefined, teile];
}

/** Gespieltes Supabase-Konto der Hülle (account_*): nur Mock-Antworten, kein Netz. */
function kontoBefehl(z: MockZustand, cmd: string, args: any): Promise<unknown> {
  const f = z.supabase;
  const an = (email: string, method: string) => { f.signedIn = true; f.signInMethod = method; f.email = email; f.displayName = "Mira"; f.userId = "user-mock"; return { ...f }; };
  switch (cmd) {
    case "account_status": return Promise.resolve({ ...f });
    case "account_sign_up": case "account_sign_in":
      if (cmd === "account_sign_up" && f.signupFehler) return Promise.reject(f.signupFehler);
      if (!f.configured) return Promise.reject("Supabase ist noch nicht eingerichtet.");
      if (!args.email || !args.password) return Promise.reject("E-Mail und Passwort eingeben.");
      f.otpEmail = args.email;
      f.otpArt = cmd === "account_sign_up" ? "signup" : "login";
      return Promise.reject({ code: "otp_required", message: "Wir haben dir einen Code geschickt. Gib ihn in Orbit ein.", email: args.email });
    case "account_verify_otp":
      if (String(args?.token) !== "123456") return Promise.reject({ code: "auth_failed", message: "Dieser Code stimmt nicht oder ist abgelaufen. Bitte erneut versuchen." });
      return Promise.resolve(an(String(args?.email || f.otpEmail || "a@b.de"), "email"));
    case "account_resend_otp": return Promise.resolve(null);
    case "account_sign_in_google":
    case "account_sign_in_oauth": {
      if (!f.configured) return Promise.reject("Supabase ist noch nicht eingerichtet.");
      const anbieter = cmd === "account_sign_in_oauth" ? String(args?.provider ?? "google") : "google";
      if (!["google", "github"].includes(anbieter)) return Promise.reject("Unbekannte Anmeldeart.");
      return new Promise((ok, nein) => {
        f.abbruch = () => nein("Die Anmeldung wurde abgebrochen.");
        f.fertig = () => { if (f.googleFehler) nein(f.googleFehler); else ok(an(`${anbieter}@beispiel.de`, anbieter)); };
      });
    }
    case "account_reset_password":
    case "account_confirm_password_reset": return Promise.resolve(null);
    case "account_update_profile":
      f.displayName = args.displayName; return Promise.resolve({ ...f });
    case "account_change_password": return Promise.resolve(null);
    case "account_cancel": f.abbruch?.(); return Promise.resolve(null);
    case "account_sign_out": f.signedIn = false; f.email = null; f.displayName = null; f.userId = null; f.signInMethod = null; return Promise.resolve(null);
    default: return Promise.resolve(undefined);
  }
}

/** Installiert den Mock; gibt Zustand und Abbau zurück. */
export function mockDienst(opt: MockOptionen = {}) {
  const zustand = neuerZustand();
  const tab = { ...routen(zustand), ...(opt.routen ?? {}) };
  mockIPC((cmd, args: any) => {
    if (cmd.startsWith("account_")) return kontoBefehl(zustand, cmd, args);
    if (cmd !== "api_request") return undefined;
    const { method, path, body } = args as { method: string; path: string; body: unknown };
    const [pfad, qs] = path.split("?");
    opt.log?.push({ methode: method, pfad: path, body });
    const [h, teile] = finde(tab, method, pfad);
    if (!h) return Promise.reject(`Nicht gefunden: ${method} ${pfad}`);
    try {
      return Promise.resolve(h(body, new URLSearchParams(qs ?? ""), teile));
    } catch (e) {
      return Promise.reject(e);
    }
  });
  return { zustand, abbauen: () => clearMocks() };
}

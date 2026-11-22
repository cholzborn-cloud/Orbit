// Routen von orbitd, die Erststart und Einstellungen brauchen und die lib/api.ts (noch) nicht kennt.
// Nur Durchreichen. Quelle: docs/neubau/SCHNITTSTELLE.md 2.1, 2.7, 2.9, 2.10 und orbitd/orbitd/routes/*.py (setup, account, mac, settings, marketplace).
import { apiRequest, openUrl, type Json } from "../../lib/tauri";
import { invoke } from "@tauri-apps/api/core";
import { useProfilName } from "../../lib/profil";

export { openUrl };
const enc = encodeURIComponent;

// ---------- Konto (routes/account.py) ----------
export interface KontoStatus {
  ok: boolean;
  configured: boolean;
  mode?: "clerk" | "local" | "supabase" | null;
  email?: string | null;
  phase: "start" | "code" | "browser" | "done";
}
export interface KontoAntwort { ok: boolean; phase: KontoStatus["phase"]; email?: string; url?: string }
export const kontoStatus = () => apiRequest<KontoStatus>("GET", "/v1/setup/account");
export const kontoAktion = (aktion: "signup" | "signin" | "verify" | "resend" | "google" | "callback" | "local" | "supabase" | "cancel" | "logout", body: Record<string, Json> = {}) =>
  apiRequest<KontoAntwort>("POST", `/v1/setup/account/${aktion}`, body);

// ---------- Erststart-Entwurf (routes/setup.py) ----------
export interface ProfilStatus {
  ok: boolean;
  required: boolean;
  draft: Record<string, string | number>;
  completedChat?: string;
}
export interface ProfilEntwurf {
  step: number;
  name?: string; job?: string; avatar?: string; color?: string; budgetUsd?: string; budgetMax?: string; macEnabled?: string; person?: string;
}
export const profilStatus = () => apiRequest<ProfilStatus>("GET", "/v1/setup/profile");
export const entwurfSpeichern = (e: ProfilEntwurf) => apiRequest<{ ok: boolean }>("PUT", "/v1/setup/profile", e as unknown as Json);
export const erststartAbschliessen = () => apiRequest<{ ok: boolean }>("POST", "/v1/setup/profile/finish");

/** POST /v1/bots mit `first: true`: der Dienst legt den ersten Orbi an (oder liefert den vorhandenen). */
export const ersterOrbi = (o: { name: string; job: string; avatar: string; color: string }) =>
  apiRequest<{ ok: boolean; id: string; chatId: string }>("POST", "/v1/bots", { ...o, isMain: true, first: true });

// ---------- Programme (routes/setup.py, cli/setup.py) ----------
export type CliZustand = "bereit" | "abgemeldet" | "fehlt" | "fehler" | "laeuft";
export interface Cli {
  id: "claude" | "codex" | "cursor" | "agy" | string;
  label: string;
  installed: boolean;
  version: string | null;
  loggedIn: boolean;
  accountEmail?: string;
  state: CliZustand;
  message?: string;
  /** Der Dienst liefert die Art des laufenden Vorgangs ("install" | "login") oder null. */
  busy?: "install" | "login" | "disconnect" | boolean | null;
  loginUrl?: string | null;
  loginCode?: string | null;
  /** Art der Anmeldung (kann fehlen): Adresse öffnen, Code aus dem Browser einfügen oder Gerätecode eingeben. */
  loginKind?: "link" | "code-paste" | "device-code" | null;
}
export function clis(fresh = false, account = false) {
  const query = new URLSearchParams();
  if (fresh) query.set("fresh", "1");
  if (account) query.set("account", "1");
  const params = query.toString();
  return apiRequest<{ ok: boolean; clis: Cli[] }>("GET", params ? `/v1/clis?${params}` : "/v1/clis");
}
export const cliInstall = (id: string) => apiRequest<{ ok: boolean }>("POST", `/v1/clis/${enc(id)}/install`);
export const cliLogin = (id: string) => apiRequest<{ ok: boolean; url?: string | null; code?: string | null; opensBrowser?: boolean }>("POST", `/v1/clis/${enc(id)}/login`);
export const cliLoginEingabe = (id: string, text: string) => apiRequest<{ ok: boolean }>("POST", `/v1/clis/${enc(id)}/login/input`, { text });
export const cliAbbruch = (id: string) => apiRequest<{ ok: boolean }>("POST", `/v1/clis/${enc(id)}/cancel`);
export const cliTrennen = (id: string) => apiRequest<{ ok: boolean }>("POST", `/v1/clis/${enc(id)}/disconnect`);

// ---------- Mac-Rechte (routes/mac.py) ----------
export type RechtStatus = "granted" | "missing" | "unknown";
export interface MacRecht { id: string; label: string; status: RechtStatus; settingsUrl?: string; detail?: string }
export const macZugriff = () => apiRequest<{ enabled: boolean; permissions: MacRecht[] }>("GET", "/v1/mac/access");
export const macSchalter = (enabled: boolean) => apiRequest<{ ok: boolean; enabled: boolean }>("POST", "/v1/mac/access", { enabled });
/** Startet Orbit neu (der Dienst wird vorher beendet, damit neue Mac-Rechte gelten). */
export const appNeustart = () => invoke<void>("restart_app");
export const FORTSETZEN = "orbit.erststart.fortsetzen";
export const NEU_GESTARTET = "orbit.erststart.neugestartet";

/** Rechte, die kein Ja/Nein-Dialog sind: Systemeinstellungen plus Ziehfenster. */
export const FENSTER_RECHTE = ["accessibility", "screen", "full_disk"];
export async function macAnfrage(id: string) {
  const r = await apiRequest<{ ok: boolean; permission: MacRecht | null }>("POST", "/v1/mac/permissions/request", { id });
  if (FENSTER_RECHTE.includes(id) && r.permission && r.permission.status !== "granted") {
    try {
      await invoke("show_permission_drag", { kind: id });
    } catch {
      return { ...r, permission: { ...r.permission, detail: `Drag Orbit.app from “Applications” into the list for ${r.permission.label}.` } };
    }
  }
  return r;
}

// ---------- Profil-Einstellungen (routes/settings.py) ----------
export interface Profil {
  name: string;
  occupation: string;
  avatarColor?: string;
  avatarFont?: string;
  answerLength: "short" | "standard" | "long";
  learn: boolean;
  backgroundWork: boolean;
  loginOpen: boolean;
  language: "de";
  notificationsDone: boolean;
  notificationsAttention: boolean;
  notificationsApprovals: boolean;
  sound: boolean;
  reducedMotion: "system" | "on" | "off";
  defaultModel: string;
  defaultEffort?: string | null;
  defaultFast?: boolean;
  cloud: boolean;
  sleepMinutes: number;
}
export const profilLesen = () => apiRequest<{ ok: boolean; profile: Profil }>("GET", "/v1/settings/profile");
/** Schreibt Profil-Einstellungen; ein geänderter Name geht erst nach Erfolg an Seitenleiste, Menü und Einstellungen. */
export const profilSchreiben = (p: Partial<Profil>) =>
  apiRequest<{ ok: boolean }>("PUT", "/v1/settings/profile", p as unknown as Json).then((r) => {
    if (typeof p.name === "string") {
      const { avatarColor, avatarFont } = p;
      useProfilName.getState().setzen(p.name, avatarColor && avatarFont ? { avatarColor, avatarFont } : undefined);
    }
    return r;
  });

// ---------- Nutzung (routes/models.py) ----------
export interface TagesEintrag { input: number; output: number; costEur: number | null; inputEur: number | null; outputEur: number | null; missingCost: boolean }
export interface Verlauf {
  ok: boolean;
  days: { date: string; entries: Record<string, TagesEintrag> }[];
  fxConfigured: boolean;
  priceDate: string | null;
  estimated: boolean;
  currency: string;
}
export const verlauf = (period: "week" | "month") => apiRequest<Verlauf>("GET", `/v1/usage/history?period=${period}`);

// ---------- Plugins (routes/marketplace.py) ----------
export const pluginEntry = (slug: string) => apiRequest<{ ok: boolean; entry: any }>("GET", `/v1/plugins/${enc(slug)}/entry`);
export const pluginOrbis = (slug: string) => apiRequest<{ ok: boolean; botIds: string[] | null }>("GET", `/v1/plugins/${enc(slug)}/orbis`);
export const pluginOrbisSetzen = (slug: string, botIds: string[] | null) =>
  apiRequest<{ ok: boolean; botIds: string[] | null }>("PUT", `/v1/plugins/${enc(slug)}/orbis`, { botIds });
export const pluginAktionen = (slug: string, cursor?: string) =>
  apiRequest<{ ok: boolean; actions: { id: string; label: string; description: string; readOnly: boolean }[]; nextCursor: string | null }>(
    "GET", `/v1/plugins/${enc(slug)}/actions${cursor ? `?cursor=${enc(cursor)}` : ""}`);

// ---------- App-Symbol (routes/settings.py) ----------

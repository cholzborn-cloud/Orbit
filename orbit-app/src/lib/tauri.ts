// Vertrag zwischen Rust-Hülle (src-tauri/src/commands.rs) und Oberfläche.
// Die Oberfläche spricht NIE direkt mit http://127.0.0.1:4317, denn der Dienst
// lehnt den Origin der Webview ab (SCHNITTSTELLE.md Abschnitt 1). Alles läuft über diese Befehle.
import { Channel, invoke } from "@tauri-apps/api/core";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface ServiceInfo {
  port: number;
  dataDir: string;
}

/** Wählt das Profil, startet/findet den Dienst, wartet auf /v1/health. Wirft einen deutschen Fehlertext. */
export const serviceConnect = () => invoke<ServiceInfo>("service_connect");

/** Normale JSON-Anfrage an /v1/... Wirft den deutschen Fehlertext des Dienstes (Form A/B). */
export const apiRequest = <T = any>(method: string, path: string, body?: Json) =>
  invoke<T>("api_request", { method, path, body: body ?? null });

/**
 * SSE-Anfrage (/v1/events, .../stream, .../turn). Jedes `data:`-Ereignis kommt geparst bei onEvent an.
 * Das Promise endet, wenn der Strom endet ([DONE] oder 204); bei Abbruch wirft es.
 * `cancel()` beendet den Strom von der Oberfläche aus.
 */
export function apiStream(method: string, path: string, body: Json | undefined, onEvent: (e: any) => void) {
  const channel = new Channel<any>();
  channel.onmessage = onEvent;
  const streamId = crypto.randomUUID();
  const done = invoke<void>("api_stream", { method, path, body: body ?? null, streamId, onEvent: channel });
  return { done, cancel: () => invoke<void>("api_stream_cancel", { streamId }) };
}

/** Öffnet einen https-Link im Standardbrowser. */
export const openUrl = (url: string) => invoke<void>("open_url", { url });

/** Beim Anmelden Orbit öffnen (Login-Item / LaunchAgent der Hülle). Fehlt in der Browser-Dev-Hülle. */
export const setLoginOpen = (enabled: boolean) => invoke<void>("set_login_open", { enabled });

/** Hell/Dunkel des Systems ändern die Oberfläche selbst per CSS (prefers-color-scheme). */

// ---------- Orbit-Konto (Supabase Auth, src-tauri/src/account.rs) ----------
export interface KontoInfo {
  signedIn: boolean;
  /** false, solange src-tauri/supabase.config.json noch Platzhalter enthält. */
  configured: boolean;
  email: string | null;
  displayName: string | null;
  photoUrl: string | null;
  userId?: string | null;
  signInMethod?: "email" | OAuthAnbieter | null;
}

/** Angemeldet? Liest den gespeicherten Refresh-Token; wirft nie wegen fehlender Einrichtung. */
export const accountStatus = () => invoke<KontoInfo>("account_status");
export type OAuthAnbieter = "google" | "github";
/** Öffnet den Browser für Google/GitHub und wartet auf die Rückkehr (bis 5 Minuten). */
export const accountSignInOAuth = (provider: OAuthAnbieter) => invoke<KontoInfo>("account_sign_in_oauth", { provider });
/** @deprecated nutze accountSignInOAuth("google") */
export const accountSignInGoogle = () => accountSignInOAuth("google");
export const accountSignUp = (email: string, password: string) => invoke<KontoInfo>("account_sign_up", { email, password });
export const accountSignIn = (email: string, password: string) => invoke<KontoInfo>("account_sign_in", { email, password });
/** 6-stelligen Code aus der Mail prüfen (nach Signup oder Sign-in). */
export const accountVerifyOtp = (email: string, token: string, kind?: "signup" | "login") =>
  invoke<KontoInfo>("account_verify_otp", { email, token, kind: kind ?? null });
export const accountResendOtp = (email?: string, kind?: "signup" | "login") =>
  invoke<void>("account_resend_otp", { email: email ?? null, kind: kind ?? null });
export const accountResetPassword = (email: string) => invoke<void>("account_reset_password", { email });
export const accountConfirmPasswordReset = (email: string, code: string, newPassword: string) =>
  invoke<void>("account_confirm_password_reset", { email, code, newPassword });
export const accountUpdateProfile = (displayName: string) => invoke<KontoInfo>("account_update_profile", { displayName });
export const accountChangePassword = (newPassword: string) => invoke<void>("account_change_password", { newPassword });
export const accountCancel = () => invoke<void>("account_cancel");
export const accountSignOut = () => invoke<void>("account_sign_out");

//! Orbit-Konto über Supabase Auth (GoTrue REST), komplett in der Hülle.
//! Google und GitHub: OAuth über Supabase mit PKCE und Rückkehr über einen festen Loopback-Port.
//! E-Mail/Passwort: Signup und Sign-in verlangen danach einen 6-stelligen Code aus der Mail
//! (`otp_required` → `/auth/v1/verify`). Der Refresh-Token liegt nur als Datei im Profilordner.

use crate::api::{Api, open_browser};
use crate::commands::State;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use reqwest::Url;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State as TauriState;
use tauri::async_runtime::spawn_blocking;

pub const KEYCHAIN_SERVICE: &str = "de.consti.orbit.app";
pub const KEYCHAIN_ACCOUNT: &str = "supabase-refresh";
const CANCELLED: &str = "Die Anmeldung wurde abgebrochen.";
const NOT_CONFIGURED: &str = "Supabase ist noch nicht eingerichtet. Die Anleitung steht in src-tauri/SUPABASE-EINRICHTEN.md.";
const OFFLINE: &str = "Keine Verbindung zum Konto-Dienst. Prüfe dein Internet und versuche es erneut.";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
/// Der in Supabase freigegebene Loopback-Port. Tests verwenden einen freien Port.
#[cfg(not(test))]
const OAUTH_LOOPBACK_PORT: u16 = 54371;
#[cfg(test)]
const OAUTH_LOOPBACK_PORT: u16 = 0;

// ---------------------------------------------------------------- Konfiguration

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub url: String,
    pub anon_key: String,

}

impl Config {
    pub fn embedded() -> Self {
        Self::parse(include_str!(env!("ORBIT_SUPABASE_CONFIG")))
    }

    pub fn parse(text: &str) -> Self {
        serde_json::from_str(text).unwrap_or(Config {
            url: String::new(),
            anon_key: String::new(),
        })
    }

    pub fn configured(&self) -> bool {
        let url = self.url.trim();
        let key = self.anon_key.trim();
        !url.is_empty()
            && !key.is_empty()
            && !url.starts_with("HIER_")
            && !key.starts_with("HIER_")
            && Url::parse(url).is_ok_and(|u| matches!(u.scheme(), "https" | "http") && u.host_str().is_some())
    }

    pub fn origin(&self) -> String {
        self.url.trim().trim_end_matches('/').to_string()
    }


}

// ---------------------------------------------------------------- Schlüsselbund / Token-Datei

pub trait TokenStore: Send + Sync {
    fn get(&self) -> Option<String>;
    fn set(&self, token: &str) -> Result<(), String>;
    fn delete(&self);
}

/// Der Refresh-Token liegt als Datei im Profilordner (nur für den Besitzer lesbar).
/// Ein alter Eintrag im Schlüsselbund (auch Firebase-Name) wird beim ersten Lesen einmal übernommen.
pub struct Keychain {
    file: std::path::PathBuf,
    legacy_accounts: Vec<String>,
}

impl Keychain {
    fn for_profile() -> Result<Self, String> {
        let profile = crate::profile::Profile::select()?;
        let id = std::fs::read_to_string(profile.data.join("profile-id"))
            .map_err(|_| "Das lokale Orbit-Profil ist noch nicht bereit.")?;
        let id = id.trim();
        if id.len() != 36 || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
            return Err("Die Kennung des Orbit-Profils ist ungültig.".into());
        }
        Ok(Self {
            file: profile.data.join("account-token"),
            legacy_accounts: vec![
                format!("{KEYCHAIN_ACCOUNT}-{id}"),
                format!("firebase-refresh-{id}"),
            ],
        })
    }

    fn marker(&self) -> std::path::PathBuf {
        self.file.with_extension("migriert")
    }

    fn write(&self, token: &str) -> std::io::Result<()> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let tmp = self.file.with_extension("neu");
        let _ = std::fs::remove_file(&tmp);
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&tmp)?;
        f.write_all(token.as_bytes())?;
        f.sync_all()?;
        std::fs::rename(tmp, &self.file)
    }

    fn delete_checked(&self) -> Result<(), String> {
        match std::fs::remove_file(&self.file) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Orbit konnte die Anmeldung nicht entfernen.".into()),
        }
        let _ = std::fs::write(self.marker(), b"");
        Ok(())
    }
}

impl TokenStore for Keychain {
    fn get(&self) -> Option<String> {
        if let Ok(t) = std::fs::read_to_string(&self.file) {
            let t = t.trim().to_string();
            return if t.is_empty() { None } else { Some(t) };
        }
        if self.marker().exists() {
            return None;
        }
        let old = self.legacy_accounts.iter().find_map(|account| {
            keyring::Entry::new(KEYCHAIN_SERVICE, account).ok().and_then(|e| e.get_password().ok()).filter(|t| !t.is_empty())
        });
        if let Some(t) = &old {
            let _ = self.write(t);
        }
        let _ = std::fs::write(self.marker(), b"");
        old
    }
    fn set(&self, token: &str) -> Result<(), String> {
        self.write(token).map_err(|_| "Die Anmeldung konnte nicht gespeichert werden.".to_string())?;
        let _ = std::fs::write(self.marker(), b"");
        Ok(())
    }
    fn delete(&self) {
        let _ = self.delete_checked();
    }
}

// ---------------------------------------------------------------- Typen

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SignInMethod {
    Email,
    Google,
    GitHub,
}

#[derive(Deserialize, Serialize)]
struct StoredSession {
    refresh_token: String,
    method: Option<SignInMethod>,
}

impl StoredSession {
    fn read(store: &dyn TokenStore) -> Option<Self> {
        let token = store.get()?;
        if token.starts_with('{') {
            serde_json::from_str(&token).ok()
        } else {
            Some(Self { refresh_token: token, method: None })
        }
    }

    fn save(&self, store: &dyn TokenStore) -> Result<(), String> {
        let value = serde_json::to_string(self)
            .map_err(|_| "Die Anmeldung konnte nicht gespeichert werden.".to_string())?;
        store.set(&value)
    }
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub signed_in: bool,
    pub configured: bool,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub photo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    pub sign_in_method: Option<SignInMethod>,
}

#[derive(Debug)]
pub struct Session {
    refresh_token: String,
    sign_in_method: Option<SignInMethod>,
    access_token: String,
    user_id: Option<String>,
    email: Option<String>,
    display_name: Option<String>,
    photo_url: Option<String>,
}

fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string)
}

fn single_provider(user: &Value) -> Option<SignInMethod> {
    let providers = user.get("app_metadata")?.get("providers")?.as_array()?;
    let [provider] = providers.as_slice() else { return None };
    match provider.as_str()? {
        "email" => Some(SignInMethod::Email),
        "google" => Some(SignInMethod::Google),
        "github" => Some(SignInMethod::GitHub),
        _ => None,
    }
}

fn user_fields(user: &Value) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    let meta = user.get("user_metadata").cloned().unwrap_or(Value::Null);
    let display = text(&meta, "full_name")
        .or_else(|| text(&meta, "name"))
        .or_else(|| text(&meta, "display_name"))
        .or_else(|| text(user, "display_name"));
    let photo = text(&meta, "avatar_url")
        .or_else(|| text(&meta, "picture"))
        .or_else(|| text(user, "photo_url"));
    (text(user, "id"), text(user, "email"), display, photo)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OtpKind {
    Signup,
    Login,
}

impl OtpKind {
    fn parse(s: &str) -> Result<Self, AuthIssue> {
        match s.trim().to_ascii_lowercase().as_str() {
            "signup" | "confirm" => Ok(Self::Signup),
            "login" | "email" | "signin" => Ok(Self::Login),
            _ => Err("Unbekannte Code-Art.".into()),
        }
    }

}

#[derive(Debug)]
pub enum SignUpOutcome {
    NeedsOtp { email: String, kind: OtpKind },
}

#[derive(Debug)]
pub enum SignInOutcome {
    NeedsOtp { email: String, kind: OtpKind, pending: Session },
}

impl Session {
    fn from_json(v: &Value) -> Result<Self, String> {
        let broken = || "Die Antwort des Konto-Dienstes war unvollständig.".to_string();
        let access = text(v, "access_token").ok_or_else(broken)?;
        let refresh = text(v, "refresh_token").ok_or_else(broken)?;
        let user = v.get("user").cloned().unwrap_or(Value::Null);
        let (user_id, email, display_name, photo_url) = user_fields(&user);
        Ok(Session {
            access_token: access,
            refresh_token: refresh,
            sign_in_method: single_provider(&user),
            user_id,
            email: email.or_else(|| text(v, "email")),
            display_name,
            photo_url,
        })
    }

    fn info(&self, configured: bool) -> Info {
        Info {
            signed_in: true,
            configured,
            email: self.email.clone(),
            display_name: self.display_name.clone(),
            photo_url: self.photo_url.clone(),
            user_id: self.user_id.clone(),
            sign_in_method: self.sign_in_method,
        }
    }
}

// ---------------------------------------------------------------- Fehlertexte

#[derive(Debug, Serialize)]
pub struct AuthIssue {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
}

impl From<String> for AuthIssue {
    fn from(message: String) -> Self {
        Self { code: "auth_failed", message, email: None }
    }
}

impl From<&str> for AuthIssue {
    fn from(message: &str) -> Self { message.to_owned().into() }
}

impl AuthIssue {
    fn from_body(body: &Value) -> Self {
        let raw = text(body, "error_code")
            .or_else(|| text(body, "error"))
            .or_else(|| text(body, "msg"))
            .or_else(|| text(body, "message"))
            .or_else(|| body.pointer("/error/message").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_default();
        let desc = text(body, "error_description").or_else(|| text(body, "msg")).unwrap_or_default();
        let combined = if desc.is_empty() { raw.clone() } else { format!("{raw}: {desc}") };
        let code = match raw.as_str() {
            "user_already_exists" | "email_exists" => "email_exists",
            "invalid_credentials" | "invalid_grant" => "invalid_credentials",
            "weak_password" => "weak_password",
            "validation_failed" if combined.to_lowercase().contains("password") => "weak_password",
            "email_not_confirmed" => "email_not_confirmed",
            "user_not_found" => "user_not_found",
            "email_address_not_authorized" | "email_delivery_failed" => "email_delivery",
            "unexpected_failure" if combined.to_lowercase().contains("email") => "email_delivery",
            "over_request_rate_limit" | "over_email_send_rate_limit" => "rate_limited",
            "identity_already_exists" | "conflict" => "google_conflict",
            _ if combined.to_lowercase().contains("already been registered") => "email_exists",
            _ if combined.to_lowercase().contains("invalid login") => "invalid_credentials",
            _ => "auth_failed",
        };
        Self { code, message: supabase_error_text(&combined), email: text(body, "email") }
    }

    fn google_conflict(email: Option<String>) -> Self {
        Self {
            code: "google_conflict",
            message: "Für diese E-Mail gilt schon eine andere Anmeldung. Melde dich mit deiner bisherigen Methode an.".into(),
            email,
        }
    }
}

/// Supabase-/GoTrue-Fehler auf einen deutschen Satz.
pub fn supabase_error_text(message: &str) -> String {
    let lower = message.to_lowercase();
    if lower.contains("already") && (lower.contains("register") || lower.contains("exist")) {
        return "Diese E-Mail hat schon ein Konto. Bitte anmelden.".into();
    }
    if lower.contains("invalid login") || lower.contains("invalid_credentials") || lower.contains("invalid_grant") {
        return "E-Mail oder Passwort stimmt nicht.".into();
    }
    if lower.contains("email_address_not_authorized") {
        return "Der Maildienst darf an diese Adresse keinen Bestätigungscode senden. Du kannst dich mit Google oder GitHub anmelden.".into();
    }
    if lower.contains("email_delivery_failed") || lower.contains("error sending") && lower.contains("email") {
        return "Der Maildienst konnte den Code gerade nicht verschicken. Versuche es später erneut.".into();
    }
    if lower.contains("email not confirmed") || lower.contains("email_not_confirmed") {
        return "Bitte bestätige zuerst deine E-Mail. Der Code steht in deinem Posteingang.".into();
    }
    if lower.contains("otp") && (lower.contains("expired") || lower.contains("invalid")) {
        return "Dieser Code stimmt nicht oder ist abgelaufen. Bitte erneut versuchen.".into();
    }
    if lower.contains("token") && (lower.contains("expired") || lower.contains("invalid")) {
        return "Dieser Code stimmt nicht oder ist abgelaufen. Bitte erneut versuchen.".into();
    }
    if lower.contains("weak") && lower.contains("password") {
        return "Passwort zu schwach. Mindestens 6 Zeichen.".into();
    }
    if lower.contains("valid email") || lower.contains("invalid email") {
        return "Ungültige E-Mail-Adresse.".into();
    }
    if lower.contains("rate") || lower.contains("too many") {
        return "Zu viele Versuche. Bitte kurz warten.".into();
    }
    if lower.contains("signup is disabled") || lower.contains("provider is not enabled") {
        return "Diese Anmeldeart ist noch nicht eingeschaltet.".into();
    }
    if lower.contains("user not found") || lower.contains("session") && lower.contains("expired") {
        return "Anmeldung abgelaufen. Bitte neu anmelden.".into();
    }
    if lower.contains("api key") || lower.contains("jwt") && lower.contains("invalid") {
        return "Der Supabase-Schlüssel ist ungültig.".into();
    }
    "Anmeldung fehlgeschlagen. Bitte erneut versuchen.".into()
}

// ---------------------------------------------------------------- PKCE und Zufall

fn random_b64(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|_| "Es konnten keine sicheren Zufallswerte erzeugt werden.".to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

// ---------------------------------------------------------------- Loopback-Rückkehr

fn read_head(stream: &mut TcpStream) -> Option<String> {
    let mut data = Vec::new();
    let mut chunk = [0u8; 1024];
    while !data.windows(4).any(|w| w == b"\r\n\r\n") && data.len() < 16 * 1024 {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => data.extend_from_slice(&chunk[..n]),
            Err(_) => break,
        }
    }
    (!data.is_empty()).then(|| String::from_utf8_lossy(&data).into_owned())
}

/// Die Loopback-Seiten verwenden lokale, statische Inhalte.
#[derive(Clone, Copy)]
enum OAuthPage {
    Ok,
    Wait,
    Cancel,
    Failed,
}

fn oauth_page(kind: OAuthPage) -> String {
    let (title, message) = match kind {
        OAuthPage::Ok => (
            "Zurück zu Orbit",
            "Orbit schließt die Anmeldung in der App ab. Du kannst diesen Tab schließen.",
        ),
        OAuthPage::Wait => (
            "Anmeldung läuft",
            "Wechsle zu Orbit. Dort siehst du, wie es mit der Anmeldung weitergeht.",
        ),
        OAuthPage::Cancel => (
            "Anmeldung abgebrochen",
            "Du kannst die Anmeldung in Orbit jederzeit erneut starten.",
        ),
        OAuthPage::Failed => (
            "Anmeldung fehlgeschlagen",
            "Wechsle zu Orbit, um es erneut zu versuchen.",
        ),
    };
    include_str!("../oauth-pages/status.html")
        .replace("{{title}}", title)
        .replace("{{message}}", message)
        .replace("{{orbi}}", concat!(
            include_str!("../../mails/orbis/freddy.svg"),
            include_str!("../../mails/orbis/trixi.svg"),
            include_str!("../../mails/orbis/nova.svg"),
            include_str!("../../mails/orbis/citrus.svg"),
            include_str!("../../mails/orbis/mopsi.svg"),
        ))
}

fn respond_orbit(stream: &mut TcpStream, status: &str, kind: OAuthPage) {
    let page = oauth_page(kind);
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nReferrer-Policy: no-referrer\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
        page.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(page.as_bytes());
    let _ = stream.flush();
}

fn oauth_listener(port: u16) -> std::io::Result<TcpListener> {
    use socket2::{Domain, Protocol, Socket, Type};

    let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))?;
    // Erneute Anmeldung unmittelbar nach einer geschlossenen Loopback-Verbindung ermöglichen.
    socket.set_reuse_address(true)?;
    socket.bind(&std::net::SocketAddr::from(([127, 0, 0, 1], port)).into())?;
    socket.listen(8)?;
    Ok(socket.into())
}

/// Wartet auf die OAuth-Rückkehr auf dem Loopback.
///
/// `expected_state` leer: Code ohne State-Prüfung annehmen (Supabase setzt oft einen
/// eigenen State und liefert ihn auf `redirect_to` nicht zurück). Nicht leer: nur bei
/// exakt passendem `state` annehmen (Google-Desktop-Flow).
pub fn wait_for_callback(listener: &TcpListener, expected_state: &str, cancel: &AtomicBool, timeout: Duration) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|_| "Der lokale Anmelde-Empfang konnte nicht starten.".to_string())?;
    let start = Instant::now();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.into());
        }
        if start.elapsed() > timeout {
            return Err("Das hat zu lange gedauert. Bitte erneut versuchen.".into());
        }
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(40));
                continue;
            }
            Err(_) => return Err("Die Anmeldung ist unterbrochen. Bitte erneut versuchen.".into()),
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let Some(head) = read_head(&mut stream) else { continue };
        let mut parts = head.lines().next().unwrap_or("").split_whitespace();
        let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else {
            respond_orbit(&mut stream, "400 Bad Request", OAuthPage::Cancel);
            continue;
        };
        if method != "GET" {
            respond_orbit(&mut stream, "404 Not Found", OAuthPage::Wait);
            continue;
        }
        let path = url.path();
        // Favicon und ähnliches: still 404, weiterwarten.
        if path != "/callback" && path != "/" {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            continue;
        }
        let query = |key: &str| url.query_pairs().find(|(k, _)| k == key).map(|(_, v)| v.into_owned());
        if let Some(error) = query("error") {
            if !expected_state.is_empty() && query("state").as_deref() != Some(expected_state) {
                respond_orbit(&mut stream, "200 OK", OAuthPage::Wait);
                continue;
            }
            if error == "access_denied" && query("error_code").is_none() {
                respond_orbit(&mut stream, "200 OK", OAuthPage::Cancel);
                return Err(CANCELLED.into());
            }
            respond_orbit(&mut stream, "200 OK", OAuthPage::Failed);
            return Err("Die Anmeldung im Browser ist fehlgeschlagen. Versuche es in Orbit erneut.".into());
        }
        if let Some(code) = query("code").filter(|c| !c.is_empty()) {
            if !expected_state.is_empty() && query("state").as_deref() != Some(expected_state) {
                // Fremder Aufruf: ignorieren, weiterwarten.
                respond_orbit(&mut stream, "200 OK", OAuthPage::Wait);
                continue;
            }
            respond_orbit(&mut stream, "200 OK", OAuthPage::Ok);
            return Ok(code);
        }
        // Leerer Aufruf (Site-URL ohne Code): freundlich, weiterwarten.
        respond_orbit(&mut stream, "200 OK", OAuthPage::Wait);
    }
}

// ---------------------------------------------------------------- Supabase-Aufrufe

pub struct Account {
    cfg: Config,
    http: Client,
    /// Nur für Tests: überschreibt die Origin-URL.
    origin_override: Option<String>,
}

impl Account {
    pub fn embedded() -> Self {
        Self::new(Config::embedded())
    }

    pub fn new(cfg: Config) -> Self {
        Self {
            cfg,
            http: Client::builder().timeout(Duration::from_secs(20)).build().unwrap_or_else(|_| Client::new()),
            origin_override: None,
        }
    }

    #[cfg(test)]
    fn with_origin(mut self, origin: &str) -> Self {
        self.origin_override = Some(origin.trim_end_matches('/').to_string());
        self
    }

    fn origin(&self) -> String {
        self.origin_override.clone().unwrap_or_else(|| self.cfg.origin())
    }

    fn configured(&self) -> bool {
        self.cfg.configured() || self.origin_override.is_some()
    }

    fn require(&self) -> Result<(), AuthIssue> {
        if self.configured() { Ok(()) } else { Err(NOT_CONFIGURED.into()) }
    }

    fn headers_anon(&self) -> reqwest::header::HeaderMap {
        let mut h = reqwest::header::HeaderMap::new();
        let key = self.cfg.anon_key.trim();
        if let Ok(v) = key.parse() {
            h.insert("apikey", v);
        }
        if let Ok(v) = format!("Bearer {key}").parse() {
            h.insert(reqwest::header::AUTHORIZATION, v);
        }
        h.insert(reqwest::header::CONTENT_TYPE, "application/json".parse().unwrap());
        h
    }

    fn send(&self, request: reqwest::blocking::RequestBuilder) -> Result<Value, AuthIssue> {
        let response = request.send().map_err(|_| OFFLINE.to_string())?;
        let status = response.status();
        let body: Value = response.json().unwrap_or(Value::Null);
        if status.is_success() {
            return Ok(body);
        }
        Err(AuthIssue::from_body(&body))
    }

    fn auth_url(&self, path: &str) -> String {
        format!("{}/auth/v1{path}", self.origin())
    }

    /// Signup: Konto anlegen. Ohne Session (Confirm email an) → `otp_required`.
    /// Mit Session trotzdem OTP verlangen: Passwort-Session wird nicht gespeichert, Code-Mail geht raus.
    pub fn sign_up(&self, email: &str, password: &str) -> Result<SignUpOutcome, AuthIssue> {
        self.require()?;
        let (email, password) = credentials(email, password)?;
        let v = self.send(
            self.http
                .post(self.auth_url("/signup"))
                .headers(self.headers_anon())
                .json(&json!({"email": email, "password": password})),
        )?;
        if text(&v, "access_token").is_none() {
            let user = v.get("user").unwrap_or(&v);
            // GoTrue liefert bei bestätigten Konten einen Platzhalter ohne Identitäten.
            if user.get("identities").and_then(Value::as_array).is_some_and(Vec::is_empty) {
                return Err(AuthIssue {
                    code: "email_exists",
                    message: "Diese E-Mail hat schon ein Konto. Bitte anmelden.".into(),
                    email: Some(email),
                });
            }
            if v.get("user").is_some() || v.get("id").is_some() {
                return Ok(SignUpOutcome::NeedsOtp { email, kind: OtpKind::Signup });
            }
            return Err(AuthIssue::from_body(&v));
        }
        // Ein bereits bestätigtes Konto erhält einen Login-Code.
        self.send_otp(&email, OtpKind::Login)?;
        Ok(SignUpOutcome::NeedsOtp { email, kind: OtpKind::Login })
    }

    /// Passwort prüfen, dann Login-OTP schicken. Session erst nach verify speichern.
    /// Unbestätigtes Konto: Bestätigungs-Code erneut senden (Art signup).
    pub fn sign_in(&self, email: &str, password: &str) -> Result<SignInOutcome, AuthIssue> {
        self.require()?;
        let (email, password) = credentials(email, password)?;
        let v = match self.send(
            self.http
                .post(self.auth_url("/token?grant_type=password"))
                .headers(self.headers_anon())
                .json(&json!({"email": email, "password": password})),
        ) {
            Ok(v) => v,
            Err(e) if e.code == "email_not_confirmed" => {
                self.send_otp(&email, OtpKind::Signup)?;
                return Err(otp_issue(email, OtpKind::Signup));
            }
            Err(e) => return Err(e),
        };
        let session = Session::from_json(&v)?;
        match self.send_otp(&email, OtpKind::Login) {
            Err(e) if e.code == "rate_limited" => Err(AuthIssue {
                code: "login_otp_rate_limited",
                email: Some(email),
                ..e
            }),
            Err(e) => Err(e),
            Ok(()) => Ok(SignInOutcome::NeedsOtp { email, kind: OtpKind::Login, pending: session }),
        }
    }

    fn send_otp(&self, email: &str, kind: OtpKind) -> Result<(), AuthIssue> {
        match kind {
            OtpKind::Signup => {
                // Erneutes Senden der Bestätigungsmail (enthält {{ .Token }}).
                self.send(
                    self.http
                        .post(self.auth_url("/resend"))
                        .headers(self.headers_anon())
                        .json(&json!({"type": "signup", "email": email})),
                )?;
                Ok(())
            }
            OtpKind::Login => {
                self.send(
                    self.http
                        .post(self.auth_url("/otp"))
                        .headers(self.headers_anon())
                        .json(&json!({"email": email, "create_user": false})),
                )?;
                Ok(())
            }
        }
    }

    pub fn verify_otp(&self, email: &str, token: &str, kind: OtpKind) -> Result<Session, AuthIssue> {
        let typ = match kind {
            OtpKind::Signup => "signup",
            OtpKind::Login => "email",
        };
        self.verify_code(email, token, typ)
    }

    fn verify_code(&self, email: &str, token: &str, typ: &str) -> Result<Session, AuthIssue> {
        self.require()?;
        let email = email.trim();
        let token = token.trim();
        if email.is_empty() || token.len() != 6 || !token.chars().all(|c| c.is_ascii_digit()) {
            return Err("Bitte den 6-stelligen Code aus der Mail eingeben.".into());
        }
        let v = self.send(
            self.http
                .post(self.auth_url("/verify"))
                .headers(self.headers_anon())
                .json(&json!({"type": typ, "email": email, "token": token})),
        )?;
        let mut session = Session::from_json(&v)?;
        session.sign_in_method = Some(SignInMethod::Email);
        Ok(session)
    }

    pub fn resend_otp(&self, email: &str, kind: OtpKind) -> Result<(), AuthIssue> {
        self.require()?;
        let email = email.trim();
        if email.is_empty() {
            return Err("E-Mail eingeben.".into());
        }
        self.send_otp(email, kind)
    }

    /// OAuth (google / github): Browser öffnen, Rückkehr abwarten, Code per PKCE tauschen.
    pub fn sign_in_oauth(&self, provider: &str, open: &dyn Fn(&str) -> Result<(), String>, cancel: &AtomicBool, timeout: Duration) -> Result<Session, AuthIssue> {
        self.require()?;
        let provider = match provider.trim().to_ascii_lowercase().as_str() {
            "google" | "github" => provider.trim().to_ascii_lowercase(),
            _ => return Err("Unbekannte Anmeldeart.".into()),
        };
        let (label, method) = match provider.as_str() {
            "github" => ("GitHub", SignInMethod::GitHub),
            _ => ("Google", SignInMethod::Google),
        };
        let listener = oauth_listener(OAUTH_LOOPBACK_PORT)
            .map_err(|_| "Orbit konnte die Browser-Rückkehr nicht starten. Schließe andere Orbit-Anmeldungen und versuche es erneut.")?;
        let address = listener.local_addr().map_err(|_| "Die lokale Adresse für die Anmeldung fehlt.")?;
        let redirect = format!("http://{address}/callback");
        let verifier = random_b64(48)?;
        // Kein eigener `state`: GoTrue setzt beim Provider sowieso einen eigenen und
        // gibt ihn auf redirect_to oft nicht als unseren Wert zurück.
        let auth = Url::parse_with_params(
            &self.auth_url("/authorize"),
            [
                ("provider", provider.as_str()),
                ("redirect_to", redirect.as_str()),
                ("code_challenge", pkce_challenge(&verifier).as_str()),
                ("code_challenge_method", "s256"),
            ],
        )
        .map_err(|_| format!("Der {label}-Link konnte nicht gebaut werden."))?;
        open(auth.as_str())?;
        let code = wait_for_callback(&listener, "", cancel, timeout)?;
        drop(listener);
        if cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.into());
        }
        let v = self.send(
            self.http
                .post(self.auth_url("/token?grant_type=pkce"))
                .headers(self.headers_anon())
                .json(&json!({"auth_code": code, "code_verifier": verifier})),
        )
        .map_err(|e| {
            if e.code == "google_conflict" || e.message.contains("andere Anmeldung") {
                AuthIssue::google_conflict(e.email)
            } else if e.message == OFFLINE {
                e
            } else {
                AuthIssue {
                    code: e.code,
                    message: if e.code == "auth_failed" {
                        format!("{label} hat die Anmeldung nicht bestätigt. Versuche es erneut.")
                    } else {
                        e.message
                    },
                    email: e.email,
                }
            }
        })?;
        let mut session = Session::from_json(&v)?;
        session.sign_in_method = Some(method);
        Ok(session)
    }

    pub fn status(&self, store: &dyn TokenStore) -> Info {
        let configured = self.configured();
        let signed_out = Info { configured, ..Info::default() };
        let Some(mut stored) = StoredSession::read(store) else { return signed_out };
        if !configured {
            return Info { signed_in: true, ..signed_out };
        }
        let fallback = Info { signed_in: true, sign_in_method: stored.method, ..signed_out.clone() };
        let refreshed = self.http
            .post(self.auth_url("/token?grant_type=refresh_token"))
            .headers(self.headers_anon())
            .json(&json!({"refresh_token": stored.refresh_token}))
            .send();
        let Ok(response) = refreshed else { return fallback };
        if response.status().is_client_error() {
            store.delete();
            return signed_out;
        }
        let Ok(body) = response.json::<Value>() else { return fallback };
        if let Some(rotated) = text(&body, "refresh_token").filter(|t| *t != stored.refresh_token) {
            stored.refresh_token = rotated;
            let _ = stored.save(store);
        }
        let Some(access) = text(&body, "access_token") else { return fallback };
        let mut h = self.headers_anon();
        if let Ok(v) = format!("Bearer {access}").parse() {
            h.insert(reqwest::header::AUTHORIZATION, v);
        }
        match self.http.get(self.auth_url("/user")).headers(h).send() {
            Ok(r) if r.status().is_success() => {
                let user = r.json::<Value>().unwrap_or(Value::Null);
                let (user_id, email, display_name, photo_url) = user_fields(&user);
                Info { email, display_name, photo_url, user_id, sign_in_method: stored.method.or_else(|| single_provider(&user)), ..fallback }
            }
            _ => {
                // Session-Body kann user schon enthalten.
                if let Some(user) = body.get("user") {
                    let (user_id, email, display_name, photo_url) = user_fields(user);
                    Info { email, display_name, photo_url, user_id, sign_in_method: stored.method.or_else(|| single_provider(user)), ..fallback }
                } else {
                    fallback
                }
            }
        }
    }

    pub fn finish(&self, session: Session, store: &dyn TokenStore) -> Result<Info, String> {
        let info = session.info(true);
        StoredSession { refresh_token: session.refresh_token, method: info.sign_in_method }.save(store)?;
        Ok(info)
    }

    fn password_reset(&self, email: &str) -> Result<(), AuthIssue> {
        self.require()?;
        if email.trim().is_empty() { return Err("E-Mail eingeben.".into()); }
        match self.send(
            self.http
                .post(self.auth_url("/recover"))
                .headers(self.headers_anon())
                .json(&json!({"email": email.trim()})),
        ) {
            Ok(_) => Ok(()),
            // Existenz der Adresse nie verraten (GoTrue kann 4xx mit user_not_found o. Ä. liefern).
            Err(e) if e.code == "user_not_found" => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// Anzeigename in Supabase user_metadata setzen.
    pub fn update_profile(&self, store: &dyn TokenStore, display_name: &str) -> Result<Info, AuthIssue> {
        self.require()?;
        let name = display_name.trim();
        if name.is_empty() || name.len() > 120 {
            return Err("Gib einen Namen ein (höchstens 120 Zeichen).".into());
        }
        let session = self.refresh_session(store)?;
        let mut h = self.headers_anon();
        if let Ok(v) = format!("Bearer {}", session.access_token).parse() {
            h.insert(reqwest::header::AUTHORIZATION, v);
        }
        let v = self.send(
            self.http
                .put(self.auth_url("/user"))
                .headers(h)
                .json(&json!({"data": {"full_name": name, "display_name": name}})),
        )?;
        let (user_id, email, display, photo) = user_fields(&v);
        Ok(Info {
            signed_in: true,
            configured: true,
            email: email.or(session.email),
            display_name: display.or(Some(name.to_string())),
            photo_url: photo.or(session.photo_url),
            user_id: user_id.or(session.user_id),
            sign_in_method: session.sign_in_method,
        })
    }

    pub fn change_password(&self, store: &dyn TokenStore, new_password: &str) -> Result<(), AuthIssue> {
        self.require()?;
        Self::validate_new_password(new_password)?;
        let session = self.refresh_session(store)?;
        self.update_password(&session, new_password)
    }

    fn confirm_password_reset(&self, email: &str, code: &str, new_password: &str) -> Result<(), AuthIssue> {
        Self::validate_new_password(new_password)?;
        let session = self.verify_code(email, code, "recovery")?;
        self.update_password(&session, new_password)
    }

    fn validate_new_password(new_password: &str) -> Result<(), AuthIssue> {
        if (6..=1024).contains(&new_password.len()) {
            Ok(())
        } else {
            Err("Gib ein Passwort mit 6 bis 1024 Zeichen ein.".into())
        }
    }

    fn update_password(&self, session: &Session, new_password: &str) -> Result<(), AuthIssue> {
        let mut headers = self.headers_anon();
        let authorization = format!("Bearer {}", session.access_token)
            .parse()
            .map_err(|_| AuthIssue::from("Die Anmeldesitzung war ungültig."))?;
        headers.insert(reqwest::header::AUTHORIZATION, authorization);
        self.send(
            self.http
                .put(self.auth_url("/user"))
                .headers(headers)
                .json(&json!({"password": new_password})),
        )?;
        Ok(())
    }

    fn refresh_session(&self, store: &dyn TokenStore) -> Result<Session, AuthIssue> {
        let stored = StoredSession::read(store).ok_or_else(|| "Nicht angemeldet.".to_string())?;
        let v = self.send(
            self.http
                .post(self.auth_url("/token?grant_type=refresh_token"))
                .headers(self.headers_anon())
                .json(&json!({"refresh_token": stored.refresh_token})),
        )?;
        let mut session = Session::from_json(&v)?;
        session.sign_in_method = stored.method.or(session.sign_in_method);
        if session.refresh_token != stored.refresh_token {
            StoredSession { refresh_token: session.refresh_token.clone(), method: session.sign_in_method }.save(store)?;
        }
        Ok(session)
    }
}

fn credentials(email: &str, password: &str) -> Result<(String, String), String> {
    let email = email.trim();
    if email.is_empty() || password.is_empty() {
        return Err("E-Mail und Passwort eingeben.".into());
    }
    Ok((email.to_string(), password.to_string()))
}

// ---------------------------------------------------------------- Tauri-Befehle

struct PendingOtp {
    email: String,
    kind: OtpKind,
    /// Nach erfolgreichem Passwort-Login, bis der Mail-Code bestätigt ist.
    session: Option<Session>,
}

#[derive(Default)]
pub struct AccountState {
    running: Mutex<Option<Arc<AtomicBool>>>,
    profile: Mutex<Option<Info>>,
    pending_otp: Mutex<Option<PendingOtp>>,
}

struct RunGuard<'a>(&'a AccountState);

impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        *self.0.running.lock().unwrap() = None;
    }
}

impl AccountState {
    fn begin(&self) -> Result<(RunGuard<'_>, Arc<AtomicBool>), String> {
        let mut running = self.running.lock().unwrap();
        if running.is_some() {
            return Err("Es läuft schon eine Anmeldung. Schließe oder breche sie ab.".into());
        }
        let flag = Arc::new(AtomicBool::new(false));
        *running = Some(Arc::clone(&flag));
        Ok((RunGuard(self), flag))
    }

    fn cancel(&self) {
        if let Some(flag) = self.running.lock().unwrap().as_ref() {
            flag.store(true, Ordering::Relaxed);
        }
    }

    fn set_pending(&self, email: String, kind: OtpKind, session: Option<Session>) {
        *self.pending_otp.lock().unwrap() = Some(PendingOtp { email, kind, session });
    }

    fn take_pending(&self) -> Option<PendingOtp> {
        self.pending_otp.lock().unwrap().take()
    }

    fn peek_pending(&self) -> Option<(String, OtpKind)> {
        self.pending_otp.lock().unwrap().as_ref().map(|p| (p.email.clone(), p.kind))
    }

    fn clear_pending(&self) {
        *self.pending_otp.lock().unwrap() = None;
    }
}

fn otp_issue(email: String, kind: OtpKind) -> AuthIssue {
    AuthIssue {
        code: if kind == OtpKind::Login { "login_otp_required" } else { "otp_required" },
        message: "Gib den Code aus der E-Mail in Orbit ein.".into(),
        email: Some(email),
    }
}

/// Markiert das Profil im Dienst mit der Supabase-UID; Fehler sind egal.
fn mark_supabase(api: Option<Arc<Api>>, info: &Info) {
    if let Some(api) = api {
        let body = json!({
            "id": info.user_id,
            "email": info.email,
            "displayName": info.display_name,
        });
        let _ = api.request("POST", "/v1/setup/account/supabase", Some(body));
    }
}

fn done(info: Info, state: &AccountState, api: Option<Arc<Api>>) -> Info {
    *state.profile.lock().unwrap() = Some(info.clone());
    mark_supabase(api, &info);
    info
}

async fn blocking<T: Send + 'static, E: From<String> + Send + 'static>(job: impl FnOnce() -> Result<T, E> + Send + 'static) -> Result<T, E> {
    spawn_blocking(job).await.map_err(|_| E::from("Die Anmeldung wurde unterbrochen.".to_string()))?
}

#[tauri::command]
pub async fn account_status(state: TauriState<'_, AccountState>) -> Result<Info, String> {
    let cached = state.profile.lock().unwrap().clone();
    if let Some(info) = cached {
        return Ok(info);
    }
    let info = blocking(|| Ok::<_, String>(Account::embedded().status(&Keychain::for_profile()?))).await?;
    if info.signed_in {
        *state.profile.lock().unwrap() = Some(info.clone());
    }
    Ok(info)
}

#[tauri::command]
pub async fn account_sign_in_oauth(state: TauriState<'_, AccountState>, app: TauriState<'_, State>, provider: String) -> Result<Info, AuthIssue> {
    let (_guard, cancel) = state.begin()?;
    let api = app.api_handle();
    let info = blocking(move || {
        let account = Account::embedded();
        let store = Keychain::for_profile()?;
        let session = account.sign_in_oauth(&provider, &|url| open_browser(url), &cancel, LOGIN_TIMEOUT)?;
        if cancel.load(Ordering::Relaxed) { return Err(AuthIssue::from(CANCELLED)); }
        Ok::<_, AuthIssue>(account.finish(session, &store)?)
    })
    .await;
    Ok(done(info?, &state, api))
}

#[tauri::command]
pub async fn account_sign_in_google(state: TauriState<'_, AccountState>, app: TauriState<'_, State>) -> Result<Info, AuthIssue> {
    account_sign_in_oauth(state, app, "google".into()).await
}

#[tauri::command]
pub async fn account_sign_up(state: TauriState<'_, AccountState>, _app: TauriState<'_, State>, email: String, password: String) -> Result<Info, AuthIssue> {
    let (_guard, cancel) = state.begin()?;
    let outcome = blocking(move || {
        let account = Account::embedded();
        let out = account.sign_up(&email, &password)?;
        if cancel.load(Ordering::Relaxed) { return Err(AuthIssue::from(CANCELLED)); }
        Ok::<_, AuthIssue>(out)
    })
    .await?;
    match outcome {
        SignUpOutcome::NeedsOtp { email, kind } => {
            state.set_pending(email.clone(), kind, None);
            Err(otp_issue(email, kind))
        }
    }
}

#[tauri::command]
pub async fn account_sign_in(state: TauriState<'_, AccountState>, _app: TauriState<'_, State>, email: String, password: String) -> Result<Info, AuthIssue> {
    let (_guard, cancel) = state.begin()?;
    let outcome = blocking(move || {
        let account = Account::embedded();
        let out = account.sign_in(&email, &password)?;
        if cancel.load(Ordering::Relaxed) { return Err(AuthIssue::from(CANCELLED)); }
        Ok::<_, AuthIssue>(out)
    })
    .await;
    match outcome {
        Ok(SignInOutcome::NeedsOtp { email, kind, pending }) => {
            state.set_pending(email.clone(), kind, Some(pending));
            Err(otp_issue(email, kind))
        }
        Err(e) if e.code == "otp_required" => {
            if let Some(mail) = e.email.clone() {
                state.set_pending(mail, OtpKind::Signup, None);
            }
            Err(e)
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn account_verify_otp(state: TauriState<'_, AccountState>, app: TauriState<'_, State>, email: String, token: String, kind: Option<String>) -> Result<Info, AuthIssue> {
    let (_guard, _) = state.begin()?;
    let api = app.api_handle();
    let pending = state.take_pending();
    let otp_kind = kind
        .as_deref()
        .map(OtpKind::parse)
        .transpose()?
        .or_else(|| pending.as_ref().map(|p| p.kind))
        .unwrap_or(OtpKind::Signup);
    let mail = {
        let trimmed = email.trim();
        if !trimmed.is_empty() {
            trimmed.to_string()
        } else if let Some(p) = pending.as_ref() {
            p.email.clone()
        } else {
            return Err("E-Mail fehlt.".into());
        }
    };
    let info = blocking(move || {
        let account = Account::embedded();
        let store = Keychain::for_profile()?;
        let session = account.verify_otp(&mail, &token, otp_kind)?;
        Ok::<_, AuthIssue>(account.finish(session, &store)?)
    })
    .await;
    match info {
        Ok(info) => Ok(done(info, &state, api)),
        Err(e) => {
            // Pending wiederherstellen, damit „Code erneut senden“ weitergeht.
            if let Some(p) = pending {
                state.set_pending(p.email, p.kind, p.session);
            }
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn account_resend_otp(state: TauriState<'_, AccountState>, email: Option<String>, kind: Option<String>) -> Result<(), AuthIssue> {
    let (mail, otp_kind) = match (email.filter(|e| !e.trim().is_empty()), kind.as_deref().map(OtpKind::parse).transpose()?, state.peek_pending()) {
        (Some(e), Some(k), _) => (e.trim().to_string(), k),
        (Some(e), None, Some((_, k))) => (e.trim().to_string(), k),
        (Some(e), None, None) => (e.trim().to_string(), OtpKind::Signup),
        (None, Some(k), Some((e, _))) => (e, k),
        (None, None, Some((e, k))) => (e, k),
        _ => return Err("Keine offene Code-Anfrage.".into()),
    };
    blocking(move || Account::embedded().resend_otp(&mail, otp_kind)).await
}

#[tauri::command]
pub async fn account_reset_password(email: String) -> Result<(), AuthIssue> {
    blocking(move || Account::embedded().password_reset(&email)).await
}

#[tauri::command]
pub async fn account_confirm_password_reset(
    state: TauriState<'_, AccountState>,
    email: String,
    code: String,
    new_password: String,
) -> Result<(), AuthIssue> {
    let (_guard, _) = state.begin()?;
    blocking(move || Account::embedded().confirm_password_reset(&email, &code, &new_password)).await
}

#[tauri::command]
pub async fn account_update_profile(state: TauriState<'_, AccountState>, app: TauriState<'_, State>, display_name: String) -> Result<Info, AuthIssue> {
    let api = app.api_handle();
    let info = blocking(move || {
        let store = Keychain::for_profile()?;
        Account::embedded().update_profile(&store, &display_name)
    })
    .await?;
    Ok(done(info, &state, api))
}

#[tauri::command]
pub async fn account_change_password(new_password: String) -> Result<(), AuthIssue> {
    blocking(move || {
        let store = Keychain::for_profile()?;
        Account::embedded().change_password(&store, &new_password)
    })
    .await
}

#[tauri::command]
pub fn account_cancel(state: TauriState<'_, AccountState>) {
    state.cancel();
    state.clear_pending();
}

#[tauri::command]
pub fn account_sign_out(state: TauriState<'_, AccountState>, app: TauriState<'_, State>) -> Result<(), String> {
    state.cancel();
    state.clear_pending();
    let (_guard, _) = state.begin()?;
    Keychain::for_profile()?.delete_checked()?;
    *state.profile.lock().unwrap() = None;
    if let Some(api) = app.api_handle() {
        let _ = api.request("POST", "/v1/setup/account/logout", Some(json!({})));
    }
    Ok(())
}

// ---------------------------------------------------------------- Tests

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::thread;

    struct Memory(Mutex<Option<String>>);
    impl Memory {
        fn new(v: Option<&str>) -> Self {
            Memory(Mutex::new(v.map(str::to_string)))
        }
    }
    impl TokenStore for Memory {
        fn get(&self) -> Option<String> {
            self.0.lock().unwrap().clone()
        }
        fn set(&self, t: &str) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(t.to_string());
            Ok(())
        }
        fn delete(&self) {
            *self.0.lock().unwrap() = None;
        }
    }

    type Log = Arc<Mutex<Vec<(String, String)>>>;

    fn fake(handler: impl Fn(&str, &str) -> (u16, String) + Send + 'static) -> (String, Log) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let log: Log = Arc::default();
        let seen = Arc::clone(&log);
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { continue };
                let mut data = Vec::new();
                let mut chunk = [0u8; 4096];
                let (head_end, length) = loop {
                    let n = s.read(&mut chunk).unwrap_or(0);
                    if n == 0 {
                        break (0, 0);
                    }
                    data.extend_from_slice(&chunk[..n]);
                    if let Some(i) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&data[..i]).to_lowercase();
                        let len = head.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse().ok()).unwrap_or(0usize);
                        break (i + 4, len);
                    }
                };
                while data.len() < head_end + length {
                    let n = s.read(&mut chunk).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    data.extend_from_slice(&chunk[..n]);
                }
                let head = String::from_utf8_lossy(&data[..head_end.min(data.len())]).into_owned();
                let path = head.lines().next().unwrap_or("").split_whitespace().nth(1).unwrap_or("").to_string();
                let body = String::from_utf8_lossy(&data[head_end.min(data.len())..]).into_owned();
                seen.lock().unwrap().push((path.clone(), body.clone()));
                let (status, reply) = handler(&path, &body);
                let out = format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
                let _ = s.write_all(out.as_bytes());
            }
        });
        (base, log)
    }

    fn account(base: &str) -> Account {
        let cfg = Config::parse(r#"{"url":"https://example.supabase.co","anonKey":"test-anon"}"#);
        Account::new(cfg).with_origin(base)
    }

    fn session_json() -> String {
        json!({
            "access_token": "AT",
            "refresh_token": "REFRESH",
            "user": {
                "id": "user-1",
                "email": "a@b.de",
                "user_metadata": { "full_name": "Mira", "avatar_url": "https://x.test/p.png" }
            }
        }).to_string()
    }

    fn query_of(url: &str) -> HashMap<String, String> {
        Url::parse(url).unwrap().query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect()
    }

    fn get(port: u16, target: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    #[test]
    fn pkce_matches_rfc7636_vector() {
        assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let a = random_b64(48).unwrap();
        assert!(a.len() >= 43 && a != random_b64(48).unwrap());
    }

    #[test]
    fn placeholders_mean_not_configured() {
        let placeholders = Config::parse(r#"{"url":"HIER_SUPABASE_URL","anonKey":"HIER_SUPABASE_ANON_KEY"}"#);
        assert!(!placeholders.configured());
        assert!(!Config::parse("kaputt").configured());
        let acc = Account::new(placeholders);
        let err = acc.sign_in("a@b.de", "pw").unwrap_err();
        assert!(err.message.starts_with("Supabase ist noch nicht eingerichtet"));
        assert!(!acc.status(&Memory::new(None)).configured);
    }

    #[test]
    fn error_texts_are_german() {
        assert!(supabase_error_text("User already registered").contains("schon ein Konto"));
        assert!(supabase_error_text("Invalid login credentials").contains("stimmt nicht"));
        assert!(supabase_error_text("email_not_confirmed").contains("bestätige"));
        assert!(supabase_error_text("weak_password").contains("zu schwach"));
        assert!(supabase_error_text("rate limit").contains("Zu viele"));
        assert!(supabase_error_text("WAS_ANDERES").contains("fehlgeschlagen"));
    }

    #[test]
    fn loopback_accepts_code_with_fake_browser() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = thread::spawn(move || {
            assert!(get(port, "/favicon.ico").contains("404"));
            // Leerer expected_state: Supabase-fremden State akzeptieren.
            get(port, "/callback?code=abc%20d&state=supabase-fremd")
        });
        let code = wait_for_callback(&listener, "", &AtomicBool::new(false), Duration::from_secs(5)).unwrap();
        assert_eq!(code, "abc d");
        let body = browser.join().unwrap();
        assert!(body.contains("200 OK"));
        assert!(body.contains("Orbit"));
        assert!(body.contains("Zurück zu Orbit"));
        assert_eq!(body.matches("<svg").count(), 5);
        assert!(!body.to_lowercase().contains("supabase"));
    }

    #[test]
    fn loopback_accepts_code_without_state_and_handles_error_cancel_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        // Leerer Aufruf darf nicht abbrechen — danach kommt der echte Code.
        let b = thread::spawn(move || {
            assert!(get(port, "/callback").contains("Anmeldung läuft"));
            get(port, "/callback?code=NURCODE")
        });
        let code = wait_for_callback(&listener, "", &AtomicBool::new(false), Duration::from_secs(5)).unwrap();
        assert_eq!(code, "NURCODE");
        assert!(b.join().unwrap().contains("Zurück zu Orbit"));

        let b = thread::spawn(move || get(port, "/callback?error=access_denied"));
        let err = wait_for_callback(&listener, "", &AtomicBool::new(false), Duration::from_secs(5)).unwrap_err();
        assert_eq!(err, CANCELLED);
        assert!(b.join().unwrap().contains("Anmeldung abgebrochen"));

        let b = thread::spawn(move || get(port, "/callback?error=server_error&error_code=unexpected_failure"));
        let err = wait_for_callback(&listener, "", &AtomicBool::new(false), Duration::from_secs(5)).unwrap_err();
        assert_ne!(err, CANCELLED);
        assert!(b.join().unwrap().contains("Anmeldung fehlgeschlagen"));

        let cancel = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&cancel);
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(150));
            flag.store(true, Ordering::Relaxed);
        });
        assert_eq!(wait_for_callback(&listener, "", &cancel, Duration::from_secs(5)).unwrap_err(), CANCELLED);
        let err = wait_for_callback(&listener, "", &AtomicBool::new(false), Duration::from_millis(100)).unwrap_err();
        assert!(err.contains("zu lange"));
    }

    #[test]
    fn loopback_requires_matching_state_when_expected() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let b = thread::spawn(move || {
            let _ = get(port, "/callback?code=WRONG&state=fremd");
            get(port, "/callback?code=RIGHT&state=S1")
        });
        let code = wait_for_callback(&listener, "S1", &AtomicBool::new(false), Duration::from_secs(5)).unwrap();
        assert_eq!(code, "RIGHT");
        assert!(b.join().unwrap().contains("Zurück zu Orbit"));
    }

    #[test]
    fn both_providers_use_supabase_pkce_end_to_end() {
        let (base, log) = fake(|path, body| {
            if path.starts_with("/auth/v1/token") && body.contains("auth_code") {
                (200, session_json())
            } else {
                (404, "{}".into())
            }
        });
        for provider in ["google", "github"] {
            let acc = account(&base);
            let store = Memory::new(None);
            let seen_auth: Arc<Mutex<String>> = Arc::default();
            let seen = Arc::clone(&seen_auth);
            let open = move |url: &str| -> Result<(), String> {
                *seen.lock().unwrap() = url.to_string();
                let auth = query_of(url);
                let redirect = Url::parse(&auth["redirect_to"]).unwrap();
                let port = redirect.port().unwrap();
                assert_eq!(redirect.host_str(), Some("127.0.0.1"));
                assert_eq!(redirect.path(), "/callback");
                thread::spawn(move || get(port, "/callback?code=CODE123"));
                Ok(())
            };
            let session = acc.sign_in_oauth(provider, &open, &AtomicBool::new(false), Duration::from_secs(10)).unwrap();
            let info = acc.finish(session, &store).unwrap();
            assert_eq!(info.email.as_deref(), Some("a@b.de"));
            let stored = StoredSession::read(&store).unwrap();
            assert_eq!(stored.refresh_token, "REFRESH");
            let method = if provider == "google" { SignInMethod::Google } else { SignInMethod::GitHub };
            assert_eq!(info.sign_in_method, Some(method));
            assert_eq!(stored.method, Some(method));
            let auth = query_of(&seen_auth.lock().unwrap());
            assert_eq!(auth["code_challenge_method"], "s256");
            assert_eq!(auth["provider"], provider);
            let log = log.lock().unwrap();
            let token = log.iter().rev().find(|(p, _)| p.contains("grant_type=pkce")).expect("pkce token");
            let body: Value = serde_json::from_str(&token.1).unwrap();
            assert_eq!(body["auth_code"], "CODE123");
            assert_eq!(pkce_challenge(body["code_verifier"].as_str().unwrap()), auth["code_challenge"]);
        }
    }

    #[test]
    fn oauth_rejects_unknown_provider() {
        let acc = account("http://127.0.0.1:9");
        let err = acc.sign_in_oauth("twitter", &|_| Ok(()), &AtomicBool::new(false), Duration::from_secs(1)).unwrap_err();
        assert!(err.message.contains("Unbekannte"));
    }

    #[test]
    fn google_flow_can_be_cancelled_and_reports_open_errors() {
        let (base, _) = fake(|_, _| (404, "{}".into()));
        let acc = account(&base);
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&cancel);
        let err = acc
            .sign_in_oauth("github", &move |_| { flag.store(true, Ordering::Relaxed); Ok(()) }, &cancel, Duration::from_secs(5))
            .unwrap_err();
        assert_eq!(err.message, CANCELLED);
        let err = acc.sign_in_oauth("google", &|_| Err("kein Browser".into()), &AtomicBool::new(false), Duration::from_secs(1)).unwrap_err();
        assert_eq!(err.message, "kein Browser");
    }

    #[test]
    fn email_password_calls_and_error_mapping() {
        let (base, log) = fake(|path, body| {
            let b: Value = serde_json::from_str(body).unwrap_or(Value::Null);
            if path.starts_with("/auth/v1/signup") {
                if b["email"] == "da@b.de" {
                    (400, json!({"error_code": "user_already_exists", "msg": "User already registered"}).to_string())
                } else if b["password"] == "123" {
                    (400, json!({"error_code": "weak_password", "msg": "Password should contain at least 6 characters"}).to_string())
                } else {
                    (200, session_json())
                }
            } else if path.contains("grant_type=password") {
                if b["password"] == "richtig" { (200, session_json()) } else { (400, json!({"error_code": "invalid_credentials", "msg": "Invalid login credentials"}).to_string()) }
            } else if path.starts_with("/auth/v1/otp") || path.starts_with("/auth/v1/resend") {
                (200, "{}".into())
            } else {
                (404, "{}".into())
            }
        });
        let acc = account(&base);
        assert_eq!(acc.sign_up("da@b.de", "geheim1").unwrap_err().code, "email_exists");
        assert!(acc.sign_up("neu@b.de", "123").unwrap_err().message.contains("zu schwach"));
        assert_eq!(acc.sign_up("", "x").unwrap_err().message, "E-Mail und Passwort eingeben.");
        assert!(acc.sign_in("a@b.de", "falsch").unwrap_err().message.contains("stimmt nicht"));
        match acc.sign_in("a@b.de", "richtig").unwrap() {
            SignInOutcome::NeedsOtp { email, kind, .. } => {
                assert_eq!(email, "a@b.de");
                assert_eq!(kind, OtpKind::Login);
            }
        }
        match acc.sign_up(" neu@b.de ", "geheim1").unwrap() {
            SignUpOutcome::NeedsOtp { email, kind } => {
                assert_eq!(email, "neu@b.de");
                assert_eq!(kind, OtpKind::Login);
            }
        }
        let log = log.lock().unwrap();
        assert!(log.iter().any(|(p, body)| p.contains("/signup") && body.contains("\"neu@b.de\"")), "E-Mail wurde getrimmt");
        assert!(log.iter().any(|(p, _)| p.contains("/otp")), "Login schickt OTP");
    }

    #[test]
    fn login_mail_limit_is_distinct_from_a_login_failure() {
        let (base, _) = fake(|path, _| {
            if path.contains("grant_type=password") {
                (200, session_json())
            } else {
                (429, json!({"error_code": "over_email_send_rate_limit"}).to_string())
            }
        });
        let issue = account(&base).sign_in("test@example.test", "test-only-password").unwrap_err();
        assert_eq!(issue.code, "login_otp_rate_limited");
        assert_eq!(issue.email.as_deref(), Some("test@example.test"));
    }

    #[test]
    fn email_delivery_error_is_not_reported_as_a_sent_code() {
        let (base, _) = fake(|path, _| {
            if path.starts_with("/auth/v1/token") {
                (400, json!({"error_code":"email_not_confirmed"}).to_string())
            } else {
                (403, json!({"error_code":"email_address_not_authorized"}).to_string())
            }
        });
        let acc = account(&base);
        for failure in [
            acc.sign_up("neu@b.de", "geheim1").unwrap_err(),
            acc.sign_in("neu@b.de", "geheim1").unwrap_err(),
            acc.resend_otp("neu@b.de", OtpKind::Signup).unwrap_err(),
        ] {
            assert_eq!(failure.code, "email_delivery");
            assert!(failure.message.contains("keinen Bestätigungscode senden"));
        }
    }

    #[test]
    fn repeated_signup_does_not_claim_a_confirmation_was_sent() {
        let (base, requests) = fake(|_, body| {
            let body: Value = serde_json::from_str(body).unwrap();
            let user = json!({"id": "obfuscated", "identities": []});
            let response = if body["email"] == "wrapped@example.test" {
                json!({"user": user, "access_token": null})
            } else {
                user
            };
            (200, response.to_string())
        });
        let account = account(&base);
        for email in ["wrapped@example.test", "unwrapped@example.test"] {
            let error = account.sign_up(email, "test-only-password").unwrap_err();
            assert_eq!(error.code, "email_exists");
            assert_eq!(error.email.as_deref(), Some(email));
        }
        assert_eq!(requests.lock().unwrap().len(), 2);
    }

    #[test]
    fn signup_without_session_asks_for_email_confirmation() {
        let (base, _) = fake(|path, _| {
            if path.starts_with("/auth/v1/signup") {
                (200, json!({"user": {"id": "u1", "email": "neu@b.de"}, "access_token": Value::Null}).to_string())
            } else {
                (404, "{}".into())
            }
        });
        match account(&base).sign_up("neu@b.de", "geheim1").unwrap() {
            SignUpOutcome::NeedsOtp { email, kind } => {
                assert_eq!(email, "neu@b.de");
                assert_eq!(kind, OtpKind::Signup);
            }
        }
    }

    #[test]
    fn verify_otp_exchanges_code_for_session() {
        let (base, log) = fake(|path, body| {
            if path.starts_with("/auth/v1/verify") {
                let b: Value = serde_json::from_str(body).unwrap_or(Value::Null);
                assert_eq!(b["token"], "123456");
                assert_eq!(b["type"], "signup");
                (200, session_json())
            } else {
                (404, "{}".into())
            }
        });
        let session = account(&base).verify_otp("neu@b.de", "123456", OtpKind::Signup).unwrap();
        assert_eq!(session.email.as_deref(), Some("a@b.de"));
        let log = log.lock().unwrap();
        assert!(log.iter().any(|(p, _)| p.contains("/verify")));
    }

    #[test]
    fn password_reset_does_not_disclose_account_existence() {
        let (base, _) = fake(|path, body| {
            assert!(path.starts_with("/auth/v1/recover"));
            let value: Value = serde_json::from_str(body).unwrap();
            assert_eq!(value["email"], "test@example.test");
            (400, json!({"error_code": "user_not_found", "msg": "User not found"}).to_string())
        });
        assert!(account(&base).password_reset("test@example.test").is_ok());
    }

    #[test]
    fn password_recovery_updates_only_after_a_valid_recovery_code() {
        let (base, log) = fake(|path, body| {
            let request: Value = serde_json::from_str(body).unwrap();
            match path {
                "/auth/v1/verify" => {
                    assert_eq!(request["type"], "recovery");
                    if request["token"] == "123456" {
                        (200, session_json())
                    } else {
                        (400, json!({"error_code":"otp_expired"}).to_string())
                    }
                }
                "/auth/v1/user" => {
                    assert_eq!(request["password"], "test-password-only");
                    (200, "{}".into())
                }
                _ => (404, "{}".into()),
            }
        });
        let acc = account(&base);
        assert!(acc.confirm_password_reset("test@example.test", "123456", "short").is_err());
        assert!(log.lock().unwrap().is_empty());
        assert!(acc.confirm_password_reset("test@example.test", "999999", "test-password-only").is_err());
        assert_eq!(log.lock().unwrap().len(), 1);
        assert!(acc.confirm_password_reset("test@example.test", "123456", "test-password-only").is_ok());
        assert_eq!(log.lock().unwrap().last().unwrap().0, "/auth/v1/user");
    }

    #[test]
    fn unreachable_service_gives_offline_text_without_url() {
        let acc = account("http://127.0.0.1:9");
        let err = acc.sign_in("a@b.de", "pw").unwrap_err();
        assert_eq!(err.message, OFFLINE);
        assert!(!err.message.contains("127.0.0.1") && !err.message.contains("anon"));
    }

    #[test]
    fn status_reads_profile_rotates_token_and_drops_rejected_token() {
        let (base, _) = fake(|path, body| {
            if path.contains("grant_type=refresh_token") {
                if body.contains("ALT") {
                    (200, json!({"access_token": "AT", "refresh_token": "NEU", "user": {
                        "id": "user-1", "email": "a@b.de",
                        "user_metadata": { "full_name": "Mira", "avatar_url": "https://x.test/p.png" }
                    }}).to_string())
                } else {
                    (400, json!({"error": "invalid_grant"}).to_string())
                }
            } else if path.starts_with("/auth/v1/user") {
                (200, json!({"id": "user-1", "email": "a@b.de", "user_metadata": {
                    "full_name": "Mira", "avatar_url": "https://x.test/p.png"
                }}).to_string())
            } else {
                (404, "{}".into())
            }
        });
        let acc = account(&base);
        let out = Memory::new(None);
        assert_eq!(acc.status(&out), Info { configured: true, ..Info::default() });
        let store = Memory::new(Some("ALT"));
        let info = acc.status(&store);
        assert!(info.signed_in);
        assert_eq!((info.email.as_deref(), info.display_name.as_deref(), info.photo_url.as_deref()), (Some("a@b.de"), Some("Mira"), Some("https://x.test/p.png")));
        assert_eq!(StoredSession::read(&store).unwrap().refresh_token, "NEU");
        let bad = Memory::new(Some("ABGELAUFEN"));
        assert!(!acc.status(&bad).signed_in);
        assert_eq!(bad.get(), None, "abgelehnter Token wird gelöscht");
        let offline = account("http://127.0.0.1:9");
        let keep = Memory::new(Some("ALT"));
        assert!(offline.status(&keep).signed_in);
        assert!(keep.get().is_some());
    }

    #[test]
    fn only_one_login_runs_and_cancel_sets_flag() {
        let state = AccountState::default();
        let (guard, flag) = state.begin().unwrap();
        assert!(state.begin().is_err());
        state.cancel();
        assert!(flag.load(Ordering::Relaxed));
        drop(guard);
        assert!(state.begin().is_ok());
    }
}

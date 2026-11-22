use crate::api::{Api, open_browser};
use crate::profile::Profile;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State as TauriState;
use tauri::async_runtime::spawn_blocking;
use tauri::ipc::Channel;

#[derive(Default)]
pub struct State {
    api: Mutex<Option<Arc<Api>>>,
    data: Mutex<Option<String>>,
    streams: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Abbrüche, die vor dem Eintragen des Stroms eintrafen.
    cancelled: Mutex<HashSet<String>>,
    /// Auth-Link, den die Oberfläche noch nicht abgeholt hat.
    pending_auth: Mutex<Option<String>>,
}

impl State {
    /// Trägt den Strom ein; war er schon abgebrochen, startet das Flag gesetzt.
    pub(crate) fn register_stream(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(self.cancelled.lock().unwrap().remove(id)));
        self.streams.lock().unwrap().insert(id.to_string(), Arc::clone(&flag));
        flag
    }

    pub(crate) fn cancel_stream(&self, id: &str) {
        // Reihenfolge wie bei register_stream (erst cancelled, dann streams) verhindert verlorene Abbrüche.
        let mut cancelled = self.cancelled.lock().unwrap();
        if let Some(flag) = self.streams.lock().unwrap().get(id) {
            flag.store(true, Ordering::Relaxed);
        } else {
            if cancelled.len() >= 256 {
                cancelled.clear();
            }
            cancelled.insert(id.to_string());
        }
    }

    /// Verbundener Dienst (für das Konto: Profil als eingerichtet markieren), falls schon verbunden.
    pub(crate) fn api_handle(&self) -> Option<Arc<Api>> {
        self.api.lock().unwrap().clone()
    }

    pub(crate) fn set_pending_auth(&self, url: String) {
        *self.pending_auth.lock().unwrap() = Some(url);
    }

    pub(crate) fn take_pending_auth(&self) -> Option<String> {
        self.pending_auth.lock().unwrap().take()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    port: u16,
    data_dir: String,
}

fn current(state: &State) -> Result<Arc<Api>, String> {
    state.api.lock().unwrap().clone().ok_or_else(|| "Der Orbit-Dienst ist noch nicht verbunden.".to_string())
}

#[tauri::command]
pub async fn service_connect(state: TauriState<'_, State>) -> Result<ServiceInfo, String> {
    let existing = state.api.lock().unwrap().clone();
    if let Some(api) = existing {
        // Bereits verbunden: nur prüfen, ob der Dienst noch lebt.
        let probe = Arc::clone(&api);
        if spawn_blocking(move || probe.get("/v1/health").is_ok()).await.unwrap_or(false) {
            let data_dir = state.data.lock().unwrap().clone().unwrap_or_default();
            return Ok(ServiceInfo { port: api.port, data_dir });
        }
    }
    let (api, data) = spawn_blocking(|| {
        let profile = Profile::select()?;
        let api = profile.connect()?;
        Ok::<_, String>((api, profile.data.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| "Der Dienststart wurde unterbrochen.".to_string())??;
    let info = ServiceInfo { port: api.port, data_dir: data.clone() };
    *state.api.lock().unwrap() = Some(Arc::new(api));
    *state.data.lock().unwrap() = Some(data);
    Ok(info)
}

#[tauri::command]
pub async fn api_request(
    state: TauriState<'_, State>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    let api = current(&state)?;
    spawn_blocking(move || api.request(&method, &path, body))
        .await
        .map_err(|_| "Die Anfrage wurde unterbrochen.".to_string())?
}

#[tauri::command]
pub async fn api_stream(
    state: TauriState<'_, State>,
    method: String,
    path: String,
    body: Option<Value>,
    stream_id: String,
    on_event: Channel<Value>,
) -> Result<(), String> {
    let api = current(&state)?;
    let cancel = state.register_stream(&stream_id);
    let flag = Arc::clone(&cancel);
    let result = spawn_blocking(move || {
        api.stream(&method, &path, body, &|| flag.load(Ordering::Relaxed), |event| {
            on_event.send(event).is_ok() && !cancel.load(Ordering::Relaxed)
        })
    })
    .await
    .map_err(|_| "Der Nachrichtenstrom wurde unterbrochen.".to_string());
    state.streams.lock().unwrap().remove(&stream_id);
    state.cancelled.lock().unwrap().remove(&stream_id);
    result?
}

#[tauri::command]
pub fn api_stream_cancel(state: TauriState<'_, State>, stream_id: String) {
    state.cancel_stream(&stream_id);
}

#[tauri::command]
pub fn take_pending_auth_callback(state: TauriState<'_, State>) -> Option<String> {
    state.take_pending_auth()
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    open_browser(&url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_before_register_is_remembered() {
        let state = State::default();
        state.cancel_stream("a");
        assert!(state.register_stream("a").load(Ordering::Relaxed));
        assert!(!state.register_stream("a").load(Ordering::Relaxed), "Vormerkung nur einmal");
        let live = state.register_stream("b");
        state.cancel_stream("b");
        assert!(live.load(Ordering::Relaxed));
    }

    #[test]
    fn pending_auth_is_taken_once() {
        let state = State::default();
        assert_eq!(state.take_pending_auth(), None);
        state.set_pending_auth("orbit-rust://auth/callback?rotating_token_nonce=x".into());
        assert!(state.take_pending_auth().is_some());
        assert_eq!(state.take_pending_auth(), None);
    }

    /// Läuft nur mit ORBIT_DATA_DIR + ORBITD_PORT (Dienst mit Kopie-Profil), sonst übersprungen.
    #[test]
    fn health_through_profile_and_api() {
        if std::env::var_os("ORBITD_PORT").is_none() {
            return;
        }
        let profile = Profile::select().expect("Profil");
        let api = profile.connect().expect("Verbindung");
        let health = api.request("GET", "/v1/health", None).expect("health");
        println!("health: {health}");
        assert_eq!(api.port, std::env::var("ORBITD_PORT").unwrap().parse::<u16>().unwrap());
        assert!(api.request("GET", "/etc/passwd", None).is_err());
        assert!(api.request("GET", "/v1/events", None).is_err());
    }
}

/// Startet Orbit neu und beendet vorher den Dienst, damit neu erteilte Mac-Rechte (Bildschirm, Dateien) gelten.
#[tauri::command]
pub async fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    spawn_blocking(|| crate::profile::Profile::select()?.stop_service()).await.map_err(|_| "Der Neustart ist fehlgeschlagen.".to_string())??;
    app.restart()
}

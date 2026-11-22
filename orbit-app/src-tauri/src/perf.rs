//! Messhaken für die Bildrate: nur aktiv mit Umgebungsvariable ORBIT_PERF=1.
//! `perf_enabled` sagt der Oberfläche, ob sie messen soll; `perf_log` schreibt ihren Bericht nach /tmp/orbit-perf.json.

#[tauri::command]
pub fn perf_enabled() -> bool {
    std::env::var("ORBIT_PERF").map(|v| v == "1").unwrap_or(false)
}

#[tauri::command]
pub fn perf_log(json: String) -> Result<(), String> {
    if !perf_enabled() {
        return Ok(());
    }
    // Nur gültiges JSON und nur diese eine feste Datei.
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    std::fs::write("/tmp/orbit-perf.json", json).map_err(|e| e.to_string())
}

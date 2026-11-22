//! „Open at login“: LaunchAgent, der Orbit.app beim Anmelden öffnet.
//! Bewusst nicht SMAppService (braucht Team-ID); gleiches Muster wie der Dienst-LaunchAgent.
use std::fs;
use std::path::PathBuf;
use std::process::Command;

const LABEL: &str = "de.consti.orbit.app.login";

fn agent_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or_else(|| "Kein Home-Verzeichnis.".to_string())?;
    Ok(PathBuf::from(home).join("Library/LaunchAgents").join(format!("{LABEL}.plist")))
}

fn app_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // …/Orbit.app/Contents/MacOS/Orbit → drei Stufen hoch = .app
    let app = exe
        .ancestors()
        .nth(3)
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("app"))
        .ok_or_else(|| "Orbit läuft nicht aus einem App-Paket.".to_string())?
        .to_path_buf();
    Ok(app)
}

fn plist(app: &std::path::Path) -> String {
    let path = app.to_string_lossy();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-a</string>
    <string>{path}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#
    )
}

fn uid() -> String {
    unsafe { libc::getuid().to_string() }
}

fn bootout(path: &std::path::Path) {
    let _ = Command::new("launchctl")
        .args(["bootout", &format!("gui/{}", uid()), &path.to_string_lossy()])
        .status();
}

fn bootstrap(path: &std::path::Path) -> Result<(), String> {
    let status = Command::new("launchctl")
        .args(["bootstrap", &format!("gui/{}", uid()), &path.to_string_lossy()])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        // Schon geladen: erst entladen, dann erneut.
        bootout(path);
        let status = Command::new("launchctl")
            .args(["bootstrap", &format!("gui/{}", uid()), &path.to_string_lossy()])
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Login-Start konnte nicht eingerichtet werden.".into())
        }
    }
}

#[tauri::command]
pub fn set_login_open(enabled: bool) -> Result<(), String> {
    // In Dev (cargo run) kein .app — Schalter speichern, Wirkung überspringen.
    let app = match app_path() {
        Ok(p) if std::env::var_os("ORBIT_DATA_DIR").is_none() => p,
        _ => return Ok(()),
    };
    let path = agent_path()?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if enabled {
        fs::write(&path, plist(&app)).map_err(|e| e.to_string())?;
        bootstrap(&path)?;
    } else {
        bootout(&path);
        let _ = fs::remove_file(&path);
    }
    Ok(())
}

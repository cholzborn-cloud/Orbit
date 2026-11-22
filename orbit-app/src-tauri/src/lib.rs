mod account;
mod api;
mod commands;
mod deeplink;
mod login;
mod perf;
mod permissions_ui;
mod profile;
pub use profile::run_packaged_service;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn configure_profile_ui(app: &mut tauri::utils::config::AppConfig, data: &std::path::Path) {
    use tauri::utils::config::AppDirectoriesOverride;
    use sha2::{Digest, Sha256};

    app.app_directories_override = Some(AppDirectoriesOverride::Root(data.join("ui")));
    let digest = Sha256::digest(data.as_os_str().as_encoded_bytes());
    let id = digest[..16].try_into().expect("16 byte store identifier");
    for window in &mut app.windows {
        // Older WebKit silently falls back to the user's default store for unknown store identifiers.
        #[cfg(target_os = "macos")]
        { window.incognito = !objc2::available!(macos = 14.0) || data.starts_with("/private/tmp"); }
        window.data_store_identifier = Some(id);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    if std::env::var_os("ORBIT_DATA_DIR").is_some() {
        // Validate before creating a WebView, so an invalid override never opens the default store.
        let profile = profile::Profile::select().expect("Invalid Orbit profile");
        let home = std::env::var_os("HOME").expect("No home directory");
        let default = std::path::PathBuf::from(home).join("Library/Application Support/Orbit Rust");
        if default.canonicalize().ok().as_ref() != Some(&profile.data) {
            configure_profile_ui(&mut context.config_mut().app, &profile.data);
        }
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(commands::State::default())
        .manage(account::AccountState::default())
        // Schließen versteckt nur das Fenster; "Orbit öffnen" und Dock-Klick holen es zurück.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            deeplink::setup(app.handle());
            let open = MenuItem::with_id(app, "open", "Orbit öffnen", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Orbit")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            perf::perf_enabled,
            perf::perf_log,
            permissions_ui::show_permission_drag,
            permissions_ui::preview_attachment,
            commands::service_connect,
            commands::api_request,
            commands::api_stream,
            commands::api_stream_cancel,
            commands::open_url,
            login::set_login_open,
            commands::restart_app,
            commands::take_pending_auth_callback,
            account::account_status,
            account::account_sign_in_oauth,
            account::account_sign_in_google,
            account::account_sign_up,
            account::account_sign_in,
            account::account_verify_otp,
            account::account_resend_otp,
            account::account_reset_password,
            account::account_confirm_password_reset,
            account::account_update_profile,
            account::account_change_password,
            account::account_cancel,
            account::account_sign_out
        ])
        .build(context)
        .expect("error while building tauri application");
    app.run(|app, event| match event {
        // Fenster schließen beendet weder App noch Dienst; "Beenden" im Menü tut es (app.exit).
        RunEvent::ExitRequested { api, code, .. } if code.is_none() => api.prevent_exit(),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(app),
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn isolated_profiles_have_separate_webview_stores() {
        use std::path::Path;
        use tauri::utils::config::Config;
        // Kein generate_context: der Info.plist-Embed kollidiert sonst mit dem Binär-Test.
        let mut config: Config = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let app = &mut config.app;
        assert!(app.windows[0].data_store_identifier.is_none());
        super::configure_profile_ui(app, Path::new("/private/tmp/orbit-a"));
        let first = app.windows[0].data_store_identifier;
        assert!(first.is_some());
        #[cfg(target_os = "macos")]
        assert!(app.windows[0].incognito);
        super::configure_profile_ui(app, Path::new("/private/tmp/orbit-b"));
        assert_ne!(app.windows[0].data_store_identifier, first);
    }

    #[test]
    fn csp_is_strict() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let csp = config["app"]["security"]["csp"].as_str().expect("CSP gesetzt");
        assert!(csp.starts_with("default-src 'self'"));
        assert!(csp.contains("connect-src 'self' ipc: http://ipc.localhost"));
        assert!(!csp.contains("script-src") && !csp.contains("unsafe-eval"));
    }
}

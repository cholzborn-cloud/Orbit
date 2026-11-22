use crate::commands::State;
use reqwest::Url;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

/// Nur orbit-rust://auth/callback?rotating_token_nonce=… (wie im früheren Rust-Prototyp).
pub fn safe_callback(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| url.scheme() == "orbit-rust" && url.host_str() == Some("auth")
        && url.path() == "/callback" && url.username().is_empty() && url.password().is_none()
        && url.port().is_none() && url.query_pairs().any(|(key, _)| key == "rotating_token_nonce"))
}

/// Gültige Callback-Links (alles andere wird verworfen).
pub fn accepted(urls: &[Url]) -> Vec<String> {
    urls.iter().filter(|url| safe_callback(url.as_str())).map(|url| url.as_str().to_string()).collect()
}

fn deliver(app: &AppHandle, urls: Vec<Url>) {
    for url in accepted(&urls) {
        // Zwischenspeichern: die Oberfläche kann den Link auch später abholen.
        app.state::<State>().set_pending_auth(url.clone());
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        let _ = app.emit_to("main", "orbit:auth-callback", url);
    }
}

pub fn setup(app: &AppHandle) {
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| deliver(&handle, event.urls()));
    // Start durch den Link selbst: sofort zwischenspeichern, ohne Wartezeit.
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        deliver(app, urls);
    }
}

#[cfg(test)]
mod tests {
    use super::{accepted, safe_callback};
    use reqwest::Url;

    #[test]
    fn accepts_only_the_auth_callback() {
        assert!(safe_callback("orbit-rust://auth/callback?rotating_token_nonce=abc&x=1"));
        assert!(!safe_callback("orbit-rust://auth/callback"));
        assert!(!safe_callback("orbit://auth/callback?rotating_token_nonce=abc"));
        assert!(!safe_callback("orbit-rust://evil/callback?rotating_token_nonce=abc"));
        assert!(!safe_callback("orbit-rust://auth/other?rotating_token_nonce=abc"));
        assert!(!safe_callback("orbit-rust://u:p@auth/callback?rotating_token_nonce=abc"));
        assert!(!safe_callback("orbit-rust://auth:80/callback?rotating_token_nonce=abc"));
    }

    #[test]
    fn only_valid_links_are_kept_for_pickup() {
        let urls = ["orbit-rust://auth/callback?rotating_token_nonce=abc", "orbit-rust://evil/callback?rotating_token_nonce=abc"]
            .map(|u| Url::parse(u).unwrap());
        assert_eq!(accepted(&urls), ["orbit-rust://auth/callback?rotating_token_nonce=abc"]);
    }
}

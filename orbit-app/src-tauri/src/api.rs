use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderValue};
use reqwest::{Method, Url};
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

#[derive(Clone)]
pub struct Api {
    local: Client,
    streaming: Client,
    pub port: u16,
    base: Url,
    token_file: PathBuf,
}

impl Api {
    pub fn new(port: u16, profile: &Path) -> Result<Self, String> {
        let client = || {
            Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(3))
        };
        let connection_error = |_| "Die Verbindung konnte nicht eingerichtet werden.".to_string();
        Ok(Self {
            local: client()
                .timeout(Duration::from_secs(35))
                .build()
                .map_err(connection_error)?,
            streaming: client().timeout(None).tcp_keepalive(Duration::from_secs(30)).build().map_err(connection_error)?,
            port,
            base: Url::parse(&format!("http://127.0.0.1:{port}/")).expect("Loopback URL"),
            token_file: profile.join("service.token"),
        })
    }

    pub fn get(&self, path: &str) -> Result<Value, String> {
        self.request("GET", path, None)
    }

    pub fn request(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        if self.is_stream_path(path) {
            return Err("Für diese Anfrage ist der Nachrichtenstrom erforderlich.".into());
        }
        let response = self.send(&self.local, method, path, body, "application/json")?;
        let status = response.status();
        let result = response.json::<Value>().map_err(|_| {
            format!("Der lokale Dienst hat eine ungültige Antwort gesendet ({status}).")
        })?;
        if !status.is_success() || result.get("ok").and_then(Value::as_bool) == Some(false) {
            return Err(result.get("error").and_then(Value::as_str)
                .unwrap_or("Die Anfrage ist fehlgeschlagen.").into());
        }
        Ok(result)
    }

    /// Prüft nur den Pfad (ohne Query/Fragment, Punktsegmente aufgelöst), nicht den Rohtext.
    pub fn is_stream_path(&self, path: &str) -> bool {
        let Ok(url) = self.base.join(path) else { return false };
        let route = url.path().trim_end_matches('/');
        route == "/v1/events" || route.ends_with("/stream") || route.ends_with("/turn")
    }

    /// Liest den Strom in einem Hilfsthread und prüft alle 250 ms das Stopp-Signal,
    /// damit ein Abbruch auch bei ruhigem Strom sofort greift. Der Hilfsthread beendet
    /// sich (und schließt die Verbindung) spätestens bei der nächsten Zeile oder dem Ende.
    pub fn stream(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
        stop: &dyn Fn() -> bool,
        mut receive: impl FnMut(Value) -> bool,
    ) -> Result<(), String> {
        use std::sync::mpsc::{RecvTimeoutError, channel};
        if stop() {
            return Ok(());
        }
        let (tx, rx) = channel::<Result<Option<Value>, String>>();
        let api = self.clone();
        let (method, path) = (method.to_owned(), path.to_owned());
        std::thread::spawn(move || {
            let events = tx.clone();
            let result = api.stream_blocking(&method, &path, body, &|| false, |event| events.send(Ok(Some(event))).is_ok());
            let _ = tx.send(result.map(|_| None));
        });
        loop {
            if stop() {
                return Ok(());
            }
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(Ok(Some(event))) => {
                    if !receive(event) {
                        return Ok(());
                    }
                }
                Ok(Ok(None)) => return Ok(()),
                Ok(Err(error)) => return Err(error),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return Err("Der Nachrichtenstrom wurde unterbrochen.".into()),
            }
        }
    }

    fn stream_blocking(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
        stop: &dyn Fn() -> bool,
        receive: impl FnMut(Value) -> bool,
    ) -> Result<(), String> {
        let response = self.send(&self.streaming, method, path, body, "text/event-stream")?;
        let status = response.status();
        if status.as_u16() == 204 {
            return Ok(());
        }
        if !status.is_success() {
            return Err(response.json::<Value>().ok()
                .and_then(|result| result.get("error").and_then(Value::as_str).map(str::to_owned))
                .unwrap_or_else(|| format!("Der Nachrichtenstrom ist fehlgeschlagen ({status}).")));
        }
        if !response.headers().get(CONTENT_TYPE).and_then(|h| h.to_str().ok())
            .is_some_and(|h| h.starts_with("text/event-stream"))
        {
            return Err("Der lokale Dienst hat keinen Nachrichtenstrom gesendet.".into());
        }
        read_events(BufReader::new(response), stop, receive)
    }

    fn send(&self, client: &Client, method: &str, path: &str, body: Option<Value>, accept: &str) -> Result<Response, String> {
        if !path.starts_with("/v1/") || path.contains(['\\', '#']) {
            return Err("Ungültiger Dienstpfad.".into());
        }
        let url = self.base.join(path).map_err(|_| "Ungültiger Dienstpfad.")?;
        if url.origin() != self.base.origin() || !url.path().starts_with("/v1/") {
            return Err("Ungültiger Dienstpfad.".into());
        }
        let method = Method::from_bytes(method.as_bytes()).map_err(|_| "Ungültige Anfrage.")?;
        let token = read_token(&self.token_file)?;
        let mut authorization = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| "Ungültiger Zugang zum lokalen Dienst.")?;
        authorization.set_sensitive(true);
        let provisioning = method == Method::POST && url.path()
            .strip_prefix("/v1/bots/")
            .and_then(|path| path.strip_suffix("/sandbox/setup"))
            .is_some_and(|id| !id.is_empty() && !id.contains('/'));
        let request = client.request(method, url).header(AUTHORIZATION, authorization).header(ACCEPT, accept);
        // Daytona kann nach der Suche bis zu 120 Sekunden für das Anlegen brauchen.
        let request = if provisioning { request.timeout(Duration::from_secs(160)) } else { request };
        let request = match body {
            Some(body) => request.json(&body),
            None => request,
        };
        request.send().map_err(|err| if err.is_timeout() {
            "Der lokale Dienst hat zu lange gebraucht.".into()
        } else {
            "Der lokale Dienst ist nicht erreichbar.".into()
        })
    }
}

fn read_token(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut file = fs::OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW).open(path)
        .map_err(|_| "Der Zugang zum lokalen Dienst wird eingerichtet.")?;
    let metadata = file.metadata().map_err(|_| "Der Zugang zum lokalen Dienst fehlt.")?;
    if !metadata.is_file() || metadata.mode() & 0o777 != 0o600 || metadata.uid() != unsafe { libc::geteuid() } {
        return Err("Die Zugangsdatei des lokalen Dienstes ist nicht geschützt.".into());
    }
    let mut token = String::new();
    file.by_ref().take(80).read_to_string(&mut token)
        .map_err(|_| "Ungültiger Zugang zum lokalen Dienst.")?;
    let token = token.trim();
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Ungültiger Zugang zum lokalen Dienst.".into());
    }
    Ok(token.to_string())
}

fn read_events(reader: impl BufRead, stop: &dyn Fn() -> bool, mut receive: impl FnMut(Value) -> bool) -> Result<(), String> {
    let mut data = String::new();
    for line in reader.lines() {
        if stop() {
            return Ok(());
        }
        let line = line.map_err(|_| "Die Verbindung zum Nachrichtenstrom wurde unterbrochen.")?;
        if line.is_empty() {
            if data == "[DONE]" {
                return Ok(());
            }
            if !data.is_empty() {
                let event = serde_json::from_str(&data).map_err(|_| "Ungültiger Nachrichtenstrom.")?;
                if !receive(event) {
                    return Ok(());
                }
                data.clear();
            }
        } else if let Some(part) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(part.strip_prefix(' ').unwrap_or(part));
        }
    }
    Err("Die Verbindung zum Nachrichtenstrom wurde unterbrochen.".into())
}

/// Erlaubt sind nur https-Links (mit Host, ohne Zugangsdaten) und mailto:-Adressen.
pub fn safe_external_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Dieser Link ist ungültig.".to_string())?;
    match url.scheme() {
        "https" if url.host_str().is_some() && url.username().is_empty() && url.password().is_none() => Ok(url),
        "https" => Err("Dieser Link ist ungültig.".into()),
        "mailto" if !url.path().is_empty() && !value.chars().any(char::is_control) => Ok(url),
        "mailto" => Err("Diese E-Mail-Adresse ist ungültig.".into()),
        _ => Err("Dieser Link-Typ wird nicht unterstützt. Erlaubt sind nur https- und mailto-Links.".into()),
    }
}

pub fn open_browser(url: &str) -> Result<(), String> {
    let url = safe_external_url(url)?;
    Command::new("/usr/bin/open").arg(url.as_str()).spawn()
        .map(|_| ()).map_err(|_| "Der Browser konnte nicht geöffnet werden.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn events_preserve_payload_and_recognize_final_marker() {
        let data = b": keepalive\r\n\r\ndata: {\r\ndata: \"delta\":\"Gr\xc3\xbc\xc3\x9fe\"}\r\n\r\ndata: [DONE]\r\n\r\n";
        let mut events = Vec::new();
        assert!(read_events(&data[..], &|| false, |event| { events.push(event); true }).is_ok());
        assert_eq!(events, [json!({"delta":"Grüße"})]);
        assert!(read_events(&b"data: {\"type\":\"start\"}\n\n"[..], &|| false, |_| true).is_err());
    }

    fn api_for(port: u16, dir: &Path) -> Api {
        Api::new(port, dir).unwrap()
    }

    #[test]
    fn stream_paths_ignore_query_and_fragment_tricks() {
        let api = api_for(1, Path::new("/nonexistent"));
        for path in ["/v1/events", "/v1/events?x", "/v1/events/", "/v1/events?x=/y", "/v1/chats/1/stream?a=b",
            "/v1/chats/1/turn?x#y", "/v1/a/../events?x", "/v1/chats/1/stream/"] {
            assert!(api.is_stream_path(path), "{path}");
            assert!(api.request("GET", path, None).is_err(), "{path}");
        }
        assert!(!api.is_stream_path("/v1/health"));
        assert!(!api.is_stream_path("/v1/chats?next=/stream"));
    }

    #[test]
    fn external_urls_allow_only_https_and_mailto() {
        assert!(safe_external_url("https://example.com/a?b=1").is_ok());
        assert!(safe_external_url("mailto:a@example.com?subject=Hallo").is_ok());
        for bad in ["http://example.com", "file:///etc/passwd", "javascript:alert(1)", "https://u:p@example.com",
            "https://", "mailto:", "orbit-rust://x", "tel:123", "nonsense"] {
            let error = safe_external_url(bad).unwrap_err();
            assert!(error.contains("Link") || error.contains("Adresse"), "{bad}: {error}");
        }
    }

    #[test]
    fn stream_stops_quickly_while_the_service_is_silent() {
        use std::io::Write;
        use std::net::TcpListener;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::time::Instant;
        let dir = std::env::temp_dir().join(format!("orbit-stream-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let token = dir.join("service.token");
        fs::write(&token, "a".repeat(64)).unwrap();
        fs::set_permissions(&token, std::os::unix::fs::PermissionsExt::from_mode(0o600)).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut socket, _)) = listener.accept() {
                let _ = socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\ndata: {\"a\":1}\n\n");
                std::thread::sleep(Duration::from_secs(6));
            }
        });
        let api = api_for(port, &dir);
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(600));
            flag.store(true, Ordering::Relaxed);
        });
        let started = Instant::now();
        let mut seen = 0;
        let result = api.stream("GET", "/v1/ok", None, &|| cancel.load(Ordering::Relaxed), |_| { seen += 1; true });
        assert!(result.is_ok());
        assert_eq!(seen, 1);
        assert!(started.elapsed() < Duration::from_secs(2), "{:?}", started.elapsed());
        let _ = fs::remove_dir_all(&dir);
    }
}

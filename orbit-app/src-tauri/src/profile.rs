use crate::api::Api;
use serde::Deserialize;
use std::env;
use std::fs::{self, File, OpenOptions, Permissions};
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const SERVICE_GENERATION: u32 = 7; // equals PROTOCOL_VERSION in orbitd/orbitd/runtime/contract.py

#[derive(Deserialize)]
struct Endpoint {
    port: u16,
    pid: u32,
    #[serde(default)]
    generation: u32,
}

pub struct Profile {
    pub data: PathBuf,
    external_port: Option<u16>,
}

impl Profile {
    pub fn select() -> Result<Self, String> {
        let home = env::var_os("HOME").map(PathBuf::from).ok_or("Der Benutzerordner fehlt.")?;
        let support = home.join("Library/Application Support");
        let data = env::var_os("ORBIT_DATA_DIR").map(PathBuf::from)
            .unwrap_or_else(|| support.join("Orbit Rust"));
        if !data.is_absolute() || data.symlink_metadata().is_ok_and(|meta| meta.is_symlink()) {
            return Err("Der Orbit-Profilordner muss ein eigener absoluter Pfad sein.".into());
        }
        let legacy = support.join("Orbit");
        let legacy_resolved = legacy.canonicalize().unwrap_or_else(|_| legacy.clone());
        let projected = canonical_destination(&data)?;
        if projected.starts_with(&legacy) || projected.starts_with(&legacy_resolved) {
            return Err("Wähle für diese Orbit-App einen eigenen Profilordner.".into());
        }
        fs::DirBuilder::new().recursive(true).mode(0o700).create(&projected)
            .map_err(|_| "Der Orbit-Profilordner konnte nicht erstellt werden.")?;
        let data = projected.canonicalize().map_err(|_| "Der Orbit-Profilordner fehlt.")?;
        let meta = data.metadata().map_err(|_| "Der Orbit-Profilordner fehlt.")?;
        if !meta.is_dir() || meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o077 != 0 {
            return Err("Der Orbit-Profilordner muss privat sein (Berechtigung 0700).".into());
        }
        let external_port = match env::var("ORBITD_PORT") {
            Ok(raw) if env::var_os("ORBIT_DATA_DIR").is_some() => Some(parse_port(&raw)?),
            Ok(_) => return Err("Gib zum Test-Port einen eigenen Orbit-Profilordner an.".into()),
            Err(env::VarError::NotPresent) => None,
            Err(env::VarError::NotUnicode(_)) => return Err("Ungültiger Test-Port für Orbit.".into()),
        };
        Ok(Self { data, external_port })
    }

    pub fn connect(&self) -> Result<Api, String> {
        if let Some(port) = self.external_port {
            let api = Api::new(port, &self.data)?;
            api.get("/v1/health")?;
            return Ok(api);
        }
        let _startup = self.lock("startup.lock", true)?.ok_or("Das Orbit-Profil ist belegt.")?;
        if self.lock("service.lock", false)?.is_none() {
            let api = self.wait_for_endpoint(Duration::from_secs(6))?;
            // Der Dienst überlebt das Schließen der App. Ein laufender Auftrag behält seinen Prozess.
            if self.endpoint()?.generation >= SERVICE_GENERATION
                || !api.get("/v1/status").is_ok_and(|status| service_is_idle(&status))
            {
                return Ok(api);
            }
            self.stop_service_locked()?;
        }
        let launch = Launch::find()?;
        let log = self.private_file("service.log")?;
        let errors = log.try_clone().map_err(|_| "Das Dienstprotokoll konnte nicht geöffnet werden.")?;
        let mut command = Command::new(&launch.binary);
        command.args(&launch.args)
            .current_dir(&launch.cwd)
            .env_clear()
            .env("ORBIT_BRAIN", "off")
            .env("ORBIT_AGENTS_PATH", &launch.agents)
            .env("ORBIT_DATA_DIR", &self.data)
            .env("ORBIT_ISOLATED_PROFILE", "1")
            .env("PATH", safe_path())
            .env_remove("ORBITD_PORT")
            .stdin(Stdio::null()).stdout(Stdio::from(log)).stderr(Stdio::from(errors));
        if let Some(path) = &launch.pythonpath { command.env("PYTHONPATH", path); }
        for key in ["HOME", "LOGNAME", "USER", "TMPDIR", "LANG", "LC_ALL", "TZ", "ORBIT_CLERK_FRONTEND_URL", "ORBIT_CLERK_PUBLISHABLE_KEY"] {
            if let Some(value) = env::var_os(key) { command.env(key, value); }
        }
        if self.data.starts_with(Path::new("/private/tmp")) {
            for key in ["ORBIT_FAKE_CLI", "ORBIT_FAKE_SANDBOX", "ORBIT_KEYCHAIN_FAKE", "ORBIT_NO_SANDBOX"] {
                if let Some(value) = env::var_os(key) { command.env(key, value); }
            }
        }
        // The service keeps its profile lock and survives exits of the graphical client.
        unsafe { command.pre_exec(|| if libc::setsid() < 0 { Err(io::Error::last_os_error()) } else { Ok(()) }); }
        let mut child = command.spawn().map_err(|_| "Der lokale Orbit-Dienst konnte nicht gestartet werden.")?;
        let expected_pid = child.id();
        let result = self.wait_for_child(expected_pid, &mut child);
        if result.is_err() && child.try_wait().ok().flatten().is_none() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if result.is_ok() {
            thread::spawn(move || { let _ = child.wait(); });
        }
        result
    }

    /// Beendet den Dienst dieses Profils (SIGTERM) und wartet, bis er die Profilsperre freigibt. Nötig vor einem App-Neustart:
    /// der Dienst überlebt das Beenden der Oberfläche und behielte sonst den alten Stand der macOS-Rechte (Bildschirm, Dateien).
    pub fn stop_service(&self) -> Result<(), String> {
        if self.external_port.is_some() { return Ok(()); }
        let _startup = self.lock("startup.lock", true)?.ok_or("Das Orbit-Profil ist belegt.")?;
        self.stop_service_locked()
    }

    fn stop_service_locked(&self) -> Result<(), String> {
        if self.lock("service.lock", false)?.is_some() { return Ok(()); }
        let endpoint = self.endpoint()?;
        if unsafe { libc::kill(endpoint.pid as i32, libc::SIGTERM) } != 0 {
            return Err("Der Orbit-Dienst konnte nicht beendet werden.".into());
        }
        let until = Instant::now() + Duration::from_secs(8);
        while Instant::now() < until {
            if self.lock("service.lock", false)?.is_some() { return Ok(()); }
            thread::sleep(Duration::from_millis(50));
        }
        Err("Der Orbit-Dienst beendet sich noch.".into())
    }

    pub fn stop_test_service(&self) -> Result<(), String> {
        if self.external_port.is_some() || env::var_os("ORBIT_DATA_DIR").is_none()
            || !self.data.starts_with(Path::new("/private/tmp")) {
            return Err("Der Selbsttest darf nur seinen eigenen temporären Dienst stoppen.".into());
        }
        self.stop_service()
    }

    fn wait_for_child(&self, expected_pid: u32, child: &mut std::process::Child) -> Result<Api, String> {
        let until = Instant::now() + Duration::from_secs(12);
        while Instant::now() < until {
            if child.try_wait().map_err(|_| "Der Orbit-Dienst ist abgestürzt.")?.is_some() {
                return Err("Der Orbit-Dienst ist beim Start ausgestiegen. Details stehen im Profilprotokoll.".into());
            }
            if let Ok(endpoint) = self.endpoint() && endpoint.pid == expected_pid {
                let api = Api::new(endpoint.port, &self.data)?;
                if api.get("/v1/health").is_ok() { return Ok(api); }
            }
            thread::sleep(Duration::from_millis(100));
        }
        Err("Der Orbit-Dienst ist noch nicht bereit. Details stehen im Profilprotokoll.".into())
    }

    fn wait_for_endpoint(&self, timeout: Duration) -> Result<Api, String> {
        let until = Instant::now() + timeout;
        while Instant::now() < until {
            if self.lock("service.lock", false)?.is_some() {
                return Err("Der Orbit-Dienst wurde gerade beendet. Versuche es erneut.".into());
            }
            if let Ok(endpoint) = self.endpoint() {
                let api = Api::new(endpoint.port, &self.data)?;
                if api.get("/v1/health").is_ok() { return Ok(api); }
            }
            thread::sleep(Duration::from_millis(100));
        }
        Err("Der Orbit-Dienst antwortet nicht. Details stehen im Profilprotokoll.".into())
    }

    fn endpoint(&self) -> Result<Endpoint, String> {
        let path = self.data.join("endpoint.json");
        let meta = fs::symlink_metadata(&path).map_err(|_| "Der Orbit-Dienst startet.")?;
        if !meta.is_file() || meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o077 != 0 || meta.len() > 1000 {
            return Err("Der lokale Orbit-Endpunkt ist ungültig.".into());
        }
        let marker = fs::read(path).map_err(|_| "Der Orbit-Dienst startet.")?;
        let endpoint: Endpoint = serde_json::from_slice(&marker).map_err(|_| "Der Orbit-Dienst startet.")?;
        parse_port(&endpoint.port.to_string())?;
        if endpoint.pid <= 1 || endpoint.pid > i32::MAX as u32 {
            return Err("Der lokale Orbit-Endpunkt ist ungültig.".into());
        }
        Ok(endpoint)
    }

    fn private_file(&self, name: &str) -> Result<File, String> {
        let file = OpenOptions::new().read(true).append(true).create(true).mode(0o600)
            .custom_flags(libc::O_NOFOLLOW).open(self.data.join(name))
            .map_err(|_| "Der Orbit-Profilordner kann nicht geschrieben werden.")?;
        let metadata = file.metadata().map_err(|_| "Der Orbit-Profilordner kann nicht gelesen werden.")?;
        if !metadata.is_file() || metadata.uid() != unsafe { libc::geteuid() } {
            return Err("Die Orbit-Profildatei ist ungültig.".into());
        }
        file.set_permissions(Permissions::from_mode(0o600))
            .map_err(|_| "Die Orbit-Profildatei ist nicht privat.")?;
        Ok(file)
    }

    fn lock(&self, file: &str, wait: bool) -> Result<Option<File>, String> {
        let file = self.private_file(file)?;
        let flag = if wait { libc::LOCK_EX } else { libc::LOCK_EX | libc::LOCK_NB };
        loop {
            if unsafe { libc::flock(file.as_raw_fd(), flag) } == 0 { return Ok(Some(file)); }
            let err = io::Error::last_os_error();
            if err.raw_os_error() == Some(libc::EWOULDBLOCK) { return Ok(None); }
            if err.kind() != io::ErrorKind::Interrupted { return Err("Das Orbit-Profil konnte nicht gesperrt werden.".into()); }
        }
    }
}

fn canonical_destination(path: &Path) -> Result<PathBuf, String> {
    if let Ok(canonical) = path.canonicalize() { return Ok(canonical); }
    let parent = path.parent().ok_or("Ungültiger Profilpfad.")?;
    let name = path.file_name().ok_or("Ungültiger Profilpfad.")?;
    Ok(canonical_destination(parent)?.join(name))
}

fn parse_port(port: &str) -> Result<u16, String> {
    port.parse::<u16>().ok().filter(|&port| port >= 1024 && port != 4317)
        .ok_or_else(|| "Der Orbit-Testport ist ungültig oder gehört zur bisherigen App.".into())
}

pub(crate) fn resources() -> Result<PathBuf, String> {
    env::current_exe().ok().and_then(|exe| exe.parent()?.parent().map(|contents| contents.join("Resources")))
        .ok_or_else(|| "Das Orbit-App-Paket wurde nicht gefunden.".into())
}

/// Wie der Dienst gestartet wird: im Paket aus Resources/python, in der Entwicklung aus ../orbitd.
struct Launch {
    binary: PathBuf,
    args: Vec<PathBuf>,
    cwd: PathBuf,
    agents: PathBuf,
    pythonpath: Option<PathBuf>,
}

impl Launch {
    fn find() -> Result<Self, String> {
        let resources = resources()?;
        let python = resources.join("python/lib/libpython3.13.dylib");
        let entry = resources.join("service_entry.py");
        if python.is_file() && entry.is_file() {
            return Ok(Self {
                binary: env::current_exe().map_err(|_| "Orbit wurde nicht gefunden.")?,
                args: vec!["--orbit-service".into()],
                agents: resources.join("AGENTS.md"),
                cwd: resources,
                pythonpath: None,
            });
        }
        if resources.join("python").exists() || cfg!(not(debug_assertions)) {
            return Err("Der lokale Dienst fehlt im App-Paket.".into());
        }
        Self::dev()
    }

    /// Entwicklung (cargo run / tauri dev): venv von ../orbitd, Einstieg wie im Paket aus orbit-app/native.
    fn dev() -> Result<Self, String> {
        let orbit = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize()
            .map_err(|_| "Der Orbit-Projektordner wurde nicht gefunden.")?;
        let service = orbit.join("orbitd");
        let python = service.join(".venv/bin/python");
        let entry = orbit.join("orbit-app/native/service_entry.py");
        if !python.is_file() || !entry.is_file() {
            return Err("Der Dienst für die Entwicklung fehlt (orbitd/.venv oder service_entry.py).".into());
        }
        Ok(Self {
            binary: python,
            args: vec!["-B".into(), entry],
            agents: orbit.join("AGENTS.md"),
            cwd: service.clone(),
            pythonpath: Some(service),
        })
    }
}

/// Boot the packaged Python runtime inside the signed Orbit executable so macOS
/// checks the same application identity for service and window permissions.
#[cfg(target_os = "macos")]
pub fn run_packaged_service() -> i32 {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let start = || -> Option<i32> {
        let resources = resources().ok()?;
        let home = resources.join("python");
        let lib = CString::new(home.join("lib/libpython3.13.dylib").as_os_str().as_bytes()).ok()?;
        let home_wide: Vec<libc::wchar_t> = home.to_str()?.chars().map(|c| c as libc::wchar_t).chain([0]).collect();
        let entry = resources.join("service_entry.py");
        let executable = home.join("bin/python3.13");
        let args = [
            CString::new(executable.as_os_str().as_bytes()).ok()?,
            CString::new("-I").ok()?,
            CString::new("-B").ok()?,
            CString::new(entry.as_os_str().as_bytes()).ok()?,
        ];
        let mut argv: Vec<*mut libc::c_char> = args.iter().map(|s| s.as_ptr().cast_mut()).collect();
        argv.push(std::ptr::null_mut());
        unsafe {
            let handle = libc::dlopen(lib.as_ptr(), libc::RTLD_NOW | libc::RTLD_GLOBAL);
            if handle.is_null() { return None; }
            let set_home = libc::dlsym(handle, c"Py_SetPythonHome".as_ptr());
            let main = libc::dlsym(handle, c"Py_BytesMain".as_ptr());
            if set_home.is_null() || main.is_null() { return None; }
            let set_home: unsafe extern "C" fn(*const libc::wchar_t) = std::mem::transmute(set_home);
            let main: unsafe extern "C" fn(libc::c_int, *mut *mut libc::c_char) -> libc::c_int = std::mem::transmute(main);
            env::set_var("ORBIT_TCC_BUNDLE", "1");
            set_home(home_wide.as_ptr());
            Some(main(args.len() as libc::c_int, argv.as_mut_ptr()))
        }
    };
    start().unwrap_or_else(|| { eprintln!("Die Orbit-Laufzeit konnte nicht gestartet werden."); 1 })
}

#[cfg(not(target_os = "macos"))]
pub fn run_packaged_service() -> i32 { 1 }

fn safe_path() -> String {
    let common = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    match env::var("HOME") {
        Ok(home) if !home.contains(':') => format!("{home}/.local/bin:{home}/.bun/bin:{common}"),
        _ => common.to_string(),
    }
}

fn service_is_idle(status: &serde_json::Value) -> bool {
    status.get("chats").and_then(|chats| chats.as_array()).is_some_and(Vec::is_empty)
        && status.get("needsYou").and_then(|count| count.as_u64()) == Some(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_legacy_port() {
        assert!(parse_port("4317").is_err());
        assert!(parse_port("44317").is_ok());
    }

    #[test]
    fn only_an_explicitly_idle_service_can_be_replaced() {
        use serde_json::json;
        assert!(service_is_idle(&json!({"chats": [], "needsYou": 0})));
        assert!(!service_is_idle(&json!({"chats": [{"status": "arbeitet"}], "needsYou": 0})));
        assert!(!service_is_idle(&json!({"chats": [], "needsYou": 1})));
        assert!(!service_is_idle(&json!({"ok": true})));
    }

    /// Startet den Dienst aus ../orbitd (Entwicklungsweg). Nur mit ORBIT_DEV_SPAWN=1 und ORBIT_DATA_DIR unter /private/tmp.
    #[test]
    fn dev_spawn_starts_and_stops_service() {
        if env::var_os("ORBIT_DEV_SPAWN").is_none() || env::var_os("ORBITD_PORT").is_some() { return; }
        let profile = Profile::select().expect("Profil");
        let api = profile.connect().expect("Dienststart aus ../orbitd");
        assert!(api.get("/v1/health").is_ok());
        assert_eq!(profile.endpoint().expect("Dienst-Endpunkt").generation, SERVICE_GENERATION);
        profile.stop_test_service().expect("Dienst beenden");
    }
}

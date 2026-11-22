#[tauri::command]
pub fn show_permission_drag(app: tauri::AppHandle, kind: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::{ffi::CString, os::unix::ffi::OsStrExt, sync::OnceLock};
        type ShowPanel = unsafe extern "C" fn(*const libc::c_char, *const libc::c_char);
        static SHOW: OnceLock<Option<ShowPanel>> = OnceLock::new();

        let resources = crate::profile::resources()?;
        let bundle = resources.parent().and_then(|contents| contents.parent())
            .ok_or("Orbit.app wurde nicht gefunden.")?;
        let path = CString::new(bundle.as_os_str().as_bytes()).map_err(|_| "Ungültiger Orbit-Pfad.")?;
        let list = match kind.as_deref() {
            Some("accessibility") => "Bedienungshilfen",
            Some("screen") => "Bildschirmaufnahme",
            Some("full_disk") | None => "Festplattenvollzugriff",
            Some(_) => return Err("Unbekanntes Recht.".into()),
        };
        let list = CString::new(list).map_err(|_| "Ungültiger Text.")?;
        let library = CString::new(resources.join("libOrbitPermissionUI.dylib").as_os_str().as_bytes())
            .map_err(|_| "Ungültiger Orbit-Pfad.")?;
        let show = *SHOW.get_or_init(|| unsafe {
            let handle = libc::dlopen(library.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
            if handle.is_null() { return None; }
            let symbol = libc::dlsym(handle, c"orbit_show_permission_drag".as_ptr());
            if symbol.is_null() { return None; }
            Some(std::mem::transmute::<*mut libc::c_void, ShowPanel>(symbol))
        });
        let show = show.ok_or("Das Orbit-Ziehfenster konnte nicht geladen werden.")?;
        app.run_on_main_thread(move || unsafe { show(path.as_ptr(), list.as_ptr()); })
            .map_err(|_| "Das Orbit-Ziehfenster konnte nicht geöffnet werden.".into())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Das Ziehfenster ist nur auf dem Mac verfügbar.".into())
    }
}

#[tauri::command]
pub async fn preview_attachment(
    app: tauri::AppHandle,
    base64: String,
    filename: String,
    media_type: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::{ffi::CString, os::unix::ffi::OsStrExt, sync::OnceLock};
        type Preview = unsafe extern "C" fn(*const libc::c_char, *const libc::c_char, *const libc::c_char) -> i32;
        static PREVIEW: OnceLock<Option<Preview>> = OnceLock::new();
        let error = || "Die Schnellansicht konnte nicht geöffnet werden.".to_string();
        if base64.len() > (10 * 1024 * 1024 + 2) / 3 * 4 || filename.len() > 1024 || media_type.len() > 256 {
            return Err(error());
        }
        let contents = CString::new(base64).map_err(|_| error())?;
        let filename = CString::new(filename).map_err(|_| error())?;
        let media_type = CString::new(media_type).map_err(|_| error())?;
        let library = CString::new(crate::profile::resources()?.join("libOrbitPermissionUI.dylib").as_os_str().as_bytes())
            .map_err(|_| error())?;
        let show = PREVIEW.get_or_init(|| unsafe {
            let handle = libc::dlopen(library.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
            if handle.is_null() { return None; }
            let symbol = libc::dlsym(handle, c"orbit_preview_attachment".as_ptr());
            if symbol.is_null() { return None; }
            Some(std::mem::transmute::<*mut libc::c_void, Preview>(symbol))
        }).ok_or_else(error)?;
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let shown = unsafe { show(contents.as_ptr(), filename.as_ptr(), media_type.as_ptr()) };
            let _ = tx.send(shown == 1);
        }).map_err(|_| error())?;
        match tauri::async_runtime::spawn_blocking(move || rx.recv()).await {
            Ok(Ok(true)) => Ok(()),
            _ => Err(error()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, base64, filename, media_type);
        Err("Die Schnellansicht ist auf dem Mac verfügbar.".into())
    }
}

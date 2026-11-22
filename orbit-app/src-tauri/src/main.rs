// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args_os().nth(1).is_some_and(|arg| arg == "--orbit-service") {
        std::process::exit(orbit_app_lib::run_packaged_service());
    }
    orbit_app_lib::run()
}

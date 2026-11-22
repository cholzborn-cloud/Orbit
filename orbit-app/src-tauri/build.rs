use std::{env, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=supabase.config.json");
    println!("cargo:rerun-if-changed=supabase.config.example.json");

    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("Cargo manifest directory"));
    let local = root.join("supabase.config.json");
    let config = if local.is_file() {
        local
    } else {
        root.join("supabase.config.example.json")
    };
    println!("cargo:rustc-env=ORBIT_SUPABASE_CONFIG={}", config.display());

    tauri_build::build()
}

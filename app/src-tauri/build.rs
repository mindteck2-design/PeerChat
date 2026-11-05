fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

    // Tauri embeds the Common Controls v6 manifest into the app .exe only.
    // `TaskDialogIndirect` exists only in comctl32 v6, so the unmanifested
    // `cargo test` harness loads comctl32 v5 and exits 0xc0000139
    // (STATUS_ENTRYPOINT_NOT_FOUND) before any test runs.
    // https://github.com/tauri-apps/tauri/issues/13419
    if target_os == "windows" && target_env == "msvc" {
        let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
        let attrs = tauri_build::Attributes::new().windows_attributes(windows);
        tauri_build::try_build(attrs).expect("failed to run tauri-build");

        let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows")
            .join("comctl-v6.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        let input = manifest.display().to_string().replace('\\', "/");
        if input.contains(' ') {
            println!("cargo:rustc-link-arg=\"/MANIFESTINPUT:{input}\"");
        } else {
            println!("cargo:rustc-link-arg=/MANIFESTINPUT:{input}");
        }
    } else {
        tauri_build::build();
    }
}

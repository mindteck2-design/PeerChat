mod bundle;
mod commands;
mod db;
mod discovery;
mod peer_http;
mod runtime;
mod state;
mod util;
#[cfg(windows)]
mod single_instance;
mod tls_cert;

use commands::*;
use runtime::bootstrap::{
    drain_pending_share, drain_second_instance_signals, show_main_window, start_runtime_inner,
};
use discovery::DiscoveryHub;
use state::AppState;
use peer_http::SharedDb;
use parking_lot::Mutex;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_notification::NotificationExt;

// Re-export windows autostart helper used in setup (defined in commands/settings).
#[cfg(windows)]
use commands::files::set_windows_autostart;

pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    // Bail before any window/tray is created if PeerChat is already running.
    #[cfg(windows)]
    single_instance::exit_if_already_running();

    // single-instance plugin still handles mid-session relaunch argv forwarding.
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main_window(app);
            // Forward Explorer "Share in PeerChat" files into the running instance.
            if let Some(pos) = args.iter().position(|a| a == "--share") {
                let files: Vec<String> = args[pos + 1..]
                    .iter()
                    .take_while(|a| !a.starts_with("--"))
                    .cloned()
                    .collect();
                if !files.is_empty() {
                    let _ = app.emit("share-files", files);
                }
            }
            drain_pending_share(app);
        }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data = app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&data).ok();
            let db_path = data.join("peerchat.sqlite");
            let conn = db::open(&db_path)?;
            let shared: SharedDb = Arc::new(Mutex::new(conn));
            {
                let conn = shared.lock();
                let _ = db::auto_accept_all_pending_identities(&conn);
                let _ = db::dedupe_peers_by_ip(&conn);
            }
            commands::screenshot::cleanup_stale_captures_dir(&data);
            app.manage(AppState {
                db: shared.clone(),
                data_dir: data.clone(),
                discovery: DiscoveryHub::default(),
                stop_tx: Mutex::new(None),
                fingerprint: Mutex::new(String::new()),
                started: Mutex::new(false),
                live_display_name: Arc::new(Mutex::new(String::new())),
                live_team: Arc::new(Mutex::new(String::new())),
            });
            // Bootstrap log so a blank UI still leaves a trail on disk.
            {
                use std::io::Write;
                let log_path = data.join("peerchat.log");
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                {
                    let _ = writeln!(
                        f,
                        "[{}] [INFO] PeerChat backend started (data_dir={})",
                        chrono::Utc::now().to_rfc3339(),
                        data.display()
                    );
                }
            }
            // auto-start if profile exists (drop DB lock before starting runtime —
            // holding it across start_runtime_inner deadlocks on the same Mutex).
            let existing = {
                let conn = shared.lock();
                db::get_profile(&conn).ok().flatten()
            };
            if let Some(p) = existing {
                let state = app.state::<AppState>();
                let _ = start_runtime_inner(
                    &app.handle().clone(),
                    &state,
                    p["id"].as_str().unwrap_or(""),
                    p["display_name"].as_str().unwrap_or(""),
                    p["x25519_public"].as_str().unwrap_or(""),
                    p["ed25519_public"].as_str().unwrap_or(""),
                    p["listen_port"].as_u64().unwrap_or(9876) as u16,
                );
            }

            // Handle --share <file> [<file>...] launched from the right-click context menu.
            // We delay the emit slightly so the React app has time to mount its listener.
            let raw_args: Vec<String> = std::env::args().collect();
            if let Some(pos) = raw_args.iter().position(|a| a == "--share") {
                let files: Vec<String> = raw_args[pos + 1..]
                    .iter()
                    .take_while(|a| !a.starts_with("--"))
                    .cloned()
                    .collect();
                if !files.is_empty() {
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(tokio::time::Duration::from_millis(900)).await;
                        show_main_window(&handle);
                        let _ = handle.emit("share-files", files);
                    });
                }
            }

            // Toast click → show window + open conversation (must register BEFORE showing
            // toasts, or Windows reports no activation).
            {
                let handle = app.handle().clone();
                let _ = app.notification().on_action(move |action| {
                    show_main_window(&handle);
                    let cid = action
                        .notification()
                        .and_then(|n| n.extra().get("conversation_id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if !cid.is_empty() {
                        let _ = handle.emit(
                            "notification-open",
                            serde_json::json!({ "conversation_id": cid }),
                        );
                    }
                });
            }

            // System tray: closing the window hides to tray; discovery + delivery keep running.
            // Remove any leftover icon with this id so we never stack trays.
            let _ = app.remove_tray_by_id("peerchat");
            let show_i = MenuItem::with_id(app, "show", "Open PeerChat", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit PeerChat", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
            let tray = TrayIconBuilder::with_id("peerchat")
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .ok_or_else(|| "missing window icon for tray".to_string())?,
                )
                .tooltip("PeerChat - running in background")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => {
                        let _ = app.remove_tray_by_id("peerchat");
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            // Keep the handle alive for the process lifetime (managed by Tauri).
            std::mem::forget(tray);

            // Login / autostart launches with --tray: stay in tray until user opens.
            let start_in_tray = std::env::args().any(|a| a == "--tray");
            if start_in_tray {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }
            // First-run default: register Start-with-Windows (tray) once.
            #[cfg(windows)]
            {
                let marker = data.join(".autostart_default_v1");
                if !marker.exists() {
                    let _ = set_windows_autostart(true);
                    let _ = std::fs::write(&marker, b"1");
                }
            }

            // Pick up Start Menu reopen / --share signals from a preempted second instance.
            drain_second_instance_signals(app.handle());
            let share_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    // Fast poll so Apps/Start Menu reopen feels instant.
                    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                    drain_second_instance_signals(&share_handle);
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Hide to tray — keep discovery, delivery, and notifications alive.
                // Full exit only from tray menu "Quit PeerChat".
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_profile,
            setup_profile,
            update_display_name,
            set_conversation_pinned,
            set_conversation_muted,
            list_pinned_messages,
            get_notifications_enabled,
            set_notifications_enabled,
            conversation_is_muted,
            my_fingerprint,
            discover_peers,
            list_lan_hosts,
            list_peers,
            pin_peer,
            set_peer_blocked,
            list_conversations,
            open_dm,
            create_group,
            list_messages,
            retry_message,
            delete_message_for_me,
            delete_message_for_everyone,
            abort_outgoing_file,
            mark_conversation_read,
            send_message,
            get_group_key,
            set_my_group_key,
            member_ids,
            list_group_members,
            add_group_members,
            remove_group_member,
            leave_group,
            rename_group,
            delete_group,
            delete_conversation_local,
            open_external_url,
            ensure_announcement_boards,
            sync_team_announcement_members,
            clear_conversation_messages,
            set_group_members_can_add,
            set_group_member_role,
            send_typing,
            create_outgoing_file,
            write_file_chunk,
            stage_outgoing_from_path,
            request_stage_cancel,
            request_stage_pause,
            clear_stage_pause,
            set_file_content_hash,
            send_file_notice,
            fetch_file_chunk,
            fetch_file_chunks,
            download_file_stream,
            cancel_file_stream,
            ack_file_download,
            get_file,
            get_files,
            ensure_file_thumbnail,
            save_downloaded_file,
            begin_file_receive,
            append_file_receive,
            finalize_file_receive,
            get_receive_progress,
            cache_outgoing_plain,
            persist_outgoing_from_path,
            open_local_file,
            read_local_file,
            tls_fingerprint_peer,
            get_app_setting,
            set_app_setting,
            get_autostart_enabled,
            set_autostart_enabled,
            accept_pending_identity,
            upsert_transfer,
            list_transfers,
            delete_transfer,
            clear_transfer_history,
            save_item,
            delete_saved_item,
            list_saved_items,
            peer_delivery_error,
            verify_downloaded_file,
            discard_file_receive,
            list_directory_files,
            pack_bundle,
            read_bundle_chunk,
            read_file_chunk,
            delete_bundle_file,
            scan_file,
            local_path_meta,
            install_shell_extension,
            uninstall_shell_extension,
            shell_extension_installed,
            app_log_path,
            append_app_log,
            begin_screenshot_session,
            complete_region_capture,
            complete_fullscreen_capture,
            cancel_screenshot_session,
            read_capture_preview,
            finalize_capture,
            discard_capture,
            list_capture_session_monitors,
            read_session_monitor_preview,
            cleanup_stale_captures,
        ])
        .build(tauri::generate_context!())
        .expect("error while building PeerChat")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = app.remove_tray_by_id("peerchat");
            }
        });
}


#[cfg(test)]
mod path_tests {
    use crate::util::safe_download_name;

    #[test]
    fn rejects_path_traversal_names() {
        let n = safe_download_name("../etc/passwd");
        assert!(!n.contains(".."));
        assert_ne!(n, "download.bin");
        let n2 = safe_download_name("..\\secret.txt");
        assert!(!n2.contains(".."));
        assert_eq!(safe_download_name(""), "download.bin");
        assert_eq!(safe_download_name("notes.pdf"), "notes.pdf");
    }
}

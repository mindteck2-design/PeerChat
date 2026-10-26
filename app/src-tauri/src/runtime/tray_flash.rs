use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};

static TRAY_FLASHING: AtomicBool = AtomicBool::new(false);

const NORMAL_ICON_BYTES: &[u8] = include_bytes!("../../icons/32x32.png");
const UNREAD_ICON_BYTES: &[u8] = include_bytes!("../../icons/32x32-unread.png");

fn load_icon(bytes: &[u8]) -> Option<tauri::image::Image<'static>> {
    let img = image::load_from_memory(bytes).ok()?;
    let rgba = img.to_rgba8().into_raw();
    Some(tauri::image::Image::new_owned(rgba, 32, 32))
}

pub fn start_tray_flash(app: &AppHandle) {
    // If the main window is already visible and focused, do not flash tray.
    if let Some(win) = app.get_webview_window("main") {
        let visible = win.is_visible().unwrap_or(false);
        let focused = win.is_focused().unwrap_or(false);
        if visible && focused {
            return;
        }
    }

    if TRAY_FLASHING.swap(true, Ordering::SeqCst) {
        // Already running flash loop
        return;
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let normal_icon = load_icon(NORMAL_ICON_BYTES).or_else(|| app_handle.default_window_icon().cloned());
        let unread_icon = load_icon(UNREAD_ICON_BYTES).or_else(|| normal_icon.clone());

        let (Some(normal), Some(unread)) = (normal_icon, unread_icon) else {
            return;
        };

        let mut is_unread = true;
        while TRAY_FLASHING.load(Ordering::SeqCst) {
            if let Some(tray) = app_handle.tray_by_id("peerchat") {
                let icon = if is_unread { unread.clone() } else { normal.clone() };
                let _ = tray.set_icon(Some(icon));
                let _ = tray.set_tooltip(Some("PeerChat — New message received"));
            }
            is_unread = !is_unread;
            tokio::time::sleep(Duration::from_millis(600)).await;
        }

        // Restore normal icon on stop
        if let Some(tray) = app_handle.tray_by_id("peerchat") {
            let _ = tray.set_icon(Some(normal));
            let _ = tray.set_tooltip(Some("PeerChat - running in background"));
        }
    });
}

pub fn stop_tray_flash(app: &AppHandle) {
    if TRAY_FLASHING.swap(false, Ordering::SeqCst) {
        if let Some(tray) = app.tray_by_id("peerchat") {
            if let Some(normal) = load_icon(NORMAL_ICON_BYTES).or_else(|| app.default_window_icon().cloned()) {
                let _ = tray.set_icon(Some(normal));
            }
            let _ = tray.set_tooltip(Some("PeerChat - running in background"));
        }
    }
}

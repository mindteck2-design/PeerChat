//! Screen capture + temporary PNG lifecycle for Screenshot & Annotate.
//! Flow: hide main → selection overlay → close overlay → live capture region → annotate.

use crate::runtime::bootstrap::show_main_window;
use crate::state::AppState;
use base64::Engine;
use image::{DynamicImage, ImageBuffer, Rgba, RgbaImage};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

const CAPTURES_DIR: &str = "captures";
const STALE_SECS: u64 = 24 * 60 * 60;

fn captures_dir(state: &AppState) -> Result<PathBuf, String> {
    let dir = state.data_dir.join(CAPTURES_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn valid_capture_id(id: &str) -> bool {
    !id.is_empty()
        && !id.contains("..")
        && !id.contains('/')
        && !id.contains('\\')
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn capture_path(dir: &Path, id: &str, suffix: &str) -> PathBuf {
    dir.join(format!("{id}{suffix}.png"))
}

fn hide_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

fn destroy_overlay(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("capture-overlay") {
        // destroy removes the label so a new overlay can be created immediately.
        let _ = win.destroy();
    }
}

async fn destroy_overlay_wait(app: &AppHandle) {
    destroy_overlay(app);
    for _ in 0..40 {
        if app.get_webview_window("capture-overlay").is_none() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
        destroy_overlay(app);
    }
    // Let the compositor clear the overlay before a live capture.
    tokio::time::sleep(Duration::from_millis(120)).await;
}

async fn open_overlay(app: &AppHandle, session_id: &str) -> Result<(), String> {
    destroy_overlay_wait(app).await;
    let url = WebviewUrl::App(format!("capture-overlay.html#{session_id}").into());
    let builder = WebviewWindowBuilder::new(app, "capture-overlay", url)
        .title("PeerChat Screenshot")
        .fullscreen(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(true)
        .visible(true);
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.transparent(true);
    builder
        .build()
        .map_err(|e| format!("Could not open capture overlay: {e}"))?;
    Ok(())
}

#[derive(Clone, Serialize, serde::Deserialize)]
struct MonitorMeta {
    index: usize,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    is_primary: bool,
    scale_factor: f32,
}

fn list_monitor_meta() -> Result<Vec<MonitorMeta>, String> {
    let monitors = xcap::Monitor::all().map_err(|e| {
        format!("Screen capture is not available on this display ({e}). On Wayland, grant screen-share permission or use X11.")
    })?;
    if monitors.is_empty() {
        return Err("No monitors found for screen capture".into());
    }
    let mut out = Vec::new();
    for (index, mon) in monitors.into_iter().enumerate() {
        out.push(MonitorMeta {
            index,
            x: mon.x(),
            y: mon.y(),
            width: mon.width(),
            height: mon.height(),
            is_primary: mon.is_primary(),
            scale_factor: mon.scale_factor(),
        });
    }
    Ok(out)
}

/// Map overlay CSS viewport selection → physical pixels on the monitor the
/// fullscreen overlay is covering (primary, or best size match).
fn map_overlay_selection_to_physical(
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    view_w: f64,
    view_h: f64,
) -> Result<(i32, i32, i32, i32), String> {
    if view_w < 1.0 || view_h < 1.0 {
        return Err("Invalid overlay viewport size".into());
    }
    let monitors = list_monitor_meta()?;
    let mon = monitors
        .iter()
        .find(|m| m.is_primary)
        .or_else(|| {
            monitors.iter().min_by(|a, b| {
                let da = ((a.width as f64) - view_w).abs() + ((a.height as f64) - view_h).abs();
                let db = ((b.width as f64) - view_w).abs() + ((b.height as f64) - view_h).abs();
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            })
        })
        .cloned()
        .or_else(|| monitors.first().cloned())
        .ok_or_else(|| "No monitors found for screen capture".to_string())?;

    let px = mon.x + ((x / view_w) * mon.width as f64).round() as i32;
    let py = mon.y + ((y / view_h) * mon.height as f64).round() as i32;
    let pw = ((w / view_w) * mon.width as f64).round() as i32;
    let ph = ((h / view_h) * mon.height as f64).round() as i32;
    Ok((px, py, pw, ph))
}

/// Capture a rectangle in physical screen coordinates (xcap space).
fn capture_screen_region(x: i32, y: i32, w: i32, h: i32) -> Result<RgbaImage, String> {
    if w < 2 || h < 2 {
        return Err("Selection too small — drag a larger area".into());
    }
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let rw = w as u32;
    let rh = h as u32;
    let mut canvas: RgbaImage = ImageBuffer::from_pixel(rw, rh, Rgba([0, 0, 0, 255]));
    let mut painted = false;

    for mon in monitors {
        let mx0 = mon.x();
        let my0 = mon.y();
        let mw = mon.width();
        let mh = mon.height();
        let mx1 = mx0 + mw as i32;
        let my1 = my0 + mh as i32;
        let ix0 = x.max(mx0);
        let iy0 = y.max(my0);
        let ix1 = (x + w).min(mx1);
        let iy1 = (y + h).min(my1);
        if ix0 >= ix1 || iy0 >= iy1 {
            continue;
        }
        let shot = mon
            .capture_image()
            .map_err(|e| format!("Failed to capture display: {e}"))?;
        let sx = (ix0 - mx0) as u32;
        let sy = (iy0 - my0) as u32;
        let cw = (ix1 - ix0) as u32;
        let ch = (iy1 - iy0) as u32;
        if sx >= shot.width() || sy >= shot.height() {
            continue;
        }
        let cw = cw.min(shot.width().saturating_sub(sx));
        let ch = ch.min(shot.height().saturating_sub(sy));
        if cw == 0 || ch == 0 {
            continue;
        }
        let cropped = image::imageops::crop_imm(&shot, sx, sy, cw, ch).to_image();
        let dx = (ix0 - x) as i64;
        let dy = (iy0 - y) as i64;
        image::imageops::overlay(&mut canvas, &cropped, dx, dy);
        painted = true;
    }
    if !painted {
        return Err("Selection did not intersect any display".into());
    }
    Ok(canvas)
}

fn write_capture_png(dir: &Path, image: &RgbaImage) -> Result<String, String> {
    let capture_id = Uuid::new_v4().to_string();
    let path = capture_path(dir, &capture_id, "");
    DynamicImage::ImageRgba8(image.clone())
        .save(&path)
        .map_err(|e| format!("Failed to save screenshot: {e}"))?;
    Ok(capture_id)
}

fn cleanup_session_marker(dir: &Path, session_id: &str) {
    let _ = std::fs::remove_file(dir.join(format!("{session_id}.session")));
}

#[tauri::command]
pub async fn begin_screenshot_session(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let dir = captures_dir(&state)?;
    let session_id = Uuid::new_v4().to_string();

    hide_main(&app);
    tokio::time::sleep(Duration::from_millis(180)).await;

    // Marker so cancel can validate the session id.
    let _ = std::fs::write(dir.join(format!("{session_id}.session")), b"1");

    // Probe monitors early so we fail before the overlay if capture is unavailable.
    if let Err(err) = list_monitor_meta() {
        cleanup_session_marker(&dir, &session_id);
        show_main_window(&app);
        return Err(err);
    }

    // open_overlay destroys any leftover webview label before creating a new one.
    if let Err(err) = open_overlay(&app, &session_id).await {
        cleanup_session_marker(&dir, &session_id);
        show_main_window(&app);
        return Err(err);
    }
    Ok(serde_json::json!({ "sessionId": session_id }))
}

#[tauri::command]
pub async fn complete_region_capture(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    view_width: f64,
    view_height: f64,
) -> Result<serde_json::Value, String> {
    if !valid_capture_id(&session_id) {
        let _ = destroy_overlay_wait(&app).await;
        show_main_window(&app);
        return Err("Invalid capture session".into());
    }
    let dir = captures_dir(&state)?;

    // Close overlay FIRST so it is not in the screenshot.
    destroy_overlay_wait(&app).await;

    let (px, py, pw, ph) =
        match map_overlay_selection_to_physical(x, y, width, height, view_width, view_height) {
            Ok(r) => r,
            Err(e) => {
                cleanup_session_marker(&dir, &session_id);
                show_main_window(&app);
                return Err(e);
            }
        };

    let img = match capture_screen_region(px, py, pw, ph) {
        Ok(i) => i,
        Err(e) => {
            cleanup_session_marker(&dir, &session_id);
            show_main_window(&app);
            return Err(e);
        }
    };
    let capture_id = match write_capture_png(&dir, &img) {
        Ok(id) => id,
        Err(e) => {
            cleanup_session_marker(&dir, &session_id);
            show_main_window(&app);
            return Err(e);
        }
    };
    cleanup_session_marker(&dir, &session_id);
    show_main_window(&app);
    let _ = app.emit(
        "screenshot-captured",
        serde_json::json!({ "captureId": capture_id }),
    );
    Ok(serde_json::json!({ "captureId": capture_id }))
}

#[tauri::command]
pub async fn complete_fullscreen_capture(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    if !valid_capture_id(&session_id) {
        let _ = destroy_overlay_wait(&app).await;
        show_main_window(&app);
        return Err("Invalid capture session".into());
    }
    let dir = captures_dir(&state)?;
    destroy_overlay_wait(&app).await;

    let monitors = match list_monitor_meta() {
        Ok(m) => m,
        Err(e) => {
            cleanup_session_marker(&dir, &session_id);
            show_main_window(&app);
            return Err(e);
        }
    };
    let min_x = monitors.iter().map(|m| m.x).min().unwrap_or(0);
    let min_y = monitors.iter().map(|m| m.y).min().unwrap_or(0);
    let max_x = monitors
        .iter()
        .map(|m| m.x + m.width as i32)
        .max()
        .unwrap_or(0);
    let max_y = monitors
        .iter()
        .map(|m| m.y + m.height as i32)
        .max()
        .unwrap_or(0);

    let img = match capture_screen_region(min_x, min_y, max_x - min_x, max_y - min_y) {
        Ok(i) => i,
        Err(e) => {
            cleanup_session_marker(&dir, &session_id);
            show_main_window(&app);
            return Err(e);
        }
    };
    let capture_id = match write_capture_png(&dir, &img) {
        Ok(id) => id,
        Err(e) => {
            cleanup_session_marker(&dir, &session_id);
            show_main_window(&app);
            return Err(e);
        }
    };
    cleanup_session_marker(&dir, &session_id);
    show_main_window(&app);
    let _ = app.emit(
        "screenshot-captured",
        serde_json::json!({ "captureId": capture_id }),
    );
    Ok(serde_json::json!({ "captureId": capture_id }))
}

#[tauri::command]
pub async fn cancel_screenshot_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: Option<String>,
) -> Result<(), String> {
    if let Some(id) = session_id {
        if valid_capture_id(&id) {
            if let Ok(dir) = captures_dir(&state) {
                cleanup_session_marker(&dir, &id);
            }
        }
    }
    destroy_overlay_wait(&app).await;
    show_main_window(&app);
    Ok(())
}

#[tauri::command]
pub fn read_capture_preview(
    state: State<'_, AppState>,
    capture_id: String,
) -> Result<serde_json::Value, String> {
    if !valid_capture_id(&capture_id) {
        return Err("Invalid capture id".into());
    }
    let dir = captures_dir(&state)?;
    let final_path = capture_path(&dir, &capture_id, "-final");
    let orig = capture_path(&dir, &capture_id, "");
    let path = if final_path.exists() {
        final_path
    } else {
        orig
    };
    let bytes = std::fs::read(&path).map_err(|_| "Screenshot file missing".to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(serde_json::json!({
        "mime": "image/png",
        "data_b64": b64,
        "bytes": bytes.len(),
    }))
}

#[tauri::command]
pub fn finalize_capture(
    state: State<'_, AppState>,
    capture_id: String,
    png_b64: String,
) -> Result<serde_json::Value, String> {
    if !valid_capture_id(&capture_id) {
        return Err("Invalid capture id".into());
    }
    let dir = captures_dir(&state)?;
    let orig = capture_path(&dir, &capture_id, "");
    if !orig.exists() {
        return Err("Original capture missing".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(png_b64.as_bytes())
        .map_err(|_| "Invalid PNG data".to_string())?;
    if bytes.len() < 8 || &bytes[0..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("Export is not a PNG".into());
    }
    if bytes.len() > 80 * 1024 * 1024 {
        return Err("Screenshot too large to attach".into());
    }
    let final_path = capture_path(&dir, &capture_id, "-final");
    std::fs::write(&final_path, &bytes).map_err(|e| format!("Failed to write screenshot: {e}"))?;
    Ok(serde_json::json!({
        "captureId": capture_id,
        "path": final_path.to_string_lossy(),
        "bytes": bytes.len(),
        "name": format!(
            "Screenshot-{}.png",
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        ),
    }))
}

#[tauri::command]
pub fn discard_capture(state: State<'_, AppState>, capture_id: String) -> Result<(), String> {
    if !valid_capture_id(&capture_id) {
        return Ok(());
    }
    let dir = captures_dir(&state)?;
    let _ = std::fs::remove_file(capture_path(&dir, &capture_id, ""));
    let _ = std::fs::remove_file(capture_path(&dir, &capture_id, "-final"));
    Ok(())
}

/// Overlay only needs virtual-desktop layout for optional hints — no image payloads.
#[tauri::command]
pub fn list_capture_session_monitors() -> Result<serde_json::Value, String> {
    let monitors = list_monitor_meta()?;
    Ok(serde_json::json!({ "monitors": monitors }))
}

/// Kept for API compatibility; overlay no longer loads previews.
#[tauri::command]
pub fn read_session_monitor_preview(
    _session_id: String,
    _index: usize,
) -> Result<serde_json::Value, String> {
    Err("Preview not used — capture happens after selection".into())
}

pub fn cleanup_stale_captures_dir(data_dir: &Path) {
    let dir = data_dir.join(CAPTURES_DIR);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return;
    };
    let now = SystemTime::now();
    for ent in rd.flatten() {
        let path = ent.path();
        let Ok(meta) = ent.metadata() else { continue };
        let Ok(modified) = meta.modified() else { continue };
        let age = now.duration_since(modified).unwrap_or_default();
        if age.as_secs() > STALE_SECS {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[tauri::command]
pub fn cleanup_stale_captures(state: State<'_, AppState>) -> Result<(), String> {
    cleanup_stale_captures_dir(&state.data_dir);
    Ok(())
}

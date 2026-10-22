//! Screen capture + temporary PNG lifecycle for Screenshot & Annotate.
//! Flow: hide main → freeze desktop → selection overlay on freeze → crop → annotate.
//!
//! Freeze-frame (not a live transparent overlay) so Linux WebKitGTK still shows the
//! desktop, and we avoid exclusive fullscreen which triggers GNOME Caffeine toasts.

use crate::runtime::bootstrap::show_main_window;
use crate::state::AppState;
use base64::Engine;
use image::{DynamicImage, ImageBuffer, Rgba, RgbaImage};
use serde::Serialize;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, State, WebviewUrl,
    WebviewWindowBuilder,
};
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

fn freeze_path(dir: &Path, session_id: &str) -> PathBuf {
    dir.join(format!("{session_id}-freeze.png"))
}

fn hide_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

fn destroy_overlay(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("capture-overlay") {
        // Hide first so destroy does not flash a white webview frame.
        let _ = win.hide();
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
    tokio::time::sleep(Duration::from_millis(40)).await;
}

fn primary_monitor(monitors: &[MonitorMeta]) -> Option<MonitorMeta> {
    monitors
        .iter()
        .find(|m| m.is_primary)
        .cloned()
        .or_else(|| {
            monitors.iter().max_by_key(|m| m.width.saturating_mul(m.height)).cloned()
        })
        .or_else(|| monitors.first().cloned())
}

async fn open_overlay(app: &AppHandle, session_id: &str, mon: &MonitorMeta) -> Result<(), String> {
    destroy_overlay_wait(app).await;
    let url = WebviewUrl::App(format!("capture-overlay.html#{session_id}").into());
    let mut builder = WebviewWindowBuilder::new(app, "capture-overlay", url)
        .title("PeerChat Screenshot")
        // Borderless monitor-sized window — not exclusive fullscreen (avoids GNOME Caffeine).
        .fullscreen(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        // Hidden until freeze image is painted (avoids white WebView flash).
        .visible(false)
        .inner_size(Size::Physical(PhysicalSize {
            width: mon.width,
            height: mon.height,
        }))
        .position(Position::Physical(PhysicalPosition {
            x: mon.x,
            y: mon.y,
        }))
        .background_color(tauri::window::Color(0x12, 0x12, 0x14, 255));

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        builder = builder.transparent(false);
    }
    #[cfg(target_os = "windows")]
    {
        builder = builder.no_redirection_bitmap(true);
    }

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

fn virtual_desktop_bounds(monitors: &[MonitorMeta]) -> (i32, i32, i32, i32) {
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
    (min_x, min_y, max_x - min_x, max_y - min_y)
}

fn write_capture_png(dir: &Path, image: &RgbaImage) -> Result<String, String> {
    let capture_id = Uuid::new_v4().to_string();
    let path = capture_path(dir, &capture_id, "");
    DynamicImage::ImageRgba8(image.clone())
        .save(&path)
        .map_err(|e| format!("Failed to save screenshot: {e}"))?;
    Ok(capture_id)
}

fn cleanup_session_files(dir: &Path, session_id: &str) {
    let _ = std::fs::remove_file(dir.join(format!("{session_id}.session")));
    let _ = std::fs::remove_file(freeze_path(dir, session_id));
}

fn load_freeze(dir: &Path, session_id: &str) -> Result<RgbaImage, String> {
    let path = freeze_path(dir, session_id);
    let img = image::open(&path).map_err(|_| "Desktop freeze missing — try again".to_string())?;
    Ok(img.to_rgba8())
}

/// Crop from the freeze image using physical desktop coordinates.
fn crop_freeze_region(
    freeze: &RgbaImage,
    monitors: &[MonitorMeta],
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> Result<RgbaImage, String> {
    if w < 2 || h < 2 {
        return Err("Selection too small — drag a larger area".into());
    }
    let (vx, vy, vw, vh) = virtual_desktop_bounds(monitors);
    if freeze.width() != vw as u32 || freeze.height() != vh as u32 {
        // Fallback: treat freeze as origin-aligned if size drifted.
        let sx = x.saturating_sub(0).max(0) as u32;
        let sy = y.saturating_sub(0).max(0) as u32;
        let cw = (w as u32).min(freeze.width().saturating_sub(sx));
        let ch = (h as u32).min(freeze.height().saturating_sub(sy));
        if cw < 2 || ch < 2 {
            return Err("Selection too small — drag a larger area".into());
        }
        return Ok(image::imageops::crop_imm(freeze, sx, sy, cw, ch).to_image());
    }
    let sx = (x - vx).max(0) as u32;
    let sy = (y - vy).max(0) as u32;
    let cw = (w as u32).min(freeze.width().saturating_sub(sx));
    let ch = (h as u32).min(freeze.height().saturating_sub(sy));
    if cw < 2 || ch < 2 {
        return Err("Selection too small — drag a larger area".into());
    }
    Ok(image::imageops::crop_imm(freeze, sx, sy, cw, ch).to_image())
}

/// Map overlay CSS viewport selection → physical pixels on the monitor the
/// overlay is covering (primary).
fn map_overlay_selection_to_physical(
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    view_w: f64,
    view_h: f64,
    mon: &MonitorMeta,
) -> Result<(i32, i32, i32, i32), String> {
    if view_w < 1.0 || view_h < 1.0 {
        return Err("Invalid overlay viewport size".into());
    }
    let px = mon.x + ((x / view_w) * mon.width as f64).round() as i32;
    let py = mon.y + ((y / view_h) * mon.height as f64).round() as i32;
    let pw = ((w / view_w) * mon.width as f64).round() as i32;
    let ph = ((h / view_h) * mon.height as f64).round() as i32;
    Ok((px, py, pw, ph))
}

fn encode_jpeg_b64(img: &RgbaImage, quality: u8) -> Result<(String, usize), String> {
    let rgb = DynamicImage::ImageRgba8(img.clone()).to_rgb8();
    let mut buf = Cursor::new(Vec::new());
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
    enc
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("Failed to encode freeze preview: {e}"))?;
    let bytes = buf.into_inner();
    let len = bytes.len();
    Ok((
        base64::engine::general_purpose::STANDARD.encode(&bytes),
        len,
    ))
}

#[tauri::command]
pub async fn begin_screenshot_session(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let dir = captures_dir(&state)?;
    let session_id = Uuid::new_v4().to_string();

    hide_main(&app);
    // Let the main window leave the compositor before freezing the desktop.
    tokio::time::sleep(Duration::from_millis(220)).await;

    let _ = std::fs::write(dir.join(format!("{session_id}.session")), b"1");

    let monitors = match list_monitor_meta() {
        Ok(m) => m,
        Err(err) => {
            cleanup_session_files(&dir, &session_id);
            show_main_window(&app);
            return Err(err);
        }
    };
    let primary = match primary_monitor(&monitors) {
        Some(m) => m,
        None => {
            cleanup_session_files(&dir, &session_id);
            show_main_window(&app);
            return Err("No monitors found for screen capture".into());
        }
    };

    let (vx, vy, vw, vh) = virtual_desktop_bounds(&monitors);
    let freeze = match capture_screen_region(vx, vy, vw, vh) {
        Ok(i) => i,
        Err(e) => {
            cleanup_session_files(&dir, &session_id);
            show_main_window(&app);
            return Err(e);
        }
    };
    if let Err(e) = DynamicImage::ImageRgba8(freeze)
        .save(freeze_path(&dir, &session_id))
        .map_err(|e| format!("Failed to save desktop freeze: {e}"))
    {
        cleanup_session_files(&dir, &session_id);
        show_main_window(&app);
        return Err(e);
    }

    if let Err(err) = open_overlay(&app, &session_id, &primary).await {
        cleanup_session_files(&dir, &session_id);
        show_main_window(&app);
        return Err(err);
    }
    Ok(serde_json::json!({ "sessionId": session_id }))
}

/// Overlay calls this after the freeze image is painted so we never flash a blank webview.
#[tauri::command]
pub async fn show_capture_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("capture-overlay") {
        let _ = win.set_always_on_top(true);
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(())
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

    let monitors = match list_monitor_meta() {
        Ok(m) => m,
        Err(e) => {
            let _ = destroy_overlay_wait(&app).await;
            cleanup_session_files(&dir, &session_id);
            show_main_window(&app);
            return Err(e);
        }
    };
    let primary = match primary_monitor(&monitors) {
        Some(m) => m,
        None => {
            let _ = destroy_overlay_wait(&app).await;
            cleanup_session_files(&dir, &session_id);
            show_main_window(&app);
            return Err("No monitors found for screen capture".into());
        }
    };

    let (px, py, pw, ph) =
        match map_overlay_selection_to_physical(x, y, width, height, view_width, view_height, &primary)
        {
            Ok(r) => r,
            Err(e) => {
                let _ = destroy_overlay_wait(&app).await;
                cleanup_session_files(&dir, &session_id);
                show_main_window(&app);
                return Err(e);
            }
        };

    let freeze = match load_freeze(&dir, &session_id) {
        Ok(i) => i,
        Err(e) => {
            let _ = destroy_overlay_wait(&app).await;
            cleanup_session_files(&dir, &session_id);
            show_main_window(&app);
            return Err(e);
        }
    };
    let img = match crop_freeze_region(&freeze, &monitors, px, py, pw, ph) {
        Ok(i) => i,
        Err(e) => {
            let _ = destroy_overlay_wait(&app).await;
            cleanup_session_files(&dir, &session_id);
            show_main_window(&app);
            return Err(e);
        }
    };

    // Crop from freeze first, then tear down overlay (no live re-capture → no white flash gap).
    destroy_overlay_wait(&app).await;

    let capture_id = match write_capture_png(&dir, &img) {
        Ok(id) => id,
        Err(e) => {
            cleanup_session_files(&dir, &session_id);
            show_main_window(&app);
            return Err(e);
        }
    };
    cleanup_session_files(&dir, &session_id);
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

    let freeze = match load_freeze(&dir, &session_id) {
        Ok(i) => i,
        Err(e) => {
            let _ = destroy_overlay_wait(&app).await;
            cleanup_session_files(&dir, &session_id);
            show_main_window(&app);
            return Err(e);
        }
    };

    destroy_overlay_wait(&app).await;

    let capture_id = match write_capture_png(&dir, &freeze) {
        Ok(id) => id,
        Err(e) => {
            cleanup_session_files(&dir, &session_id);
            show_main_window(&app);
            return Err(e);
        }
    };
    cleanup_session_files(&dir, &session_id);
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
                cleanup_session_files(&dir, &id);
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

/// Overlay backdrop: primary-monitor crop of the session freeze (JPEG for speed).
#[tauri::command]
pub fn read_session_freeze_preview(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    if !valid_capture_id(&session_id) {
        return Err("Invalid capture session".into());
    }
    let dir = captures_dir(&state)?;
    let monitors = list_monitor_meta()?;
    let primary = primary_monitor(&monitors).ok_or_else(|| "No monitors found".to_string())?;
    let freeze = load_freeze(&dir, &session_id)?;
    let crop = crop_freeze_region(
        &freeze,
        &monitors,
        primary.x,
        primary.y,
        primary.width as i32,
        primary.height as i32,
    )?;
    let (b64, bytes) = encode_jpeg_b64(&crop, 82)?;
    Ok(serde_json::json!({
        "mime": "image/jpeg",
        "data_b64": b64,
        "bytes": bytes,
        "width": crop.width(),
        "height": crop.height(),
    }))
}

/// Overlay only needs virtual-desktop layout for optional hints — no image payloads.
#[tauri::command]
pub fn list_capture_session_monitors() -> Result<serde_json::Value, String> {
    let monitors = list_monitor_meta()?;
    Ok(serde_json::json!({ "monitors": monitors }))
}

/// Kept for API compatibility; overlay uses read_session_freeze_preview.
#[tauri::command]
pub fn read_session_monitor_preview(
    _session_id: String,
    _index: usize,
) -> Result<serde_json::Value, String> {
    Err("Use read_session_freeze_preview".into())
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

//! Hard single-instance gate for Windows.
//!
//! The tauri-plugin-single-instance can race (mutex exists before its hidden
//! window is registered) and then allow a second full app — which creates a
//! second tray icon. We bail out early if the plugin mutex is already held.
//!
//! Important: do NOT Win32-ShowWindow the main PeerChat HWND from this process.
//! That desyncs Tauri's hide/show state after tray-hide, so the next X no longer
//! hides cleanly. Instead write pending-show / pending-share and let the running
//! instance call Tauri `window.show()`.

#![cfg(windows)]

use std::time::Duration;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HWND};
use windows_sys::Win32::System::Threading::OpenMutexW;

/// Win32 SYNCHRONIZE access right (not always re-exported by windows-sys).
const SYNCHRONIZE: u32 = 0x0010_0000;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, EnumWindows, FindWindowW, GetWindowTextW, GetWindowThreadProcessId,
};

const MUTEX_NAME: &str = "com.lanmsg.app-sim";
const CLASS_NAME: &str = "com.lanmsg.app-sic";
const WINDOW_NAME: &str = "com.lanmsg.app-siw";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn app_data_dir() -> Option<std::path::PathBuf> {
    let local = std::env::var_os("LOCALAPPDATA")?;
    let dir = std::path::PathBuf::from(local).join("com.lanmsg.app");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir)
}

unsafe extern "system" fn enum_peerchat(
    hwnd: HWND,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> i32 {
    let out = lparam as *mut HWND;
    let mut buf = [0u16; 256];
    let n = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if n <= 0 {
        return 1;
    }
    let title = String::from_utf16_lossy(&buf[..n as usize]);
    if title.starts_with("PeerChat") {
        unsafe {
            if (*out).is_null() {
                *out = hwnd;
            }
        }
        return 0;
    }
    1
}

fn find_main_peerchat_hwnd() -> HWND {
    let mut found: HWND = std::ptr::null_mut();
    unsafe {
        let _ = EnumWindows(Some(enum_peerchat), &mut found as *mut _ as isize);
    }
    found
}

fn allow_foreground_for_running_instance() {
    let class_name = wide(CLASS_NAME);
    let window_name = wide(WINDOW_NAME);
    for _ in 0..40 {
        let mut pid = 0u32;
        let relay = unsafe { FindWindowW(class_name.as_ptr(), window_name.as_ptr()) };
        if !relay.is_null() {
            unsafe { GetWindowThreadProcessId(relay, &mut pid) };
        }
        if pid == 0 {
            let main = find_main_peerchat_hwnd();
            if !main.is_null() {
                unsafe { GetWindowThreadProcessId(main, &mut pid) };
            }
        }
        if pid != 0 {
            unsafe { AllowSetForegroundWindow(pid) };
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Ask the running instance to show via Tauri (polled in lib.rs).
fn write_pending_show() {
    let Some(dir) = app_data_dir() else {
        return;
    };
    let path = dir.join("pending-show");
    let _ = std::fs::write(path, b"1");
}

fn write_pending_share_args() {
    let args: Vec<String> = std::env::args().collect();
    let Some(pos) = args.iter().position(|a| a == "--share") else {
        return;
    };
    let files: Vec<String> = args[pos + 1..]
        .iter()
        .take_while(|a| !a.starts_with("--"))
        .cloned()
        .collect();
    if files.is_empty() {
        return;
    }
    let Some(dir) = app_data_dir() else {
        return;
    };
    let path = dir.join("pending-share.json");
    if let Ok(body) = serde_json::to_string(&files) {
        let _ = std::fs::write(path, body);
    }
}

/// If another PeerChat already owns the single-instance mutex, signal it and exit.
/// Call this *before* `tauri::Builder::run`.
pub fn exit_if_already_running() {
    let mutex_name = wide(MUTEX_NAME);
    let existing = unsafe { OpenMutexW(SYNCHRONIZE, 0, mutex_name.as_ptr()) };
    if existing.is_null() {
        let _err = unsafe { GetLastError() };
        // Mutex not created yet (ERROR_FILE_NOT_FOUND=2) — we are the first instance.
        return;
    }
    unsafe { CloseHandle(existing) };

    // Permit the running process to take foreground, then request a Tauri show.
    // Never ShowWindow the main HWND from here — that breaks hide-to-tray.
    allow_foreground_for_running_instance();
    write_pending_show();
    write_pending_share_args();
    std::process::exit(0);
}

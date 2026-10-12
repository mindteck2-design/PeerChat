//! Hard single-instance gate for Windows.
//!
//! The tauri-plugin-single-instance can race (mutex exists before its hidden
//! window is registered) and then allow a second full app — which creates a
//! second tray icon. We bail out early if the plugin mutex is already held.

#![cfg(windows)]

use std::time::Duration;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HWND};
use windows_sys::Win32::System::Threading::OpenMutexW;

/// Win32 SYNCHRONIZE access right (not always re-exported by windows-sys).
const SYNCHRONIZE: u32 = 0x0010_0000;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, EnumWindows, FindWindowW, GetWindowTextW, GetWindowThreadProcessId,
    IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
};

const MUTEX_NAME: &str = "com.lanmsg.app-sim";
const CLASS_NAME: &str = "com.lanmsg.app-sic";
const WINDOW_NAME: &str = "com.lanmsg.app-siw";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
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
        // Prefer a visible main window; otherwise take the first PeerChat title.
        let visible = unsafe { IsWindowVisible(hwnd) } != 0;
        unsafe {
            if visible || (*out).is_null() {
                *out = hwnd;
            }
            if visible {
                return 0; // stop
            }
        }
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

fn activate_hwnd(hwnd: HWND) -> bool {
    if hwnd.is_null() {
        return false;
    }
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid != 0 {
            AllowSetForegroundWindow(pid);
        }
        ShowWindow(hwnd, SW_RESTORE);
        ShowWindow(hwnd, SW_SHOW);
        SetForegroundWindow(hwnd) != 0
    }
}

/// If another PeerChat already owns the single-instance mutex, focus it and exit.
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

    // Another instance holds the mutex. Give its message window a moment to appear,
    // then focus either the plugin relay window's peer or the main PeerChat UI.
    let class_name = wide(CLASS_NAME);
    let window_name = wide(WINDOW_NAME);
    for _ in 0..40 {
        let relay = unsafe { FindWindowW(class_name.as_ptr(), window_name.as_ptr()) };
        if !relay.is_null() {
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(relay, &mut pid) };
            if pid != 0 {
                unsafe { AllowSetForegroundWindow(pid) };
            }
        }
        let main = find_main_peerchat_hwnd();
        if activate_hwnd(main) {
            write_pending_share_args();
            std::process::exit(0);
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    // Still couldn't focus — do not start a second tray/window.
    write_pending_share_args();
    std::process::exit(0);
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
    let Some(local) = std::env::var_os("LOCALAPPDATA") else {
        return;
    };
    let dir = std::path::PathBuf::from(local).join("com.lanmsg.app");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("pending-share.json");
    if let Ok(body) = serde_json::to_string(&files) {
        let _ = std::fs::write(path, body);
    }
}

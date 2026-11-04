//! Gate OS toast sounds so catch-up on launch cannot queue dozens of Windows
//! notification sounds that keep playing until the process exits.

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// After runtime starts, suppress all OS toast *sounds* (and optionally toasts)
/// while peers flush backlog. UI still refreshes via `inbox-updated`.
const STARTUP_QUIET: Duration = Duration::from_secs(25);
/// Hard floor between OS notification sounds for the whole app.
const SOUND_GAP: Duration = Duration::from_secs(3);
/// Max OS toasts (with or without sound) per rolling window during steady state.
const TOAST_GAP: Duration = Duration::from_millis(1500);

static RUNTIME_STARTED: OnceLock<Instant> = OnceLock::new();
static LAST_SOUND: Mutex<Option<Instant>> = Mutex::new(None);
static LAST_TOAST: Mutex<Option<Instant>> = Mutex::new(None);
static QUIET_LOGGED: AtomicBool = AtomicBool::new(false);

/// Call once when the peer listener / discovery runtime comes up.
pub fn mark_runtime_started() {
    let _ = RUNTIME_STARTED.set(Instant::now());
    QUIET_LOGGED.store(false, Ordering::SeqCst);
}

fn started_at() -> Instant {
    *RUNTIME_STARTED.get_or_init(Instant::now)
}

pub fn in_startup_quiet() -> bool {
    started_at().elapsed() < STARTUP_QUIET
}

/// Whether to show an OS toast at all. During startup quiet, skip entirely so
/// Windows does not enqueue a backlog of Reminder/Default sounds.
pub fn allow_os_toast() -> bool {
    if in_startup_quiet() {
        if !QUIET_LOGGED.swap(true, Ordering::SeqCst) {
            eprintln!("[notify] startup quiet — suppressing OS toasts for catch-up");
        }
        return false;
    }
    let mut last = LAST_TOAST.lock();
    if let Some(t) = *last {
        if t.elapsed() < TOAST_GAP {
            return false;
        }
    }
    *last = Some(Instant::now());
    true
}

/// Whether this toast may attach a platform sound. Always false in startup quiet.
pub fn allow_os_sound() -> bool {
    if in_startup_quiet() {
        return false;
    }
    let mut last = LAST_SOUND.lock();
    if let Some(t) = *last {
        if t.elapsed() < SOUND_GAP {
            return false;
        }
    }
    *last = Some(Instant::now());
    true
}

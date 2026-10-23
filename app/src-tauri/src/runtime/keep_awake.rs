//! Keep the machine from idle-sleeping while PeerChat is running so LAN peers
//! can still download files when the screen is locked / the window is in the tray.
//!
//! Lock alone should not kill networking; suspend/idle sleep does. We block idle
//! sleep for the process lifetime (best-effort; no-op if unsupported).

#[cfg(target_os = "linux")]
use std::process::{Child, Command, Stdio};

pub struct KeepAwakeGuard {
    #[cfg(target_os = "linux")]
    child: Option<Child>,
    #[cfg(windows)]
    _marker: (),
}

impl KeepAwakeGuard {
    pub fn acquire() -> Self {
        #[cfg(target_os = "linux")]
        {
            // systemd-inhibit holds until the child exits — common on Ubuntu/GNOME/KDE.
            let child = Command::new("systemd-inhibit")
                .args([
                    "--what=idle:sleep",
                    "--who=PeerChat",
                    "--why=Stay reachable on the LAN for file transfers while locked or idle",
                    "--mode=block",
                    "sleep",
                    "infinity",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .ok();
            return Self { child };
        }
        #[cfg(windows)]
        {
            // Prevent system idle sleep; screen can still lock / turn off.
            unsafe {
                windows_sys::Win32::System::Power::SetThreadExecutionState(
                    windows_sys::Win32::System::Power::ES_CONTINUOUS
                        | windows_sys::Win32::System::Power::ES_SYSTEM_REQUIRED
                        | windows_sys::Win32::System::Power::ES_AWAYMODE_REQUIRED,
                );
            }
            return Self { _marker: () };
        }
        #[cfg(not(any(target_os = "linux", windows)))]
        {
            Self {}
        }
    }
}

impl Drop for KeepAwakeGuard {
    fn drop(&mut self) {
        #[cfg(target_os = "linux")]
        {
            if let Some(mut child) = self.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        #[cfg(windows)]
        {
            unsafe {
                windows_sys::Win32::System::Power::SetThreadExecutionState(
                    windows_sys::Win32::System::Power::ES_CONTINUOUS,
                );
            }
        }
    }
}

use crate::discovery::DiscoveryHub;
use crate::peer_http::SharedDb;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;

pub struct AppState {
    pub db: SharedDb,
    pub data_dir: PathBuf,
    pub discovery: DiscoveryHub,
    pub stop_tx: Mutex<Option<tokio::sync::watch::Sender<bool>>>,
    pub fingerprint: Mutex<String>,
    pub started: Mutex<bool>,
    /// Live discovery beacon display name (updated on rename).
    pub live_display_name: Arc<Mutex<String>>,
    /// Live discovery beacon team label.
    pub live_team: Arc<Mutex<String>>,
}

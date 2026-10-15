#![allow(unused_imports)]
use base64::Engine;
use rusqlite::OptionalExtension;
use crate::tls_cert;
use crate::discovery::{self, DiscoveryHub, PeerBeacon};
use crate::db;
use crate::runtime;
use crate::state::AppState;
use crate::util;
use crate::peer_http::{self, SharedDb};
use crate::bundle;
use parking_lot::Mutex;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::util::*;
use crate::runtime::outbox::{kick_flush, kick_flush_for_peer, flush_outbox};
use crate::runtime::group_events::{enqueue_group_event, enqueue_group_event_extra};
use crate::runtime::bootstrap::{start_runtime_inner, show_main_window};

#[tauri::command]
pub fn upsert_transfer(state: State<AppState>, row: Value) -> Result<(), String> {
    let conn = state.db.lock();
    db::upsert_transfer(&conn, &row)
}

#[tauri::command]
pub fn list_transfers(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    db::list_transfers(&conn, 200)
}

#[tauri::command]
pub fn delete_transfer(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock();
    db::delete_transfer(&conn, &id)
}

#[tauri::command]
pub fn clear_transfer_history(state: State<AppState>) -> Result<u64, String> {
    let conn = state.db.lock();
    db::clear_transfer_history(&conn)
}


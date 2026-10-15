#![allow(unused_imports)]
use crate::db;
use crate::util::*;
use rusqlite::Connection;
use serde_json::{json, Value};

pub(crate) fn enqueue_group_event(
    conn: &Connection,
    from_peer: &Value,
    conversation_id: &str,
    recipient_id: &str,
    title: &str,
    wrapped_for_recipient: Option<String>,
    members: &Value,
    op: &str,
    subject_user_id: Option<&str>,
) -> Result<(), String> {
    enqueue_group_event_extra(
        conn,
        from_peer,
        conversation_id,
        recipient_id,
        title,
        wrapped_for_recipient,
        members,
        op,
        subject_user_id,
        None,
    )
}

pub(crate) fn enqueue_group_event_extra(
    conn: &Connection,
    from_peer: &Value,
    conversation_id: &str,
    recipient_id: &str,
    title: &str,
    wrapped_for_recipient: Option<String>,
    members: &Value,
    op: &str,
    subject_user_id: Option<&str>,
    extra: Option<Value>,
) -> Result<(), String> {
    let oid = format!("gev-{}:{}", uuid::Uuid::new_v4(), recipient_id);
    let mut event = json!({
        "op": op,
        "conversation_id": conversation_id,
        "title": title,
        "members": members,
    });
    if let Some(uid) = subject_user_id {
        event["user_id"] = json!(uid);
    }
    if let Some(ex) = extra {
        if let Some(obj) = ex.as_object() {
            for (k, v) in obj {
                event[k] = v.clone();
            }
        }
    }
    let payload = json!({
        "from_peer": from_peer,
        "conversation_id": conversation_id,
        "group_title": title,
        "wrapped_group_key": wrapped_for_recipient,
        "members": members,
        "group_event": event,
    });
    db::enqueue_outbox(
        conn,
        &oid,
        recipient_id,
        conversation_id,
        &payload.to_string(),
    )
}


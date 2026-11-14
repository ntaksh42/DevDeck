//! Items picked by hand that wait for their turn; kept in memory only.

use std::sync::{LazyLock, Mutex};

use super::{key, scope_id, ItemLabel, Key};
use crate::auto_agent::AutoItem;
use crate::db::Organization;

pub(super) struct Pending {
    pub(super) key: Key,
    pub(super) scope_id: String,
    pub(super) label: ItemLabel,
    pub(super) started: bool,
}

pub(super) static PENDING: LazyLock<Mutex<Vec<Pending>>> = LazyLock::new(Mutex::default);

pub(in crate::auto_agent) fn enqueue(org: &Organization, item: &AutoItem) {
    if let Ok(mut pending) = PENDING.lock() {
        let key = key(&org.id, item.target(), item.id());
        if !pending.iter().any(|p| p.key == key) {
            pending.push(Pending {
                key,
                scope_id: scope_id(item),
                label: ItemLabel::of(item),
                started: false,
            });
        }
    }
}

pub(in crate::auto_agent) fn mark_started(org: &Organization, item: &AutoItem) {
    let key = key(&org.id, item.target(), item.id());
    if let Ok(mut pending) = PENDING.lock() {
        pending
            .iter_mut()
            .filter(|p| p.key == key)
            .for_each(|p| p.started = true);
    }
}

pub(in crate::auto_agent) fn dequeue(org: &Organization, item: &AutoItem) {
    let key = key(&org.id, item.target(), item.id());
    if let Ok(mut pending) = PENDING.lock() {
        pending.retain(|p| p.key != key);
    }
}

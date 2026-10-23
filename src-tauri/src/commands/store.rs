use std::sync::Arc;

use tauri::{
    ipc::{InvokeBody, Request},
    State,
};

use crate::{
    error::{Error, Result},
    store::{Key, Row, Store},
};

#[tauri::command]
pub fn store_load(store: State<'_, Arc<Store>>) -> Result<Vec<Row>> {
    store.rows()
}

#[tauri::command]
pub fn store_write(store: State<'_, Arc<Store>>, upsert: Vec<Row>, remove: Vec<Key>) -> Result<()> {
    store.write(&upsert, &remove)
}

#[tauri::command]
pub fn store_original(store: State<'_, Arc<Store>>, request: Request<'_>) -> Result<()> {
    let id = request
        .headers()
        .get("x-id")
        .and_then(|value| value.to_str().ok())
        .ok_or(Error::Input("missing x-id header"))?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(Error::Input("expected raw image bytes"));
    };
    store.save_original(id, bytes)
}

use std::sync::Arc;

use tauri::State;

use crate::{error::Result, graph, store::Store};

#[tauri::command(async)]
pub fn graph_edges(store: State<'_, Arc<Store>>, space: String, ids: Vec<String>) -> Result<Vec<(u32, u32, f32)>> {
    graph::edges(&store, &space, &ids)
}

use tauri::State;

use crate::{bing::Web, error::Result};

#[tauri::command]
pub async fn fetch_bing(web: State<'_, Web>, url: String) -> Result<String> {
    web.results(&url).await
}

#[tauri::command]
pub async fn warm_web(web: State<'_, Web>) -> Result<()> {
    web.warm().await;
    Ok(())
}

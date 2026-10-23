use std::sync::Arc;

use tauri::State;

use crate::{
    error::{Error, Result},
    vision::{Signature, Vision},
};

#[tauri::command]
pub fn vision_rate(vision: State<'_, Arc<Vision>>) -> Option<f32> {
    vision.rate()
}

#[tauri::command]
pub async fn analyze_images(
    vision: State<'_, Arc<Vision>>,
    urls: Vec<String>,
    embed: bool,
) -> Result<Vec<Option<Signature>>> {
    if !urls.iter().all(|url| url.starts_with("https://")) {
        return Err(Error::Input("only https image URLs are allowed"));
    }
    Arc::clone(&vision).analyze(urls, embed).await
}

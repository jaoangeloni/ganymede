use std::sync::Arc;

use tauri::{path::BaseDirectory, Manager};

mod bing;
mod error;
mod graph;
pub mod store;
pub mod vision;

mod commands {
    pub mod bing;
    pub mod graph;
    pub mod store;
    pub mod vision;
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(bing::Web::new())
        .register_asynchronous_uri_scheme_protocol("media", |context, request, responder| {
            let store = Arc::clone(&context.app_handle().state::<Arc<store::Store>>());
            tauri::async_runtime::spawn_blocking(move || responder.respond(store.serve(&request)));
        })
        .setup(|app| {
            let bundled = app.path().resolve("models", BaseDirectory::Resource)?;
            let models = if bundled.join("clip-vision.onnx").exists() || !cfg!(debug_assertions) {
                bundled
            } else {
                concat!(env!("CARGO_MANIFEST_DIR"), "/models").into()
            };
            let vision = Arc::new(vision::Vision::new(models));
            let preload = Arc::clone(&vision);
            tauri::async_runtime::spawn_blocking(move || preload.preload());
            app.manage(store::Store::open(app.path().app_data_dir()?, Arc::clone(&vision), app.handle().clone())?);
            app.manage(vision);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::bing::fetch_bing,
            commands::bing::warm_web,
            commands::vision::analyze_images,
            commands::vision::vision_rate,
            commands::store::store_load,
            commands::store::store_write,
            commands::store::store_original,
            commands::graph::graph_edges,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

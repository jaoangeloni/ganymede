fn main() {
    let runtime = match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
        Ok("windows") => "onnxruntime.dll",
        Ok("macos") => "libonnxruntime.dylib",
        _ => "libonnxruntime.so",
    };
    for file in ["clip-vision.onnx", runtime] {
        let path = format!("models/{file}");
        println!("cargo:rerun-if-changed={path}");
        if !std::path::Path::new(&path).exists() {
            if std::env::var("PROFILE").as_deref() == Ok("release") {
                panic!("missing src-tauri/{path}: run `bun run model` before a release build (without CLIP the map has no edges and search has no visual ranking)");
            }
            println!("cargo:warning=missing src-tauri/{path}: run `bun run model` (without CLIP the map has no edges)");
        }
    }
    tauri_build::build()
}

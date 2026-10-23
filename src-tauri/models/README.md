CLIP image encoder (`clip-vision.onnx`) and the official ONNX Runtime (`onnxruntime.dll` or `libonnxruntime.so`),
bundled with the installer (`bundle.resources`). They are not in git: run `bun run model`.

This file must stay: `bundle.resources` is a glob over this folder, and a fresh clone without the models needs one
file here to compile. Without the models the app still runs, only without visual ranking and map edges.

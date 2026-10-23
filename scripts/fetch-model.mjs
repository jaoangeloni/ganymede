import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FORCE = process.argv.includes("--force");
const DIR = "src-tauri/models";

const REVISION = "d15189d7028b43f1d3e65039190477f6af591c2a";
const MODEL_URL = `https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/${REVISION}/onnx/vision_model_int8.onnx`;

const ORT = "1.28.3";
const RUNTIMES = {
  win32: { archive: `onnxruntime-win-x64-${ORT}.zip`, inside: "lib/onnxruntime.dll", target: "onnxruntime.dll" },
  linux: {
    archive: `onnxruntime-linux-x64-${ORT}.tgz`,
    inside: `lib/libonnxruntime.so.${ORT}`,
    target: "libonnxruntime.so",
  },
};

async function download(url) {
  console.log(`Downloading ${url}…`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

mkdirSync(DIR, { recursive: true });

const model = join(DIR, "clip-vision.onnx");
if (existsSync(model) && !FORCE) console.log(`${model} already exists (use --force to download again).`);
else writeFileSync(model, await download(MODEL_URL));

const runtime = RUNTIMES[process.platform];
if (!runtime) {
  console.log(`No ONNX Runtime for ${process.platform}: the app runs without CLIP.`);
} else if (existsSync(join(DIR, runtime.target)) && !FORCE) {
  console.log(`${join(DIR, runtime.target)} already exists.`);
} else {
  const scratch = mkdtempSync(join(tmpdir(), "ganymede-ort-"));
  const archive = join(scratch, runtime.archive);
  writeFileSync(
    archive,
    await download(`https://github.com/microsoft/onnxruntime/releases/download/v${ORT}/${runtime.archive}`),
  );
  const tar =
    process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  const extracted = spawnSync(tar, ["-xf", archive, "-C", scratch], { stdio: "inherit" });
  if (extracted.status !== 0) throw new Error("could not extract the ONNX Runtime");
  copyFileSync(join(scratch, runtime.archive.replace(/\.(zip|tgz)$/, ""), runtime.inside), join(DIR, runtime.target));
  rmSync(scratch, { recursive: true, force: true });
  console.log(`Saved to ${join(DIR, runtime.target)}.`);
}

use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::PathBuf,
};

use ganymede_lib::{
    store::{jpeg, SCHEMA},
    vision::{quantize, Vision},
};
use image::{imageops::FilterType, DynamicImage};
use rusqlite::{params, Connection};
use serde::Deserialize;

const DOWNLOADS: usize = 8;
const BATCH: usize = 16;
const THUMB_SIDE: u32 = 256;
const SAMPLE_SIDE: u32 = 16;

#[derive(Deserialize)]
struct Image {
    id: String,
    url: String,
}

fn option(name: &str) -> PathBuf {
    let args: Vec<String> = env::args().collect();
    let at = args.iter().position(|arg| arg == name).unwrap_or_else(|| panic!("missing {name}"));
    PathBuf::from(&args[at + 1])
}

fn key(url: &str) -> String {
    let hash = url
        .bytes()
        .fold(0xcbf2_9ce4_8422_2325u64, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3));
    format!("{hash:016x}.img")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cache = option("--cache");
    let thumbs = cache.join("thumbs");
    fs::create_dir_all(&thumbs)?;
    let mut db = Connection::open(option("--dir").join("ganymede.db"))?;
    db.execute_batch(SCHEMA)?;
    let done: HashSet<String> = db
        .prepare("SELECT id FROM media WHERE embedding IS NOT NULL")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    let mut pixels: HashMap<String, String> = fs::read(cache.join("pixels.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    pixels.retain(|id, _| done.contains(id));
    let images: Vec<Image> = serde_json::from_slice::<Vec<Image>>(&fs::read(option("--images"))?)?
        .into_iter()
        .filter(|image| !pixels.contains_key(&image.id))
        .collect();
    let vision = Vision::new(concat!(env!("CARGO_MANIFEST_DIR"), "/models").into());

    let missing: Vec<&Image> = images.iter().filter(|image| !thumbs.join(key(&image.url)).exists()).collect();
    let mut failed = 0;
    tauri::async_runtime::block_on(async {
        for (k, chunk) in missing.chunks(DOWNLOADS).enumerate() {
            let tasks: Vec<_> = chunk
                .iter()
                .map(|image| tauri::async_runtime::spawn(Vision::download(vision.client.clone(), image.url.clone())))
                .collect();
            for (image, task) in chunk.iter().zip(tasks) {
                match task.await.ok().flatten() {
                    Some(bytes) => fs::write(thumbs.join(key(&image.url)), bytes).expect("thumbnail cache"),
                    None => failed += 1,
                }
            }
            if (k + 1) % 50 == 0 {
                println!("  thumbnails: {}/{}", (k + 1) * DOWNLOADS, missing.len());
            }
        }
    });
    println!(
        "{} thumbnails downloaded, {failed} failed, {} were cached",
        missing.len() - failed,
        images.len() - missing.len()
    );

    for (k, chunk) in images.chunks(BATCH).enumerate() {
        let decoded: Vec<Option<DynamicImage>> = chunk
            .iter()
            .map(|image| {
                fs::read(thumbs.join(key(&image.url))).ok().and_then(|bytes| image::load_from_memory(&bytes).ok())
            })
            .collect();
        let embeddings = vision.embed(&decoded);
        let tx = db.transaction()?;
        for ((image, decoded), embedding) in chunk.iter().zip(&decoded).zip(embeddings) {
            let Some(decoded) = decoded else { continue };
            tx.execute(
                "INSERT OR REPLACE INTO media (id, thumb, preview, embedding) VALUES (?1, ?2, NULL, ?3)",
                params![image.id, jpeg(decoded, THUMB_SIDE), embedding.map(|e| quantize(&e))],
            )?;
            pixels.insert(
                image.id.clone(),
                hex(&decoded.resize_exact(SAMPLE_SIDE, SAMPLE_SIDE, FilterType::Triangle).to_rgb8().into_raw()),
            );
        }
        tx.commit()?;
        if (k + 1) % 25 == 0 {
            println!("  CLIP: {}/{}", ((k + 1) * BATCH).min(images.len()), images.len());
        }
    }
    fs::write(cache.join("pixels.json"), serde_json::to_vec(&pixels)?)?;
    println!("{} images stored with thumbnail and embedding ({} processed now)", pixels.len(), images.len());
    Ok(())
}

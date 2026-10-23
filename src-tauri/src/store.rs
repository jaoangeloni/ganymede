use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Cursor,
    path::PathBuf,
    sync::{mpsc, Arc, Mutex, MutexGuard, PoisonError},
};

use image::{imageops::FilterType, DynamicImage, ImageFormat};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::{
    http::{header, Request, Response, StatusCode},
    AppHandle, Emitter,
};

use crate::{
    error::Result,
    graph::Neighbors,
    vision::{quantize, Vision},
};

const THUMB_SIDE: u32 = 256;
const PREVIEW_SIDE: u32 = 640;
const JOB_BATCH: usize = 8;

pub const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS items (kind TEXT NOT NULL, scope TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (kind, scope, id));
CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, thumb BLOB, preview BLOB, embedding BLOB);
CREATE TABLE IF NOT EXISTS knn (scope TEXT NOT NULL, id TEXT NOT NULL, list TEXT NOT NULL, PRIMARY KEY (scope, id));
";

pub type Row = (String, String, String, String);
pub type Key = (String, String, String);

pub struct Store {
    db: Mutex<Connection>,
    originals: PathBuf,
    jobs: mpsc::Sender<String>,
}

fn file_name(id: &str) -> String {
    id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect()
}

pub fn jpeg(image: &DynamicImage, side: u32) -> Option<Vec<u8>> {
    let small = if image.width().max(image.height()) > side {
        image.resize(side, side, FilterType::Triangle)
    } else {
        image.clone()
    };
    let mut bytes = Cursor::new(Vec::new());
    small.to_rgb8().write_to(&mut bytes, ImageFormat::Jpeg).ok()?;
    Some(bytes.into_inner())
}

fn decode_path(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match (
            bytes[i],
            bytes.get(i + 1..i + 3).and_then(|hex| u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()),
        ) {
            (b'%', Some(byte)) => {
                out.push(byte);
                i += 3;
            }
            (byte, _) => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

impl Store {
    pub fn open(dir: PathBuf, vision: Arc<Vision>, app: AppHandle) -> Result<Arc<Self>> {
        let originals = dir.join("originals");
        fs::create_dir_all(&originals)?;
        let db = Connection::open(dir.join("ganymede.db"))?;
        db.execute_batch(SCHEMA)?;
        let (jobs, queue) = mpsc::channel();
        let store = Arc::new(Self { db: Mutex::new(db), originals, jobs });
        let worker = Arc::clone(&store);
        std::thread::spawn(move || worker.work(queue, &vision, &app));
        Ok(store)
    }

    // Release builds abort on panic, so a poisoned lock can only come from a debug build: keep going.
    fn db(&self) -> MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn rows(&self) -> Result<Vec<Row>> {
        let db = self.db();
        let mut query = db.prepare("SELECT kind, scope, id, data FROM items")?;
        let rows = query.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn write(&self, upsert: &[Row], remove: &[Key]) -> Result<()> {
        let fresh: Vec<String> = {
            let mut db = self.db();
            let tx = db.transaction()?;
            {
                let mut put = tx.prepare_cached(
                    "INSERT INTO items (kind, scope, id, data) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (kind, scope, id) DO UPDATE SET data = excluded.data",
                )?;
                for (kind, scope, id, data) in upsert {
                    put.execute(params![kind, scope, id, data])?;
                }
                let mut delete = tx.prepare_cached("DELETE FROM items WHERE kind = ?1 AND scope = ?2 AND id = ?3")?;
                for (kind, scope, id) in remove {
                    delete.execute(params![kind, scope, id])?;
                }
            }
            tx.commit()?;
            let mut known = db.prepare_cached("SELECT EXISTS (SELECT 1 FROM media WHERE id = ?1)")?;
            upsert
                .iter()
                .filter(|(kind, ..)| kind == "ref")
                .filter(|(_, _, id, _)| !known.query_row([id], |row| row.get::<_, bool>(0)).unwrap_or(true))
                .map(|(_, _, id, _)| id.clone())
                .collect()
        };
        fresh.into_iter().for_each(|id| drop(self.jobs.send(id)));
        Ok(())
    }

    pub fn save_original(&self, id: &str, bytes: &[u8]) -> Result<()> {
        let image = image::load_from_memory(bytes)?;
        fs::write(self.originals.join(file_name(id)), bytes)?;
        self.db().execute(
            "INSERT INTO media (id, thumb, preview) VALUES (?1, ?2, ?3) ON CONFLICT (id) DO UPDATE SET thumb = excluded.thumb, preview = excluded.preview",
            params![id, jpeg(&image, THUMB_SIDE), jpeg(&image, PREVIEW_SIDE)],
        )?;
        let _ = self.jobs.send(id.to_string());
        Ok(())
    }

    pub fn embeddings(&self, ids: &[String]) -> Result<Vec<Option<Vec<u8>>>> {
        let db = self.db();
        let mut query = db.prepare_cached("SELECT embedding FROM media WHERE id = ?1")?;
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            out.push(query.query_row([id], |row| row.get(0)).optional()?.flatten());
        }
        Ok(out)
    }

    pub fn neighbors(&self, space: &str) -> Result<HashMap<String, Neighbors>> {
        let db = self.db();
        let mut stored = db.prepare_cached("SELECT id, list FROM knn WHERE scope = ?1")?;
        let lists = stored
            .query_map([space], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
            .filter_map(|row| row.ok().and_then(|(id, list)| Some((id, serde_json::from_str(&list).ok()?))))
            .collect();
        Ok(lists)
    }

    pub fn save_neighbors<'a>(
        &self,
        space: &str,
        lists: impl Iterator<Item = (&'a String, &'a Neighbors)>,
    ) -> Result<()> {
        let mut db = self.db();
        let tx = db.transaction()?;
        {
            let mut put = tx.prepare_cached("INSERT OR REPLACE INTO knn (scope, id, list) VALUES (?1, ?2, ?3)")?;
            for (id, list) in lists {
                put.execute(params![space, id, serde_json::to_string(list)?])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn sweep(&self, embed: bool) -> rusqlite::Result<Vec<String>> {
        let db = self.db();
        let refs: HashSet<String> = db
            .prepare("SELECT id FROM items WHERE kind = 'ref'")?
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        let known: HashSet<String> =
            db.prepare("SELECT id FROM media")?.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
        let done: HashSet<String> = db
            .prepare(if embed { "SELECT id FROM media WHERE embedding IS NOT NULL" } else { "SELECT id FROM media" })?
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        for id in known.difference(&refs) {
            db.execute("DELETE FROM media WHERE id = ?1", [id])?;
        }
        db.execute("DELETE FROM knn WHERE id NOT IN (SELECT id FROM items WHERE kind = 'ref')", [])?;
        let files: HashSet<String> = refs.iter().map(|id| file_name(id)).collect();
        for entry in fs::read_dir(&self.originals).into_iter().flatten().flatten() {
            if !files.contains(&entry.file_name().to_string_lossy().into_owned()) {
                let _ = fs::remove_file(entry.path());
            }
        }
        Ok(refs.difference(&done).cloned().collect())
    }

    fn work(&self, queue: mpsc::Receiver<String>, vision: &Vision, app: &AppHandle) {
        match self.sweep(vision.available()) {
            Ok(missing) => missing.into_iter().for_each(|id| drop(self.jobs.send(id))),
            Err(error) => eprintln!("[store] sweep: {error}"),
        }
        while let Ok(first) = queue.recv() {
            let mut batch = vec![first];
            batch.extend(queue.try_iter().take(JOB_BATCH - 1));
            batch.sort();
            batch.dedup();
            let ready = self.process(&batch, vision).unwrap_or_else(|error| {
                eprintln!("[store] media: {error}");
                Vec::new()
            });
            if !ready.is_empty() {
                let _ = app.emit("media-ready", ready);
            }
        }
    }

    fn source_of(&self, id: &str) -> rusqlite::Result<Option<String>> {
        let data: Option<String> = self
            .db()
            .query_row("SELECT data FROM items WHERE kind = 'ref' AND id = ?1", [id], |row| row.get(0))
            .optional()?;
        Ok(data.and_then(|data| {
            serde_json::from_str::<serde_json::Value>(&data).ok()?["thumbUrl"].as_str().map(String::from)
        }))
    }

    fn process(&self, ids: &[String], vision: &Vision) -> rusqlite::Result<Vec<String>> {
        let mut files = Vec::with_capacity(ids.len());
        let mut downloads = Vec::new();
        for id in ids {
            let original = self.originals.join(file_name(id));
            if original.exists() {
                files.push(fs::read(&original).ok());
                continue;
            }
            let stored: Option<Vec<u8>> = self
                .db()
                .query_row("SELECT thumb FROM media WHERE id = ?1", [id], |row| row.get(0))
                .optional()?
                .flatten();
            if stored.is_some() {
                files.push(stored);
                continue;
            }
            match self.source_of(id)?.filter(|url| url.starts_with("https://")) {
                Some(url) => {
                    downloads
                        .push((files.len(), tauri::async_runtime::spawn(Vision::download(vision.client.clone(), url))));
                    files.push(None);
                }
                None => files.push(None),
            }
        }
        for (slot, download) in downloads {
            files[slot] = tauri::async_runtime::block_on(download).ok().flatten();
        }
        let images: Vec<Option<DynamicImage>> =
            files.iter().map(|bytes| bytes.as_ref().and_then(|bytes| image::load_from_memory(bytes).ok())).collect();
        let embeddings = vision.embed(&images);
        let db = self.db();
        let mut ready = Vec::new();
        for ((id, image), embedding) in ids.iter().zip(&images).zip(embeddings) {
            let Some(image) = image else { continue };
            let exists: bool =
                db.query_row("SELECT EXISTS (SELECT 1 FROM items WHERE kind = 'ref' AND id = ?1)", [id], |row| {
                    row.get(0)
                })?;
            let local = self.originals.join(file_name(id)).exists();
            if !exists && !local {
                continue;
            }
            db.execute(
                "INSERT INTO media (id, thumb, preview, embedding) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT (id) DO UPDATE SET thumb = COALESCE(media.thumb, excluded.thumb), preview = COALESCE(media.preview, excluded.preview), embedding = COALESCE(excluded.embedding, media.embedding)",
                params![id, jpeg(image, THUMB_SIDE), if local { jpeg(image, PREVIEW_SIDE) } else { None }, embedding.map(|e| quantize(&e))],
            )?;
            ready.push(id.clone());
        }
        Ok(ready)
    }

    pub fn serve(&self, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        let path = decode_path(request.uri().path().trim_start_matches('/'));
        let (kind, id) = path.split_once('/').unwrap_or_default();
        let bytes: Option<Vec<u8>> = match kind {
            "original" => fs::read(self.originals.join(file_name(id))).ok(),
            "thumb" | "preview" => {
                let column = if kind == "thumb" { "thumb" } else { "COALESCE(preview, thumb)" };
                self.db()
                    .query_row(&format!("SELECT {column} FROM media WHERE id = ?1"), [id], |row| row.get(0))
                    .optional()
                    .ok()
                    .flatten()
                    .flatten()
            }
            _ => None,
        };
        let builder = Response::builder().header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
        match bytes {
            Some(bytes) => {
                let mime = image::guess_format(&bytes)
                    .map(|format| format.to_mime_type())
                    .unwrap_or("application/octet-stream");
                builder.header(header::CONTENT_TYPE, mime).body(bytes)
            }
            None => builder.status(StatusCode::NOT_FOUND).header(header::CACHE_CONTROL, "no-store").body(Vec::new()),
        }
        .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_the_protocol_path() {
        assert_eq!(decode_path("thumb%2Fbing%3Ahttps%3A%2F%2Fa.com%2Fx.jpg"), "thumb/bing:https://a.com/x.jpg");
        assert_eq!(decode_path("100%"), "100%");
    }

    #[test]
    fn file_names_are_safe_for_any_id() {
        assert_eq!(file_name("local:ab12-cd"), "local_ab12-cd");
        assert_eq!(file_name("../x"), "___x");
    }

    #[test]
    fn thumbnail_fits_the_longest_side() {
        let image = DynamicImage::new_rgb8(1200, 600);
        let small = image::load_from_memory(&jpeg(&image, THUMB_SIDE).unwrap()).unwrap();
        assert_eq!((small.width(), small.height()), (256, 128));
    }
}

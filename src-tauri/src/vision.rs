use std::{
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock, PoisonError},
    time::{Duration, Instant},
};

use image::{imageops::FilterType, DynamicImage};
use ort::{session::Session, value::Tensor};
use serde::Serialize;

use crate::error::Result;

const SIDE: usize = 224;
const MEAN: [f32; 3] = [0.481_454_66, 0.457_827_5, 0.408_210_73];
const STD: [f32; 3] = [0.268_629_54, 0.261_302_6, 0.275_777_1];
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(4);
const SAMPLE_SIDE: u32 = 16;
const RATE_SAMPLE: u32 = 4;
const MODEL: &str = "clip-vision.onnx";
#[cfg(windows)]
const RUNTIME: &str = "onnxruntime.dll";
#[cfg(target_os = "macos")]
const RUNTIME: &str = "libonnxruntime.dylib";
#[cfg(not(any(windows, target_os = "macos")))]
const RUNTIME: &str = "libonnxruntime.so";

#[derive(Serialize, Debug)]
pub struct Signature {
    hash: String,
    embedding: Option<Vec<f32>>,
    pixels: Vec<u8>,
}

pub struct Vision {
    pub client: reqwest::Client,
    models: PathBuf,
    session: OnceLock<Option<Mutex<Session>>>,
    rate: OnceLock<f32>,
}

impl Vision {
    pub fn new(models: PathBuf) -> Self {
        let client = reqwest::Client::builder()
            .timeout(DOWNLOAD_TIMEOUT)
            .user_agent(concat!("Ganymede/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP client");
        Self { client, models, session: OnceLock::new(), rate: OnceLock::new() }
    }

    pub(crate) fn available(&self) -> bool {
        self.session().is_some()
    }

    pub fn preload(&self) {
        if self.session().is_none() {
            return;
        }
        let sample =
            |n: u32| (0..n).map(|i| Some(DynamicImage::new_rgb8(SIDE as u32 + i, SIDE as u32))).collect::<Vec<_>>();
        self.embed(&sample(1));
        let start = Instant::now();
        self.embed(&sample(RATE_SAMPLE));
        let _ = self.rate.set(RATE_SAMPLE as f32 / start.elapsed().as_secs_f32());
    }

    fn session(&self) -> Option<&Mutex<Session>> {
        self.session
            .get_or_init(|| {
                let opened = ort::init_from(self.models.join(RUNTIME)).map_err(|error| error.to_string()).and_then(
                    |environment| {
                        environment.commit();
                        Session::builder()
                            .and_then(|mut builder| builder.commit_from_file(self.models.join(MODEL)))
                            .map_err(|error| error.to_string())
                    },
                );
                match opened {
                    Ok(session) => Some(Mutex::new(session)),
                    Err(error) => {
                        eprintln!("[vision] no embeddings ({}): {error}", self.models.display());
                        None
                    }
                }
            })
            .as_ref()
    }

    pub fn rate(&self) -> Option<f32> {
        self.rate.get().copied()
    }

    pub async fn analyze(self: Arc<Self>, urls: Vec<String>, embed: bool) -> Result<Vec<Option<Signature>>> {
        let downloads: Vec<_> =
            urls.into_iter().map(|url| tauri::async_runtime::spawn(Self::download(self.client.clone(), url))).collect();
        let mut files = Vec::with_capacity(downloads.len());
        for download in downloads {
            files.push(download.await.ok().flatten());
        }
        Ok(tauri::async_runtime::spawn_blocking(move || self.sign(files, embed)).await?)
    }

    pub async fn download(client: reqwest::Client, url: String) -> Option<Vec<u8>> {
        let response = client.get(url).send().await.ok()?.error_for_status().ok()?;
        Some(response.bytes().await.ok()?.to_vec())
    }

    fn sign(&self, files: Vec<Option<Vec<u8>>>, embed: bool) -> Vec<Option<Signature>> {
        let images: Vec<Option<DynamicImage>> =
            files.into_iter().map(|bytes| bytes.and_then(|bytes| image::load_from_memory(&bytes).ok())).collect();
        let embeddings = if embed { self.embed(&images) } else { vec![None; images.len()] };
        images
            .iter()
            .zip(embeddings)
            .map(|(image, embedding)| {
                image.as_ref().map(|image| Signature {
                    hash: format!("{:016x}", dhash(image)),
                    embedding,
                    pixels: image.resize_exact(SAMPLE_SIDE, SAMPLE_SIDE, FilterType::Triangle).to_rgb8().into_raw(),
                })
            })
            .collect()
    }

    pub fn embed(&self, images: &[Option<DynamicImage>]) -> Vec<Option<Vec<f32>>> {
        let mut embeddings = vec![None; images.len()];
        let present: Vec<usize> =
            images.iter().enumerate().filter_map(|(i, image)| image.as_ref().map(|_| i)).collect();
        let Some(session) = self.session().filter(|_| !present.is_empty()) else {
            return embeddings;
        };
        let pixels: Vec<f32> = images.iter().flatten().flat_map(preprocess).collect();
        let run = || -> ort::Result<Vec<f32>> {
            let input = Tensor::from_array(([present.len(), 3, SIDE, SIDE], pixels))?;
            let mut session = session.lock().unwrap_or_else(PoisonError::into_inner);
            let outputs = session.run(ort::inputs!["pixel_values" => input])?;
            let (_, data) = outputs["image_embeds"].try_extract_tensor::<f32>()?;
            Ok(data.to_vec())
        };
        match run() {
            Ok(flat) => {
                let dim = flat.len() / present.len();
                for (slot, chunk) in present.iter().zip(flat.chunks(dim)) {
                    let norm = chunk.iter().map(|v| v * v).sum::<f32>().sqrt().max(f32::EPSILON);
                    embeddings[*slot] = Some(chunk.iter().map(|v| v / norm).collect());
                }
            }
            Err(error) => eprintln!("[vision] CLIP failed: {error}"),
        }
        embeddings
    }
}

pub fn quantize(embedding: &[f32]) -> Vec<u8> {
    let scale = embedding.iter().fold(f32::EPSILON, |max, value| max.max(value.abs()));
    let mut bytes = scale.to_le_bytes().to_vec();
    bytes.extend(embedding.iter().map(|value| (value / scale * 127.0).round() as i8 as u8));
    bytes
}

fn dhash(image: &DynamicImage) -> u64 {
    let small = image.resize_exact(9, 8, FilterType::Triangle).to_luma8();
    let mut hash = 0u64;
    for y in 0..8 {
        for x in 0..8 {
            hash = (hash << 1) | u64::from(small.get_pixel(x, y)[0] > small.get_pixel(x + 1, y)[0]);
        }
    }
    hash
}

fn preprocess(image: &DynamicImage) -> Vec<f32> {
    let (width, height) = (image.width() as f32, image.height() as f32);
    let scale = SIDE as f32 / width.min(height);
    let (w, h) =
        (((width * scale).round() as u32).max(SIDE as u32), ((height * scale).round() as u32).max(SIDE as u32));
    let resized = image.resize_exact(w, h, FilterType::CatmullRom).to_rgb8();
    let (left, top) = ((w - SIDE as u32) / 2, (h - SIDE as u32) / 2);
    let plane = SIDE * SIDE;
    let mut out = vec![0.0; 3 * plane];
    for y in 0..SIDE {
        for x in 0..SIDE {
            let pixel = resized.get_pixel(left + x as u32, top + y as u32);
            for c in 0..3 {
                out[c * plane + y * SIDE + x] = (f32::from(pixel[c]) / 255.0 - MEAN[c]) / STD[c];
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GrayImage, Luma};

    fn gradient(flip: bool) -> DynamicImage {
        DynamicImage::ImageLuma8(GrayImage::from_fn(300, 200, |x, _| {
            Luma([if flip { 255 - x as u8 / 2 } else { x as u8 / 2 }])
        }))
    }

    #[test]
    fn dhash_matches_a_resized_copy_and_separates_different_images() {
        let original = gradient(false);
        let resized = original.resize_exact(150, 100, FilterType::Triangle);
        assert!((dhash(&original) ^ dhash(&resized)).count_ones() <= 4);
        assert!((dhash(&original) ^ dhash(&gradient(true))).count_ones() > 32);
    }

    #[test]
    fn signature_carries_the_rgb_sample_for_the_palette() {
        let vision = Vision::new(PathBuf::from("no-model"));
        let mut bytes = std::io::Cursor::new(Vec::new());
        gradient(false).write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        let signatures = vision.sign(vec![Some(bytes.into_inner()), None], false);
        assert_eq!(signatures[0].as_ref().unwrap().pixels.len(), (SAMPLE_SIDE * SAMPLE_SIDE * 3) as usize);
        assert!(signatures[1].is_none());
    }

    #[test]
    fn runs_without_embeddings_when_onnx_runtime_is_missing() {
        let vision = Vision::new(PathBuf::from("no-model"));
        assert!(!vision.available());
        assert_eq!(vision.embed(&[Some(gradient(false))]), vec![None]);
    }

    #[test]
    fn preprocess_crops_a_224_square_in_chw_order() {
        assert_eq!(preprocess(&gradient(false)).len(), 3 * SIDE * SIDE);
    }

    #[test]
    #[ignore]
    fn clip_produces_normalized_embeddings() {
        let vision = Vision::new(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models"));
        let png = |image: DynamicImage| {
            let mut bytes = std::io::Cursor::new(Vec::new());
            image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
            Some(bytes.into_inner())
        };
        let start = std::time::Instant::now();
        let signatures = vision.sign(vec![png(gradient(false)), None, png(gradient(true))], true);
        println!("2 images in {:?} (including model load)", start.elapsed());
        assert!(signatures[1].is_none());
        let embedding = signatures[0].as_ref().unwrap().embedding.as_ref().expect("embedding");
        assert_eq!(embedding.len(), 512);
        assert!((embedding.iter().map(|v| v * v).sum::<f32>() - 1.0).abs() < 1e-3);

        let preview = || {
            let mut bytes = std::io::Cursor::new(Vec::new());
            gradient(false)
                .resize_exact(474, 315, FilterType::Triangle)
                .to_rgb8()
                .write_to(&mut bytes, image::ImageFormat::Jpeg)
                .unwrap();
            Some(bytes.into_inner())
        };
        let decoded: Vec<_> = (0..40).map(|_| image::load_from_memory(&preview().unwrap()).unwrap()).collect();
        let start = std::time::Instant::now();
        decoded.iter().for_each(|image| drop(preprocess(image)));
        println!("preprocessing 40: {:?}", start.elapsed());
        let start = std::time::Instant::now();
        let batch = vision.sign((0..40).map(|_| preview()).collect(), true);
        println!("40 previews in {:?}", start.elapsed());
        assert!(batch.iter().all(|signature| signature.as_ref().is_some_and(|s| s.embedding.is_some())));
    }
}

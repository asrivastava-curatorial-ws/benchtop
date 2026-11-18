//! Image operations for the AI tools: background removal, upscaling, face
//! blurring and the object eraser.  Images arrive as encoded files and leave as
//! PNG, so the web view never handles raw tensors.

use std::io::Cursor;
use std::path::Path;

use image::imageops::{self, FilterType};
use image::{
    DynamicImage, GenericImageView, GrayImage, ImageReader, Luma, Rgb, RgbImage, Rgba, RgbaImage,
};
use ort::value::Tensor;
use serde_json::{json, Value};

use super::protocol::Frame;
use super::worker::{Engine, Reply};

/// Largest image accepted, in pixels (about 50 megapixels).
const MAX_PIXELS: u64 = 50_000_000;
/// Largest upscaled result, in pixels.
const MAX_OUTPUT_PIXELS: u64 = 120_000_000;

pub fn decode(bytes: &[u8]) -> Result<DynamicImage, String> {
    use image::ImageDecoder;
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| error.to_string())?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|error| format!("This image could not be read: {error}"))?;
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let (width, height) = decoder.dimensions();
    if width as u64 * height as u64 > MAX_PIXELS {
        return Err(format!(
            "The image is {width} × {height}; the limit is about 50 megapixels."
        ));
    }
    let mut image = DynamicImage::from_decoder(decoder)
        .map_err(|error| format!("This image could not be read: {error}"))?;
    image.apply_orientation(orientation);
    Ok(image)
}

pub fn png(image: &DynamicImage) -> Result<Vec<u8>, String> {
    use image::codecs::png::{CompressionType, FilterType as PngFilter, PngEncoder};
    let mut out = Vec::new();
    let encoder =
        PngEncoder::new_with_quality(&mut out, CompressionType::Fast, PngFilter::Adaptive);
    image
        .write_with_encoder(encoder)
        .map_err(|error| format!("Could not encode the result: {error}"))?;
    Ok(out)
}

fn option_f64(options: &Value, key: &str, default: f64) -> f64 {
    options.get(key).and_then(Value::as_f64).unwrap_or(default)
}

fn option_str<'a>(options: &'a Value, key: &str, default: &'a str) -> &'a str {
    options.get(key).and_then(Value::as_str).unwrap_or(default)
}

fn parse_colour(text: &str) -> [u8; 3] {
    let hex = text.trim_start_matches('#');
    if hex.len() == 6 {
        if let Ok(value) = u32::from_str_radix(hex, 16) {
            return [(value >> 16) as u8, (value >> 8) as u8, value as u8];
        }
    }
    [255, 255, 255]
}

/// Square input size of a model with a fixed spatial shape (falls back to `default`).
fn input_side(engine: &mut Engine, model: &Path, default: u32) -> Result<u32, String> {
    let session = engine.session(model)?;
    let side = session
        .inputs()
        .first()
        .and_then(|input| input.dtype().tensor_shape().map(|shape| shape.to_vec()))
        .and_then(|shape| shape.get(3).copied())
        .filter(|side| *side > 0)
        .map(|side| side as u32)
        .unwrap_or(default);
    Ok(side)
}

/// NCHW float tensor from an RGB image, after `(x / scale - mean) / std` per channel.
fn to_tensor(image: &RgbImage, scale: f32, mean: [f32; 3], std: [f32; 3]) -> Vec<f32> {
    let (width, height) = image.dimensions();
    let plane = (width * height) as usize;
    let mut data = vec![0f32; plane * 3];
    for (index, pixel) in image.pixels().enumerate() {
        for channel in 0..3 {
            data[channel * plane + index] =
                (pixel[channel] as f32 / scale - mean[channel]) / std[channel];
        }
    }
    data
}

/// Runs a single-input model and returns the first output's shape and data.
fn run_single(
    engine: &mut Engine,
    model: &Path,
    shape: [usize; 4],
    data: Vec<f32>,
) -> Result<(Vec<i64>, Vec<f32>), String> {
    let session = engine.session(model)?;
    let name = session
        .inputs()
        .first()
        .map(|input| input.name().to_string())
        .ok_or("The model has no inputs.")?;
    let tensor = Tensor::from_array((shape, data)).map_err(|error| error.to_string())?;
    let outputs = session
        .run(ort::inputs![name => tensor])
        .map_err(|error| format!("The model failed: {error}"))?;
    let (out_shape, values) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|error| error.to_string())?;
    Ok((out_shape.to_vec(), values.to_vec()))
}

// ------------------------------------------------------------------ background

pub fn background(
    engine: &mut Engine,
    model: &Path,
    input: &[u8],
    options: &Value,
    reply: &mut Reply,
) -> Result<Frame, String> {
    let image = decode(input)?;
    reply.progress(0.1, "Finding the subject");
    let name = model
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let side = input_side(engine, model, 1024)?;
    let rgb = image.to_rgb8();
    let resized = imageops::resize(&rgb, side, side, FilterType::Lanczos3);
    // rembg's preprocessing: scale by the brightest value, then normalise per model family.
    let peak = resized
        .pixels()
        .flat_map(|pixel| pixel.0)
        .max()
        .unwrap_or(255)
        .max(1) as f32;
    let (mean, std) = if name.contains("isnet") {
        ([0.5; 3], [1.0; 3])
    } else {
        ([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    };
    let data = to_tensor(&resized, peak, mean, std);
    let (shape, mut values) =
        run_single(engine, model, [1, 3, side as usize, side as usize], data)?;
    reply.progress(0.7, "Cutting out");
    let plane = (side * side) as usize;
    if values.len() < plane || shape.len() < 4 {
        return Err("The model returned an unexpected mask.".into());
    }
    values.truncate(plane);
    if name.contains("birefnet") {
        for value in &mut values {
            *value = 1.0 / (1.0 + (-*value).exp());
        }
    }
    let (min, max) = values
        .iter()
        .fold((f32::MAX, f32::MIN), |(lo, hi), v| (lo.min(*v), hi.max(*v)));
    let range = (max - min).max(1e-6);
    let small = GrayImage::from_fn(side, side, |x, y| {
        Luma([(((values[(y * side + x) as usize] - min) / range) * 255.0).round() as u8])
    });
    let (width, height) = image.dimensions();
    let mut mask = imageops::resize(&small, width, height, FilterType::Lanczos3);
    if option_str(options, "edges", "soft") == "hard" {
        for pixel in mask.pixels_mut() {
            pixel.0[0] = if pixel.0[0] >= 128 { 255 } else { 0 };
        }
    }
    let original = image.to_rgba8();
    let mode = option_str(options, "mode", "cutout");
    let result: DynamicImage = match mode {
        "mask" => DynamicImage::ImageLuma8(mask.clone()),
        "colour" => {
            let colour = parse_colour(option_str(options, "colour", "#ffffff"));
            let mut out = RgbImage::new(width, height);
            for (x, y, pixel) in out.enumerate_pixels_mut() {
                let source = original.get_pixel(x, y);
                let alpha = mask.get_pixel(x, y).0[0] as f32 / 255.0 * source.0[3] as f32 / 255.0;
                *pixel = Rgb(std::array::from_fn(|c| {
                    (source.0[c] as f32 * alpha + colour[c] as f32 * (1.0 - alpha)).round() as u8
                }));
            }
            DynamicImage::ImageRgb8(out)
        }
        "blur" => {
            let sigma = (width.max(height) as f32 / 120.0).max(2.0)
                * option_f64(options, "strength", 1.0) as f32;
            let blurred = imageops::blur(&original, sigma);
            let mut out = original.clone();
            for (x, y, pixel) in out.enumerate_pixels_mut() {
                let alpha = mask.get_pixel(x, y).0[0] as f32 / 255.0;
                let back = blurred.get_pixel(x, y);
                *pixel = Rgba(std::array::from_fn(|c| {
                    if c == 3 {
                        255
                    } else {
                        (pixel.0[c] as f32 * alpha + back.0[c] as f32 * (1.0 - alpha)).round() as u8
                    }
                }));
            }
            DynamicImage::ImageRgba8(out)
        }
        _ => {
            let mut out = original.clone();
            for (x, y, pixel) in out.enumerate_pixels_mut() {
                pixel.0[3] = ((pixel.0[3] as u32 * mask.get_pixel(x, y).0[0] as u32) / 255) as u8;
            }
            DynamicImage::ImageRgba8(out)
        }
    };
    // Optionally trim to the subject with a small margin.
    let result = if options
        .get("crop")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        && mode != "mask"
    {
        let (mut x0, mut y0, mut x1, mut y1) = (width, height, 0, 0);
        for (x, y, pixel) in mask.enumerate_pixels() {
            if pixel.0[0] > 16 {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
        }
        if x1 > x0 && y1 > y0 {
            let margin = ((x1 - x0).max(y1 - y0) / 50).max(2);
            let (x0, y0) = (x0.saturating_sub(margin), y0.saturating_sub(margin));
            let (x1, y1) = ((x1 + margin).min(width - 1), (y1 + margin).min(height - 1));
            result.crop_imm(x0, y0, x1 - x0 + 1, y1 - y0 + 1)
        } else {
            result
        }
    } else {
        result
    };
    mask.fill(0);
    reply.progress(0.95, "Saving");
    let (out_width, out_height) = result.dimensions();
    Ok(
        Frame::new(json!({"width": out_width, "height": out_height, "mime": "image/png"}))
            .with(png(&result)?),
    )
}

// ------------------------------------------------------------------ upscale

pub fn upscale(
    engine: &mut Engine,
    model: &Path,
    input: &[u8],
    options: &Value,
    reply: &mut Reply,
) -> Result<Frame, String> {
    let image = decode(input)?;
    let (width, height) = image.dimensions();
    let name = model
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let native: u32 = if name.contains("x2") { 2 } else { 4 };
    let wanted = option_f64(options, "scale", native as f64).clamp(1.0, 4.0);
    if (width as f64 * wanted) * (height as f64 * wanted) > MAX_OUTPUT_PIXELS as f64 {
        return Err(format!("{width} × {height} at {wanted}× would be larger than 120 megapixels; crop or shrink the image first."));
    }
    let rgb = image.to_rgb8();
    let tile = option_f64(options, "tile", 192.0).clamp(64.0, 512.0) as u32;
    let overlap = 12u32;
    let mut out = RgbImage::new(width * native, height * native);
    let columns = width.div_ceil(tile);
    let rows = height.div_ceil(tile);
    let total = (columns * rows) as f64;
    let mut done = 0f64;
    for row in 0..rows {
        for column in 0..columns {
            // The tile plus an overlap margin, clamped to the image.
            let x0 = (column * tile).saturating_sub(overlap);
            let y0 = (row * tile).saturating_sub(overlap);
            let x1 = ((column + 1) * tile + overlap).min(width);
            let y1 = ((row + 1) * tile + overlap).min(height);
            let crop = imageops::crop_imm(&rgb, x0, y0, x1 - x0, y1 - y0).to_image();
            let (tw, th) = crop.dimensions();
            let data = to_tensor(&crop, 255.0, [0.0; 3], [1.0; 3]);
            let (shape, values) =
                run_single(engine, model, [1, 3, th as usize, tw as usize], data)?;
            let (ow, oh) = (shape[3] as u32, shape[2] as u32);
            if ow != tw * native || oh != th * native {
                return Err("The upscaler returned an unexpected size.".into());
            }
            let plane = (ow * oh) as usize;
            // Copy only this tile's own area (without the overlap) into place.
            let keep_x0 = column * tile;
            let keep_y0 = row * tile;
            let keep_x1 = ((column + 1) * tile).min(width);
            let keep_y1 = ((row + 1) * tile).min(height);
            for y in (keep_y0 * native)..(keep_y1 * native) {
                for x in (keep_x0 * native)..(keep_x1 * native) {
                    let local = ((y - y0 * native) * ow + (x - x0 * native)) as usize;
                    let pixel = std::array::from_fn(|c| {
                        (values[c * plane + local].clamp(0.0, 1.0) * 255.0).round() as u8
                    });
                    out.put_pixel(x, y, Rgb(pixel));
                }
            }
            done += 1.0;
            reply.progress(0.05 + 0.85 * done / total, "Upscaling");
        }
    }
    let target_w = (width as f64 * wanted).round() as u32;
    let target_h = (height as f64 * wanted).round() as u32;
    let mut result = DynamicImage::ImageRgb8(out);
    if target_w != width * native {
        result = result.resize_exact(target_w, target_h, FilterType::Lanczos3);
    }
    if image.color().has_alpha() {
        let alpha = imageops::resize(&image.to_rgba8(), target_w, target_h, FilterType::Lanczos3);
        let mut rgba = result.to_rgba8();
        for (pixel, source) in rgba.pixels_mut().zip(alpha.pixels()) {
            pixel.0[3] = source.0[3];
        }
        result = DynamicImage::ImageRgba8(rgba);
    }
    reply.progress(0.95, "Saving");
    Ok(
        Frame::new(json!({"width": target_w, "height": target_h, "mime": "image/png"}))
            .with(png(&result)?),
    )
}

// ------------------------------------------------------------------ faces

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FaceBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub score: f32,
}

fn iou(a: &FaceBox, b: &FaceBox) -> f32 {
    let x0 = a.x.max(b.x);
    let y0 = a.y.max(b.y);
    let x1 = (a.x + a.w).min(b.x + b.w);
    let y1 = (a.y + a.h).min(b.y + b.h);
    let inter = (x1 - x0).max(0.0) * (y1 - y0).max(0.0);
    inter / (a.w * a.h + b.w * b.h - inter).max(1e-6)
}

pub fn non_max_suppression(mut boxes: Vec<FaceBox>, threshold: f32) -> Vec<FaceBox> {
    boxes.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut kept: Vec<FaceBox> = Vec::new();
    for candidate in boxes {
        if kept
            .iter()
            .all(|existing| iou(existing, &candidate) < threshold)
        {
            kept.push(candidate);
        }
    }
    kept
}

/// YuNet on one 640 × 640 window: `scale` maps window pixels back to the image, `offset` is the window origin.
fn yunet_window(
    engine: &mut Engine,
    model: &Path,
    window: &RgbImage,
    scale: f32,
    offset: (f32, f32),
    threshold: f32,
) -> Result<Vec<FaceBox>, String> {
    const SIDE: u32 = 640;
    let mut canvas = RgbImage::new(SIDE, SIDE);
    imageops::replace(&mut canvas, window, 0, 0);
    // YuNet expects BGR values from 0 to 255.
    let plane = (SIDE * SIDE) as usize;
    let mut data = vec![0f32; plane * 3];
    for (index, pixel) in canvas.pixels().enumerate() {
        data[index] = pixel.0[2] as f32;
        data[plane + index] = pixel.0[1] as f32;
        data[2 * plane + index] = pixel.0[0] as f32;
    }
    let session = engine.session(model)?;
    let name = session
        .inputs()
        .first()
        .map(|input| input.name().to_string())
        .ok_or("The model has no inputs.")?;
    let tensor = Tensor::from_array(([1usize, 3, SIDE as usize, SIDE as usize], data))
        .map_err(|error| error.to_string())?;
    let outputs = session
        .run(ort::inputs![name => tensor])
        .map_err(|error| format!("Face detection failed: {error}"))?;
    let mut boxes = Vec::new();
    for (level, stride) in [8u32, 16, 32].into_iter().enumerate() {
        let cls = outputs[level]
            .try_extract_tensor::<f32>()
            .map_err(|error| error.to_string())?
            .1;
        let obj = outputs[level + 3]
            .try_extract_tensor::<f32>()
            .map_err(|error| error.to_string())?
            .1;
        let bbox = outputs[level + 6]
            .try_extract_tensor::<f32>()
            .map_err(|error| error.to_string())?
            .1;
        let columns = SIDE / stride;
        for index in 0..cls.len() {
            let score = (cls[index].clamp(0.0, 1.0) * obj[index].clamp(0.0, 1.0)).sqrt();
            if score < threshold {
                continue;
            }
            let row = (index as u32 / columns) as f32;
            let column = (index as u32 % columns) as f32;
            let s = stride as f32;
            let cx = (column + bbox[index * 4]) * s;
            let cy = (row + bbox[index * 4 + 1]) * s;
            let w = bbox[index * 4 + 2].exp() * s;
            let h = bbox[index * 4 + 3].exp() * s;
            boxes.push(FaceBox {
                x: (cx - w / 2.0) * scale + offset.0,
                y: (cy - h / 2.0) * scale + offset.1,
                w: w * scale,
                h: h * scale,
                score,
            });
        }
    }
    Ok(boxes)
}

pub fn detect_faces(
    engine: &mut Engine,
    model: &Path,
    image: &DynamicImage,
    threshold: f32,
    thorough: bool,
) -> Result<Vec<FaceBox>, String> {
    let rgb = image.to_rgb8();
    let (width, height) = rgb.dimensions();
    // Whole picture, shrunk to fit the window.
    let fit = (640.0 / width.max(height) as f32).min(1.0);
    let small = imageops::resize(
        &rgb,
        ((width as f32 * fit).round() as u32).max(1),
        ((height as f32 * fit).round() as u32).max(1),
        FilterType::Triangle,
    );
    let mut boxes = yunet_window(engine, model, &small, 1.0 / fit, (0.0, 0.0), threshold)?;
    // Small faces in big pictures: scan overlapping windows over a copy no wider than 1920 pixels.
    if thorough && width.max(height) > 800 {
        let shrink = (1920.0 / width.max(height) as f32).min(1.0);
        let medium = imageops::resize(
            &rgb,
            ((width as f32 * shrink).round() as u32).max(1),
            ((height as f32 * shrink).round() as u32).max(1),
            FilterType::Triangle,
        );
        let (mw, mh) = medium.dimensions();
        let step = 480u32;
        let mut y = 0;
        loop {
            let mut x = 0;
            loop {
                let w = 640.min(mw - x);
                let h = 640.min(mh - y);
                let window = imageops::crop_imm(&medium, x, y, w, h).to_image();
                boxes.extend(yunet_window(
                    engine,
                    model,
                    &window,
                    1.0 / shrink,
                    (x as f32 / shrink, y as f32 / shrink),
                    threshold,
                )?);
                if x + 640 >= mw {
                    break;
                }
                x += step;
            }
            if y + 640 >= mh {
                break;
            }
            y += step;
        }
    }
    let boxes = non_max_suppression(boxes, 0.3)
        .into_iter()
        .map(|b| FaceBox {
            x: b.x.max(0.0),
            y: b.y.max(0.0),
            w: b.w.min(width as f32 - b.x.max(0.0)),
            h: b.h.min(height as f32 - b.y.max(0.0)),
            score: b.score,
        })
        .filter(|b| b.w > 2.0 && b.h > 2.0)
        .collect();
    Ok(boxes)
}

pub fn faces(
    engine: &mut Engine,
    model: Option<&Path>,
    input: &[u8],
    options: &Value,
    reply: &mut Reply,
) -> Result<Frame, String> {
    let image = decode(input)?;
    reply.progress(0.1, "Finding faces");
    let boxes: Vec<FaceBox> = match options.get("boxes").and_then(Value::as_array) {
        Some(list) => list
            .iter()
            .map(|b| FaceBox {
                x: b["x"].as_f64().unwrap_or(0.0) as f32,
                y: b["y"].as_f64().unwrap_or(0.0) as f32,
                w: b["w"].as_f64().unwrap_or(0.0) as f32,
                h: b["h"].as_f64().unwrap_or(0.0) as f32,
                score: b["score"].as_f64().unwrap_or(1.0) as f32,
            })
            .collect(),
        None => {
            let model = model.ok_or("The face detector is not installed.")?;
            let threshold = option_f64(options, "threshold", 0.6) as f32;
            detect_faces(
                engine,
                model,
                &image,
                threshold,
                options
                    .get("thorough")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
            )?
        }
    };
    reply.progress(0.6, "Hiding faces");
    let mut out = image.to_rgba8();
    let (width, height) = out.dimensions();
    let effect = option_str(options, "effect", "blur");
    let padding = option_f64(options, "padding", 0.15) as f32;
    let colour = parse_colour(option_str(options, "colour", "#000000"));
    for face in &boxes {
        let pad_w = face.w * padding;
        let pad_h = face.h * padding;
        let x0 = (face.x - pad_w).max(0.0) as u32;
        let y0 = (face.y - pad_h * 1.4).max(0.0) as u32;
        let x1 = ((face.x + face.w + pad_w) as u32).min(width);
        let y1 = ((face.y + face.h + pad_h) as u32).min(height);
        if x1 <= x0 || y1 <= y0 {
            continue;
        }
        let (bw, bh) = (x1 - x0, y1 - y0);
        let region = imageops::crop_imm(&out, x0, y0, bw, bh).to_image();
        let covered: RgbaImage = match effect {
            "pixelate" => {
                let blocks = (bw.max(bh) / 10).max(1);
                let tiny = imageops::resize(
                    &region,
                    (bw / blocks).max(1),
                    (bh / blocks).max(1),
                    FilterType::Triangle,
                );
                imageops::resize(&tiny, bw, bh, FilterType::Nearest)
            }
            "fill" => RgbaImage::from_pixel(bw, bh, Rgba([colour[0], colour[1], colour[2], 255])),
            _ => imageops::blur(&region, (bw.max(bh) as f32 / 6.0).max(3.0)),
        };
        // An ellipse with a soft edge looks natural for blur; boxes stay square for fill and pixelate.
        let ellipse = effect == "blur";
        let (cx, cy, rx, ry) = (
            bw as f32 / 2.0,
            bh as f32 / 2.0,
            bw as f32 / 2.0,
            bh as f32 / 2.0,
        );
        for y in 0..bh {
            for x in 0..bw {
                let weight = if ellipse {
                    let d = ((x as f32 - cx) / rx).powi(2) + ((y as f32 - cy) / ry).powi(2);
                    ((1.0 - d) / 0.15).clamp(0.0, 1.0)
                } else {
                    1.0
                };
                if weight <= 0.0 {
                    continue;
                }
                let target = out.get_pixel_mut(x0 + x, y0 + y);
                let source = covered.get_pixel(x, y);
                for c in 0..3 {
                    target.0[c] = (source.0[c] as f32 * weight
                        + target.0[c] as f32 * (1.0 - weight))
                        .round() as u8;
                }
            }
        }
    }
    let list: Vec<Value> = boxes
        .iter()
        .map(|b| json!({"x": b.x, "y": b.y, "w": b.w, "h": b.h, "score": b.score}))
        .collect();
    reply.progress(0.95, "Saving");
    let result = if image.color().has_alpha() {
        DynamicImage::ImageRgba8(out)
    } else {
        DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(out).to_rgb8())
    };
    Ok(
        Frame::new(json!({"width": width, "height": height, "mime": "image/png", "faces": list}))
            .with(png(&result)?),
    )
}

// ------------------------------------------------------------------ eraser

pub fn erase(
    engine: &mut Engine,
    model: &Path,
    input: &[u8],
    mask_bytes: &[u8],
    reply: &mut Reply,
) -> Result<Frame, String> {
    let image = decode(input)?;
    let (width, height) = image.dimensions();
    let painted = decode(mask_bytes)?;
    // White (or opaque) paint marks what to remove; MI-GAN wants 255 where pixels are kept.
    let painted = painted
        .resize_exact(width, height, FilterType::Nearest)
        .to_rgba8();
    let plane = (width * height) as usize;
    let mut mask = vec![255u8; plane];
    let mut any = false;
    for (index, pixel) in painted.pixels().enumerate() {
        let erase =
            pixel.0[3] > 127 && (pixel.0[0] as u32 + pixel.0[1] as u32 + pixel.0[2] as u32) > 384;
        if erase {
            mask[index] = 0;
            any = true;
        }
    }
    if !any {
        return Err("Paint over what to remove first.".into());
    }
    reply.progress(0.2, "Filling in");
    let rgb = image.to_rgb8();
    let mut data = vec![0u8; plane * 3];
    for (index, pixel) in rgb.pixels().enumerate() {
        for c in 0..3 {
            data[c * plane + index] = pixel.0[c];
        }
    }
    let session = engine.session(model)?;
    let image_tensor = Tensor::from_array(([1usize, 3, height as usize, width as usize], data))
        .map_err(|error| error.to_string())?;
    let mask_tensor = Tensor::from_array(([1usize, 1, height as usize, width as usize], mask))
        .map_err(|error| error.to_string())?;
    let outputs = session
        .run(ort::inputs!["image" => image_tensor, "mask" => mask_tensor])
        .map_err(|error| format!("The eraser failed: {error}"))?;
    let (shape, values) = outputs[0]
        .try_extract_tensor::<u8>()
        .map_err(|error| error.to_string())?;
    if shape.len() != 4 || shape[2] as u32 != height || shape[3] as u32 != width {
        return Err("The eraser returned an unexpected size.".into());
    }
    let mut out = image.to_rgba8();
    for (index, pixel) in out.pixels_mut().enumerate() {
        for c in 0..3 {
            pixel.0[c] = values[c * plane + index];
        }
    }
    reply.progress(0.95, "Saving");
    let result = if image.color().has_alpha() {
        DynamicImage::ImageRgba8(out)
    } else {
        DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(out).to_rgb8())
    };
    Ok(
        Frame::new(json!({"width": width, "height": height, "mime": "image/png"}))
            .with(png(&result)?),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suppresses_overlapping_faces() {
        let a = FaceBox {
            x: 10.0,
            y: 10.0,
            w: 100.0,
            h: 100.0,
            score: 0.9,
        };
        let b = FaceBox {
            x: 15.0,
            y: 12.0,
            w: 100.0,
            h: 100.0,
            score: 0.8,
        };
        let c = FaceBox {
            x: 300.0,
            y: 10.0,
            w: 50.0,
            h: 50.0,
            score: 0.7,
        };
        let kept = non_max_suppression(vec![b, c, a], 0.3);
        assert_eq!(kept, vec![a, c]);
    }

    #[test]
    fn reads_colours_and_encodes_png() {
        assert_eq!(parse_colour("#ff8000"), [255, 128, 0]);
        assert_eq!(parse_colour("nonsense"), [255, 255, 255]);
        let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(3, 2, Rgb([1, 2, 3])));
        let bytes = png(&image).unwrap();
        let back = decode(&bytes).unwrap();
        assert_eq!(back.dimensions(), (3, 2));
        assert_eq!(back.to_rgb8().get_pixel(2, 1).0, [1, 2, 3]);
    }
}

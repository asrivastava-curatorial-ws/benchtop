//! End-to-end checks of the AI operations with real models.  They run only when
//! BENCHTOP_AI_TEST_DIR points at a folder holding libonnxruntime.so and the
//! files the tests name (models from the app's catalog, under the names they are
//! stored with, plus a few sample pictures and recordings); otherwise they pass
//! without work.

use std::path::{Path, PathBuf};

use image::GenericImageView;
use serde_json::json;

use super::image_ops;
use super::speech::{self, SpeechModels};
use super::worker::{Engine, Reply};

fn folder() -> Option<PathBuf> {
    std::env::var_os("BENCHTOP_AI_TEST_DIR")
        .map(PathBuf::from)
        .filter(|dir| dir.join("libonnxruntime.so").is_file())
}

fn engine(dir: &Path) -> Engine {
    Engine::init(&dir.join("libonnxruntime.so"), false).expect("ONNX Runtime loads")
}

fn result_image(frame: &super::protocol::Frame) -> image::DynamicImage {
    image_ops::decode(&frame.attachments[0]).expect("PNG result")
}

#[test]
fn removes_a_background_upscales_and_blurs_faces() {
    let Some(dir) = folder() else { return };
    let mut engine = engine(&dir);
    let mut sink = Vec::new();
    let mut reply = Reply::new(&mut sink);
    let photo = std::fs::read(dir.join("face.jpg")).expect("test photo");

    let cut = image_ops::background(
        &mut engine,
        &dir.join("isnet-general-use.onnx"),
        &photo,
        &json!({"mode": "cutout"}),
        &mut reply,
    )
    .expect("background");
    let rgba = result_image(&cut).to_rgba8();
    let clear = rgba.pixels().filter(|p| p.0[3] < 10).count();
    let solid = rgba.pixels().filter(|p| p.0[3] > 245).count();
    assert!(
        clear > rgba.len() / 40 && solid > rgba.len() / 40,
        "clear {clear}, solid {solid}"
    );

    let fast = image_ops::background(
        &mut engine,
        &dir.join("u2netp.onnx"),
        &photo,
        &json!({"mode": "mask"}),
        &mut reply,
    )
    .expect("u2netp");
    assert_eq!(
        result_image(&fast).dimensions(),
        image_ops::decode(&photo).unwrap().dimensions()
    );

    let small = image_ops::decode(&photo).unwrap().thumbnail(96, 96);
    let small_png = image_ops::png(&small).unwrap();
    let up = image_ops::upscale(
        &mut engine,
        &dir.join("realesr-general-x4v3.onnx"),
        &small_png,
        &json!({"scale": 4, "tile": 64}),
        &mut reply,
    )
    .expect("upscale");
    let (w, h) = small.dimensions();
    assert_eq!(result_image(&up).dimensions(), (w * 4, h * 4));
    let half = image_ops::upscale(
        &mut engine,
        &dir.join("realesr-general-x4v3.onnx"),
        &small_png,
        &json!({"scale": 2}),
        &mut reply,
    )
    .expect("upscale 2x");
    assert_eq!(result_image(&half).dimensions(), (w * 2, h * 2));

    let faces = image_ops::faces(
        &mut engine,
        Some(&dir.join("yunet_2023_mar.onnx")),
        &photo,
        &json!({"effect": "pixelate"}),
        &mut reply,
    )
    .expect("faces");
    let found = faces.header["faces"].as_array().expect("face list").len();
    assert!(found >= 1, "no face found");
    let manual = image_ops::faces(
        &mut engine,
        None,
        &photo,
        &json!({"boxes": [{"x": 0, "y": 0, "w": 50, "h": 50}], "effect": "fill"}),
        &mut reply,
    )
    .expect("manual boxes");
    assert_eq!(
        result_image(&manual).to_rgb8().get_pixel(10, 10).0,
        [0, 0, 0]
    );
    assert!(!sink.is_empty(), "progress was reported");
}

#[test]
fn transcribes_english_speech() {
    let Some(dir) = folder() else { return };
    let mut engine = engine(&dir);
    let mut sink = Vec::new();
    let mut reply = Reply::new(&mut sink);
    let models = SpeechModels {
        encoder: dir.join("whisper/encoder.onnx"),
        decoder: dir.join("whisper/decoder.onnx"),
        tokens: dir.join("whisper/tokens.txt"),
        vad: Some(dir.join("silero_vad.onnx")),
    };
    let audio = std::fs::read(dir.join("0.wav")).expect("test speech");
    let started = std::time::Instant::now();
    let result = speech::transcribe(
        &mut engine,
        &models,
        speech::Source::Bytes(&audio, "0.wav".into()),
        &json!({}),
        &mut reply,
    )
    .expect("transcription");
    let text: String = result.header["segments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["text"].as_str().unwrap_or_default())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    eprintln!("transcript in {:?}: {text}", started.elapsed());
    assert!(text.contains("yellow lamps"), "{text}");
    assert!(text.contains("nightfall"), "{text}");
    // Without the voice detector the fixed splitter is used.
    let plain = SpeechModels {
        vad: None,
        ..models
    };
    let second = speech::transcribe(
        &mut engine,
        &plain,
        speech::Source::Path(dir.join("1.wav")),
        &json!({}),
        &mut reply,
    )
    .expect("second file");
    assert!(!second.header["segments"].as_array().unwrap().is_empty());
}

fn joined(result: &super::protocol::Frame) -> String {
    result.header["segments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["text"].as_str().unwrap_or_default())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Multilingual Whisper (the sherpa-onnx export of base or large-v3 turbo, in
/// `whisper-multi/` or `whisper-turbo/`): detects the language, reads Hindi from
/// espeak-ng speech, translates it, and refuses Hindi with an English-only model.
#[test]
fn transcribes_hindi_with_a_multilingual_model() {
    let Some(dir) = folder() else { return };
    let mut engine = engine(&dir);
    let mut sink = Vec::new();
    let mut reply = Reply::new(&mut sink);
    for name in ["whisper-multi", "whisper-turbo"] {
        if !dir.join(name).join("encoder.onnx").is_file() {
            continue;
        }
        let models = SpeechModels {
            encoder: dir.join(name).join("encoder.onnx"),
            decoder: dir.join(name).join("decoder.onnx"),
            tokens: dir.join(name).join("tokens.txt"),
            vad: Some(dir.join("silero_vad.onnx")),
        };
        let hindi = std::fs::read(dir.join("hindi.wav")).expect("Hindi speech");
        let run =
            |engine: &mut Engine, reply: &mut Reply, options: serde_json::Value, audio: &[u8]| {
                let started = std::time::Instant::now();
                let result = speech::transcribe(
                    engine,
                    &models,
                    speech::Source::Bytes(audio, "speech.wav".into()),
                    &options,
                    reply,
                )
                .expect("transcription");
                eprintln!(
                    "{name} {options} in {:?}: {} [{}]",
                    started.elapsed(),
                    joined(&result),
                    result.header["language"]
                );
                result
            };
        // espeak-ng's robotic Hindi is often heard as another language, so detection is
        // only checked on real English below; with Hindi chosen both models write Devanagari.
        let turbo = name == "whisper-turbo";
        run(&mut engine, &mut reply, json!({}), &hindi);
        let chosen = run(&mut engine, &mut reply, json!({"language": "hi"}), &hindi);
        let text = joined(&chosen);
        assert_eq!(chosen.header["language"], "hi");
        assert!(
            text.chars().any(|c| ('\u{0900}'..='\u{097f}').contains(&c)),
            "Devanagari expected: {text}"
        );
        if turbo {
            assert!(text.contains("नमस्ते"), "{text}");
        } else {
            // Turbo was never trained to translate; the other multilingual models were.
            let translated = run(
                &mut engine,
                &mut reply,
                json!({"language": "hi", "task": "translate"}),
                &hindi,
            );
            assert_eq!(translated.header["language"], "en");
            assert!(joined(&translated).is_ascii(), "{}", joined(&translated));
        }
        let english = std::fs::read(dir.join("0.wav")).expect("test speech");
        let auto = run(
            &mut engine,
            &mut reply,
            json!({"language": "auto"}),
            &english,
        );
        assert_eq!(auto.header["language"], "en");
        assert!(
            joined(&auto).to_lowercase().contains("lamps"),
            "{}",
            joined(&auto)
        );
    }
    if dir.join("whisper/encoder.onnx").is_file() {
        let english_only = SpeechModels {
            encoder: dir.join("whisper/encoder.onnx"),
            decoder: dir.join("whisper/decoder.onnx"),
            tokens: dir.join("whisper/tokens.txt"),
            vad: None,
        };
        let error = speech::transcribe(
            &mut engine,
            &english_only,
            speech::Source::Path(dir.join("0.wav")),
            &json!({"language": "hi"}),
            &mut reply,
        )
        .expect_err("English-only models refuse Hindi");
        assert!(error.contains("English only"), "{error}");
    }
}

/// Sends `requests` through the worker loop exactly as the app would over the pipes.
fn round_trip(requests: &[super::protocol::Frame]) -> Vec<super::protocol::Frame> {
    let mut input = Vec::new();
    for request in requests {
        super::protocol::write_frame(&mut input, request).expect("encode request");
    }
    let mut output = Vec::new();
    super::worker::serve(&mut std::io::Cursor::new(input), &mut output);
    let mut reader = std::io::Cursor::new(output);
    let mut frames = Vec::new();
    while let Some(frame) = super::protocol::read_frame(&mut reader).expect("decode reply") {
        frames.push(frame);
    }
    frames
}

#[test]
fn worker_reports_a_missing_runtime_as_an_error_reply() {
    let frames = round_trip(&[super::protocol::Frame::new(json!({"op": "probe"}))]);
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0].header["type"], "error");
    assert!(frames[0].header["message"]
        .as_str()
        .unwrap_or_default()
        .contains("ONNX Runtime"));
}

#[test]
fn worker_answers_requests_over_the_pipe_protocol() {
    let Some(dir) = folder() else { return };
    let runtime = dir.join("libonnxruntime.so").to_string_lossy().into_owned();
    let photo = std::fs::read(dir.join("face.jpg")).expect("test photo");
    let probe = super::protocol::Frame::new(json!({"op": "probe", "runtime": runtime}));
    let mut job = super::protocol::Frame::new(json!({
        "op": "background",
        "runtime": runtime,
        "model": dir.join("u2netp.onnx").to_string_lossy(),
        "options": {"mode": "mask"},
    }));
    job.attachments.push(photo);
    let unknown = super::protocol::Frame::new(json!({"op": "nonsense", "runtime": runtime}));
    let frames = round_trip(&[probe, job, unknown]);
    let replies: Vec<_> = frames
        .iter()
        .filter(|frame| frame.header["type"] != "progress")
        .collect();
    assert_eq!(replies.len(), 3, "one reply per request");
    assert_eq!(replies[0].header["type"], "result");
    assert!(replies[0].header["device"]
        .as_str()
        .unwrap_or_default()
        .starts_with("Processor"));
    assert_eq!(replies[1].header["type"], "result");
    let mask = image_ops::decode(&replies[1].attachments[0]).expect("mask PNG");
    assert!(mask.width() > 0 && mask.height() > 0);
    assert_eq!(replies[2].header["type"], "error");
}

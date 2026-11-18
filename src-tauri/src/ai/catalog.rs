//! What the AI tools can download: the ONNX Runtime library for this platform and
//! the models.  Every file is pinned by size and SHA-256 and comes from the
//! upstream project's GitHub release where one exists; the project's own
//! release (`MIRROR`) is the fallback and the only source for files converted
//! for Benchtop.

use serde::Serialize;

/// Release on the Benchtop repository that mirrors every model file.
pub const MIRROR: &str =
    "https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Archive {
    None,
    TarGz,
    TarBz2,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    Zip,
}

/// One download, and which files to keep from it (archive member suffix → stored name).
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Download {
    pub file: &'static str,
    pub urls: &'static [&'static str],
    pub sha256: &'static str,
    pub size: u64,
    pub archive: Archive,
    pub keep: &'static [(&'static str, &'static str)],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Runtime,
    GpuRuntime,
    Background,
    Upscale,
    Faces,
    Eraser,
    Speech,
    Vad,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: &'static str,
    pub kind: Kind,
    pub name: &'static str,
    pub description: &'static str,
    pub licence: &'static str,
    pub homepage: &'static str,
    /// Selected when a tool needs a model of this kind and none is chosen.
    pub default: bool,
    /// Speech models only: understands languages other than English.
    pub multilingual: bool,
    pub download: Download,
}

const ORT: &str = "1.22.0";

macro_rules! urls {
    ($($part:expr),+) => { &[$($part),+] };
}

macro_rules! ort_url {
    ($file:literal) => {
        concat!(
            "https://github.com/microsoft/onnxruntime/releases/download/v1.22.0/",
            $file
        )
    };
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const RUNTIME: Download = Download {
    file: "onnxruntime-linux-x64-1.22.0.tgz",
    urls: &[ort_url!("onnxruntime-linux-x64-1.22.0.tgz")],
    sha256: "8344d55f93d5bc5021ce342db50f62079daf39aaafb5d311a451846228be49b3",
    size: 7_798_730,
    archive: Archive::TarGz,
    keep: &[("lib/libonnxruntime.so.1.22.0", "libonnxruntime.so")],
};

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
const RUNTIME: Download = Download {
    file: "onnxruntime-linux-aarch64-1.22.0.tgz",
    urls: &[ort_url!("onnxruntime-linux-aarch64-1.22.0.tgz")],
    sha256: "bb76395092d150b52c7092dc6b8f2fe4d80f0f3bf0416d2f269193e347e24702",
    size: 6_849_865,
    archive: Archive::TarGz,
    keep: &[("lib/libonnxruntime.so.1.22.0", "libonnxruntime.so")],
};

#[cfg(target_os = "windows")]
const RUNTIME: Download = Download {
    file: "onnxruntime-win-x64-1.22.0.zip",
    urls: &[ort_url!("onnxruntime-win-x64-1.22.0.zip")],
    sha256: "174c616efc0271194488642a72f1a514e01487da4dfe84c49296d66e40ebe0da",
    size: 72_368_545,
    archive: Archive::Zip,
    keep: &[
        ("lib/onnxruntime.dll", "onnxruntime.dll"),
        (
            "lib/onnxruntime_providers_shared.dll",
            "onnxruntime_providers_shared.dll",
        ),
    ],
};

#[cfg(target_os = "macos")]
const RUNTIME: Download = Download {
    file: "onnxruntime-osx-universal2-1.22.0.tgz",
    urls: &[ort_url!("onnxruntime-osx-universal2-1.22.0.tgz")],
    sha256: "cfa6f6584d87555ed9f6e7e8a000d3947554d589efe3723b8bfa358cd263d03c",
    size: 54_820_264,
    archive: Archive::TarGz,
    keep: &[("lib/libonnxruntime.1.22.0.dylib", "libonnxruntime.dylib")],
};

/// The library file name inside the runtime folder.
#[cfg(target_os = "windows")]
pub const RUNTIME_LIBRARY: &str = "onnxruntime.dll";
#[cfg(target_os = "macos")]
pub const RUNTIME_LIBRARY: &str = "libonnxruntime.dylib";
#[cfg(target_os = "linux")]
pub const RUNTIME_LIBRARY: &str = "libonnxruntime.so";

const RUNTIME_ITEM: Item = Item {
    id: "runtime",
    kind: Kind::Runtime,
    name: "ONNX Runtime",
    description:
        "The engine that runs every model, on the processor (and through Core ML on a Mac).",
    licence: "MIT",
    homepage: "https://onnxruntime.ai/",
    default: true,
    multilingual: false,
    download: RUNTIME,
};

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const GPU_ITEMS: &[Item] = &[Item {
    id: "runtime-cuda",
    kind: Kind::GpuRuntime,
    name: "ONNX Runtime for Nvidia GPUs",
    description: "Runs the image models on an Nvidia card. Needs the Nvidia driver, CUDA 12 and cuDNN 9 installed; without them the processor is used.",
    licence: "MIT",
    homepage: "https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html",
    default: false,
    multilingual: false,
    download: Download {
        file: "onnxruntime-linux-x64-gpu-1.22.0.tgz",
        urls: &[ort_url!("onnxruntime-linux-x64-gpu-1.22.0.tgz")],
        sha256: "2a19dbfa403672ec27378c3d40a68f793ac7a6327712cd0e8240a86be2b10c55",
        size: 227_317_516,
        archive: Archive::TarGz,
        keep: &[
            ("lib/libonnxruntime.so.1.22.0", "libonnxruntime.so"),
            ("lib/libonnxruntime_providers_shared.so", "libonnxruntime_providers_shared.so"),
            ("lib/libonnxruntime_providers_cuda.so", "libonnxruntime_providers_cuda.so"),
        ],
    },
}];

/// DirectML runs on any DirectX 12 GPU (AMD, Intel or Nvidia).  Microsoft publishes the
/// DirectML build of ONNX Runtime as a Python wheel, which is a zip archive holding the
/// same DLLs as the NuGet package.
#[cfg(target_os = "windows")]
const GPU_ITEMS: &[Item] = &[Item {
    id: "runtime-directml",
    kind: Kind::GpuRuntime,
    name: "ONNX Runtime for DirectX 12 GPUs",
    description: "Runs the image models on any DirectX 12 graphics card (AMD, Intel or Nvidia) through DirectML. Nothing else to install; without a suitable card the processor is used.",
    licence: "MIT",
    homepage: "https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html",
    default: false,
    multilingual: false,
    download: Download {
        file: "onnxruntime_directml-1.22.0-cp312-cp312-win_amd64.whl",
        urls: urls!(
            "https://files.pythonhosted.org/packages/0a/64/6d942153e202ac0033629f64c7aa8a647b8401f3cb9114cdc44004bed331/onnxruntime_directml-1.22.0-cp312-cp312-win_amd64.whl",
            concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "onnxruntime_directml-1.22.0-cp312-cp312-win_amd64.whl")
        ),
        sha256: "f8fc1a48b7fb134e34f8f138719a27d1bf6895611728b593fd86bc7c05b848a1",
        size: 24_435_369,
        archive: Archive::Zip,
        keep: &[
            ("onnxruntime/capi/onnxruntime.dll", "onnxruntime.dll"),
            ("onnxruntime/capi/onnxruntime_providers_shared.dll", "onnxruntime_providers_shared.dll"),
            ("onnxruntime/capi/DirectML.dll", "DirectML.dll"),
        ],
    },
}];

#[cfg(not(any(
    all(target_os = "linux", target_arch = "x86_64"),
    target_os = "windows"
)))]
const GPU_ITEMS: &[Item] = &[];

const MODELS: &[Item] = &[
    Item {
        id: "isnet-general",
        kind: Kind::Background,
        name: "IS-Net (general use)",
        description: "Background removal for any subject: about a second per photo on most processors.",
        licence: "Apache-2.0",
        homepage: "https://github.com/xuebinqin/DIS",
        default: true,
        multilingual: false,
        download: Download {
            file: "isnet-general-use.onnx",
            urls: urls!(concat!("https://github.com/danielgatis/rembg/releases/download/v0.0.0/", "isnet-general-use.onnx"), concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "isnet-general-use.onnx")),
            sha256: "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a",
            size: 178_648_008,
            archive: Archive::None,
            keep: &[],
        },
    },
    Item {
        id: "u2netp",
        kind: Kind::Background,
        name: "U²-Net small",
        description: "Fast, rough background removal for slow computers and quick previews.",
        licence: "Apache-2.0",
        homepage: "https://github.com/xuebinqin/U-2-Net",
        default: false,
        multilingual: false,
        download: Download {
            file: "u2netp.onnx",
            urls: urls!(concat!("https://github.com/danielgatis/rembg/releases/download/v0.0.0/", "u2netp.onnx"), concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "u2netp.onnx")),
            sha256: "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8",
            size: 4_574_861,
            archive: Archive::None,
            keep: &[],
        },
    },
    Item {
        id: "birefnet-lite",
        kind: Kind::Background,
        name: "BiRefNet lite",
        description: "Finest edges (hair, fur, wire). Needs about 8 GB of free memory or a GPU.",
        licence: "MIT",
        homepage: "https://github.com/ZhengPeng7/BiRefNet",
        default: false,
        multilingual: false,
        download: Download {
            file: "birefnet-lite.onnx",
            urls: urls!(concat!("https://github.com/danielgatis/rembg/releases/download/v0.0.0/", "BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx"), concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "birefnet-lite.onnx")),
            sha256: "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333",
            size: 224_005_088,
            archive: Archive::None,
            keep: &[],
        },
    },
    Item {
        id: "realesr-general-x4v3",
        kind: Kind::Upscale,
        name: "Real-ESRGAN general (fast)",
        description: "Upscales photos 2× or 4×, about ten times faster than the full model. Converted from the official weights for Benchtop.",
        licence: "BSD-3-Clause",
        homepage: "https://github.com/xinntao/Real-ESRGAN",
        default: true,
        multilingual: false,
        download: Download {
            file: "realesr-general-x4v3.onnx",
            urls: urls!(concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "realesr-general-x4v3.onnx")),
            sha256: "c272c284a06fb4b0cde9d7de81f7d514bf9cbdc9fa63553e6b65fdd971e33a4e",
            size: 4_863_093,
            archive: Archive::None,
            keep: &[],
        },
    },
    Item {
        id: "realesrgan-x4plus",
        kind: Kind::Upscale,
        name: "Real-ESRGAN x4plus",
        description: "The full 4× model: sharper detail, but a minute or more per photo without a GPU.",
        licence: "BSD-3-Clause",
        homepage: "https://github.com/xinntao/Real-ESRGAN",
        default: false,
        multilingual: false,
        download: Download {
            file: "real_esrgan_x4.onnx",
            urls: urls!(concat!("https://github.com/facefusion/facefusion-assets/releases/download/", "models-3.0.0/real_esrgan_x4.onnx"), concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "real_esrgan_x4.onnx")),
            sha256: "afa7fa42eed0315a3d7b2a54e79e4e44a672d3c0889c2828c4f84c9ab91edb0b",
            size: 69_539_503,
            archive: Archive::None,
            keep: &[],
        },
    },
    Item {
        id: "realesrgan-x2plus",
        kind: Kind::Upscale,
        name: "Real-ESRGAN x2plus",
        description: "The full 2× model, for gentle enlargement with sharper detail.",
        licence: "BSD-3-Clause",
        homepage: "https://github.com/xinntao/Real-ESRGAN",
        default: false,
        multilingual: false,
        download: Download {
            file: "real_esrgan_x2.onnx",
            urls: urls!(concat!("https://github.com/facefusion/facefusion-assets/releases/download/", "models-3.0.0/real_esrgan_x2.onnx"), concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "real_esrgan_x2.onnx")),
            sha256: "5be2d62ab3b0357986efb20a19638334c0e7a2a055ccbc52c77063da0482b3bb",
            size: 69_552_244,
            archive: Archive::None,
            keep: &[],
        },
    },
    Item {
        id: "yunet",
        kind: Kind::Faces,
        name: "YuNet face detector",
        description: "Finds faces for blurring; a fraction of a second per photo.",
        licence: "MIT",
        homepage: "https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet",
        default: true,
        multilingual: false,
        download: Download {
            file: "yunet_2023_mar.onnx",
            urls: urls!(concat!("https://github.com/facefusion/facefusion-assets/releases/download/", "models-3.4.0/yunet_2023_mar.onnx"), concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "yunet_2023_mar.onnx")),
            sha256: "490d79bc15c0e958d91c999c566c6a338b310ead96e0274dd004e59dd6abecb9",
            size: 232_475,
            archive: Archive::None,
            keep: &[],
        },
    },
    Item {
        id: "migan",
        kind: Kind::Eraser,
        name: "MI-GAN eraser",
        description: "Fills in what you paint over; under a second on most processors.",
        licence: "MIT",
        homepage: "https://github.com/Picsart-AI-Research/MI-GAN",
        default: true,
        multilingual: false,
        download: Download {
            file: "migan_pipeline_v2.onnx",
            urls: urls!(
                "https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx",
                concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "migan_pipeline_v2.onnx")
            ),
            sha256: "6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b",
            size: 28_079_181,
            archive: Archive::None,
            keep: &[],
        },
    },
    Item {
        id: "whisper-base-en",
        kind: Kind::Speech,
        name: "Whisper base (English)",
        description: "Transcribes English speech several times faster than real time on most processors.",
        licence: "MIT",
        homepage: "https://github.com/openai/whisper",
        default: true,
        multilingual: false,
        download: Download {
            file: "sherpa-onnx-whisper-base.en.tar.bz2",
            urls: urls!(concat!("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/", "sherpa-onnx-whisper-base.en.tar.bz2"), concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "sherpa-onnx-whisper-base.en.tar.bz2")),
            sha256: "475bc7052ce299c007f6d5d5407ba8601f819a2867f6eecee510ed17df581542",
            size: 208_576_005,
            archive: Archive::TarBz2,
            keep: &[
                ("base.en-encoder.int8.onnx", "encoder.onnx"),
                ("base.en-decoder.int8.onnx", "decoder.onnx"),
                ("base.en-tokens.txt", "tokens.txt"),
            ],
        },
    },
    Item {
        id: "whisper-tiny-en",
        kind: Kind::Speech,
        name: "Whisper tiny (English)",
        description: "The quickest English model, for slow computers; less accurate.",
        licence: "MIT",
        homepage: "https://github.com/openai/whisper",
        default: false,
        multilingual: false,
        download: Download {
            file: "sherpa-onnx-whisper-tiny.en.tar.bz2",
            urls: urls!(concat!("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/", "sherpa-onnx-whisper-tiny.en.tar.bz2"), concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "sherpa-onnx-whisper-tiny.en.tar.bz2")),
            sha256: "2bd6cf965c8bb3e068ef9fa2191387ee63a9dfa2a4e37582a8109641c20005dd",
            size: 118_071_777,
            archive: Archive::TarBz2,
            keep: &[
                ("tiny.en-encoder.int8.onnx", "encoder.onnx"),
                ("tiny.en-decoder.int8.onnx", "decoder.onnx"),
                ("tiny.en-tokens.txt", "tokens.txt"),
            ],
        },
    },
    Item {
        id: "whisper-small-en",
        kind: Kind::Speech,
        name: "Whisper small (English)",
        description: "More accurate on noisy recordings and accents; two to three times slower than base.",
        licence: "MIT",
        homepage: "https://github.com/openai/whisper",
        default: false,
        multilingual: false,
        download: Download {
            file: "sherpa-onnx-whisper-small.en.tar.bz2",
            urls: urls!(concat!("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/", "sherpa-onnx-whisper-small.en.tar.bz2"), concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "sherpa-onnx-whisper-small.en.tar.bz2")),
            sha256: "0cdba2b8aaab69e04847f3427cc9709574112e67913a1a84b7fec3a8729faa9a",
            size: 635_693_775,
            archive: Archive::TarBz2,
            keep: &[
                ("small.en-encoder.int8.onnx", "encoder.onnx"),
                ("small.en-decoder.int8.onnx", "decoder.onnx"),
                ("small.en-tokens.txt", "tokens.txt"),
            ],
        },
    },
    Item {
        id: "whisper-base",
        kind: Kind::Speech,
        name: "Whisper base (99 languages)",
        description: "Hindi, English and 97 more languages, with language detection and translation into English. Quick, but rough on Hindi.",
        licence: "MIT",
        homepage: "https://github.com/openai/whisper",
        default: false,
        multilingual: true,
        download: Download {
            file: "sherpa-onnx-whisper-base.tar.bz2",
            urls: urls!(concat!("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/", "sherpa-onnx-whisper-base.tar.bz2"), concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "sherpa-onnx-whisper-base.tar.bz2")),
            sha256: "911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de",
            size: 207_557_382,
            archive: Archive::TarBz2,
            keep: &[
                ("base-encoder.int8.onnx", "encoder.onnx"),
                ("base-decoder.int8.onnx", "decoder.onnx"),
                ("base-tokens.txt", "tokens.txt"),
            ],
        },
    },
    Item {
        id: "whisper-small",
        kind: Kind::Speech,
        name: "Whisper small (99 languages)",
        description: "Clearly better than base for Hindi and other languages; about three times slower.",
        licence: "MIT",
        homepage: "https://github.com/openai/whisper",
        default: false,
        multilingual: true,
        download: Download {
            file: "sherpa-onnx-whisper-small.tar.bz2",
            urls: urls!(concat!("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/", "sherpa-onnx-whisper-small.tar.bz2"), concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "sherpa-onnx-whisper-small.tar.bz2")),
            sha256: "486a46afbb7ba798507190ffe02fea2dd726049af212e774537efac6afb210a6",
            size: 639_387_718,
            archive: Archive::TarBz2,
            keep: &[
                ("small-encoder.int8.onnx", "encoder.onnx"),
                ("small-decoder.int8.onnx", "decoder.onnx"),
                ("small-tokens.txt", "tokens.txt"),
            ],
        },
    },
    Item {
        id: "whisper-turbo",
        kind: Kind::Speech,
        name: "Whisper large-v3 turbo (99 languages)",
        description: "The most accurate model, recommended for Hindi. Needs about 3 GB of free memory and is slow without a GPU; it transcribes but cannot translate.",
        licence: "MIT",
        homepage: "https://github.com/openai/whisper",
        default: false,
        multilingual: true,
        download: Download {
            file: "sherpa-onnx-whisper-turbo.tar.bz2",
            urls: urls!(concat!("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/", "sherpa-onnx-whisper-turbo.tar.bz2"), concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "sherpa-onnx-whisper-turbo.tar.bz2")),
            sha256: "b11acbbcd660b44a8e0df33724feb5aaa709cf65668f2823d59f656312544f22",
            size: 563_790_207,
            archive: Archive::TarBz2,
            keep: &[
                ("turbo-encoder.int8.onnx", "encoder.onnx"),
                ("turbo-decoder.int8.onnx", "decoder.onnx"),
                ("turbo-tokens.txt", "tokens.txt"),
            ],
        },
    },
    Item {
        id: "silero-vad",
        kind: Kind::Vad,
        name: "Silero voice activity detector",
        description: "Splits recordings at pauses and skips silence before transcription.",
        licence: "MIT",
        homepage: "https://github.com/snakers4/silero-vad",
        default: true,
        multilingual: false,
        download: Download {
            file: "silero_vad.onnx",
            urls: urls!(concat!("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/", "silero_vad.onnx"), concat!("https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/", "silero_vad.onnx")),
            sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
            size: 643_854,
            archive: Archive::None,
            keep: &[],
        },
    },
];

/// Every item for this platform: the runtime first, then GPU runtimes, then models.
pub fn items() -> Vec<Item> {
    let mut all = vec![RUNTIME_ITEM];
    all.extend_from_slice(GPU_ITEMS);
    all.extend_from_slice(MODELS);
    all
}

pub fn find(id: &str) -> Option<Item> {
    items().into_iter().find(|item| item.id == id)
}

/// Files an installed item leaves in the store, relative to its folder.
pub fn stored_files(item: &Item) -> Vec<&'static str> {
    if item.download.keep.is_empty() {
        vec![item.download.file]
    } else {
        item.download
            .keep
            .iter()
            .map(|(_, stored)| *stored)
            .collect()
    }
}

pub const ORT_VERSION: &str = ORT;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_hashes_are_sha256() {
        let all = items();
        let mut ids: Vec<_> = all.iter().map(|item| item.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), all.len());
        for item in &all {
            assert_eq!(item.download.sha256.len(), 64, "{}", item.id);
            assert!(item.download.sha256.chars().all(|c| c.is_ascii_hexdigit()));
            assert!(!item.download.urls.is_empty());
            assert!(item
                .download
                .urls
                .iter()
                .all(|url| url.starts_with("https://")));
        }
    }

    #[test]
    fn every_kind_a_tool_needs_has_one_default() {
        for kind in [
            Kind::Runtime,
            Kind::Background,
            Kind::Upscale,
            Kind::Faces,
            Kind::Eraser,
            Kind::Speech,
            Kind::Vad,
        ] {
            let defaults = items()
                .into_iter()
                .filter(|item| item.kind == kind && item.default)
                .count();
            assert_eq!(defaults, 1, "{kind:?}");
        }
    }
}

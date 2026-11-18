#!/usr/bin/env bash
# Copies the AI model files to this repository's "models-v1" release, which the
# app uses when a publisher's download is unavailable (and as the only source of
# realesr-general-x4v3.onnx, converted locally by scripts/convert_srvgg.py).
#
# Every file is checked against the SHA-256 compiled into the app
# (src-tauri/src/ai/catalog.rs) before it is uploaded.
#
# Needs curl, sha256sum and the GitHub CLI, logged in with write access:
#   gh auth login
#   scripts/mirror-models.sh /path/to/realesr-general-x4v3.onnx
#
# Set REPO to mirror into a fork.
set -euo pipefail

REPO="${REPO:-asrivastava-curatorial-ws/benchtop}"
TAG="models-v1"
CONVERTED="${1:-}"

# name on the mirror | publisher URL | SHA-256
FILES=(
  "isnet-general-use.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx|60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a"
  "u2netp.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx|309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8"
  "birefnet-lite.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx|5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333"
  "real_esrgan_x4.onnx|https://github.com/facefusion/facefusion-assets/releases/download/models-3.0.0/real_esrgan_x4.onnx|afa7fa42eed0315a3d7b2a54e79e4e44a672d3c0889c2828c4f84c9ab91edb0b"
  "real_esrgan_x2.onnx|https://github.com/facefusion/facefusion-assets/releases/download/models-3.0.0/real_esrgan_x2.onnx|5be2d62ab3b0357986efb20a19638334c0e7a2a055ccbc52c77063da0482b3bb"
  "yunet_2023_mar.onnx|https://github.com/facefusion/facefusion-assets/releases/download/models-3.4.0/yunet_2023_mar.onnx|490d79bc15c0e958d91c999c566c6a338b310ead96e0274dd004e59dd6abecb9"
  "migan_pipeline_v2.onnx|https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx|6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b"
  "sherpa-onnx-whisper-base.en.tar.bz2|https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.en.tar.bz2|475bc7052ce299c007f6d5d5407ba8601f819a2867f6eecee510ed17df581542"
  "sherpa-onnx-whisper-tiny.en.tar.bz2|https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.en.tar.bz2|2bd6cf965c8bb3e068ef9fa2191387ee63a9dfa2a4e37582a8109641c20005dd"
  "sherpa-onnx-whisper-small.en.tar.bz2|https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.en.tar.bz2|0cdba2b8aaab69e04847f3427cc9709574112e67913a1a84b7fec3a8729faa9a"
  "silero_vad.onnx|https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx|9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"
)
CONVERTED_SHA="c272c284a06fb4b0cde9d7de81f7d514bf9cbdc9fa63553e6b65fdd971e33a4e"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  # --latest=false: the app's own newest release keeps the "Latest" label.
  gh release create "$TAG" --repo "$REPO" --title "AI models (mirror)" --latest=false \
    --notes "Copies of the AI model files Benchtop downloads on first use, for when a publisher's download is unavailable. Each file keeps its original licence (see Settings → AI models in the app). The app checks every file against a fixed SHA-256 before using it."
fi

upload() {
  local file="$1" sha="$2"
  local got
  got="$(sha256sum "$file" | cut -d' ' -f1)"
  if [ "$got" != "$sha" ]; then
    echo "Checksum mismatch for $(basename "$file"): $got" >&2
    exit 1
  fi
  gh release upload "$TAG" "$file" --repo "$REPO" --clobber
  echo "uploaded $(basename "$file")"
}

for entry in "${FILES[@]}"; do
  IFS='|' read -r name url sha <<<"$entry"
  curl -fL --retry 3 -o "$work/$name" "$url"
  upload "$work/$name" "$sha"
  rm -f "$work/$name"
done

if [ -n "$CONVERTED" ]; then
  cp "$CONVERTED" "$work/realesr-general-x4v3.onnx"
  upload "$work/realesr-general-x4v3.onnx" "$CONVERTED_SHA"
else
  echo "Skipped realesr-general-x4v3.onnx: pass its path (made with scripts/convert_srvgg.py) to upload it." >&2
fi

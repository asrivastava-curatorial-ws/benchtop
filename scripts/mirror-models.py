#!/usr/bin/env python3
"""Copy every AI download (ONNX Runtime and the models) to this repository's
"models-v1" release, which the app tries when a publisher's copy is unreachable.

The list comes from src-tauri/src/ai/catalog.rs, so it always matches the app:
every platform's ONNX Runtime, the GPU runtimes and every model. Each file is
checked against the SHA-256 compiled into the app before it is uploaded, and
files already on the release are skipped, so the script can be run again after
an interruption or when the catalogue gains a file.

realesr-general-x4v3.onnx is converted for Benchtop (scripts/convert_srvgg.py)
and has no publisher download; pass its path to upload it.

Needs curl and the GitHub CLI, logged in with write access to the repository:
    gh auth login
    python3 scripts/mirror-models.py /path/to/realesr-general-x4v3.onnx

Set REPO=owner/name to mirror into a fork. Use --list to print the files only.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "src-tauri" / "src" / "ai" / "catalog.rs"
REPO = os.environ.get("REPO", "asrivastava-curatorial-ws/benchtop")
TAG = "models-v1"
MIRROR = "https://github.com/asrivastava-curatorial-ws/benchtop/releases/download/models-v1/"
CONVERTED = "realesr-general-x4v3.onnx"


def catalogue():
    """(file name, publisher URL or None, sha256, size) for every download in the catalogue."""
    text = CATALOG.read_text(encoding="utf-8")
    found = {}
    for match in re.finditer(r'file:\s*"([^"]+)",(.*?)sha256:\s*"([0-9a-f]{64})",\s*size:\s*([\d_]+)', text, re.S):
        name, urls, sha, size = match.group(1), match.group(2), match.group(3), int(match.group(4).replace("_", ""))
        candidates = [a + b for a, b in re.findall(r'concat!\(\s*"([^"]+)",\s*"([^"]+)"\s*\)', urls)]
        candidates += re.findall(r'(?<!concat!\()\s"(https://[^"]+)"', urls)
        publisher = next((u for u in candidates if not u.startswith(MIRROR)), None)
        found[name] = (name, publisher, sha, size)
    return list(found.values())


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def gh(*args, capture=False):
    return subprocess.run(["gh", *args], check=True, text=True, capture_output=capture)


def main():
    files = catalogue()
    if "--list" in sys.argv:
        for name, url, sha, size in files:
            print(f"{name}\t{size}\t{sha}\t{url or '(converted; pass its path)'}")
        return
    converted = next((a for a in sys.argv[1:] if not a.startswith("--")), None)

    if subprocess.run(["gh", "release", "view", TAG, "--repo", REPO], capture_output=True).returncode != 0:
        # --latest=false: the app's newest release keeps the "Latest" label.
        gh("release", "create", TAG, "--repo", REPO, "--title", "AI models (mirror)", "--latest=false", "--notes",
           "Copies of the files Benchtop downloads on first use (ONNX Runtime and the AI models), for when a "
           "publisher's download is unavailable. Each file keeps its original licence (see Settings → AI models "
           "in the app). The app checks every file against a fixed SHA-256 before using it.")
    assets = json.loads(gh("release", "view", TAG, "--repo", REPO, "--json", "assets", capture=True).stdout)["assets"]
    present = {a["name"]: a["size"] for a in assets}

    failed = []
    with tempfile.TemporaryDirectory() as work:
        for name, url, sha, size in files:
            if present.get(name) == size:
                print(f"already there  {name}")
                continue
            target = Path(work) / name
            if url is None:
                if not converted:
                    print(f"skipped        {name}: pass its path (made with scripts/convert_srvgg.py)", file=sys.stderr)
                    failed.append(name)
                    continue
                target.write_bytes(Path(converted).read_bytes())
            else:
                print(f"downloading    {name} ({size / 1e6:.1f} MB)")
                if subprocess.run(["curl", "-fL", "--retry", "3", "-o", str(target), url]).returncode != 0:
                    # One publisher taking a file down must not stop the others from being mirrored.
                    print(f"NOT AVAILABLE  {name}: {url}", file=sys.stderr)
                    failed.append(name)
                    target.unlink(missing_ok=True)
                    continue
            got = sha256(target)
            if got != sha:
                print(f"CHECKSUM MISMATCH {name}: {got}", file=sys.stderr)
                failed.append(name)
            else:
                gh("release", "upload", TAG, str(target), "--repo", REPO, "--clobber")
                print(f"uploaded       {name}")
            target.unlink(missing_ok=True)
    if failed:
        sys.exit(f"Not uploaded: {', '.join(failed)}")


if __name__ == "__main__":
    main()

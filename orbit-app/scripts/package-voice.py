"""Assemble the offline arm64 synthesizer from immutable release archives into a fresh bundle."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

RUNTIME = "sherpa-onnx-v1.12.35-osx-arm64-shared"
EN = "vits-piper-en_US-libritts_r-medium-int8"
DE = "vits-piper-de_DE-thorsten-medium-int8"
ARCHIVES = {
    RUNTIME: ("v1.12.35", "03713def1df1a47a42e81259d20c6d375ae78a48e351724ca2dd70c16f57f10d"),
    DE: ("tts-models", "07e240b7b9c1fc9211d5a69512f8cbe11b3286c2ed79c15c076ac6ed427fdf13"),
    EN: ("tts-models", "7e4552e239988f4896872822b56e99e0e9e00958164e3f6bdf5ee14391fbe829"),
}
native = Path(__file__).resolve().parents[1] / "native"
target = Path(sys.argv[1]).resolve()
target.mkdir(parents=True)
cache = Path.home() / "Library/Caches/Orbit/voice-build"
cache.mkdir(parents=True, exist_ok=True)

with tempfile.TemporaryDirectory() as scratch:
    stage = Path(scratch)
    for name, (release, digest) in ARCHIVES.items():
        filename = name + ".tar.bz2"
        source = cache / filename
        if not source.exists():
            url = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/{release}/{filename}"
            with tempfile.NamedTemporaryFile(dir=cache, delete=False) as download:
                temporary = Path(download.name)
            try:
                urllib.request.urlretrieve(url, temporary)
                if hashlib.file_digest(temporary.open("rb"), "sha256").hexdigest() != digest:
                    raise ValueError(f"Checksum mismatch for {filename}")
                os.replace(temporary, source)
            finally:
                temporary.unlink(missing_ok=True)
        with source.open("rb") as archive:
            if hashlib.file_digest(archive, "sha256").hexdigest() != digest:
                raise ValueError(f"Checksum mismatch for cached {filename}")
            archive.seek(0)
            with tarfile.open(fileobj=archive) as contents:
                contents.extractall(stage, filter="data")

    for language, name in (("de", DE), ("en", EN)):
        voice = target / language
        voice.mkdir()
        shutil.copy2(next((stage / name).glob("*.onnx")), voice / "model.onnx")
        for filename in ("tokens.txt", "MODEL_CARD"):
            shutil.copy2(stage / name / filename, voice)
    shutil.copytree(stage / DE / "espeak-ng-data", target / "espeak-ng-data")
    for filename in ("libsherpa-onnx-c-api.dylib", "libonnxruntime.1.23.2.dylib"):
        shutil.copy2(stage / RUNTIME / "lib" / filename, target)
    shutil.copytree(native / "voice-licenses", target / "licenses")
    subprocess.run(["xcrun", "clang", "-arch", "arm64", "-mmacosx-version-min=13.0", "-O2",
                    "-fobjc-arc", "-framework", "NaturalLanguage", "-framework", "Foundation",
                    "-I", str(stage / RUNTIME / "include"), str(native / "VoiceMemo.m"),
                    "-L", str(target), "-lsherpa-onnx-c-api", "-Wl,-rpath,@executable_path",
                    "-o", str(target / "voice-memo")], check=True)

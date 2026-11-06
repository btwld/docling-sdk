"""Record reproducible identities without printing environment variables.

Run with the isolated venv Python. Package inventory records exact versions and
installed RECORD digests, and verifies the official pinned Docling wheel bytes
against PyPI SHA256 plus installed package files against that wheel's RECORD.
Model identities are in model-manifest.json (upstream and local digests).
"""
import base64
import csv
import hashlib
from importlib import metadata
from io import StringIO
import json
from pathlib import Path
import platform
import subprocess
import sys
import urllib.request
import zipfile


def main():
    runtime = Path(sys.prefix).resolve().parent
    packages = []
    for dist in sorted(metadata.distributions(), key=lambda d: d.metadata["Name"].lower()):
        record = dist.read_text("RECORD")
        packages.append({"name": dist.metadata["Name"], "version": dist.version, "installed_record_sha256": hashlib.sha256(record.encode()).hexdigest() if record else None})
    (runtime / "installed-packages.json").write_text(json.dumps(packages, indent=2) + "\n")
    freeze = subprocess.run([sys.executable, "-m", "pip", "freeze", "--all"], capture_output=True, text=True, check=True)
    (runtime / "requirements-exact.txt").write_text(freeze.stdout)
    with urllib.request.urlopen("https://pypi.org/pypi/docling/2.60.1/json", timeout=20) as response:
        release = json.load(response)
    wheel = next(item for item in release["urls"] if item["filename"].endswith(".whl"))
    with urllib.request.urlopen(wheel["url"], timeout=20) as response:
        data = response.read(2_000_000)
    digest = hashlib.sha256(data).hexdigest()
    if digest != wheel["digests"]["sha256"] or len(data) != wheel["size"]:
        raise ValueError("Official Docling wheel identity mismatch")
    wheel_path = runtime / "wheels" / wheel["filename"]
    wheel_path.parent.mkdir(exist_ok=True)
    wheel_path.write_bytes(data)
    installed = metadata.distribution("docling")
    verified_files = 0
    with zipfile.ZipFile(wheel_path) as archive:
        record_path = next(name for name in archive.namelist() if name.endswith(".dist-info/RECORD"))
        for name, encoded_hash, size in csv.reader(StringIO(archive.read(record_path).decode())):
            if not name.startswith("docling/") or not encoded_hash:
                continue
            algorithm, expected = encoded_hash.split("=", 1)
            if algorithm != "sha256":
                raise ValueError("Unexpected wheel digest algorithm")
            actual = hashlib.sha256(Path(installed.locate_file(name)).read_bytes()).digest()
            if base64.urlsafe_b64encode(actual).rstrip(b"=").decode() != expected:
                raise ValueError("Installed package differs from official wheel: " + name)
            verified_files += 1
    identity = {"python": platform.python_version(), "python_binary_sha256": hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest(), "platform": platform.platform(), "docling": metadata.version("docling"), "docling_core": metadata.version("docling-core"), "docling_ibm_models": metadata.version("docling-ibm-models"), "docling_parse": metadata.version("docling-parse"), "torch": metadata.version("torch"), "torchvision": metadata.version("torchvision"), "rapidocr": metadata.version("rapidocr"), "onnxruntime": metadata.version("onnxruntime"), "official_docling_wheel": {"url": wheel["url"], "sha256": digest, "size": len(data), "installed_files_verified": verified_files}, "package_inventory_sha256": hashlib.sha256((runtime / "installed-packages.json").read_bytes()).hexdigest(), "model_manifest_sha256": hashlib.sha256((runtime / "model-manifest.json").read_bytes()).hexdigest()}
    (runtime / "runtime-identity.json").write_text(json.dumps(identity, indent=2) + "\n")
    print(json.dumps(identity, indent=2))


if __name__ == "__main__":
    main()

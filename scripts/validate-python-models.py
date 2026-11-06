"""Download a bounded pinned model subset from official upstream hosting.

Use system Python; assets remain in the ignored runtime. Max 420 MB transferred.
HF commit identities and LFS/Git digests are verified before publishing each file.
RapidOCR URLs come from Docling 2.60.1's upstream defaults; observed SHA256 pins
are checked (these were locally recorded, not upstream-published checksums).
No installers, executable assets, authentication, or global model environment.
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

LAYOUT = ("ds4sd/docling-layout-heron", "8f39ad3c0b4c58e9c2d2c84a38465abf757272d8", ["config.json", "preprocessor_config.json", "model.safetensors", "README.md"])
TABLE = ("ds4sd/docling-models", "fc0f2d45e2218ea24bce5045f58a389aed16dc23", ["model_artifacts/tableformer/accurate/tm_config.json", "model_artifacts/tableformer/accurate/tableformer_accurate.safetensors", "README.md", "LICENSE"])
MAX_BYTES = 420_000_000
RAPID_DIGESTS = {
    "ch_PP-OCRv4_det_infer.onnx": "d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9",
    "ch_ppocr_mobile_v2.0_cls_infer.onnx": "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c",
    "ch_PP-OCRv4_rec_infer.onnx": "48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b",
    "ppocr_keys_v1.txt": "28b2362ad4ab2dc38769aa72feb535e3a9ddb3fd2a7585a05920e6393b1dc7f7",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, default=Path(".context/release-hardening-2026-11-06/python-runtime"))
    parser.add_argument("--rapidocr", action="store_true")
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    target = runtime / "models/docling"
    target.mkdir(parents=True, exist_ok=True)
    records = []
    transferred = 0

    def fetch(url, path, size=None, sha256=None, blob=None):
        nonlocal transferred
        if path.exists():
            data = path.read_bytes()
        else:
            data = bytearray()
            with urllib.request.urlopen(url, timeout=30) as response:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    data.extend(chunk)
                    transferred += len(chunk)
                    if transferred > MAX_BYTES:
                        raise ValueError("Bounded model download budget exceeded")
        digest = hashlib.sha256(data).hexdigest()
        if size is not None and len(data) != size:
            raise ValueError("Model size mismatch: " + path.name)
        if sha256 and digest != sha256:
            raise ValueError("LFS SHA256 mismatch: " + path.name)
        if blob and not sha256:
            git_digest = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
            if git_digest != blob:
                raise ValueError("Git blob digest mismatch: " + path.name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        record = {"source": url, "path": str(path.relative_to(runtime)), "size": len(data), "sha256": digest, "pinned_sha256_verified": bool(sha256), "upstream_git_blob_verified": bool(blob and not sha256)}
        records.append(record)
        (runtime / "model-manifest.json").write_text(json.dumps(records, indent=2) + "\n")
        print(json.dumps(record), flush=True)

    for repo, commit, names in [LAYOUT, TABLE]:
        metadata_url = "https://huggingface.co/api/models/" + repo + "/revision/" + commit + "?blobs=true"
        with urllib.request.urlopen(metadata_url, timeout=20) as response:
            metadata = json.load(response)
        if metadata["sha"] != commit:
            raise ValueError("Upstream model identity mismatch")
        (runtime / (repo.replace("/", "--") + "-pinned.json")).write_text(json.dumps(metadata, indent=2))
        files = {item["rfilename"]: item for item in metadata["siblings"]}
        for name in names:
            if name not in files:
                print("License/readme not in pinned upstream repository: " + repo + "/" + name, flush=True)
                continue
            item = files[name]
            fetch("https://huggingface.co/" + repo + "/resolve/" + commit + "/" + name, target / repo.replace("/", "--") / name, item.get("size"), item.get("lfs", {}).get("sha256"), item.get("blobId"))

    if args.rapidocr:
        for model in ["onnx/PP-OCRv4/det/ch_PP-OCRv4_det_infer.onnx", "onnx/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_infer.onnx", "onnx/PP-OCRv4/rec/ch_PP-OCRv4_rec_infer.onnx", "paddle/PP-OCRv4/rec/ch_PP-OCRv4_rec_infer/ppocr_keys_v1.txt"]:
            version = "v2.0.7" if model.endswith(".txt") else "v3.4.0"
            fetch("https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/" + version + "/" + model, target / "RapidOcr" / model, sha256=RAPID_DIGESTS[Path(model).name])


if __name__ == "__main__":
    main()

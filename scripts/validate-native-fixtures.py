#!/usr/bin/env python3
"""Create deterministic synthetic fixtures, or check the native JSON contract.

Requires tests/fixtures/native-validation/requirements.txt. Reuses validate-python-fixtures.py rather
than implementing document writers/parsers. No converter is invoked here.
"""
import argparse
import contextlib
import hashlib
import importlib.util
from importlib.metadata import version
from io import BytesIO, StringIO
import json
from pathlib import Path
import sys
import tempfile
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
SUPPORT = ROOT / "tests/fixtures/native-validation"


def require(condition, label):
    if not condition:
        raise ValueError(label)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def dependencies():
    pins = {}
    for line in (SUPPORT / "requirements.txt").read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        name, expected = line.split("==")
        actual = version(name)
        require(actual == expected, "validation dependency pin mismatch: " + name)
        pins[name] = actual
    return pins


def canonical_office(path):
    # python-docx/python-pptx set ZIP member timestamps to the current wall clock.
    # Repack using stdlib ZIP handling with fixed metadata and a stable ordering.
    with zipfile.ZipFile(path) as source:
        members = [(name, source.read(name)) for name in sorted(source.namelist())]
    output = BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
        for name, data in members:
            entry = zipfile.ZipInfo(name, date_time=(2000, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.create_system = 3
            entry.external_attr = 0o100600 << 16
            target.writestr(entry, data, compresslevel=9)
    path.write_bytes(output.getvalue())


def generate(destination, font_path):
    from PIL import Image, ImageDraw, ImageFont
    from docx import Document
    from pptx import Presentation
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    pins = dependencies()
    require(font_path.is_file(), "an explicit reviewed font is required")
    require(not destination.exists(), "fixture destination must be fresh")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Keep all original minimal fixtures; replace only the host-font-dependent scan.
    spec = importlib.util.spec_from_file_location("original_fixtures", ROOT / "scripts/validate-python-fixtures.py")
    original = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(original)
    with tempfile.TemporaryDirectory(prefix="native-fixtures-", dir=destination.parent) as temporary:
        stage = Path(temporary) / "fixtures"
        with contextlib.redirect_stdout(StringIO()):
            original.generate(stage)
        scan = Image.new("RGB", (1224, 1584), "white")
        draw = ImageDraw.Draw(scan)
        font = ImageFont.truetype(str(font_path), 44)
        draw.text((100, 120), "SCANNED ALPHA original scanned page", fill="black", font=font)
        draw.text((100, 240), "Apples 11    Pears 22", fill="black", font=font)
        image = BytesIO()
        scan.save(image, format="PNG")
        pdf = canvas.Canvas(str(stage / "scanned.pdf"), invariant=1, pagesize=(612, 792))
        pdf.drawImage(ImageReader(image), 0, 0, width=612, height=792)
        pdf.save()
        # Keep cancellation/deadline well inside the work on fast CI CPUs too.
        # ReportLab shares the tiny PNG object across all 256 pages.
        pdf = canvas.Canvas(str(stage / "timeout.pdf"), invariant=1, pagesize=(612, 792))
        diagram = ImageReader(BytesIO((stage / "original-diagram.png").read_bytes()))
        for page in range(256):
            pdf.setFont("Helvetica", 16)
            pdf.drawString(50, 735, "NATIVE_LONG_PAGE_%04d original deadline fixture" % (page + 1))
            # A filename becomes part of ReportLab's image resource identifier;
            # use image content so random staging paths cannot affect the PDF.
            pdf.drawImage(diagram, 50, 400, width=200, height=100)
            pdf.showPage()
        pdf.save()
        Document().save(stage / "empty.docx")
        # A truly empty presentation (zero slides) tests the empty-package contract.
        Presentation().save(stage / "empty.pptx")
        # Different content and identical basenames exercise isolation under concurrency.
        (stage / "left").mkdir()
        (stage / "right").mkdir()
        for side, marker in [("left", "CONCURRENT_LEFT"), ("right", "CONCURRENT_RIGHT")]:
            doc = Document()
            doc.add_paragraph(marker)
            doc.save(stage / side / "same.docx")
        for path in stage.rglob("*.docx"):
            if path.name != "corrupt.docx":
                canonical_office(path)
        for path in stage.rglob("*.pptx"):
            if path.name != "corrupt.pptx":
                canonical_office(path)
        # Truncate only after metadata normalization, otherwise the corrupt
        # fixtures would retain time-dependent ZIP header bytes.
        (stage / "corrupt.docx").write_bytes((stage / "original.docx").read_bytes()[:256])
        (stage / "corrupt.pptx").write_bytes((stage / "original.pptx").read_bytes()[:256])
        (stage / "fixtures.json").unlink()
        manifest = {
            "schemaVersion": 1,
            "license": "Original synthetic content; BSD-3-Clause (repository license)",
            "dependencies": pins,
            "generatorSha256": digest(Path(__file__).read_bytes()),
            "baseGeneratorSha256": digest((ROOT / "scripts/validate-python-fixtures.py").read_bytes()),
            "scanFontSha256": digest(font_path.read_bytes()),
            "expected": {"original.pdf": 2, "scanned.pdf": 1, "original.pptx": 2, "timeout.pdf": 256},
            "files": {
                path.relative_to(stage).as_posix(): {"size": path.stat().st_size, "sha256": digest(path.read_bytes())}
                for path in sorted(stage.rglob("*")) if path.is_file()
            },
        }
        (stage / "fixtures.json").write_text(json.dumps(manifest, indent=2) + "\n")
        stage.rename(destination)
    return {"kind": "synthetic-fixtures", "count": len(manifest["files"]),
            "manifestSha256": digest((destination / "fixtures.json").read_bytes())}


def check_document(path):
    from jsonschema import Draft202012Validator
    from PIL import Image

    dependencies()
    schema = json.loads((SUPPORT / "docling-document.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    data = json.loads(path.read_text())
    # Error values/messages can contain document text; retain counts only.
    require(not list(Draft202012Validator(schema).iter_errors(data)), "native JSON schema mismatch")
    refs, pointers = [], set()
    images = 0

    def visit(value, pointer="#"):
        nonlocal images
        pointers.add(pointer)
        if isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, pointer + "/" + str(index))
        elif isinstance(value, dict):
            if "$ref" in value:
                refs.append(value["$ref"])
            if "self_ref" in value:
                require(value["self_ref"] == pointer, "incorrect native self reference")
            for prov in value.get("prov", []):
                require(str(prov["page_no"]) in data["pages"], "unresolved provenance page")
            image = value.get("image")
            if image:
                import base64
                header, encoded = image["uri"].split(",", 1)
                require(header == "data:image/png;base64", "unexpected synthetic image encoding")
                raw = base64.b64decode(encoded, validate=True)
                require(raw.startswith(b"\x89PNG\r\n\x1a\n"), "invalid embedded PNG signature")
                with Image.open(BytesIO(raw)) as decoded:
                    decoded.load()
                    require(decoded.size == (image["size"]["width"], image["size"]["height"]), "embedded PNG dimensions mismatch")
                images += 1
            for key, item in value.items():
                visit(item, pointer + "/" + key.replace("~", "~0").replace("/", "~1"))

    visit(data)
    require(all(ref in pointers for ref in refs), "unresolved native JSON reference")
    for key, page in data["pages"].items():
        require(str(page["page_no"]) == key, "page key mismatch")
    return {"kind": "native-json-contract", "sha256": digest(path.read_bytes()),
            "schemaSha256": digest((SUPPORT / "docling-document.schema.json").read_bytes()),
            "pages": len(data["pages"]), "texts": len(data["texts"]),
            "tables": len(data["tables"]), "embeddedImages": images, "resolvedReferences": len(refs)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--font", type=Path)
    parser.add_argument("--check-document", type=Path)
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    if args.check_document:
        result = check_document(args.check_document)
    else:
        if not args.output or not args.font:
            parser.error("--output and --font are required")
        result = generate(args.output.resolve(), args.font.resolve())
    encoded = json.dumps(result, indent=2) + "\n"
    if args.receipt:
        args.receipt.write_text(encoded)
    print(encoded, end="")


if __name__ == "__main__":
    main()

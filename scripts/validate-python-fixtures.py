"""Generate tiny original fixtures for the isolated Docling validation.

Run with python-runtime/venv/bin/python. Output defaults to the ignored runtime.
All fixture text and drawings are created here; no third-party document content.
"""
from pathlib import Path
import argparse
import json
import hashlib
from io import BytesIO


def generate(destination: Path):
    from PIL import Image, ImageDraw, ImageFont
    from docx import Document
    from docx.shared import Inches as DocxInches
    from pptx import Presentation
    from pptx.util import Inches
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader

    destination.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (200, 100), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((10, 10, 190, 90), fill="blue")
    draw.rectangle((70, 25, 130, 75), fill="yellow")
    png = BytesIO()
    image.save(png, format="PNG")
    image_path = destination / "original-diagram.png"
    image_path.write_bytes(png.getvalue())

    document = Document()
    document.add_heading("SDK original DOCX fixture", 0)
    document.add_paragraph("DOCX_ALPHA verifies original prose.")
    table = document.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "Fruit"
    table.rows[0].cells[1].text = "Count"
    for left, right in [("Apples", "11"), ("Pears", "22")]:
        cells = table.add_row().cells
        cells[0].text, cells[1].text = left, right
    document.add_picture(str(image_path), width=DocxInches(2))
    document.add_page_break()
    document.add_paragraph("DOCX_OMEGA verifies content after the page break.")
    document.save(destination / "original.docx")

    presentation = Presentation()
    first = presentation.slides.add_slide(presentation.slide_layouts[5])
    first.shapes.title.text = "SDK original PPTX fixture"
    first.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(1)).text = "PPTX_ALPHA original slide one"
    table = first.shapes.add_table(3, 2, Inches(1), Inches(2), Inches(4), Inches(1.5)).table
    for row, values in enumerate([("Fruit", "Count"), ("Apples", "11"), ("Pears", "22")]):
        for col, value in enumerate(values):
            table.cell(row, col).text = value
    first.shapes.add_picture(str(image_path), Inches(6), Inches(2), width=Inches(2))
    first.notes_slide.notes_text_frame.text = "PPTX_NOTES original speaker note"
    second = presentation.slides.add_slide(presentation.slide_layouts[5])
    second.shapes.title.text = "PPTX_OMEGA original slide two"
    presentation.save(destination / "original.pptx")

    pdf = canvas.Canvas(str(destination / "original.pdf"), invariant=1, pagesize=(612, 792))
    pdf.setFont("Helvetica", 18)
    pdf.drawString(50, 735, "SDK original PDF fixture")
    pdf.setFont("Helvetica", 12)
    pdf.drawString(50, 700, "PDF_ALPHA original page one")
    for y, values in [(640, ("Fruit", "Count")), (610, ("Apples", "11")), (580, ("Pears", "22"))]:
        pdf.drawString(60, y, values[0])
        pdf.drawString(220, y, values[1])
    for y in [660, 630, 600, 570]:
        pdf.line(50, y, 300, y)
    for x in [50, 200, 300]:
        pdf.line(x, 570, x, 660)
    pdf.drawImage(ImageReader(png), 50, 400, width=200, height=100)
    pdf.showPage()
    pdf.setFont("Helvetica", 16)
    pdf.drawString(50, 735, "PDF_OMEGA original page two")
    pdf.save()

    scan = Image.new("RGB", (1224, 1584), "white")
    scan_draw = ImageDraw.Draw(scan)
    font_path = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    font = ImageFont.truetype(str(font_path), 40) if font_path.exists() else ImageFont.load_default()
    scan_draw.text((100, 120), "SCANNED ALPHA original scanned page", fill="black", font=font)
    scan_draw.text((100, 220), "Apples 11    Pears 22", fill="black", font=font)
    scan_bytes = BytesIO()
    scan.save(scan_bytes, format="PNG")
    pdf = canvas.Canvas(str(destination / "scanned.pdf"), invariant=1, pagesize=(612, 792))
    pdf.drawImage(ImageReader(scan_bytes), 0, 0, width=612, height=792)
    pdf.save()
    pdf = canvas.Canvas(str(destination / "partial.pdf"), invariant=1, pagesize=(612, 792))
    pdf.setFont("Helvetica", 16)
    pdf.drawString(50, 735, "PARTIAL_ALPHA original valid first page")
    pdf.showPage()
    pdf.setPageSize((0, 0))
    pdf.drawString(0, 0, "Deliberately invalid zero-size second page")
    pdf.showPage()
    pdf.save()
    pdf = canvas.Canvas(str(destination / "timeout.pdf"), invariant=1, pagesize=(612, 792))
    for page in range(32):
        pdf.setFont("Helvetica", 16)
        pdf.drawString(50, 735, "Original deadline fixture page " + str(page + 1))
        pdf.drawImage(ImageReader(png), 50, 400, width=200, height=100)
        pdf.showPage()
    pdf.save()
    (destination / "corrupt.pdf").write_bytes(b"%PDF-1.7\nThis original file is deliberately truncated.\n")
    manifest = {
        "license": "Original synthetic fixture content; BSD-3-Clause (repository license)",
        "files": {
            p.name: {"size": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in sorted(destination.iterdir()) if p.is_file() and p.name != "fixtures.json"
        },
    }
    (destination / "fixtures.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(".context/release-hardening-2026-11-06/python-runtime/fixtures"))
    generate(parser.parse_args().output)

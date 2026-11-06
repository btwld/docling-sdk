"""Check real partial-page behavior through Python's public converter API.

Run in the same isolated child environment as validate-python-runtime.py. The
SDK CLI counterpart is checked separately because upstream exports SUCCESS only.
"""
from pathlib import Path
import json
import sys
from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.pipeline.legacy_standard_pdf_pipeline import LegacyStandardPdfPipeline

runtime = Path(sys.prefix).resolve().parent
options = PdfPipelineOptions(do_ocr=False, artifacts_path=runtime / "models/docling", document_timeout=0.001)
converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options, backend=PyPdfiumDocumentBackend, pipeline_cls=LegacyStandardPdfPipeline)})
result = converter.convert(runtime / "fixtures/timeout.pdf", raises_on_error=False)
evidence = {"status": result.status.value, "input_pages": result.input.page_count, "processed_pages": [page.page_no for page in result.pages], "errors": [item.model_dump(mode="json") for item in result.errors], "texts": [item.text for item in result.document.texts]}
(runtime / "evidence/partial-python.json").write_text(json.dumps(evidence, indent=2) + "\n")
print(json.dumps(evidence, indent=2))
assert result.status.value == "partial_success", "Fixture did not actually establish partial conversion"
assert len(result.pages) < result.input.page_count, "Actual page coverage must be incomplete"
assert any("Original deadline fixture page" in item.text for item in result.document.texts)

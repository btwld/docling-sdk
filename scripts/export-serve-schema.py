"""Export the pinned Serve application's real OpenAPI schema without starting models.

Run with an isolated environment containing docling-serve==1.7.2 and docling==2.60.1.
See openapi/README.md for the recorded dependency versions and generation commands.
"""

import importlib.metadata
import json
import os
from pathlib import Path

for package, expected in {"docling-serve": "1.7.2", "docling": "2.60.1"}.items():
    actual = importlib.metadata.version(package)
    if actual != expected:
        raise RuntimeError(f"Expected {package}=={expected}, found {actual}")

# These apply only to this explicit generation process, not SDK consumers.
os.environ["DOCLING_SERVE_ENABLE_UI"] = "false"
os.environ["HF_HUB_OFFLINE"] = "1"

from docling_serve.app import create_app

output = Path(__file__).resolve().parents[1] / "openapi" / "docling-serve.json"
output.parent.mkdir(parents=True, exist_ok=True)
schema = create_app().openapi()
output.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")
print(f"Exported Serve {schema['info']['version']}: {len(schema['paths'])} paths")

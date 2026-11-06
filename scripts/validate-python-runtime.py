"""Run real SDK validation with a local Python runtime and controlled child caches.

Setup (official indexes; no global installation):
  python3 -m venv .context/release-hardening-2026-11-06/python-runtime/venv
  <venv>/bin/python -m pip install uv==0.9.8
  UV_CACHE_DIR=<runtime>/cache <venv>/bin/uv pip install --python <venv>/bin/python \
    --index https://pypi.org/simple --index https://download.pytorch.org/whl/cpu \
    --index-strategy unsafe-best-match docling==2.60.1 torch==2.8.0+cpu \
    torchvision==0.23.0+cpu reportlab==4.4.4 onnxruntime==1.19.2
  <venv>/bin/python scripts/validate-python-fixtures.py
  python3 scripts/validate-python-models.py --rapidocr
  <venv>/bin/python scripts/validate-python-identity.py
  python3 scripts/validate-python-runtime.py docx pptx corrupt

No model fetches are implicit in this launcher: HF offline mode is enforced.
Download a verified model subset separately with validate-python-models.py.
Known engine repros timeout-options/partial-options intentionally exit nonzero;
passing supported scenarios and upstream limitations are recorded separately.
HF offline flags do not establish OS-level network isolation.
"""
import argparse
from pathlib import Path
import os
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenarios", nargs="+", choices=["docx", "pptx", "pdf", "scanned", "corrupt", "cli-options", "table-options", "timeout-options", "referenced-options", "partial-python", "partial-options", "process-timeout-options", "default-options"])
    parser.add_argument("--runtime", type=Path, default=Path(".context/release-hardening-2026-11-06/python-runtime"))
    parser.add_argument("--node", default=shutil.which("node"), help="Node executable for SDK checks (defaults to PATH)")
    parser.add_argument("--filename", help="Override the input filename for referenced-options")
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    (runtime / "models/docling").mkdir(parents=True, exist_ok=True)
    needs_models = {"pdf", "scanned", "default-options", "timeout-options", "partial-python", "partial-options", "process-timeout-options"}
    if needs_models.intersection(args.scenarios):
        import json
        manifest = json.loads((runtime / "model-manifest.json").read_text())
        for item in manifest:
            if not (runtime / item["path"]).is_file():
                raise FileNotFoundError("Required isolated model asset missing: " + item["path"])
    env = {**os.environ, "HF_HOME": str(runtime / "models/huggingface"), "XDG_CACHE_HOME": str(runtime / "models"), "TORCH_HOME": str(runtime / "models/torch"), "MPLCONFIGDIR": str(runtime / "models/matplotlib"), "DOCLING_ARTIFACTS_PATH": str(runtime / "models/docling"), "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2", "TOKENIZERS_PARALLELISM": "false"}
    node = args.node
    if not node:
        raise RuntimeError("Node is required; supply --node or add it to PATH")
    for scenario in args.scenarios:
        script = "scripts/validate-python-options.ts" if scenario.endswith("-options") else "scripts/validate-python-sdk.ts"
        command = [str(runtime / "venv/bin/python"), "scripts/validate-python-partial.py"] if scenario == "partial-python" else [node, "--import", "tsx", script, str(runtime), scenario]
        if scenario == "referenced-options" and args.filename:
            command.append(args.filename)
        p = subprocess.run(command, env=env, capture_output=True, text=True, timeout=240)
        evidence = runtime / "evidence" / scenario
        evidence.mkdir(parents=True, exist_ok=True)
        (evidence / "run.log").write_text(p.stdout + p.stderr)
        print(scenario + ": exit=" + str(p.returncode))
        print((p.stdout + p.stderr)[-3500:])
        if p.returncode:
            return p.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

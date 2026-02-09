import { createWebClient } from "docling-sdk/web";
import * as ui from "./ui";

// Create client with local worker URL (Vite resolves the import via alias)
const workerUrl = new URL("./ocr-worker.ts", import.meta.url).href;
const client = createWebClient({ workerUrl, device: "webgpu" });

let streamedRaw = "";

// ============================================================================
// Event handlers
// ============================================================================

client.on("loading", ({ progress, status }) => {
  ui.setLoadingProgress(progress, status);
});

client.on("status", ({ status }) => {
  ui.setProcessingProgress(0, status);
});

client.on("stream", ({ chunk, progress }) => {
  streamedRaw += chunk;
  ui.setStreamedRaw(streamedRaw);
  ui.setProcessingProgress(progress, "Generating...");
});

client.on("error", ({ message }) => {
  ui.setStatus(message, "error");
});

// ============================================================================
// Load Model button
// ============================================================================

document.getElementById("load-btn")!.addEventListener("click", async () => {
  ui.showLoadingModal();
  ui.setStatus("Loading model...", "info");

  try {
    await client.initialize();
    ui.hideLoadingModal();
    ui.setModelReady();
    ui.setStatus("Model loaded and ready", "success");
  } catch (err) {
    ui.hideLoadingModal();
    ui.setStatus(`Failed to load model: ${err instanceof Error ? err.message : err}`, "error");
  }
});

// ============================================================================
// Image upload handler
// ============================================================================

ui.initUploader(async (file: File) => {
  if (!client.ready) {
    ui.setStatus("Load the model first before processing images", "error");
    return;
  }

  streamedRaw = "";
  ui.showProcessingPanel();
  ui.setStatus("Processing image...", "info");

  try {
    const result = await client.processImage(file);
    ui.setProcessingProgress(1, "Complete");
    ui.displayResults(result);
    ui.setStatus("Processing complete", "success");
  } catch (err) {
    ui.setStatus(`Processing failed: ${err instanceof Error ? err.message : err}`, "error");
  }
});

// ============================================================================
// Tab initialization
// ============================================================================

ui.initTabs();

// ============================================================================
// Copy / Download button wiring
// ============================================================================

function getResultText(id: string): string {
  return document.getElementById(id)?.textContent ?? "";
}

document.getElementById("copy-markdown")?.addEventListener("click", () => {
  ui.copyToClipboard(getResultText("result-markdown"), "copy-markdown");
});
document.getElementById("download-markdown")?.addEventListener("click", () => {
  ui.downloadFile(getResultText("result-markdown"), "output.md", "text/markdown");
});

document.getElementById("copy-text")?.addEventListener("click", () => {
  ui.copyToClipboard(getResultText("result-text"), "copy-text");
});
document.getElementById("download-text")?.addEventListener("click", () => {
  ui.downloadFile(getResultText("result-text"), "output.txt", "text/plain");
});

document.getElementById("copy-json")?.addEventListener("click", () => {
  ui.copyToClipboard(getResultText("result-json"), "copy-json");
});
document.getElementById("download-json")?.addEventListener("click", () => {
  ui.downloadFile(getResultText("result-json"), "output.json", "application/json");
});

document.getElementById("copy-raw")?.addEventListener("click", () => {
  ui.copyToClipboard(getResultText("result-raw"), "copy-raw");
});
document.getElementById("download-raw")?.addEventListener("click", () => {
  ui.downloadFile(getResultText("result-raw"), "output.doctags", "text/plain");
});

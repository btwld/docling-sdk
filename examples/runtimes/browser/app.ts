/**
 * Browser Runtime Example
 *
 * Demonstrates Docling SDK usage in browser environment.
 * Run: npx vite examples/runtimes/browser
 */

// Import from browser entry point (no Node.js dependencies)
import { createAPIClient } from "../../../src/browser-entry";
import type { DoclingAPIClient } from "../../../src/clients/api-client";

// DOM Elements
const apiUrlInput = document.getElementById("apiUrl") as HTMLInputElement;
const docUrlInput = document.getElementById("docUrl") as HTMLInputElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const healthBtn = document.getElementById("healthBtn") as HTMLButtonElement;
const convertUrlBtn = document.getElementById("convertUrlBtn") as HTMLButtonElement;
const convertFileBtn = document.getElementById("convertFileBtn") as HTMLButtonElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;
const outputPre = document.getElementById("output") as HTMLPreElement;
const progressBar = document.getElementById("progressBar") as HTMLDivElement;

let client: DoclingAPIClient | null = null;

// Utility functions
function setStatus(message: string, type: "info" | "success" | "error" = "info") {
  statusDiv.textContent = message;
  statusDiv.className = type;
}

function setProgress(percent: number) {
  progressBar.style.width = `${percent}%`;
}

function setOutput(content: string) {
  outputPre.textContent = content;
}

function getClient(): DoclingAPIClient {
  const baseUrl = apiUrlInput.value.trim() || "http://localhost:5001";
  if (!client || (client as unknown as { config: { baseUrl: string } }).config.baseUrl !== baseUrl) {
    client = createAPIClient(baseUrl, {
      timeout: 60000,
      retries: 3,
    });
  }
  return client;
}

// Event handlers
healthBtn.addEventListener("click", async () => {
  try {
    setStatus("Checking health...", "info");
    setProgress(50);

    const api = getClient();
    const health = await api.health();

    setStatus("Health check successful!", "success");
    setProgress(100);
    setOutput(JSON.stringify(health, null, 2));
  } catch (error) {
    setStatus(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    setProgress(0);
  }
});

convertUrlBtn.addEventListener("click", async () => {
  try {
    const url = docUrlInput.value.trim();
    if (!url) {
      setStatus("Please enter a document URL", "error");
      return;
    }

    setStatus("Converting document from URL...", "info");
    setProgress(30);

    const api = getClient();
    const result = await api.convertFromUrl(url, {
      to_formats: ["md"],
    });

    setStatus("Conversion successful!", "success");
    setProgress(100);

    const mdContent = result.document?.md_content || "";
    setOutput(
      `// Converted from: ${result.document?.source?.filename || url}\n` +
        `// Content length: ${mdContent.length} characters\n\n` +
        mdContent
    );
  } catch (error) {
    setStatus(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    setProgress(0);
  }
});

// Enable file convert button when file is selected
fileInput.addEventListener("change", () => {
  convertFileBtn.disabled = !fileInput.files?.length;
});

convertFileBtn.addEventListener("click", async () => {
  try {
    const file = fileInput.files?.[0];
    if (!file) {
      setStatus("Please select a file", "error");
      return;
    }

    setStatus(`Converting ${file.name}...`, "info");
    setProgress(30);

    // Read file as Uint8Array (cross-runtime compatible)
    const arrayBuffer = await file.arrayBuffer();
    const uint8Data = new Uint8Array(arrayBuffer);

    setProgress(50);

    const api = getClient();
    const result = await api.convert(uint8Data, file.name, {
      to_formats: ["md"],
    });

    setStatus("Conversion successful!", "success");
    setProgress(100);

    const mdContent = result.document?.md_content || "";
    setOutput(
      `// Converted file: ${file.name}\n` +
        `// Original size: ${file.size} bytes\n` +
        `// Content length: ${mdContent.length} characters\n\n` +
        mdContent
    );
  } catch (error) {
    setStatus(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    setProgress(0);
  }
});

// Log browser compatibility info
console.log("Docling SDK - Browser Example");
console.log("=============================");
console.log("Features available:");
console.log("- Native fetch:", typeof fetch !== "undefined");
console.log("- Native WebSocket:", typeof WebSocket !== "undefined");
console.log("- TextEncoder:", typeof TextEncoder !== "undefined");
console.log("- Uint8Array:", typeof Uint8Array !== "undefined");
console.log("- File API:", typeof File !== "undefined");

import type { WebOCRResult, ExtractedTable, ElementOverlay } from "docling-sdk/web";

// ============================================================================
// DOM helpers
// ============================================================================

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

export function showElement(id: string): void {
  $(id).classList.remove("hidden");
}

export function hideElement(id: string): void {
  $(id).classList.add("hidden");
}

// ============================================================================
// Status
// ============================================================================

export function setStatus(message: string, type: "info" | "success" | "error"): void {
  const el = $("status-text");
  el.textContent = message;
  el.className =
    type === "error"
      ? "text-sm text-red-600 dark:text-red-400"
      : type === "success"
        ? "text-sm text-green-600 dark:text-green-400"
        : "text-sm text-gray-500 dark:text-gray-400";
}

// ============================================================================
// Model loading
// ============================================================================

export function showLoadingModal(): void {
  showElement("loading-modal");
}

export function hideLoadingModal(): void {
  hideElement("loading-modal");
}

export function setLoadingProgress(progress: number, status: string): void {
  const bar = $("loading-progress-bar") as HTMLDivElement;
  const text = $("loading-status") as HTMLSpanElement;
  const pct = Math.round(progress * 100);
  bar.style.width = `${pct}%`;
  text.textContent = status;
  ($("loading-percent") as HTMLSpanElement).textContent = `${pct}%`;
}

export function setModelReady(): void {
  hideElement("load-btn");
  showElement("model-status");
}

// ============================================================================
// Processing
// ============================================================================

export function showProcessingPanel(): void {
  showElement("processing-panel");
  setProcessingProgress(0, "Starting...");
  setStreamedRaw("");
}

export function hideProcessingPanel(): void {
  // Keep visible so user can see final streamed output
}

export function setProcessingProgress(progress: number, status: string): void {
  const bar = $("processing-progress-bar") as HTMLDivElement;
  const text = $("processing-status") as HTMLSpanElement;
  const pct = Math.round(progress * 100);
  bar.style.width = `${pct}%`;
  text.textContent = status;
}

export function setStreamedRaw(text: string): void {
  ($("streamed-raw") as HTMLPreElement).textContent = text;
  // Auto-scroll to bottom
  const container = $("streamed-raw");
  container.scrollTop = container.scrollHeight;
}

// ============================================================================
// Image upload
// ============================================================================

export function initUploader(onFile: (file: File) => void): void {
  const zone = $("drop-zone");
  const input = $("file-input") as HTMLInputElement;

  zone.addEventListener("click", () => input.click());

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("border-blue-500", "bg-blue-50", "dark:bg-blue-900/20");
  });

  zone.addEventListener("dragleave", () => {
    zone.classList.remove("border-blue-500", "bg-blue-50", "dark:bg-blue-900/20");
  });

  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("border-blue-500", "bg-blue-50", "dark:bg-blue-900/20");
    const file = (e as DragEvent).dataTransfer?.files[0];
    if (file) handleFile(file, onFile);
  });

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) handleFile(file, onFile);
    input.value = "";
  });
}

function handleFile(file: File, onFile: (file: File) => void): void {
  if (!file.type.startsWith("image/")) {
    setStatus("Please upload an image file (PNG, JPG, WebP, GIF)", "error");
    return;
  }

  // Show preview
  const preview = $("image-preview") as HTMLImageElement;
  preview.src = URL.createObjectURL(file);
  showElement("preview-container");

  onFile(file);
}

// ============================================================================
// Tabs
// ============================================================================

let activeTab = "tab-preview";

export function initTabs(): void {
  const tabs = document.querySelectorAll("[data-tab]");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabId = (tab as HTMLElement).dataset.tab!;
      showTab(tabId);
    });
  });
}

export function showTab(tabId: string): void {
  activeTab = tabId;

  // Update tab buttons
  document.querySelectorAll("[data-tab]").forEach((tab) => {
    const el = tab as HTMLElement;
    if (el.dataset.tab === tabId) {
      el.classList.add("text-blue-600", "dark:text-blue-400", "border-blue-600");
      el.classList.remove("text-gray-500", "border-transparent");
    } else {
      el.classList.remove("text-blue-600", "dark:text-blue-400", "border-blue-600");
      el.classList.add("text-gray-500", "border-transparent");
    }
  });

  // Update tab panels
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    const el = panel as HTMLElement;
    if (el.dataset.panel === tabId) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
}

// ============================================================================
// Results display
// ============================================================================

export function displayResults(result: WebOCRResult): void {
  showElement("results-container");

  // Preview (HTML in iframe)
  const iframe = $("preview-iframe") as HTMLIFrameElement;
  iframe.srcdoc = wrapHtmlForPreview(result.html);

  // Markdown
  ($("result-markdown") as HTMLPreElement).textContent = result.markdown;

  // Text
  ($("result-text") as HTMLPreElement).textContent = result.plainText;

  // Tables
  displayTables(result.tables);

  // JSON
  ($("result-json") as HTMLPreElement).textContent = JSON.stringify(result.json, null, 2);

  // Raw
  ($("result-raw") as HTMLPreElement).textContent = result.raw;

  // Overlays
  const preview = $("image-preview") as HTMLImageElement;
  if (preview.src) {
    displayOverlays(preview.src, result.overlays);
  }

  // Update table badge
  const tableBadge = $("table-badge");
  if (result.tables.length > 0) {
    tableBadge.textContent = String(result.tables.length);
    tableBadge.classList.remove("hidden");
  } else {
    tableBadge.classList.add("hidden");
  }

  // Update overlay badge
  const overlayBadge = $("overlay-badge");
  if (result.overlays.length > 0) {
    overlayBadge.textContent = String(result.overlays.length);
    overlayBadge.classList.remove("hidden");
  } else {
    overlayBadge.classList.add("hidden");
  }

  // Switch to preview tab
  showTab("tab-preview");
}

function wrapHtmlForPreview(html: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 1rem; color: #1f2937; line-height: 1.6; }
    table { border-collapse: collapse; margin: 1rem 0; width: 100%; }
    th, td { border: 1px solid #d1d5db; padding: 0.5rem; text-align: left; }
    th { background: #f3f4f6; font-weight: 600; }
    h1 { font-size: 1.5rem; font-weight: 700; margin: 1rem 0 0.5rem; }
    h2 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.5rem; }
    h3 { font-size: 1.1rem; font-weight: 600; margin: 0.75rem 0 0.5rem; }
    p { margin: 0.5rem 0; }
    code { background: #f3f4f6; padding: 0.125rem 0.25rem; border-radius: 0.25rem; font-size: 0.875rem; }
    pre { background: #f3f4f6; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; }
    img { max-width: 100%; }
  </style>
</head>
<body>${html}</body>
</html>`;
}

// ============================================================================
// Tables
// ============================================================================

let currentTables: ExtractedTable[] = [];

function displayTables(tables: ExtractedTable[]): void {
  currentTables = tables;
  const container = $("tables-container");

  if (tables.length === 0) {
    container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-sm">No tables found in this document.</p>';
    return;
  }

  let html = "";

  // Table selector if multiple
  if (tables.length > 1) {
    html += '<div class="mb-3 flex items-center gap-2">';
    html += '<label class="text-sm text-gray-600 dark:text-gray-400">Table:</label>';
    html += '<select id="table-selector" class="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 dark:text-gray-200">';
    tables.forEach((_, i) => {
      html += `<option value="${i}">Table ${i + 1}</option>`;
    });
    html += "</select>";
    html += `<button id="export-csv-btn" class="ml-auto text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Export CSV</button>`;
    html += "</div>";
  } else {
    html += '<div class="mb-3 flex justify-end">';
    html += `<button id="export-csv-btn" class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Export CSV</button>`;
    html += "</div>";
  }

  html += '<div id="table-display"></div>';
  container.innerHTML = html;

  // Wire selector
  const selector = document.getElementById("table-selector") as HTMLSelectElement | null;
  if (selector) {
    selector.addEventListener("change", () => renderTable(Number(selector.value)));
  }

  // Wire CSV export
  document.getElementById("export-csv-btn")?.addEventListener("click", () => {
    const idx = selector ? Number(selector.value) : 0;
    exportTableCSV(idx);
  });

  renderTable(0);
}

function renderTable(index: number): void {
  const table = currentTables[index];
  if (!table) return;

  const display = $("table-display");
  let html = '<div class="overflow-x-auto"><table class="w-full text-sm border-collapse">';

  // Headers
  if (table.headers.length > 0) {
    html += "<thead><tr>";
    table.headers.forEach((h) => {
      html += `<th class="border border-gray-300 dark:border-gray-600 px-3 py-2 bg-gray-50 dark:bg-gray-700 text-left font-medium">${escapeHtml(h)}</th>`;
    });
    html += "</tr></thead>";
  }

  // Rows
  html += "<tbody>";
  table.rows.forEach((row) => {
    html += "<tr>";
    row.forEach((cell) => {
      html += `<td class="border border-gray-300 dark:border-gray-600 px-3 py-2">${escapeHtml(cell)}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody></table></div>";

  display.innerHTML = html;
}

function exportTableCSV(index: number): void {
  const table = currentTables[index];
  if (!table) return;

  const rows = [table.headers, ...table.rows];
  const csv = rows
    .map((row) =>
      row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");

  downloadFile(csv, `table-${index + 1}.csv`, "text/csv");
}

// ============================================================================
// Overlays
// ============================================================================

function displayOverlays(imageUrl: string, overlays: ElementOverlay[]): void {
  const container = $("overlay-container");

  if (overlays.length === 0) {
    container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-sm">No overlays detected.</p>';
    return;
  }

  // Collect unique tag types for legend
  const tagTypes = [...new Set(overlays.map((o) => o.tagType))];
  const colors = new Map<string, string>();
  tagTypes.forEach((tag, i) => {
    const hue = (i * 137.5) % 360;
    colors.set(tag, `hsl(${hue}, 70%, 55%)`);
  });

  let html = "";

  // Legend
  html += '<div class="flex flex-wrap gap-2 mb-3">';
  tagTypes.forEach((tag) => {
    const color = colors.get(tag)!;
    html += `<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700">`;
    html += `<span class="w-2.5 h-2.5 rounded-full" style="background:${color}"></span>`;
    html += `${escapeHtml(tag)}</span>`;
  });
  html += "</div>";

  // Image with overlays
  html += '<div class="relative inline-block">';
  html += `<img src="${imageUrl}" class="max-w-full rounded" id="overlay-image" />`;

  overlays.forEach((overlay) => {
    const color = colors.get(overlay.tagType)!;
    const { left, top, right, bottom } = overlay.bbox;
    const w = right - left;
    const h = bottom - top;
    html += `<div class="absolute border-2 hover:bg-opacity-20 transition-all duration-150 group"
      style="left:${left * 100}%;top:${top * 100}%;width:${w * 100}%;height:${h * 100}%;border-color:${color}">`;
    html += `<span class="absolute -top-5 left-0 text-xs px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
      style="background:${color};color:white">${escapeHtml(overlay.tagType)}</span>`;
    html += "</div>";
  });

  html += "</div>";
  container.innerHTML = html;
}

// ============================================================================
// Utilities
// ============================================================================

export function copyToClipboard(text: string, btnId?: string): void {
  navigator.clipboard.writeText(text).then(() => {
    if (btnId) {
      const btn = document.getElementById(btnId);
      if (btn) {
        const original = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.textContent = original;
        }, 2000);
      }
    }
  });
}

export function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

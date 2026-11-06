/**
 * Custom cache implementation with progress tracking for model downloads
 *
 * Ported from web-ocr/packages/docling-client/src/cache.ts
 */

export type ProgressCallback = (progress: number, status: string) => void;

/**
 * Create a custom cache object for @huggingface/transformers
 * that tracks download progress and uses the Cache API for persistence
 */
export function createCustomCache(onProgress?: ProgressCallback) {
  const progresses = new Map<string, { loaded: number; total: number }>();
  return {
    async match(request: string | Request): Promise<Response | undefined> {
      const cache = await caches.open("hf-model-cache");
      const key = typeof request === "string" ? request : request.url;

      const fixedUrl = key.replace(
        /^\/models\/([^/]+\/[^/]+)\/(.*)$/,
        "https://huggingface.co/$1/resolve/main/$2"
      );

      const cached = await cache.match(fixedUrl);
      if (cached) {
        const response = cached.clone();
        onProgress?.(1, `Cached: ${getFileName(fixedUrl)}`);
        return response;
      }

      const response = await fetch(fixedUrl);
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }

      const contentLength = response.headers.get("Content-Length");
      const parsedLength = Number(contentLength);
      const total = Number.isFinite(parsedLength) && parsedLength > 0 ? parsedLength : 0;
      let loaded = 0;

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      const chunks: BlobPart[] = [];

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          loaded += value.length;
          progresses.set(fixedUrl, { loaded, total });

          let totalLoaded = 0;
          let totalSize = 0;
          for (const { loaded: l, total: t } of progresses.values()) {
            if (t) {
              totalLoaded += l;
              totalSize += t;
            }
          }

          const aggregateProgress = totalSize > 0 ? Math.min(totalLoaded / totalSize, 1) : 0;
          onProgress?.(aggregateProgress, `Downloading: ${getFileName(fixedUrl)}`);
        }

        const blob = new Blob(chunks);
        const finalResponse = new Response(blob, { headers: response.headers });
        await cache.put(fixedUrl, finalResponse.clone());

        onProgress?.(1, `Downloaded: ${getFileName(fixedUrl)}`);
        return finalResponse;
      } catch (error) {
        await reader.cancel().catch(() => {
          // Preserve the original download/cache error if stream cancellation also fails.
        });
        throw error;
      } finally {
        progresses.delete(fixedUrl);
        reader.releaseLock();
      }
    },

    async put(): Promise<void> {
      // Intentionally empty - caching happens in match
    },
  };
}

function getFileName(url: string): string {
  const parts = url.split("/");
  return parts[parts.length - 1] ?? url;
}

/**
 * Clear the model cache
 */
export async function clearModelCache(): Promise<boolean> {
  return caches.delete("hf-model-cache");
}

/**
 * Get approximate cache size in bytes
 */
export async function getModelCacheSize(): Promise<number> {
  const cache = await caches.open("hf-model-cache");
  const keys = await cache.keys();

  let totalSize = 0;
  for (const request of keys) {
    const response = await cache.match(request);
    if (response) {
      const blob = await response.blob();
      totalSize += blob.size;
    }
  }

  return totalSize;
}

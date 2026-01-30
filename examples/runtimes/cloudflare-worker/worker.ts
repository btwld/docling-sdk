/**
 * Cloudflare Worker Runtime Example
 *
 * Demonstrates Docling SDK usage in Cloudflare Workers environment.
 * Deploy: cd examples/runtimes/cloudflare-worker && wrangler deploy
 *
 * Note: Cloudflare Workers use the browser entry point (no Node.js APIs)
 */

// Import from browser entry point (works in edge runtimes)
import { createAPIClient } from "docling-sdk";

// Environment bindings
interface Env {
  DOCLING_URL: string;
}

// Request/Response type from Cloudflare Workers
export interface ExportedHandler<Env = unknown> {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for browser access
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Create Docling client
    const doclingUrl = env.DOCLING_URL || "http://localhost:5001";
    const client = createAPIClient(doclingUrl, {
      timeout: 30000,
      retries: 2,
    });

    try {
      // Route handling
      switch (path) {
        case "/":
          return new Response(
            JSON.stringify({
              name: "Docling SDK - Cloudflare Worker Example",
              endpoints: {
                health: "/health",
                convert: "/convert?url=<document-url>",
                upload: "POST /upload (multipart/form-data with 'file' field)",
              },
            }),
            {
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders,
              },
            }
          );

        case "/health": {
          const health = await client.health();
          return new Response(JSON.stringify(health), {
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders,
            },
          });
        }

        case "/convert": {
          const docUrl = url.searchParams.get("url");
          if (!docUrl) {
            return new Response(
              JSON.stringify({ error: "Missing 'url' query parameter" }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json",
                  ...corsHeaders,
                },
              }
            );
          }

          const result = await client.convertFromUrl(docUrl, {
            to_formats: ["md"],
          });

          return new Response(
            JSON.stringify({
              success: true,
              source: result.document?.source?.filename || docUrl,
              content_length: result.document?.md_content?.length || 0,
              markdown: result.document?.md_content,
            }),
            {
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders,
              },
            }
          );
        }

        case "/upload": {
          if (request.method !== "POST") {
            return new Response(
              JSON.stringify({ error: "POST method required" }),
              {
                status: 405,
                headers: {
                  "Content-Type": "application/json",
                  ...corsHeaders,
                },
              }
            );
          }

          const formData = await request.formData();
          const file = formData.get("file") as File | null;

          if (!file) {
            return new Response(
              JSON.stringify({ error: "Missing 'file' field in form data" }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json",
                  ...corsHeaders,
                },
              }
            );
          }

          // Read file as Uint8Array (cross-runtime compatible)
          const arrayBuffer = await file.arrayBuffer();
          const uint8Data = new Uint8Array(arrayBuffer);

          const result = await client.convert(uint8Data, file.name, {
            to_formats: ["md"],
          });

          return new Response(
            JSON.stringify({
              success: true,
              filename: file.name,
              original_size: file.size,
              content_length: result.document?.md_content?.length || 0,
              markdown: result.document?.md_content,
            }),
            {
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders,
              },
            }
          );
        }

        default:
          return new Response(
            JSON.stringify({ error: "Not found" }),
            {
              status: 404,
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders,
              },
            }
          );
      }
    } catch (error) {
      console.error("Worker error:", error);
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }
  },
} satisfies ExportedHandler<Env>;

import { createServer, type IncomingHttpHeaders } from "node:http";

export interface ReceivedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
  json(): unknown;
  form(): Promise<FormData>;
}
export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array | object;
}
export async function loopback(respond: (request: ReceivedRequest) => Reply | Promise<Reply>) {
  const requests: ReceivedRequest[] = [];
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const request: ReceivedRequest = {
        method: incoming.method ?? "GET",
        url: incoming.url ?? "/",
        headers: incoming.headers,
        body,
        json: () => JSON.parse(body.toString()),
        form: () =>
          new Response(body, {
            headers: { "Content-Type": incoming.headers["content-type"] ?? "" },
          }).formData(),
      };
      requests.push(request);
      const reply = await respond(request);
      const raw = typeof reply.body === "string" || reply.body instanceof Uint8Array;
      outgoing.writeHead(reply.status ?? 200, {
        "Content-Type": raw ? "text/plain" : "application/json",
        ...reply.headers,
      });
      outgoing.end(raw ? reply.body : JSON.stringify(reply.body ?? {}));
    } catch (error) {
      outgoing.writeHead(500, { "Content-Type": "application/json" });
      outgoing.end(
        JSON.stringify({ detail: error instanceof Error ? error.message : String(error) })
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback address");
  return {
    requests,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

export async function readNodeStream(stream?: NodeJS.ReadableStream) {
  if (!stream) throw new Error("Missing result stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

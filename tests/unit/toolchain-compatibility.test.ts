import { createServer } from "node:http";
import { createConfig } from "@redocly/openapi-core";
import openapiTS, { astToString } from "openapi-typescript";
import { expect, it } from "vitest";

it("generates URL schema types with configured HTTP header matching", async () => {
  const keys: Array<string | string[] | undefined> = [];
  const server = createServer((request, response) => {
    keys.push(request.headers["x-api-key"]);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Toolchain fixture", version: "1.0.0" },
      paths: {
        "/health": {
          get: { responses: { "200": { description: "Healthy" } } },
        },
      },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}`;
    const redocly = await createConfig({
      resolve: {
        http: {
          headers: [{ matches: `${url}/**`, name: "x-api-key", value: "fixture-key" }],
        },
      },
    });
    const types = await openapiTS(new URL(`${url}/openapi.json`), { redocly });
    expect(keys).toEqual(["fixture-key"]);
    expect(astToString(types)).toContain('"/health"');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

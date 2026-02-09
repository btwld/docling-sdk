import { DoclingAPIClient } from "./clients/api-client";
import { DoclingCLIClient } from "./clients/cli-client";
import { DoclingWebClient } from "./clients/web-client";
import type { DoclingAPIConfig, DoclingCLIConfig, DoclingConfig } from "./types/client";
import { isAPIConfig, isCLIConfig, isWebConfig } from "./types/client";
import type { DoclingWebClientConfig } from "./types/web";

type ApiVariant = Extract<DoclingConfig, { api: unknown }>;
type CliVariant = Extract<DoclingConfig, { cli: unknown }>;
type WebVariant = Extract<DoclingConfig, { web: unknown }>;

interface DoclingConstructor {
  new (config: ApiVariant): DoclingAPIClient;
  new (config: CliVariant): DoclingCLIClient;
  new (config: WebVariant): DoclingWebClient;
  new (config: DoclingConfig): DoclingAPIClient | DoclingCLIClient | DoclingWebClient;
}

class DoclingImpl {
  constructor(config: DoclingConfig) {
    if (isAPIConfig(config)) {
      const sharedConfig = omit(config, ["api", "cli", "web"]);
      const apiConfig = {
        type: "api" as const,
        ...config.api,
        ...sharedConfig,
      } satisfies DoclingAPIConfig;
      return new DoclingAPIClient(apiConfig);
    }

    if (isCLIConfig(config)) {
      const sharedConfig = omit(config, ["api", "cli", "web"]);
      const cliConfig = {
        type: "cli" as const,
        ...config.cli,
        ...sharedConfig,
      } satisfies DoclingCLIConfig;
      return new DoclingCLIClient(cliConfig);
    }

    if (isWebConfig(config)) {
      const webConfig = {
        type: "web" as const,
        ...config.web,
      } satisfies DoclingWebClientConfig;
      return new DoclingWebClient(webConfig);
    }

    throw new Error(
      "Invalid configuration: must specify either 'api', 'cli', or 'web' configuration"
    );
  }
}

export const Docling = DoclingImpl as unknown as DoclingConstructor;

function omit<T extends object, K extends readonly (keyof T)[]>(
  obj: T,
  keys: K
): Omit<T, K[number]> {
  const result = { ...obj } as Omit<T, K[number]> & Record<string, unknown>;

  for (const key of keys) {
    delete (result as Record<string, unknown>)[key as string];
  }

  return result as Omit<T, K[number]>;
}

export type DoclingClientType<T extends DoclingConfig> = T extends DoclingAPIConfig
  ? DoclingAPIClient
  : T extends DoclingCLIConfig
    ? DoclingCLIClient
    : T extends DoclingWebClientConfig
      ? DoclingWebClient
      : never;

export function isAPIClient(
  client: DoclingAPIClient | DoclingCLIClient | DoclingWebClient
): client is DoclingAPIClient {
  return client.type === "api";
}

/**
 * Type guard to check if client is CLI type
 *
 * @param client - The client instance to check
 * @returns True if the client is a CLI client
 *
 * @example
 * ```typescript
 * const client = new Docling({ cli: { outputDir: './output' } });
 * if (isCLIClient(client)) {
 *
 *   await client.convertToStream(options, outputStream);
 * }
 * ```
 */
export function isCLIClient(
  client: DoclingAPIClient | DoclingCLIClient | DoclingWebClient
): client is DoclingCLIClient {
  return client.type === "cli";
}

/**
 * Type guard to check if client is Web type
 */
export function isWebClient(
  client: DoclingAPIClient | DoclingCLIClient | DoclingWebClient
): client is DoclingWebClient {
  return client.type === "web";
}

/**
 * Create a Web client
 *
 * Convenience factory function for creating a web OCR client.
 *
 * @param options - Optional web client configuration (device, modelId, etc.)
 * @returns DoclingWebClient instance ready for use
 */
export function createWebClient(
  options?: Partial<Omit<DoclingWebClientConfig, "type">>
): DoclingWebClient {
  return new Docling({
    web: {
      ...options,
    },
  });
}

/**
 * Create an API client
 *
 * Convenience factory function that reduces boilerplate for API client creation.
 * Automatically sets the type to 'api' and allows partial configuration.
 *
 * @param baseUrl - The base URL for the Docling API server
 * @param options - Optional additional configuration (timeout, retries, headers, etc.)
 * @returns DoclingAPIClient instance ready for use
 *
 * @example
 * ```typescript
 * const client = createAPIClient('http:
 *   timeout: 30000,
 *   retries: 3,
 *   headers: { 'Authorization': 'Bearer token' }
 * });
 *
 * await client.convertFromUrl('https:
 * ```
 */
export function createAPIClient(
  baseUrl: string,
  options?: Partial<Omit<DoclingAPIConfig, "type" | "baseUrl">>
): DoclingAPIClient {
  return new Docling({
    api: {
      baseUrl,
      ...options,
    },
  });
}

/**
 * Create a CLI client
 *
 * Convenience factory function that reduces boilerplate for CLI client creation.
 * Automatically sets the type to 'cli' and allows partial configuration.
 *
 * @param options - Optional CLI configuration (outputDir, verbose, etc.)
 * @returns DoclingCLIClient instance ready for use
 *
 * @example
 * ```typescript
 * const client = createCLIClient({
 *   outputDir: './converted-docs',
 *   verbose: true,
 *   concurrency: 4
 * });
 *
 * await client.convertFromFile('./document.pdf');
 * ```
 */
export function createCLIClient(
  options?: Partial<Omit<DoclingCLIConfig, "type">>
): DoclingCLIClient {
  return new Docling({
    cli: {
      ...options,
    },
  });
}

export type {
  DoclingConfig,
  DoclingAPIConfig,
  DoclingCLIConfig,
} from "./types/client";

export type { DoclingWebClientConfig } from "./types/web";

export { DoclingWebClient } from "./clients/web-client";

/**
 * Default export of the main Docling factory function
 *
 * Allows both named and default import patterns:
 * - `import { Docling } from 'docling-sdk'`
 * - `import Docling from 'docling-sdk'`
 */
export default Docling;

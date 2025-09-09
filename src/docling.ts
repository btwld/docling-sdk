import { DoclingAPIClient } from "./clients/api-client";
import { DoclingCLIClient } from "./clients/cli-client";
import type { DoclingAPIConfig, DoclingCLIConfig, DoclingConfig } from "./types/client";
import { isAPIConfig, isCLIConfig } from "./types/client";

type ApiVariant = Extract<DoclingConfig, { api: unknown }>;
type CliVariant = Extract<DoclingConfig, { cli: unknown }>;

interface DoclingConstructor {
  new (config: ApiVariant): DoclingAPIClient;
  new (config: CliVariant): DoclingCLIClient;
  new (config: DoclingConfig): DoclingAPIClient | DoclingCLIClient;
}

class DoclingImpl {
  constructor(config: DoclingConfig) {
    if (isAPIConfig(config)) {
      const sharedConfig = omit(config, ["api", "cli"]);
      const apiConfig = {
        type: "api" as const,
        ...config.api,
        ...sharedConfig,
      } satisfies DoclingAPIConfig;
      return new DoclingAPIClient(apiConfig);
    }

    if (isCLIConfig(config)) {
      const sharedConfig = omit(config, ["api", "cli"]);
      const cliConfig = {
        type: "cli" as const,
        ...config.cli,
        ...sharedConfig,
      } satisfies DoclingCLIConfig;
      return new DoclingCLIClient(cliConfig);
    }

    throw new Error("Invalid configuration: must specify either 'api' or 'cli' configuration");
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
    : never;

export function isAPIClient(
  client: DoclingAPIClient | DoclingCLIClient
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
  client: DoclingAPIClient | DoclingCLIClient
): client is DoclingCLIClient {
  return client.type === "cli";
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

/**
 * Default export of the main Docling factory function
 *
 * Allows both named and default import patterns:
 * - `import { Docling } from 'docling-sdk'`
 * - `import Docling from 'docling-sdk'`
 */
export default Docling;

import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

import type {
  CliAsyncOptions,
  CliConfig,
  CliExecutionOptions,
  CliProgressCallback,
  CliResult,
} from "../types";
import { CliError, CliNotFoundError, CliTimeoutError } from "../types";
import { ProcessTimeoutError, runProcess } from "./process-runner";

/**
 * CLI execution utilities
 */
export class CliUtils {
  private config: CliConfig;

  constructor(config: CliConfig = {}) {
    this.config = {
      doclingPath: "docling",
      doclingToolsPath: "docling-tools",
      pythonPath: "python",
      timeout: 300000,
      ...config,
    };
  }

  /**
   * Normalize command for Windows by appending .exe when likely required.
   */
  private normalizeExecutable(cmd: string): string {
    if (process.platform !== "win32") return cmd;

    if (cmd.endsWith(".exe") || cmd.endsWith(".cmd") || cmd.endsWith(".bat")) {
      return cmd;
    }

    const looksLikePath = /[\\/]/.test(cmd) || /^[A-Za-z]:\\/.test(cmd) || cmd.startsWith(".");
    if (looksLikePath) {
      if (existsSync(cmd)) return cmd;
      const candidates = [".exe", ".cmd", ".bat"].map((ext) => `${cmd}${ext}`);
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
    }

    return cmd;
  }

  /**
   * Check if Docling CLI is available
   */
  async checkAvailability(): Promise<boolean> {
    try {
      const result = await this.execute(["--version"], { timeout: 5000 });
      return result.success;
    } catch {
      // Ignore errors
      // Return false if version check fails
      return false;
    }
  }

  /**
   * Get Docling version information
   */
  async getVersion(): Promise<string> {
    const result = await this.execute(["--version"], { timeout: 10000 });
    if (!result.success) {
      throw new CliError("Failed to get version", result.exitCode, result.stdout, result.stderr);
    }
    return result.stdout.trim();
  }

  /**
   * Execute a Docling CLI command synchronously
   */
  async execute(args: string[], options: CliExecutionOptions = {}): Promise<CliResult> {
    const doclingPath = this.config.doclingPath || "docling";
    return this.runCommand(doclingPath, args, options);
  }

  /**
   * Execute a Docling Tools command synchronously
   */
  async executeTools(args: string[], options: CliExecutionOptions = {}): Promise<CliResult> {
    const doclingToolsPath = this.config.doclingToolsPath || "docling-tools";
    return this.runCommand(doclingToolsPath, args, options);
  }

  private async runCommand(
    executable: string,
    args: string[],
    options: CliAsyncOptions
  ): Promise<CliResult> {
    try {
      const result = await runProcess(this.normalizeExecutable(executable), args, {
        timeout: options.timeout ?? this.config.timeout,
        cwd: options.cwd ?? this.config.cwd,
        env: { ...process.env, ...this.config.env, ...options.env },
        stdio: options.stdio,
        signal: options.signal,
        maxBuffer: options.maxBuffer,
        onStdout: (data) => options.onProgress?.({ type: "stdout", data }),
        onStderr: (data) => options.onProgress?.({ type: "stderr", data }),
      });
      return { ...result, exitCode: result.exitCode ?? -1 };
    } catch (error) {
      if (error instanceof ProcessTimeoutError) throw new CliTimeoutError(error.timeout);
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
        throw new CliNotFoundError(executable);
      }
      throw error;
    }
  }

  /**
   * Execute a Docling CLI command asynchronously with progress monitoring
   */
  async executeAsync(args: string[], options: CliAsyncOptions = {}): Promise<CliResult> {
    const doclingPath = this.config.doclingPath || "docling";
    return this.runCommand(doclingPath, args, options);
  }

  /**
   * Execute a Docling Tools command asynchronously with progress monitoring
   */
  async executeToolsAsync(args: string[], options: CliAsyncOptions = {}): Promise<CliResult> {
    const doclingToolsPath = this.config.doclingToolsPath || "docling-tools";
    return this.runCommand(doclingToolsPath, args, options);
  }

  /**
   * Build command arguments from options
   */
  buildArgs(command: string, options: Record<string, unknown> = {}): string[] {
    const args: string[] = [command];

    for (const [key, value] of Object.entries(options)) {
      if (value === undefined || value === null) {
        continue;
      }

      const argName = this.camelToKebab(key);

      if (typeof value === "boolean") {
        if (value) {
          args.push(`--${argName}`);
        }
      } else if (Array.isArray(value)) {
        for (const item of value) {
          args.push(`--${argName}`, String(item));
        }
      } else {
        args.push(`--${argName}`, String(value));
      }
    }

    return args;
  }

  /**
   * Convert camelCase to kebab-case
   */
  private camelToKebab(str: string): string {
    return str
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
      .toLowerCase();
  }

  /**
   * Escape shell arguments
   */
  escapeArg(arg: string): string {
    if (process.platform === "win32") {
      return `"${arg.replace(/"/g, '""')}"`;
    }

    return `'${arg.replace(/'/g, "'\"'\"'")}'`;
  }

  /**
   * Parse CLI output for structured data
   */
  parseOutput(stdout: string, format: "json" | "text" = "text"): unknown {
    if (format === "json") {
      try {
        return JSON.parse(stdout);
      } catch {
        // Ignore errors
        // Re-throw with more context if JSON parsing fails
        throw new CliError("Failed to parse JSON output", 1, stdout, "");
      }
    }
    return stdout;
  }

  /**
   * Extract file paths from CLI output
   */
  extractOutputFiles(stdout: string): string[] {
    const files: string[] = [];
    const lines = stdout.split("\n");

    for (const line of lines) {
      const match = line.match(/(?:Saved to|Written to|Output):\s*(.+)/i);
      if (match?.[1]) {
        files.push(match[1].trim());
      }
    }

    return files;
  }

  /**
   * Monitor CLI process and provide progress updates
   */
  monitorProgress(child: ChildProcess, onProgress?: CliProgressCallback): void {
    if (!onProgress) return;

    if (child.stdout) {
      child.stdout.on("data", (data: Buffer) => {
        onProgress({ type: "stdout", data: data.toString() });
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (data: Buffer) => {
        onProgress({ type: "stderr", data: data.toString() });
      });
    }
  }

  /**
   * Validate CLI configuration
   */
  validateConfig(): void {
    if (!this.config.doclingPath) {
      throw new CliNotFoundError();
    }
  }

  /**
   * Update CLI configuration
   */
  updateConfig(newConfig: Partial<CliConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current CLI configuration
   */
  getConfig(): CliConfig {
    return { ...this.config };
  }
}

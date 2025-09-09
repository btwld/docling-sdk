import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";

import type {
  CliAsyncOptions,
  CliConfig,
  CliExecutionOptions,
  CliProgressCallback,
  CliResult,
} from "../types";
import { CliError, CliNotFoundError, CliTimeoutError } from "../types";

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
   * Forward parent termination signals to child; return a cleanup function.
   */
  private forwardSignals(child: ChildProcess): () => void {
    const onSigint = () => {
      this.gracefulTerminate(child);
      this.forceTerminateAfter(child, 500);
    };
    const onSigterm = () => {
      this.gracefulTerminate(child);
      this.forceTerminateAfter(child, 500);
    };

    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    return () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };
  }

  /**
   * Try graceful termination first.
   */
  private gracefulTerminate(child: ChildProcess): void {
    if (!child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore errors
        // Ignore errors when killing process
      }
    }
  }

  /**
   * Ensure process is terminated after delay; on Windows, kills tree via taskkill.
   */
  private forceTerminateAfter(child: ChildProcess, delayMs: number): void {
    setTimeout(() => {
      if (!child.killed) {
        if (process.platform === "win32" && typeof child.pid === "number") {
          spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
            stdio: "ignore",
            shell: true,
          });
        } else {
          try {
            child.kill("SIGKILL");
          } catch {
            // Ignore errors
            // Ignore errors when force killing process
          }
        }
      }
    }, delayMs);
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
    try {
      const result = await this.execute(["--version"], { timeout: 10000 });
      if (!result.success) {
        throw new CliError("Failed to get version", result.exitCode, result.stdout, result.stderr);
      }
      return result.stdout.trim();
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      throw new CliNotFoundError(this.config.doclingPath);
    }
  }

  /**
   * Execute a Docling CLI command synchronously
   */
  async execute(args: string[], options: CliExecutionOptions = {}): Promise<CliResult> {
    const doclingPath = this.config.doclingPath || "docling";
    return this.executeCommand(doclingPath, args, options);
  }

  /**
   * Execute a Docling Tools command synchronously
   */
  async executeTools(args: string[], options: CliExecutionOptions = {}): Promise<CliResult> {
    const doclingToolsPath = this.config.doclingToolsPath || "docling-tools";
    return this.executeCommand(doclingToolsPath, args, options);
  }

  /**
   * Execute a command with the specified executable
   */
  private async executeCommand(
    executable: string,
    args: string[],
    options: CliExecutionOptions = {}
  ): Promise<CliResult> {
    const execOptions = {
      timeout: options.timeout || this.config.timeout,
      cwd: options.cwd || this.config.cwd,
      env: { ...process.env, ...this.config.env, ...options.env },
    };

    return new Promise<CliResult>((resolve, reject) => {
      const cmd = this.normalizeExecutable(executable);
      const child: ChildProcess = spawn(cmd, args, {
        cwd: execOptions.cwd,
        env: execOptions.env,
        stdio: options.stdio || "pipe",
        shell: false,
        detached: process.platform !== "win32",
      });

      const cleanupSignals = this.forwardSignals(child);

      let stdout = "";
      let stderr = "";
      let timeoutId: NodeJS.Timeout | null = null;

      const timeout = execOptions.timeout;
      if (timeout && timeout > 0) {
        timeoutId = setTimeout(() => {
          this.gracefulTerminate(child);

          this.forceTerminateAfter(child, 500);
          reject(new CliTimeoutError(timeout));
        }, timeout);
      }

      if (child.stdout) {
        child.stdout.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
      }

      if (child.stderr) {
        child.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
      }

      child.on("close", (code: number | null) => {
        if (timeoutId) clearTimeout(timeoutId);
        cleanupSignals();
        const exitCode = code ?? 0;
        resolve({ success: exitCode === 0, stdout, stderr, exitCode });
      });

      child.on("error", (error: Error & { code?: string }) => {
        if (timeoutId) clearTimeout(timeoutId);
        cleanupSignals();
        if (error.code === "ENOENT") {
          reject(new CliNotFoundError(executable));
        } else {
          reject(error);
        }
      });
    });
  }

  /**
   * Execute a Docling CLI command asynchronously with progress monitoring
   */
  async executeAsync(args: string[], options: CliAsyncOptions = {}): Promise<CliResult> {
    const doclingPath = this.config.doclingPath || "docling";
    return this.executeCommandAsync(doclingPath, args, options);
  }

  /**
   * Execute a Docling Tools command asynchronously with progress monitoring
   */
  async executeToolsAsync(args: string[], options: CliAsyncOptions = {}): Promise<CliResult> {
    const doclingToolsPath = this.config.doclingToolsPath || "docling-tools";
    return this.executeCommandAsync(doclingToolsPath, args, options);
  }

  /**
   * Execute a command asynchronously with the specified executable
   */
  private async executeCommandAsync(
    executable: string,
    args: string[],
    options: CliAsyncOptions = {}
  ): Promise<CliResult> {
    return new Promise((resolve, reject) => {
      const execOptions = {
        cwd: options.cwd || this.config.cwd,
        env: { ...process.env, ...this.config.env, ...options.env },
        stdio: options.stdio || "pipe",
      };

      const cmd = this.normalizeExecutable(executable);
      const child: ChildProcess = spawn(cmd, args, {
        cwd: execOptions.cwd,
        env: execOptions.env,
        stdio: execOptions.stdio,
        shell: false,
        detached: process.platform !== "win32",
      });

      const cleanupSignals = this.forwardSignals(child);

      let stdout = "";
      let stderr = "";
      let timeoutId: NodeJS.Timeout | null = null;

      const timeout = options.timeout || this.config.timeout;
      if (timeout && timeout > 0) {
        timeoutId = setTimeout(() => {
          this.gracefulTerminate(child);
          this.forceTerminateAfter(child, 500);
          reject(new CliTimeoutError(timeout));
        }, timeout);
      }

      if (child.stdout) {
        child.stdout.on("data", (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          if (options.onProgress) {
            options.onProgress({ type: "stdout", data: chunk });
          }
        });
      }

      if (child.stderr) {
        child.stderr.on("data", (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          if (options.onProgress) {
            options.onProgress({ type: "stderr", data: chunk });
          }
        });
      }

      child.on("close", (code: number | null) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        cleanupSignals();

        const exitCode = code || 0;
        const result: CliResult = {
          success: exitCode === 0,
          stdout,
          stderr,
          exitCode,
        };

        resolve(result);
      });

      child.on("error", (error: Error) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        cleanupSignals();

        if ((error as { code?: string }).code === "ENOENT") {
          reject(new CliNotFoundError(executable));
        } else {
          reject(error);
        }
      });
    });
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

import { spawn } from "node:child_process";

export interface ProcessRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Milliseconds; zero (the default) disables the timeout. */
  timeout?: number;
  signal?: AbortSignal;
  /** Combined stdout/stderr byte limit; defaults to 10 MiB. */
  maxBuffer?: number;
  stdio?: "pipe" | "inherit" | "ignore";
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface ProcessRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  success: boolean;
}

export class ProcessExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessExecutionError";
  }
}

export class ProcessTimeoutError extends ProcessExecutionError {
  constructor(public readonly timeout: number) {
    super(`Process timed out after ${timeout}ms`);
    this.name = "ProcessTimeoutError";
  }
}

export class ProcessAbortError extends ProcessExecutionError {
  constructor(message = "Process execution aborted") {
    super(message);
    this.name = "ProcessAbortError";
  }
}

export class ProcessOutputLimitError extends ProcessExecutionError {
  constructor(public readonly maxBuffer: number) {
    super(`Process output exceeded ${maxBuffer} bytes`);
    this.name = "ProcessOutputLimitError";
  }
}

const TERMINATION_GRACE_MS = 500;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Internal executable/argv boundary. POSIX children share an isolated process group.
 * On Windows, taskkill provides best-effort tree termination; Node has no Job Object
 * API to retain ownership of descendants after their parent exits. Descendants that
 * deliberately leave the POSIX group are likewise outside this runner's ownership.
 */
export async function runProcess(
  executable: string,
  args: readonly string[],
  options: ProcessRunOptions = {}
): Promise<ProcessRunResult> {
  if (options.signal?.aborted) throw new ProcessAbortError();
  const timeout = options.timeout ?? 0;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 2 ** 31 - 1) {
    throw new RangeError("timeout must be between 0 and 2147483647 milliseconds");
  }
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer < 0) {
    throw new RangeError("maxBuffer must be a nonnegative safe integer");
  }

  return new Promise<ProcessRunResult>((resolve, reject) => {
    // A synchronous spawn failure rejects before any listeners/timers are installed.
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio ?? "pipe",
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let exited = false;
    let closed = false;
    let settled = false;
    let failed = false;
    let failure: unknown;
    let terminating = false;
    let terminationDone = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    let exitCheck: NodeJS.Immediate | undefined;
    let finishGrace: (() => void) | undefined;

    const recordFailure = (error: unknown) => {
      if (!failed) {
        failed = true;
        failure = error;
      }
    };

    const treeIsAlive = (): boolean => {
      if (!child.pid) return false;
      try {
        process.kill(process.platform === "win32" ? child.pid : -child.pid, 0);
        return true;
      } catch (error) {
        // EPERM also means that the target exists.
        return (error as NodeJS.ErrnoException).code !== "ESRCH";
      }
    };

    const destroyPipes = () => {
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
    };

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(graceTimer);
      clearImmediate(exitCheck);
      options.signal?.removeEventListener("abort", onAbort);
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      child.off("error", onError);
      child.off("exit", onExit);
      child.off("close", onClose);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.stdout?.off("error", onError);
      child.stderr?.off("error", onError);
      child.stdin?.off("error", onError);
      destroyPipes();
    };

    const maybeSettle = () => {
      if (settled || !closed || (terminating && !terminationDone)) return;
      settled = true;
      cleanup();
      if (failed) reject(failure);
      else {
        resolve({
          stdout,
          stderr,
          exitCode,
          signal: exitSignal,
          success: exitCode === 0 && exitSignal === null,
        });
      }
    };

    const signalTree = async (force: boolean, signal: NodeJS.Signals): Promise<void> => {
      if (!child.pid) return;
      if (process.platform !== "win32") {
        try {
          process.kill(-child.pid, force ? "SIGKILL" : signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") recordFailure(error);
        }
        return;
      }

      // Never invoke a command shell, including for the Windows tree-kill helper.
      await new Promise<void>((done) => {
        const killer = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/t", ...(force ? ["/f"] : [])],
          {
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          }
        );
        const helperTimer = setTimeout(() => killer.kill("SIGKILL"), 2000);
        const onHelperError = (error: Error) =>
          recordFailure(
            new ProcessExecutionError(`Unable to terminate process tree: ${error.message}`)
          );
        killer.on("error", onHelperError);
        killer.once("close", (code) => {
          clearTimeout(helperTimer);
          killer.off("error", onHelperError);
          if (code !== 0 && !exited) {
            try {
              child.kill(force ? "SIGKILL" : signal);
            } catch (error) {
              recordFailure(error);
            }
          }
          done();
        });
      });
    };

    const beginTermination = (signal: NodeJS.Signals = "SIGTERM") => {
      if (terminating || settled) return;
      terminating = true;
      clearTimeout(timeoutTimer);
      void (async () => {
        await signalTree(false, signal);
        if (treeIsAlive() || !closed) {
          await new Promise<void>((done) => {
            finishGrace = () => {
              clearTimeout(graceTimer);
              finishGrace = undefined;
              done();
            };
            graceTimer = setTimeout(finishGrace, TERMINATION_GRACE_MS);
          });
        }
        // child.killed only records a successful signal send. Probe actual liveness
        // and escalate even if SIGTERM was accepted or the direct child has exited.
        if (treeIsAlive() || !closed) await signalTree(true, "SIGKILL");
        terminationDone = true;
        // An exited parent can leave inherited pipes open. After escalation, close
        // our handles even if a descendant escaped the group / Windows tree lookup.
        if (exited && !closed) destroyPipes();
        maybeSettle();
      })().catch((error: unknown) => {
        recordFailure(error);
        // A helper spawn failure must still attempt to stop the direct child.
        if (!exited) {
          try {
            child.kill("SIGKILL");
          } catch (killError) {
            recordFailure(killError);
          }
        }
        terminationDone = true;
        if (exited) destroyPipes();
        maybeSettle();
      });
    };

    const fail = (error: unknown, signal?: NodeJS.Signals) => {
      recordFailure(error);
      beginTermination(signal);
    };
    const onAbort = () => fail(new ProcessAbortError());
    const onSigint = () => fail(new ProcessAbortError("Process interrupted by SIGINT"), "SIGINT");
    const onSigterm = () =>
      fail(new ProcessAbortError("Process interrupted by SIGTERM"), "SIGTERM");
    const onError = (error: Error) => {
      if (!child.pid) exited = true;
      fail(error); // Retain original spawn errors, including ENOENT and its code.
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      if (!terminating) {
        if (treeIsAlive()) beginTermination();
        else {
          // Let ordinary pipe EOF/close finish first. A surviving inherited pipe
          // still needs bounded cleanup when tree lookup cannot find its owner.
          exitCheck = setImmediate(() => {
            if (!closed) beginTermination();
          });
        }
      }
      if (terminating && !treeIsAlive()) finishGrace?.();
      if (terminationDone && !closed) destroyPipes();
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      exited = true;
      closed = true;
      exitCode = code;
      exitSignal = signal;
      if (!terminating && treeIsAlive()) beginTermination();
      if (!treeIsAlive()) finishGrace?.();
      maybeSettle();
    };
    const receive = (data: string, stream: "stdout" | "stderr") => {
      if (failed || settled) return;
      outputBytes += Buffer.byteLength(data);
      if (outputBytes > maxBuffer) {
        fail(new ProcessOutputLimitError(maxBuffer));
        return;
      }
      if (stream === "stdout") stdout += data;
      else stderr += data;
      try {
        (stream === "stdout" ? options.onStdout : options.onStderr)?.(data);
      } catch (error) {
        fail(error);
      }
    };
    const onStdout = (data: string) => receive(data, "stdout");
    const onStderr = (data: string) => receive(data, "stderr");

    child.once("error", onError);
    child.once("exit", onExit);
    child.once("close", onClose);
    child.stdout?.setEncoding("utf8").on("data", onStdout).on("error", onError);
    child.stderr?.setEncoding("utf8").on("data", onStderr).on("error", onError);
    child.stdin?.on("error", onError);
    child.stdin?.end();
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (timeout > 0) {
      timeoutTimer = setTimeout(() => fail(new ProcessTimeoutError(timeout)), timeout);
    }
    // Cover cancellation between the initial check and listener installation.
    if (options.signal?.aborted) onAbort();
  });
}

import { spawn } from "node:child_process";
import * as vscode from "vscode";

export interface ToolboxRunResult {
  command: string;
  args: string[];
  cwd?: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class ToolboxInvocationError extends Error {
  public readonly result: ToolboxRunResult;
  public readonly causeError?: unknown;

  public constructor(message: string, result: ToolboxRunResult, causeError?: unknown) {
    super(message);
    this.name = "ToolboxInvocationError";
    this.result = result;
    this.causeError = causeError;
  }
}

let warnedWorkspaceToolboxPath = false;
const TOOLBOX_TIMEOUT_MS = 30_000;
const TOOLBOX_FORCE_KILL_AFTER_MS = 2_000;
const MAX_TOOLBOX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_TOOLBOX_STDERR_BYTES = 1 * 1024 * 1024;

function getToolboxCommand(): string {
  const config = vscode.workspace.getConfiguration("audioEda");
  const inspected = config.inspect<string>("toolboxPath");
  const defaultValue =
    typeof inspected?.defaultValue === "string" && inspected.defaultValue.trim()
      ? inspected.defaultValue.trim()
      : "audio-eda";
  const globalValue =
    typeof inspected?.globalValue === "string" && inspected.globalValue.trim()
      ? inspected.globalValue.trim()
      : undefined;

  if (!warnedWorkspaceToolboxPath && (inspected?.workspaceValue || inspected?.workspaceFolderValue)) {
    warnedWorkspaceToolboxPath = true;
    void vscode.window.showWarningMessage(
      "Ignoring workspace value for audioEda.toolboxPath for security; using user/global setting."
    );
  }

  return globalValue ?? defaultValue;
}

function validateToolboxCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("audioEda.toolboxPath must not be empty.");
  }

  if (/[\r\n;&|`$<>]/.test(trimmed)) {
    throw new Error(
      "audioEda.toolboxPath contains disallowed shell metacharacters."
    );
  }

  return trimmed;
}

function runToolbox(args: string[], cwd?: string): Promise<ToolboxRunResult> {
  const command = validateToolboxCommand(getToolboxCommand());

  return new Promise<ToolboxRunResult>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true
    });

    let settled = false;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let forceKillHandle: ReturnType<typeof setTimeout> | undefined;
    let terminationRequested = false;

    const settle = (exitCode: number): void => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (forceKillHandle) {
        clearTimeout(forceKillHandle);
      }
      resolve({
        command,
        args,
        cwd,
        stdout,
        stderr,
        exitCode
      });
    };

    const terminateChild = (): void => {
      if (terminationRequested) {
        return;
      }

      terminationRequested = true;
      try {
        child.kill();
      } catch {
        // ignore: child may already be terminated
      }

      forceKillHandle = setTimeout(() => {
        if (settled) {
          return;
        }

        try {
          child.kill("SIGKILL");
        } catch {
          // ignore: process may not accept force-kill signal on platform/runtime
        }

        settle(-1);
      }, TOOLBOX_FORCE_KILL_AFTER_MS);
    };

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      stderr += `\nToolbox command timed out after ${TOOLBOX_TIMEOUT_MS}ms.`;
      terminateChild();
    }, TOOLBOX_TIMEOUT_MS);

    const appendChunk = (
      chunk: Buffer,
      maxBytes: number,
      currentText: string,
      currentBytes: number
    ): { nextText: string; nextBytes: number; exceeded: boolean } => {
      if (currentBytes >= maxBytes) {
        return {
          nextText: currentText,
          nextBytes: currentBytes,
          exceeded: true
        };
      }

      const chunkBytes = chunk.byteLength;
      if (currentBytes + chunkBytes <= maxBytes) {
        return {
          nextText: currentText + chunk.toString("utf8"),
          nextBytes: currentBytes + chunkBytes,
          exceeded: false
        };
      }

      const remainingBytes = Math.max(0, maxBytes - currentBytes);
      return {
        nextText: currentText + chunk.subarray(0, remainingBytes).toString("utf8"),
        nextBytes: maxBytes,
        exceeded: true
      };
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const appended = appendChunk(chunk, MAX_TOOLBOX_STDOUT_BYTES, stdout, stdoutBytes);
      stdout = appended.nextText;
      stdoutBytes = appended.nextBytes;
      if (appended.exceeded && !outputLimitExceeded) {
        outputLimitExceeded = true;
        stderr += `\nToolbox stdout exceeded ${MAX_TOOLBOX_STDOUT_BYTES} bytes; process terminated.`;
        terminateChild();
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const appended = appendChunk(chunk, MAX_TOOLBOX_STDERR_BYTES, stderr, stderrBytes);
      stderr = appended.nextText;
      stderrBytes = appended.nextBytes;
      if (appended.exceeded && !outputLimitExceeded) {
        outputLimitExceeded = true;
        stderr += `\nToolbox stderr exceeded ${MAX_TOOLBOX_STDERR_BYTES} bytes; process terminated.`;
        terminateChild();
      }
    });

    child.on("error", (error: Error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (forceKillHandle) {
        clearTimeout(forceKillHandle);
      }
      stderr += error.message;
      settle(-1);
    });

    child.on("close", (code: number | null) => {
      if (timedOut || outputLimitExceeded) {
        settle(-1);
        return;
      }

      settle(code ?? -1);
    });
  });
}

export async function runToolboxJson(args: string[], cwd?: string): Promise<unknown> {
  const result = await runToolbox(args, cwd);
  if (result.exitCode !== 0) {
    throw new ToolboxInvocationError(
      `Command failed (${result.exitCode}): ${result.command} ${result.args.join(" ")}`,
      result
    );
  }

  const trimmed = result.stdout.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error: unknown) {
    throw new ToolboxInvocationError("Toolbox output was not valid JSON.", result, error);
  }
}

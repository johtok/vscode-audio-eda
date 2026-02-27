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

function getToolboxCommand(): string {
  return vscode.workspace.getConfiguration("audioEda").get<string>("toolboxPath", "audio-eda");
}

function runToolbox(args: string[], cwd?: string): Promise<ToolboxRunResult> {
  const command = getToolboxCommand();

  return new Promise<ToolboxRunResult>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32"
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error: Error) => {
      stderr += error.message;
      resolve({
        command,
        args,
        cwd,
        stdout,
        stderr,
        exitCode: -1
      });
    });

    child.on("close", (code: number | null) => {
      resolve({
        command,
        args,
        cwd,
        stdout,
        stderr,
        exitCode: code ?? -1
      });
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

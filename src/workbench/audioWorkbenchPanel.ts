import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildWorkbenchHtml, getWorkbenchLocalResourceRoots } from "./workbenchHtml";
import { buildExportFilters, parseSaveTextFileRequest } from "./saveTextFile";
import { runToolboxJson, ToolboxInvocationError } from "../toolbox/toolboxCli";

export interface WorkbenchStatePersistence {
  load(): unknown | undefined;
  save(state: unknown): Thenable<void> | void;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

const MAX_RCLUSTER_CSV_BYTES = 8 * 1024 * 1024;
const MAX_RUN_CONTEXT_CHARS = 64_000;

function sanitizeNullableText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  if (!value.trim()) {
    return null;
  }
  if (value.length > maxChars) {
    return value.slice(0, maxChars);
  }
  return value;
}

function sanitizeInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function sanitizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

export class AudioWorkbenchPanel {
  public static readonly viewType = "audioEda.workbench";
  private static currentPanel: AudioWorkbenchPanel | undefined;
  private static statePersistence: WorkbenchStatePersistence | undefined;

  public static configureStatePersistence(persistence: WorkbenchStatePersistence): void {
    AudioWorkbenchPanel.statePersistence = persistence;
  }

  public static openPreset(extensionUri: vscode.Uri, presetId: string): void {
    AudioWorkbenchPanel.createOrShow(extensionUri);
    AudioWorkbenchPanel.currentPanel?.setPreset(presetId);
  }

  public static createOrShow(extensionUri: vscode.Uri, initialAudioUri?: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (AudioWorkbenchPanel.currentPanel) {
      AudioWorkbenchPanel.currentPanel.panel.reveal(column);
      if (initialAudioUri?.scheme === "file") {
        AudioWorkbenchPanel.currentPanel.setPreloadedAudio(initialAudioUri);
      } else {
        AudioWorkbenchPanel.currentPanel.unlockAudioPicker();
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      AudioWorkbenchPanel.viewType,
      "Audio EDA Workbench",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: getWorkbenchLocalResourceRoots(
          extensionUri,
          initialAudioUri ? [initialAudioUri] : []
        )
      }
    );

    AudioWorkbenchPanel.currentPanel = new AudioWorkbenchPanel(
      panel,
      extensionUri,
      initialAudioUri,
      AudioWorkbenchPanel.statePersistence
    );
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly statePersistence: WorkbenchStatePersistence | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private pendingPreloadUri: vscode.Uri | undefined;
  private pendingPresetId: string | undefined;
  private webviewReady = false;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    initialAudioUri: vscode.Uri | undefined,
    statePersistence: WorkbenchStatePersistence | undefined
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.statePersistence = statePersistence;
    this.pendingPreloadUri = initialAudioUri?.scheme === "file" ? initialAudioUri : undefined;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => this.handleWebviewMessage(message),
      null,
      this.disposables
    );
    this.panel.webview.html = buildWorkbenchHtml(
      this.panel.webview,
      this.extensionUri,
      this.statePersistence?.load()
    );
  }

  private dispose(): void {
    AudioWorkbenchPanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
  }

  private handleWebviewMessage(message: unknown): void {
    const record = asRecord(message);
    if (!record) {
      return;
    }

    const messageType = typeof record.type === "string" ? record.type : "";
    if (messageType === "ready") {
      this.webviewReady = true;
      this.trySendPreloadMessage();
      this.trySendPresetMessage();
      return;
    }

    if (messageType === "stateChanged" && "payload" in record) {
      void this.statePersistence?.save(record.payload);
      return;
    }

    if (messageType === "runRCluster") {
      void this.runRCluster(record.payload);
      return;
    }

    if (messageType === "saveTextFile") {
      void this.saveTextFile(record.payload);
    }
  }

  private async saveTextFile(rawPayload: unknown): Promise<void> {
    const parsedRequest = parseSaveTextFileRequest(rawPayload);
    if (!parsedRequest.ok) {
      const payload = asRecord(rawPayload);
      const requestId = sanitizeNullableText(payload?.requestId, 128);
      if (!requestId) {
        return;
      }
      void this.panel.webview.postMessage({
        type: "saveTextFileResult",
        payload: {
          requestId,
          ok: false,
          cancelled: false,
          message: parsedRequest.error
        }
      });
      return;
    }

    const request = parsedRequest.value;
    const requestId = request.requestId;

    const postResult = (ok: boolean, message?: string, fileUri?: string, cancelled = false): void => {
      void this.panel.webview.postMessage({
        type: "saveTextFileResult",
        payload: {
          requestId,
          ok,
          cancelled,
          message,
          fileUri
        }
      });
    };

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultBase = workspaceRoot ?? vscode.Uri.file(os.homedir());
    const defaultUri = vscode.Uri.joinPath(defaultBase, request.fileName);
    const filters = buildExportFilters(request.fileName, request.mimeType);

    try {
      const targetUri = await vscode.window.showSaveDialog({
        defaultUri,
        saveLabel: "Export Metrics",
        filters
      });

      if (!targetUri) {
        postResult(false, "Save canceled.", undefined, true);
        return;
      }

      const bytes = new TextEncoder().encode(request.content);
      await vscode.workspace.fs.writeFile(targetUri, bytes);
      postResult(true, undefined, targetUri.toString());
    } catch (error: unknown) {
      postResult(false, error instanceof Error ? error.message : String(error));
    }
  }

  private async runRCluster(rawPayload: unknown): Promise<void> {
    const payload = asRecord(rawPayload);
    if (!payload) {
      void this.panel.webview.postMessage({
        type: "rClusterError",
        payload: { message: "Invalid run payload." }
      });
      return;
    }

    const featureCsvText = sanitizeNullableText(payload.featureCsvText, MAX_RCLUSTER_CSV_BYTES * 2);
    const labelsCsvText = sanitizeNullableText(payload.labelsCsvText, MAX_RCLUSTER_CSV_BYTES * 2);
    if (!featureCsvText) {
      void this.panel.webview.postMessage({
        type: "rClusterError",
        payload: { message: "Generated feature CSV content is required." }
      });
      return;
    }
    if (!labelsCsvText) {
      void this.panel.webview.postMessage({
        type: "rClusterError",
        payload: { message: "Generated labels CSV content is required." }
      });
      return;
    }
    if (featureCsvText.includes("\0") || labelsCsvText.includes("\0")) {
      void this.panel.webview.postMessage({
        type: "rClusterError",
        payload: { message: "CSV payload contains invalid NUL byte." }
      });
      return;
    }

    const featureCsvBytes = Buffer.byteLength(featureCsvText, "utf8");
    const labelsCsvBytes = Buffer.byteLength(labelsCsvText, "utf8");
    if (featureCsvBytes > MAX_RCLUSTER_CSV_BYTES || labelsCsvBytes > MAX_RCLUSTER_CSV_BYTES) {
      void this.panel.webview.postMessage({
        type: "rClusterError",
        payload: {
          message:
            "Generated CSV payload is too large (feature=" +
            featureCsvBytes +
            " bytes, labels=" +
            labelsCsvBytes +
            " bytes)."
        }
      });
      return;
    }

    const k = sanitizeInteger(payload.k, 2, 2, 64);
    const seed = sanitizeInteger(payload.seed, 0, -2147483648, 2147483647);
    const maxIter = sanitizeInteger(payload.maxIter, 64, 4, 2048);
    const stabilityRuns = sanitizeInteger(payload.stabilityRuns, 16, 1, 128);
    const rowRatio = sanitizeNumber(payload.rowRatio, 0.8, 0.1, 1);
    const featureRatio = sanitizeNumber(payload.featureRatio, 0.8, 0.1, 1);
    const runContext = asRecord(payload.runContext);
    const runContextSerialized = runContext ? JSON.stringify(runContext) : undefined;
    const safeRunContext =
      runContextSerialized && runContextSerialized.length <= MAX_RUN_CONTEXT_CHARS
        ? runContext
        : undefined;

    let tempDir: string | undefined;
    try {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "audio-eda-rcluster-"));
      const featureCsvPath = path.join(tempDir, "features.csv");
      const labelsCsvPath = path.join(tempDir, "labels.csv");
      await fs.writeFile(featureCsvPath, featureCsvText, { encoding: "utf8", mode: 0o600 });
      await fs.writeFile(labelsCsvPath, labelsCsvText, { encoding: "utf8", mode: 0o600 });

      const args = [
        "r-cluster",
        featureCsvPath,
        "--k",
        String(k),
        "--seed",
        String(seed),
        "--max-iter",
        String(maxIter),
        "--stability-runs",
        String(stabilityRuns),
        "--row-ratio",
        String(rowRatio),
        "--feature-ratio",
        String(featureRatio),
        "--labels-csv",
        labelsCsvPath,
        "--json"
      ];

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const cwd = workspaceRoot || tempDir;

      void this.panel.webview.postMessage({ type: "rClusterRunStarted" });
      const result = await runToolboxJson(args, cwd);
      void this.panel.webview.postMessage({
        type: "rClusterResult",
        payload: {
          result,
          runContext: safeRunContext
        }
      });
    } catch (error: unknown) {
      let message = error instanceof Error ? error.message : String(error);
      if (error instanceof ToolboxInvocationError) {
        const stderr = error.result.stderr.trim();
        if (stderr) {
          message = stderr;
        }
      }
      void this.panel.webview.postMessage({
        type: "rClusterError",
        payload: { message }
      });
    } finally {
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // best effort cleanup
        }
      }
    }
  }

  private setPreloadedAudio(uri: vscode.Uri): void {
    this.pendingPreloadUri = uri;
    this.extendLocalResourceRootsForUri(uri);
    this.trySendPreloadMessage();
  }

  private extendLocalResourceRootsForUri(uri: vscode.Uri): void {
    this.panel.webview.options = {
      ...this.panel.webview.options,
      localResourceRoots: getWorkbenchLocalResourceRoots(this.extensionUri, [uri])
    };
  }

  private unlockAudioPicker(): void {
    if (!this.webviewReady) {
      return;
    }

    void this.panel.webview.postMessage({
      type: "unlockAudioPicker"
    });
  }

  private setPreset(presetId: string): void {
    this.pendingPresetId = presetId;
    this.trySendPresetMessage();
  }

  private trySendPreloadMessage(): void {
    if (!this.webviewReady || !this.pendingPreloadUri) {
      return;
    }

    const sourceUri = this.pendingPreloadUri;
    const webviewUri = this.panel.webview.asWebviewUri(sourceUri);
    const fileName = sourceUri.path.split("/").pop() ?? "audio";

    void this.panel.webview.postMessage({
      type: "preloadAudio",
      payload: {
        name: fileName,
        uri: webviewUri.toString()
      }
    });

    this.pendingPreloadUri = undefined;
  }

  private trySendPresetMessage(): void {
    if (!this.webviewReady || !this.pendingPresetId) {
      return;
    }

    void this.panel.webview.postMessage({
      type: "applyPreset",
      payload: {
        presetId: this.pendingPresetId
      }
    });

    this.pendingPresetId = undefined;
  }
}

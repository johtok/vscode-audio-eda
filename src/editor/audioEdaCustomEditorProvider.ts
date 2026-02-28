import * as vscode from "vscode";
import * as path from "node:path";
import { buildWorkbenchHtml, getWorkbenchLocalResourceRoots } from "../workbench/workbenchHtml";
import { buildExportFilters, parseSaveTextFileRequest } from "../workbench/saveTextFile";

interface AudioEdaDocument extends vscode.CustomDocument {
  readonly uri: vscode.Uri;
}

export interface AudioEdaEditorStatePersistence {
  loadForUri(uri: vscode.Uri): unknown | undefined;
  saveForUri(uri: vscode.Uri, state: unknown): Thenable<void> | void;
  noteRecentWorkspace?(uri: vscode.Uri): Thenable<void> | void;
}

function createCustomDocument(uri: vscode.Uri): AudioEdaDocument {
  return {
    uri,
    dispose(): void {
      // no-op: readonly custom document
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function sanitizeNullableText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

export class AudioEdaCustomEditorProvider
  implements vscode.CustomReadonlyEditorProvider<AudioEdaDocument>
{
  public static readonly viewType = "audioEda.editor";

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly statePersistence?: AudioEdaEditorStatePersistence
  ) {}

  public async openCustomDocument(uri: vscode.Uri): Promise<AudioEdaDocument> {
    return createCustomDocument(uri);
  }

  public async resolveCustomEditor(
    document: AudioEdaDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    void this.statePersistence?.noteRecentWorkspace?.(document.uri);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: getWorkbenchLocalResourceRoots(this.extensionUri, [document.uri])
    };

    let ready = false;
    let preloadSent = false;

    const sendPreloadIfReady = (): void => {
      if (!ready || preloadSent || document.uri.scheme !== "file") {
        return;
      }

      preloadSent = true;
      const webviewUri = webviewPanel.webview.asWebviewUri(document.uri);
      const fileName = document.uri.path.split("/").pop() ?? "audio";

      void webviewPanel.webview.postMessage({
        type: "preloadAudio",
        payload: {
          name: fileName,
          uri: webviewUri.toString()
        }
      });
    };

    const onMessage = webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      const record = asRecord(message);
      if (!record) {
        return;
      }

      if (record.type === "ready") {
        ready = true;
        sendPreloadIfReady();
        return;
      }

      if (record.type === "stateChanged" && "payload" in record) {
        void this.statePersistence?.saveForUri(document.uri, record.payload);
        return;
      }

      if (record.type === "saveTextFile") {
        void this.saveTextFileFromWebview(webviewPanel, document.uri, record.payload);
      }
    });

    webviewPanel.webview.html = buildWorkbenchHtml(
      webviewPanel.webview,
      this.extensionUri,
      this.statePersistence?.loadForUri(document.uri)
    );

    webviewPanel.onDidDispose(() => {
      onMessage.dispose();
    });
  }

  private async saveTextFileFromWebview(
    webviewPanel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
    rawPayload: unknown
  ): Promise<void> {
    const parsedRequest = parseSaveTextFileRequest(rawPayload);
    if (!parsedRequest.ok) {
      const payload = asRecord(rawPayload);
      const requestId = sanitizeNullableText(payload?.requestId, 128);
      if (!requestId) {
        return;
      }
      void webviewPanel.webview.postMessage({
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
      void webviewPanel.webview.postMessage({
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

    const baseDir = documentUri.scheme === "file" ? vscode.Uri.file(path.dirname(documentUri.fsPath)) : undefined;
    const defaultUri = baseDir ? vscode.Uri.joinPath(baseDir, request.fileName) : undefined;
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
}

import * as vscode from "vscode";
import { buildWorkbenchHtml, getWorkbenchLocalResourceRoots } from "../workbench/workbenchHtml";

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
      if (!message || typeof message !== "object") {
        return;
      }

      if ("type" in message && message.type === "ready") {
        ready = true;
        sendPreloadIfReady();
        return;
      }

      if ("type" in message && message.type === "stateChanged" && "payload" in message) {
        void this.statePersistence?.saveForUri(document.uri, message.payload);
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
}

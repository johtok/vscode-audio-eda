import * as vscode from "vscode";
import { buildWorkbenchHtml, getWorkbenchLocalResourceRoots } from "./workbenchHtml";

export class AudioWorkbenchPanel {
  public static readonly viewType = "audioEda.workbench";
  private static currentPanel: AudioWorkbenchPanel | undefined;

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
        localResourceRoots: getWorkbenchLocalResourceRoots(extensionUri)
      }
    );

    AudioWorkbenchPanel.currentPanel = new AudioWorkbenchPanel(panel, extensionUri, initialAudioUri);
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private pendingPreloadUri: vscode.Uri | undefined;
  private pendingPresetId: string | undefined;
  private webviewReady = false;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, initialAudioUri?: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.pendingPreloadUri = initialAudioUri?.scheme === "file" ? initialAudioUri : undefined;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => this.handleWebviewMessage(message),
      null,
      this.disposables
    );
    this.panel.webview.html = buildWorkbenchHtml(this.panel.webview, this.extensionUri);
  }

  private dispose(): void {
    AudioWorkbenchPanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
  }

  private handleWebviewMessage(message: unknown): void {
    if (!message || typeof message !== "object") {
      return;
    }

    if ("type" in message && message.type === "ready") {
      this.webviewReady = true;
      this.trySendPreloadMessage();
      this.trySendPresetMessage();
    }
  }

  private setPreloadedAudio(uri: vscode.Uri): void {
    this.pendingPreloadUri = uri;
    this.trySendPreloadMessage();
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

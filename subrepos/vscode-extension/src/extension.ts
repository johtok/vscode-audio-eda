import * as vscode from "vscode";
import * as path from "path";

import { AudioEdaCustomEditorProvider } from "./editor/audioEdaCustomEditorProvider";
import {
  AudioEdaSidebarProvider,
  RecentWorkspaceEntry,
  WorkspacePresetId
} from "./sidebar/audioEdaSidebarProvider";
import { runToolboxJson, ToolboxInvocationError } from "./toolbox/toolboxCli";
import { AudioWorkbenchPanel } from "./workbench/audioWorkbenchPanel";

const AUDIO_EXTENSIONS = new Set([
  ".wav",
  ".flac",
  ".mp3",
  ".mpga",
  ".mpeg",
  ".ogg",
  ".m4a",
  ".aac",
  ".opus",
  ".sph"
]);

const EXTENSION_ID = "local-dev.audio-eda-vscode";
const WORKBENCH_STATE_KEY = "audioEda.workbenchState";
const WORKBENCH_STATE_BY_AUDIO_KEY = "audioEda.workbenchStateByAudio";
const RECENT_WORKSPACES_KEY = "audioEda.recentWorkspaces";
const MAX_RECENT_WORKSPACES = 5;

interface RecentWorkspaceRecord {
  readonly uri: string;
  readonly label: string;
  readonly description?: string;
  readonly timestamp: number;
}

function logJson(channel: vscode.OutputChannel, heading: string, payload: unknown): void {
  channel.appendLine(heading);
  channel.appendLine(JSON.stringify(payload, null, 2));
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("audioEda");
}

function sanitizeStateMap(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[String(key)] = value;
  }
  return out;
}

function sanitizeRecentWorkspaceRecords(raw: unknown): RecentWorkspaceRecord[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const deduped = new Map<string, RecentWorkspaceRecord>();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Partial<RecentWorkspaceRecord>;
    if (typeof record.uri !== "string" || !record.uri.trim()) {
      continue;
    }

    const uri = record.uri.trim();
    let fallbackLabel = "audio";
    try {
      fallbackLabel = path.basename(vscode.Uri.parse(uri).path) || fallbackLabel;
    } catch {
      fallbackLabel = "audio";
    }
    const label =
      typeof record.label === "string" && record.label.trim()
        ? record.label.trim()
        : fallbackLabel;
    const description =
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : undefined;
    const timestamp = Number.isFinite(Number(record.timestamp))
      ? Number(record.timestamp)
      : Date.now();

    if (!deduped.has(uri)) {
      deduped.set(uri, { uri, label, description, timestamp });
    }
  }

  return Array.from(deduped.values())
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, MAX_RECENT_WORKSPACES);
}

function toRecentWorkspaceEntries(
  records: readonly RecentWorkspaceRecord[]
): RecentWorkspaceEntry[] {
  return records.slice(0, MAX_RECENT_WORKSPACES).map((record) => ({
    uri: record.uri,
    label: record.label,
    description: record.description
  }));
}

function createRecentWorkspaceRecord(uri: vscode.Uri): RecentWorkspaceRecord {
  const uriString = uri.toString();
  const label = path.basename(uri.fsPath || uri.path);
  const relativePath = vscode.workspace.asRelativePath(uri, false);
  const description = relativePath && relativePath !== label ? relativePath : uri.fsPath || uri.path;
  return {
    uri: uriString,
    label,
    description,
    timestamp: Date.now()
  };
}

function isAudioUri(uri: vscode.Uri | undefined): uri is vscode.Uri {
  if (!uri || uri.scheme !== "file") {
    return false;
  }

  const filePath = uri.fsPath.toLowerCase();
  for (const extension of AUDIO_EXTENSIONS) {
    if (filePath.endsWith(extension)) {
      return true;
    }
  }

  return false;
}

function getAudioUriFromArgs(uri?: vscode.Uri): vscode.Uri | undefined {
  if (isAudioUri(uri)) {
    return uri;
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (isAudioUri(activeUri)) {
    return activeUri;
  }

  return undefined;
}

async function resolveAudioFilePath(uri?: vscode.Uri): Promise<string | undefined> {
  if (uri?.scheme === "file") {
    return uri.fsPath;
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri?.scheme === "file") {
    return activeUri.fsPath;
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFolders: false,
    canSelectFiles: true,
    canSelectMany: false,
    title: "Select audio file",
    filters: {
      "Audio files": ["wav", "flac", "mp3", "mpga", "mpeg", "ogg", "m4a", "aac", "opus", "sph"]
    }
  });
  return selected?.[0]?.fsPath;
}

async function resolveFolderPath(uri?: vscode.Uri): Promise<string | undefined> {
  if (uri?.scheme === "file") {
    return uri.fsPath;
  }

  const workspaceRoot = getWorkspaceRoot();
  if (workspaceRoot) {
    return workspaceRoot;
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    title: "Select folder to summarize"
  });
  return selected?.[0]?.fsPath;
}

function handleToolboxError(channel: vscode.OutputChannel, error: unknown): void {
  if (error instanceof ToolboxInvocationError) {
    channel.appendLine(`[toolbox] ${error.message}`);
    if (error.result.stderr.trim()) {
      channel.appendLine(error.result.stderr.trim());
    }
    void vscode.window.showErrorMessage(`Audio EDA toolbox failed: ${error.message}`);
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  channel.appendLine(`[toolbox] Unexpected error: ${message}`);
  void vscode.window.showErrorMessage(`Audio EDA unexpected error: ${message}`);
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Audio EDA");
  const sidebarProvider = new AudioEdaSidebarProvider();
  const reopenGuard = new Set<string>();

  const loadStateMap = (): Record<string, unknown> =>
    sanitizeStateMap(context.workspaceState.get<unknown>(WORKBENCH_STATE_BY_AUDIO_KEY));

  const loadRecentWorkspaceRecords = (): RecentWorkspaceRecord[] =>
    sanitizeRecentWorkspaceRecords(context.workspaceState.get<unknown>(RECENT_WORKSPACES_KEY));

  const publishRecentWorkspaces = (records: readonly RecentWorkspaceRecord[]): void => {
    sidebarProvider.setRecentWorkspaces(toRecentWorkspaceEntries(records));
  };

  const noteRecentWorkspace = async (uri: vscode.Uri): Promise<void> => {
    if (!isAudioUri(uri)) {
      return;
    }

    const current = loadRecentWorkspaceRecords();
    const nextRecord = createRecentWorkspaceRecord(uri);
    const merged = [nextRecord, ...current.filter((entry) => entry.uri !== nextRecord.uri)].slice(
      0,
      MAX_RECENT_WORKSPACES
    );

    await context.workspaceState.update(RECENT_WORKSPACES_KEY, merged);
    publishRecentWorkspaces(merged);
  };

  const workbenchStatePersistence = {
    load: (): unknown | undefined => context.workspaceState.get(WORKBENCH_STATE_KEY),
    save: (state: unknown): Thenable<void> =>
      context.workspaceState.update(WORKBENCH_STATE_KEY, state)
  };

  const customEditorStatePersistence = {
    loadForUri: (uri: vscode.Uri): unknown | undefined => {
      const stateByAudio = loadStateMap();
      const key = uri.toString();
      return stateByAudio[key] ?? context.workspaceState.get(WORKBENCH_STATE_KEY);
    },
    saveForUri: async (uri: vscode.Uri, state: unknown): Promise<void> => {
      const stateByAudio = loadStateMap();
      stateByAudio[uri.toString()] = state;
      await context.workspaceState.update(WORKBENCH_STATE_BY_AUDIO_KEY, stateByAudio);
      await context.workspaceState.update(WORKBENCH_STATE_KEY, state);
      await noteRecentWorkspace(uri);
    },
    noteRecentWorkspace
  };

  const sidebarTree = vscode.window.registerTreeDataProvider("audioEdaSidebar", sidebarProvider);
  publishRecentWorkspaces(loadRecentWorkspaceRecords());
  AudioWorkbenchPanel.configureStatePersistence(workbenchStatePersistence);

  const customEditorProvider = new AudioEdaCustomEditorProvider(
    context.extensionUri,
    customEditorStatePersistence
  );
  const customEditorRegistration = vscode.window.registerCustomEditorProvider(
    AudioEdaCustomEditorProvider.viewType,
    customEditorProvider,
    {
      webviewOptions: {
        retainContextWhenHidden: true
      },
      supportsMultipleEditorsPerDocument: true
    }
  );

  const openWithAudioEdaEditor = async (uri: vscode.Uri): Promise<boolean> => {
    if (!isAudioUri(uri)) {
      return false;
    }

    const key = uri.toString();
    if (reopenGuard.has(key)) {
      return true;
    }

    reopenGuard.add(key);

    try {
      await vscode.commands.executeCommand("vscode.openWith", uri, AudioEdaCustomEditorProvider.viewType);
      await noteRecentWorkspace(uri);
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[openWith] fallback to panel for ${uri.fsPath}: ${message}`);
      AudioWorkbenchPanel.createOrShow(context.extensionUri, uri);
      await noteRecentWorkspace(uri);
      return false;
    } finally {
      setTimeout(() => {
        reopenGuard.delete(key);
      }, 1200);
    }
  };

  const maybeAutoOpenAudioEditor = (uri: vscode.Uri | undefined): void => {
    const autoOpen = getConfig().get<boolean>("openWorkbenchWhenAudioFileFocused", true);
    if (!autoOpen || !isAudioUri(uri)) {
      return;
    }

    void openWithAudioEdaEditor(uri);
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      publishRecentWorkspaces(loadRecentWorkspaceRecords());
      sidebarProvider.refresh();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      maybeAutoOpenAudioEditor(editor?.document.uri);
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      maybeAutoOpenAudioEditor(document.uri);
    })
  );

  const openWorkbenchCommand = vscode.commands.registerCommand("audioEda.openWorkbench", () => {
    AudioWorkbenchPanel.createOrShow(context.extensionUri);
  });

  const openPresetWorkspaceCommand = vscode.commands.registerCommand(
    "audioEda.openPresetWorkspace",
    (presetId?: WorkspacePresetId) => {
      AudioWorkbenchPanel.openPreset(context.extensionUri, presetId ?? "default");
    }
  );

  const openPresetTransformsCommand = vscode.commands.registerCommand(
    "audioEda.openPresetTransforms",
    () => {
      AudioWorkbenchPanel.openPreset(context.extensionUri, "transforms");
    }
  );

  const openPresetMetricsCommand = vscode.commands.registerCommand(
    "audioEda.openPresetMetrics",
    () => {
      AudioWorkbenchPanel.openPreset(context.extensionUri, "metrics");
    }
  );

  const openPresetPcaCommand = vscode.commands.registerCommand("audioEda.openPresetPca", () => {
    AudioWorkbenchPanel.openPreset(context.extensionUri, "pca");
  });

  const openWorkbenchForFileCommand = vscode.commands.registerCommand(
    "audioEda.openWorkbenchForFile",
    async (uri?: vscode.Uri) => {
      const targetUri = getAudioUriFromArgs(uri);
      if (targetUri) {
        await openWithAudioEdaEditor(targetUri);
        return;
      }

      const targetPath = await resolveAudioFilePath(uri);
      if (!targetPath) {
        return;
      }

      await openWithAudioEdaEditor(vscode.Uri.file(targetPath));
    }
  );

  const reopenActiveWithAudioEdaCommand = vscode.commands.registerCommand(
    "audioEda.reopenActiveWithAudioEda",
    async () => {
      const activeUri = vscode.window.activeTextEditor?.document.uri;
      if (!isAudioUri(activeUri)) {
        void vscode.window.showWarningMessage(
          "Active editor is not a supported audio file (.wav/.flac/.mp3/.mpga/.mpeg/.ogg/.m4a/.aac/.opus/.sph)."
        );
        return;
      }

      await openWithAudioEdaEditor(activeUri);
    }
  );

  const toggleAutoOpenOnFocusCommand = vscode.commands.registerCommand(
    "audioEda.toggleAutoOpenOnFocus",
    async () => {
      const config = getConfig();
      const current = config.get<boolean>("openWorkbenchWhenAudioFileFocused", true);
      const next = !current;
      const targetScope = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;

      await config.update("openWorkbenchWhenAudioFileFocused", next, targetScope);
      void vscode.window.showInformationMessage(
        `Audio EDA auto-open on audio focus: ${next ? "enabled" : "disabled"}`
      );
    }
  );

  const openExtensionSettingsCommand = vscode.commands.registerCommand(
    "audioEda.openExtensionSettings",
    async () => {
      await vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${EXTENSION_ID}`);
    }
  );

  const inspectFileCommand = vscode.commands.registerCommand(
    "audioEda.inspectFile",
    async (uri?: vscode.Uri) => {
      const targetUri = getAudioUriFromArgs(uri);
      if (targetUri) {
        await openWithAudioEdaEditor(targetUri);
        return;
      }

      const targetPath = await resolveAudioFilePath(uri);
      if (!targetPath) {
        return;
      }

      await openWithAudioEdaEditor(vscode.Uri.file(targetPath));
    }
  );

  const summarizeFolderCommand = vscode.commands.registerCommand(
    "audioEda.summarizeFolder",
    async (uri?: vscode.Uri) => {
      const target = await resolveFolderPath(uri);
      if (!target) {
        return;
      }

      output.show(true);
      output.appendLine(`[summarize] ${target}`);

      try {
        const payload = await runToolboxJson(["summarize", target, "--json"], target);
        logJson(output, "[summarize] result", payload);
        void vscode.window.showInformationMessage("Audio EDA summary complete.");
      } catch (error: unknown) {
        handleToolboxError(output, error);
      }
    }
  );

  context.subscriptions.push(
    output,
    sidebarTree,
    customEditorRegistration,
    openWorkbenchCommand,
    openPresetWorkspaceCommand,
    openPresetTransformsCommand,
    openPresetMetricsCommand,
    openPresetPcaCommand,
    openWorkbenchForFileCommand,
    reopenActiveWithAudioEdaCommand,
    toggleAutoOpenOnFocusCommand,
    openExtensionSettingsCommand,
    inspectFileCommand,
    summarizeFolderCommand
  );

  const shouldOpenWorkbenchOnStart = getConfig().get<boolean>("openWorkbenchOnStart", false);

  if (shouldOpenWorkbenchOnStart) {
    AudioWorkbenchPanel.createOrShow(context.extensionUri);
  }
}

export function deactivate(): void {
  // no-op
}

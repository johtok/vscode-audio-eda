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
import { createDefaultWorkbenchState } from "./workbench/workbenchState";

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
const MAX_PERSISTED_AUDIO_STATES = 20;
const MAX_PERSISTED_AUDIO_STATES_SCAN = 200;
const MAX_RECENT_WORKSPACES_SCAN = 200;
const MAX_WORKBENCH_STATE_BYTES = 1_000_000;
const MAX_STACK_ITEMS = 24;
const MAX_STFT_FRAMES = 2000;
const MAX_OVERLAY_CSV_TEXT_CHARS = 500_000;

const VALID_TRANSFORM_KINDS = new Set([
  "timeseries",
  "stft",
  "mel",
  "mfcc",
  "dct",
  "custom_filterbank"
]);
const VALID_OVERLAY_MODES = new Set(["flag", "timestamped"]);
const VALID_COMPARISON_MODES = new Set([
  "none",
  "side_by_side",
  "overlay",
  "side_by_side_difference",
  "stacked",
  "stacked_difference"
]);
const VALID_PCA_GOALS = new Set([
  "eda",
  "classification",
  "denoising",
  "doa_beamforming",
  "enhancement"
]);
const VALID_STFT_WINDOW_TYPES = new Set(["hann", "hamming", "blackman", "rectangular"]);
const VALID_STFT_MODES = new Set(["magnitude", "phase"]);

interface PersistedAudioWorkbenchEntry {
  readonly state: unknown;
  readonly updatedAt: number;
}

interface RecentWorkspaceRecord {
  readonly uri: string;
  readonly label: string;
  readonly description?: string;
  readonly timestamp: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function sanitizeNullableString(value: unknown, maxLength: number): string | null {
  const sanitized = sanitizeString(value, maxLength);
  return sanitized ?? null;
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function sanitizeInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  return Math.round(sanitizeNumber(value, fallback, min, max));
}

function sanitizeEnumValue(
  value: unknown,
  validValues: Set<string>,
  fallback: string
): string {
  return typeof value === "string" && validValues.has(value) ? value : fallback;
}

function sanitizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed.charAt(1);
    const g = trimmed.charAt(2);
    const b = trimmed.charAt(3);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  return fallback;
}

function safeJsonStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function sanitizeStackItem(rawItem: unknown, index: number): Record<string, unknown> | undefined {
  const record = asRecord(rawItem);
  if (!record) {
    return undefined;
  }

  const kind = sanitizeEnumValue(record.kind, VALID_TRANSFORM_KINDS, "timeseries");
  const id = sanitizeString(record.id, 128) ?? `view-${Date.now()}-${index}`;
  const item: Record<string, unknown> = { id, kind };

  const defaults = createDefaultWorkbenchState().transformParams;
  const paramsRecord = asRecord(record.params);
  if (paramsRecord) {
    const sanitizedParams: Record<string, unknown> = {};

    const stft = asRecord(paramsRecord.stft);
    if (stft) {
      sanitizedParams.stft = {
        mode: sanitizeEnumValue(stft.mode, VALID_STFT_MODES, defaults.stft.mode),
        windowSize: sanitizeInteger(stft.windowSize, defaults.stft.windowSize, 128, 4096),
        overlapPercent: sanitizeInteger(stft.overlapPercent, defaults.stft.overlapPercent, 0, 95),
        windowType: sanitizeEnumValue(stft.windowType, VALID_STFT_WINDOW_TYPES, defaults.stft.windowType),
        maxAnalysisSeconds: sanitizeInteger(
          stft.maxAnalysisSeconds,
          defaults.stft.maxAnalysisSeconds,
          1,
          600
        ),
        maxFrames: sanitizeInteger(stft.maxFrames, defaults.stft.maxFrames, 32, MAX_STFT_FRAMES)
      };
    }

    const mel = asRecord(paramsRecord.mel);
    if (mel) {
      sanitizedParams.mel = {
        bands: sanitizeInteger(mel.bands, defaults.mel.bands, 8, 256),
        minHz: sanitizeNumber(mel.minHz, defaults.mel.minHz, 0, 24000),
        maxHz: sanitizeNumber(mel.maxHz, defaults.mel.maxHz, 1, 24000)
      };
    }

    const mfcc = asRecord(paramsRecord.mfcc);
    if (mfcc) {
      sanitizedParams.mfcc = {
        coeffs: sanitizeInteger(mfcc.coeffs, defaults.mfcc.coeffs, 2, 128)
      };
    }

    const dct = asRecord(paramsRecord.dct);
    if (dct) {
      sanitizedParams.dct = {
        coeffs: sanitizeInteger(dct.coeffs, defaults.dct.coeffs, 2, 256)
      };
    }

    if (Object.keys(sanitizedParams).length > 0) {
      item.params = sanitizedParams;
    }
  }

  return item;
}

function sanitizeTransformParams(rawTransformParams: unknown): Record<string, unknown> {
  const defaults = createDefaultWorkbenchState().transformParams;
  const result = JSON.parse(JSON.stringify(defaults)) as typeof defaults;
  const record = asRecord(rawTransformParams);

  if (!record) {
    return result as unknown as Record<string, unknown>;
  }

  const stft = asRecord(record.stft);
  if (stft) {
    result.stft.mode = sanitizeEnumValue(stft.mode, VALID_STFT_MODES, result.stft.mode) as
      | "magnitude"
      | "phase";
    result.stft.windowSize = sanitizeInteger(stft.windowSize, result.stft.windowSize, 128, 4096);
    result.stft.overlapPercent = sanitizeInteger(
      stft.overlapPercent,
      result.stft.overlapPercent,
      0,
      95
    );
    result.stft.windowType = sanitizeEnumValue(
      stft.windowType,
      VALID_STFT_WINDOW_TYPES,
      result.stft.windowType
    ) as "hann" | "hamming" | "blackman" | "rectangular";
    result.stft.maxAnalysisSeconds = sanitizeInteger(
      stft.maxAnalysisSeconds,
      result.stft.maxAnalysisSeconds,
      1,
      600
    );
    result.stft.maxFrames = sanitizeInteger(
      stft.maxFrames,
      result.stft.maxFrames,
      32,
      MAX_STFT_FRAMES
    );
  }

  const mel = asRecord(record.mel);
  if (mel) {
    result.mel.bands = sanitizeInteger(mel.bands, result.mel.bands, 8, 256);
    result.mel.minHz = sanitizeNumber(mel.minHz, result.mel.minHz, 0, 24000);
    result.mel.maxHz = sanitizeNumber(mel.maxHz, result.mel.maxHz, 1, 24000);
  }

  const mfcc = asRecord(record.mfcc);
  if (mfcc) {
    result.mfcc.coeffs = sanitizeInteger(mfcc.coeffs, result.mfcc.coeffs, 2, 128);
  }

  const dct = asRecord(record.dct);
  if (dct) {
    result.dct.coeffs = sanitizeInteger(dct.coeffs, result.dct.coeffs, 2, 256);
  }

  return result as unknown as Record<string, unknown>;
}

function sanitizeWorkbenchStatePayload(rawState: unknown): unknown | undefined {
  const record = asRecord(rawState);
  if (!record) {
    return undefined;
  }

  const defaults = createDefaultWorkbenchState();
  const sanitized = createDefaultWorkbenchState();

  if (Array.isArray(record.stack)) {
    const stack = record.stack
      .slice(0, MAX_STACK_ITEMS)
      .map((item, index) => sanitizeStackItem(item, index))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    if (stack.length > 0) {
      sanitized.stack = stack as unknown as typeof defaults.stack;
    }
  }

  const overlay = asRecord(record.overlay);
  if (overlay) {
    sanitized.overlay.enabled = sanitizeBoolean(overlay.enabled, sanitized.overlay.enabled);
    sanitized.overlay.mode = sanitizeEnumValue(
      overlay.mode,
      VALID_OVERLAY_MODES,
      sanitized.overlay.mode
    ) as "flag" | "timestamped";
    sanitized.overlay.csvName = sanitizeNullableString(overlay.csvName, 256);
    sanitized.overlay.csvText =
      typeof overlay.csvText === "string"
        ? overlay.csvText.slice(0, MAX_OVERLAY_CSV_TEXT_CHARS)
        : null;
    sanitized.overlay.flagColor = sanitizeHexColor(overlay.flagColor, sanitized.overlay.flagColor);
  }

  const comparison = asRecord(record.comparison);
  if (comparison) {
    sanitized.comparison.mode = sanitizeEnumValue(
      comparison.mode,
      VALID_COMPARISON_MODES,
      sanitized.comparison.mode
    ) as
      | "none"
      | "side_by_side"
      | "overlay"
      | "side_by_side_difference"
      | "stacked"
      | "stacked_difference";
    sanitized.comparison.secondAudioName = sanitizeNullableString(comparison.secondAudioName, 256);
    sanitized.comparison.offsetSeconds = sanitizeNumber(
      comparison.offsetSeconds,
      sanitized.comparison.offsetSeconds,
      -30,
      30
    );
  }

  const metrics = asRecord(record.metrics);
  if (metrics) {
    sanitized.metrics.audio = sanitizeBoolean(metrics.audio, sanitized.metrics.audio);
    sanitized.metrics.speech = sanitizeBoolean(metrics.speech, sanitized.metrics.speech);
    sanitized.metrics.statistical = sanitizeBoolean(
      metrics.statistical,
      sanitized.metrics.statistical
    );
    sanitized.metrics.distributional = sanitizeBoolean(
      metrics.distributional,
      sanitized.metrics.distributional
    );
    sanitized.metrics.classwise = sanitizeBoolean(metrics.classwise, sanitized.metrics.classwise);
    sanitized.metrics.histogramBins = sanitizeInteger(
      metrics.histogramBins,
      sanitized.metrics.histogramBins,
      4,
      512
    );
    sanitized.metrics.histogramRangeMin = sanitizeNumber(
      metrics.histogramRangeMin,
      sanitized.metrics.histogramRangeMin,
      -10,
      10
    );
    sanitized.metrics.histogramRangeMax = sanitizeNumber(
      metrics.histogramRangeMax,
      sanitized.metrics.histogramRangeMax,
      -10,
      10
    );
    if (sanitized.metrics.histogramRangeMax <= sanitized.metrics.histogramRangeMin) {
      if (sanitized.metrics.histogramRangeMin >= 10) {
        sanitized.metrics.histogramRangeMin = 9.999;
      }
      sanitized.metrics.histogramRangeMax = Math.min(
        10,
        sanitized.metrics.histogramRangeMin + 0.001
      );
    }
  }

  const features = asRecord(record.features);
  if (features) {
    sanitized.features.power = sanitizeBoolean(features.power, sanitized.features.power);
    sanitized.features.autocorrelation = sanitizeBoolean(
      features.autocorrelation,
      sanitized.features.autocorrelation
    );
    sanitized.features.shortTimePower = sanitizeBoolean(
      features.shortTimePower,
      sanitized.features.shortTimePower
    );
    sanitized.features.shortTimeAutocorrelation = sanitizeBoolean(
      features.shortTimeAutocorrelation,
      sanitized.features.shortTimeAutocorrelation
    );
  }

  const pca = asRecord(record.pca);
  if (pca) {
    sanitized.pca.enabled = sanitizeBoolean(pca.enabled, sanitized.pca.enabled);
    sanitized.pca.goal = sanitizeEnumValue(pca.goal, VALID_PCA_GOALS, sanitized.pca.goal) as
      | "eda"
      | "classification"
      | "denoising"
      | "doa_beamforming"
      | "enhancement";
    sanitized.pca.classwise = sanitizeBoolean(pca.classwise, sanitized.pca.classwise);
  }

  const multichannel = asRecord(record.multichannel);
  if (multichannel) {
    sanitized.multichannel.enabled = sanitizeBoolean(
      multichannel.enabled,
      sanitized.multichannel.enabled
    );
    sanitized.multichannel.splitViewsByChannel = sanitizeBoolean(
      multichannel.splitViewsByChannel,
      sanitized.multichannel.splitViewsByChannel
    );
  }

  sanitized.transformParams = sanitizeTransformParams(
    record.transformParams
  ) as typeof sanitized.transformParams;

  const serialized = safeJsonStringify(sanitized);
  if (!serialized) {
    return undefined;
  }

  if (Buffer.byteLength(serialized, "utf8") > MAX_WORKBENCH_STATE_BYTES) {
    return undefined;
  }

  return JSON.parse(serialized) as unknown;
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

function sanitizePersistedAudioStateMap(
  raw: unknown
): Record<string, PersistedAudioWorkbenchEntry> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const map = raw as Record<string, unknown>;
  const entries: Array<[string, PersistedAudioWorkbenchEntry]> = [];
  let scanned = 0;

  for (const uri in map) {
    if (!Object.prototype.hasOwnProperty.call(map, uri)) {
      continue;
    }
    scanned += 1;
    if (scanned > MAX_PERSISTED_AUDIO_STATES_SCAN) {
      break;
    }
    if (!uri.trim()) {
      continue;
    }
    const value = map[uri];
    let parsedUri: vscode.Uri;
    try {
      parsedUri = vscode.Uri.parse(uri, true);
    } catch {
      continue;
    }
    if (!isAudioUri(parsedUri)) {
      continue;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const candidate = value as Partial<PersistedAudioWorkbenchEntry>;
      if ("state" in candidate) {
        const sanitizedState = sanitizeWorkbenchStatePayload(candidate.state);
        if (!sanitizedState) {
          continue;
        }
        const updatedAt = Number.isFinite(Number(candidate.updatedAt))
          ? Number(candidate.updatedAt)
          : 0;
        entries.push([uri, { state: sanitizedState, updatedAt }]);
        continue;
      }
    }

    const sanitizedState = sanitizeWorkbenchStatePayload(value);
    if (!sanitizedState) {
      continue;
    }
    entries.push([uri, { state: sanitizedState, updatedAt: 0 }]);
  }

  entries.sort((left, right) => right[1].updatedAt - left[1].updatedAt);
  return Object.fromEntries(entries.slice(0, MAX_PERSISTED_AUDIO_STATES));
}

function prunePersistedAudioStateMap(
  map: Record<string, PersistedAudioWorkbenchEntry>
): Record<string, PersistedAudioWorkbenchEntry> {
  const entries = Object.entries(map).sort((left, right) => right[1].updatedAt - left[1].updatedAt);
  return Object.fromEntries(entries.slice(0, MAX_PERSISTED_AUDIO_STATES));
}

function sanitizeRecentWorkspaceRecords(raw: unknown): RecentWorkspaceRecord[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const deduped = new Map<string, RecentWorkspaceRecord>();
  for (const item of raw.slice(0, MAX_RECENT_WORKSPACES_SCAN)) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Partial<RecentWorkspaceRecord>;
    if (typeof record.uri !== "string" || !record.uri.trim()) {
      continue;
    }

    const uri = record.uri.trim();
    let parsedUri: vscode.Uri;
    try {
      parsedUri = vscode.Uri.parse(uri, true);
    } catch {
      continue;
    }
    if (!isAudioUri(parsedUri)) {
      continue;
    }
    let fallbackLabel = "audio";
    fallbackLabel = path.basename(parsedUri.path) || fallbackLabel;
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

  const activeUri = getActiveEditorUri();
  if (isAudioUri(activeUri)) {
    return activeUri;
  }

  return undefined;
}

function getActiveEditorUri(): vscode.Uri | undefined {
  const fromTextEditor = vscode.window.activeTextEditor?.document.uri;
  if (fromTextEditor) {
    return fromTextEditor;
  }

  const tabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (!tabInput) {
    return undefined;
  }

  if (tabInput instanceof vscode.TabInputText) {
    return tabInput.uri;
  }

  if (tabInput instanceof vscode.TabInputCustom) {
    return tabInput.uri;
  }

  if (tabInput instanceof vscode.TabInputNotebook) {
    return tabInput.uri;
  }

  return undefined;
}

async function resolveAudioFilePath(uri?: vscode.Uri): Promise<string | undefined> {
  if (uri?.scheme === "file") {
    return uri.fsPath;
  }

  const activeUri = getActiveEditorUri();
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

  const loadStateMap = (): Record<string, PersistedAudioWorkbenchEntry> =>
    sanitizePersistedAudioStateMap(
      context.workspaceState.get<unknown>(WORKBENCH_STATE_BY_AUDIO_KEY)
    );

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

  const sanitizeIncomingState = (
    state: unknown,
    source: "workbench-panel" | "custom-editor"
  ): unknown | undefined => {
    const sanitized = sanitizeWorkbenchStatePayload(state);
    if (!sanitized) {
      output.appendLine(
        `[security] Rejected invalid or oversized state payload from ${source}.`
      );
    }
    return sanitized;
  };

  const workbenchStatePersistence = {
    load: (): unknown | undefined =>
      sanitizeWorkbenchStatePayload(context.workspaceState.get(WORKBENCH_STATE_KEY)),
    save: async (state: unknown): Promise<void> => {
      const sanitized = sanitizeIncomingState(state, "workbench-panel");
      if (!sanitized) {
        return;
      }
      await context.workspaceState.update(WORKBENCH_STATE_KEY, sanitized);
    }
  };

  const customEditorStatePersistence = {
    loadForUri: (uri: vscode.Uri): unknown | undefined => {
      const stateByAudio = loadStateMap();
      const key = uri.toString();
      const stateFromUri = stateByAudio[key]?.state;
      if (stateFromUri) {
        return stateFromUri;
      }
      return sanitizeWorkbenchStatePayload(context.workspaceState.get(WORKBENCH_STATE_KEY));
    },
    saveForUri: async (uri: vscode.Uri, state: unknown): Promise<void> => {
      const sanitized = sanitizeIncomingState(state, "custom-editor");
      if (!sanitized) {
        return;
      }
      const stateByAudio = loadStateMap();
      stateByAudio[uri.toString()] = { state: sanitized, updatedAt: Date.now() };
      await context.workspaceState.update(
        WORKBENCH_STATE_BY_AUDIO_KEY,
        prunePersistedAudioStateMap(stateByAudio)
      );
      await context.workspaceState.update(WORKBENCH_STATE_KEY, sanitized);
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
      const activeUri = getActiveEditorUri();
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

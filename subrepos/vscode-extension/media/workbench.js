(function () {
  // Interaction and UX inspired by vscode-audio-preview:
  // https://github.com/sukumo28/vscode-audio-preview
  const vscode =
    typeof acquireVsCodeApi === "function"
      ? acquireVsCodeApi()
      : {
          postMessage: () => {},
          getState: () => undefined,
          setState: () => {}
        };
  const transformKinds = [
    { value: "timeseries", label: "timeseries" },
    { value: "stft::magnitude", label: "stft (magnitude)" },
    { value: "stft::phase", label: "stft (phase)" },
    { value: "mel", label: "mel" },
    { value: "mfcc", label: "mfcc" },
    { value: "dct", label: "dct" },
    { value: "custom_filterbank", label: "custom_filterbank" }
  ];

  const STFT_WINDOW_SIZE_OPTIONS = [128, 256, 512, 1024, 2048, 4096];
  const STFT_WINDOW_TYPES = ["hann", "hamming", "blackman", "rectangular"];
  const STFT_MODES = ["magnitude", "phase"];
  const COMPARISON_MODES = [
    "none",
    "side_by_side",
    "overlay",
    "side_by_side_difference",
    "stacked",
    "stacked_difference"
  ];
  const STACK_ITEM_KINDS = ["timeseries", "stft", "mel", "mfcc", "dct", "custom_filterbank"];
  const OVERLAY_MODES = ["flag", "timestamped"];
  const WORKSPACE_PRESET_IDS = ["default", "transforms", "metrics", "pca"];
  const DEFAULT_FLAG_OVERLAY_COLOR = "#ef4444";
  const MAX_STACK_ITEMS = 24;
  const MAX_RESTORED_STACK_SCAN = MAX_STACK_ITEMS * 4;
  const MAX_LOCAL_WEBVIEW_STATE_BYTES = 1000000;
  const MAX_TEXT_FIELD_CHARS = 256;
  const MAX_PERSISTED_OVERLAY_CSV_CHARS = 500000;
  const MAX_STFT_FRAMES = 2000;
  const MAX_AUDIO_DECODE_BYTES = 128 * 1024 * 1024;
  const MAX_DECODED_PCM_BYTES = 256 * 1024 * 1024;
  const MAX_OVERLAY_CSV_INPUT_BYTES = 2 * 1024 * 1024;
  const MAX_OVERLAY_CSV_ROWS = 200000;
  const MAX_OVERLAY_CSV_COLUMNS = 64;
  const MAX_FILTERBANK_CSV_INPUT_BYTES = 2 * 1024 * 1024;
  const MAX_FILTERBANK_ROWS = 2048;
  const MAX_FILTERBANK_COLUMNS = 8192;
  const METRICS_HISTOGRAM_BINS = 64;
  const METRICS_DISTRIBUTION_SAMPLE_LIMIT = 200000;
  const METRICS_FRAME_SIZE_SECONDS = 0.03;
  const METRICS_HOP_SIZE_SECONDS = 0.01;
  const METRICS_SPEECH_SILENCE_DB_OFFSET = 35;
  const METRICS_SPEECH_ACTIVITY_DB_OFFSET = 20;
  const METRICS_TRUE_PEAK_OVERSAMPLE = 4;
  const METRICS_MAX_PITCH_FRAMES = 800;
  const METRICS_MIN_PITCH_HZ = 50;
  const METRICS_MAX_PITCH_HZ = 400;
  const METRICS_CHANGEPOINT_DB = 6;
  const METRICS_ONSET_MIN_SPACING_SECONDS = 0.05;
  const METRICS_FRAME_SCAN_LIMIT = 6000;
  const METRICS_EXPORT_MAX_ROWS = 200000;
  const DEFAULT_TRANSFORM_PARAMS = {
    stft: {
      mode: "magnitude",
      windowSize: 512,
      overlapPercent: 75,
      windowType: "hann",
      maxAnalysisSeconds: 20,
      maxFrames: 420
    },
    mel: {
      bands: 40,
      minHz: 0,
      maxHz: 8000
    },
    mfcc: {
      coeffs: 13
    },
    dct: {
      coeffs: 24
    }
  };

  const WAVEFORM_CANVAS_HEIGHT = 240;
  const MATRIX_CANVAS_HEIGHT = 340;

  const pcaGuidanceByGoal = {
    eda: "Single-channel default: PCA on frame x frequency log-mel/log-power spectra.",
    classification: "ML baseline: PCA on stacked log-mel features (single/multi-channel).",
    denoising: "Use lag-embedded PCA/SVD (SSA) for trend + oscillation + noise separation.",
    doa_beamforming:
      "Array-focused: eigendecomposition on spatial covariance R_y(f) per frequency.",
    enhancement: "Speech enhancement: GEVD/EVD on speech vs noise covariance matrices."
  };

  const DEFAULT_BOOTSTRAP_STATE = {
    stack: [],
    overlay: {
      enabled: false,
      mode: "flag",
      csvName: null,
      csvText: null,
      flagColor: DEFAULT_FLAG_OVERLAY_COLOR
    },
    comparison: { mode: "none", secondAudioName: null, offsetSeconds: 0 },
    metrics: {
      audio: true,
      speech: false,
      statistical: true,
      distributional: true,
      classwise: false
    },
    features: {
      power: true,
      autocorrelation: true,
      shortTimePower: false,
      shortTimeAutocorrelation: false
    },
    pca: { enabled: false, goal: "eda", classwise: false },
    multichannel: { enabled: false, splitViewsByChannel: true },
    transformParams: DEFAULT_TRANSFORM_PARAMS
  };

  const initialStateFromExtension = window.__AUDIO_EDA_BOOTSTRAP__;
  const persistedState =
    typeof vscode.getState === "function" ? vscode.getState() : undefined;
  const state = mergeBootstrapState(
    DEFAULT_BOOTSTRAP_STATE,
    initialStateFromExtension,
    persistedState
  );
  ensureOverlayState();
  ensureComparisonState();
  ensureTransformParamState();
  normalizeLegacyTransformKinds();
  normalizeStackItems();

  const stackList = byId("stack-list");
  const addTransformButton = byId("add-transform");
  const renderStackContainer = byId("transform-render-stack");

  const primaryAudioFileInput = byId("primary-audio-file");
  const primaryAudioFileLocked = byId("primary-audio-file-locked");
  const primaryAudioPlayer = byId("primary-audio-player");
  const audioStatus = byId("audio-status");
  const audioLockStatus = byId("audio-lock-status");

  const customFilterbankInput = byId("custom-filterbank-csv");
  const filterbankStatus = byId("filterbank-status");

  const overlayEnabled = byId("overlay-enabled");
  const overlayMode = byId("overlay-mode");
  const overlayCsv = byId("overlay-csv");
  const overlayFlagColor = byId("overlay-flag-color");
  const overlayCsvHint = byId("overlay-csv-hint");

  const comparisonMode = byId("comparison-mode");
  const comparisonAudio = byId("comparison-audio");
  const comparisonOffsetSeconds = byId("comparison-offset-seconds");
  const comparisonStatus = byId("comparison-status");

  const stftWindowSize = byId("stft-window-size");
  const stftOverlapPercent = byId("stft-overlap-percent");
  const stftWindowType = byId("stft-window-type");
  const stftMaxAnalysisSeconds = byId("stft-max-analysis-seconds");
  const stftMaxFrames = byId("stft-max-frames");
  const melBands = byId("mel-bands");
  const melMinHz = byId("mel-min-hz");
  const melMaxHz = byId("mel-max-hz");
  const mfccCoeffs = byId("mfcc-coeffs");
  const dctCoeffs = byId("dct-coeffs");

  const metricAudio = byId("metric-audio");
  const metricSpeech = byId("metric-speech");
  const metricStatistical = byId("metric-statistical");
  const metricDistributional = byId("metric-distributional");
  const metricClasswise = byId("metric-classwise");
  const metricsStatus = byId("metrics-status");
  const metricsContent = byId("metrics-content");
  const metricsHistogramCanvas = byId("metrics-histogram");
  const metricsExportJson = byId("metrics-export-json");
  const metricsExportCsv = byId("metrics-export-csv");

  const featurePower = byId("feature-power");
  const featureAutocorrelation = byId("feature-autocorrelation");
  const featureShorttimePower = byId("feature-shorttime-power");
  const featureShorttimeAutocorrelation = byId("feature-shorttime-autocorrelation");

  const pcaEnabled = byId("pca-enabled");
  const pcaGoal = byId("pca-goal");
  const pcaClasswise = byId("pca-classwise");
  const pcaGuidance = byId("pca-guidance");

  const multichannelEnabled = byId("multichannel-enabled");
  const multichannelSplit = byId("multichannel-split");

  let dragIndex = null;
  let primaryAudio = null;
  let primaryAudioUrl = null;
  let primaryAudioLocked = false;
  let comparisonAudioData = null;
  let customFilterbank = null;
  let overlayParsed = null;
  let overlayStatusMessage = "";
  let derivedCache = createEmptyDerivedCache();
  let comparisonDerivedCache = createEmptyDerivedCache();
  let metricsCache = { cacheKey: "", report: null };
  let metricsRenderSignature = "";
  let resizeTick = 0;
  let selectedViewId = null;
  const expandedRowSettingsIds = new Set();

  const viewStateById = Object.create(null);
  const playheadElementsByViewId = new Map();
  let playheadFrameToken = 0;

  function byId(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error("Missing element #" + id);
    }
    return element;
  }

  function copyDefaultTransformParams() {
    return JSON.parse(JSON.stringify(DEFAULT_TRANSFORM_PARAMS));
  }

  function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value;
  }

  function sanitizeBooleanValue(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function sanitizeStringValue(value, maxLength) {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
  }

  function sanitizeWebviewAudioUri(value) {
    const sanitized = sanitizeStringValue(value, 4096);
    if (!sanitized) {
      return null;
    }

    const lower = sanitized.toLowerCase();
    if (lower.indexOf("vscode-webview-resource:") === 0) {
      return sanitized;
    }
    if (lower.indexOf("vscode-webview://") === 0) {
      return sanitized;
    }
    if (lower.indexOf("vscode-resource:") === 0) {
      return sanitized;
    }

    // VS Code remote/web environments can map local resources to trusted CDN URLs.
    if (lower.indexOf("https://") === 0) {
      let parsed;
      try {
        parsed = new URL(sanitized);
      } catch {
        parsed = null;
      }
      if (parsed && /(^|\.)vscode-cdn\.net$/i.test(parsed.hostname)) {
        return sanitized;
      }
    }

    return null;
  }

  function sanitizeStackKind(rawKind) {
    if (rawKind === "magnitude_spectrogram") {
      return { kind: "stft", forceStftMode: "magnitude" };
    }
    if (rawKind === "phase_spectrogram") {
      return { kind: "stft", forceStftMode: "phase" };
    }
    if (typeof rawKind === "string" && STACK_ITEM_KINDS.indexOf(rawKind) !== -1) {
      return { kind: rawKind };
    }
    return { kind: "timeseries" };
  }

  function sanitizeStackItemForState(rawItem, index) {
    const record = asRecord(rawItem);
    if (!record) {
      return null;
    }

    const kindInfo = sanitizeStackKind(record.kind);
    const paramsRecord = asRecord(record.params);
    const item = {
      id: sanitizeStringValue(record.id, 128) || "view-" + Date.now() + "-" + index,
      kind: kindInfo.kind,
      params: {}
    };

    if (
      item.kind === "stft" ||
      item.kind === "mel" ||
      item.kind === "mfcc" ||
      item.kind === "dct" ||
      item.kind === "custom_filterbank"
    ) {
      const stft = sanitizeStftParams(asRecord(paramsRecord && paramsRecord.stft));
      if (kindInfo.forceStftMode) {
        stft.mode = kindInfo.forceStftMode;
      }
      item.params.stft = stft;
    }

    if (item.kind === "mel" || item.kind === "mfcc") {
      item.params.mel = sanitizeMelParams(asRecord(paramsRecord && paramsRecord.mel), 48000);
    }

    if (item.kind === "mfcc") {
      item.params.mfcc = sanitizeMfccParams(asRecord(paramsRecord && paramsRecord.mfcc), 128);
    }

    if (item.kind === "dct") {
      item.params.dct = sanitizeDctParams(asRecord(paramsRecord && paramsRecord.dct), 256);
    }

    return item;
  }

  function sanitizeStackCollection(rawStack) {
    if (!Array.isArray(rawStack)) {
      return [];
    }

    const sanitized = [];
    const scanLimit = Math.min(rawStack.length, MAX_RESTORED_STACK_SCAN);
    for (let index = 0; index < scanLimit; index += 1) {
      if (sanitized.length >= MAX_STACK_ITEMS) {
        break;
      }

      const item = sanitizeStackItemForState(rawStack[index], index);
      if (item) {
        sanitized.push(item);
      }
    }

    return sanitized;
  }

  function sanitizePcaGoal(rawGoal, fallback) {
    if (
      typeof rawGoal === "string" &&
      Object.prototype.hasOwnProperty.call(pcaGuidanceByGoal, rawGoal)
    ) {
      return rawGoal;
    }
    return fallback;
  }

  function estimateStateByteSize(value) {
    try {
      const serialized = JSON.stringify(value);
      if (typeof serialized !== "string") {
        return Number.POSITIVE_INFINITY;
      }
      return new TextEncoder().encode(serialized).length;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  function enforceStatePersistenceBounds(candidateState) {
    const fallback = JSON.parse(JSON.stringify(DEFAULT_BOOTSTRAP_STATE));
    let working = candidateState;
    let byteSize = estimateStateByteSize(working);

    if (!Number.isFinite(byteSize)) {
      return fallback;
    }

    if (byteSize <= MAX_LOCAL_WEBVIEW_STATE_BYTES) {
      return working;
    }

    const trimmed = JSON.parse(JSON.stringify(working));
    working = trimmed;

    if (trimmed.overlay && typeof trimmed.overlay === "object") {
      trimmed.overlay.csvText = null;
      byteSize = estimateStateByteSize(trimmed);
      if (byteSize <= MAX_LOCAL_WEBVIEW_STATE_BYTES) {
        return trimmed;
      }
    }

    if (Array.isArray(trimmed.stack)) {
      while (trimmed.stack.length > 1 && byteSize > MAX_LOCAL_WEBVIEW_STATE_BYTES) {
        trimmed.stack.pop();
        byteSize = estimateStateByteSize(trimmed);
      }
    }

    if (byteSize <= MAX_LOCAL_WEBVIEW_STATE_BYTES) {
      return trimmed;
    }

    return fallback;
  }

  function mergeBootstrapState(defaultState) {
    const merged = JSON.parse(JSON.stringify(defaultState));

    for (let argIndex = 1; argIndex < arguments.length; argIndex += 1) {
      const restoredState = asRecord(arguments[argIndex]);
      if (!restoredState) {
        continue;
      }

      if (Array.isArray(restoredState.stack)) {
        merged.stack = sanitizeStackCollection(restoredState.stack);
      }

      const overlay = asRecord(restoredState.overlay);
      if (overlay) {
        merged.overlay.enabled = sanitizeBooleanValue(overlay.enabled, merged.overlay.enabled);
        merged.overlay.mode =
          typeof overlay.mode === "string" && OVERLAY_MODES.indexOf(overlay.mode) !== -1
            ? overlay.mode
            : merged.overlay.mode;
        merged.overlay.csvName = sanitizeStringValue(overlay.csvName, MAX_TEXT_FIELD_CHARS);
        merged.overlay.csvText =
          typeof overlay.csvText === "string"
            ? overlay.csvText.slice(0, MAX_PERSISTED_OVERLAY_CSV_CHARS)
            : null;
        merged.overlay.flagColor = sanitizeHexColor(overlay.flagColor, merged.overlay.flagColor);
      }

      const comparison = asRecord(restoredState.comparison);
      if (comparison) {
        merged.comparison.mode =
          typeof comparison.mode === "string" && COMPARISON_MODES.indexOf(comparison.mode) !== -1
            ? comparison.mode
            : merged.comparison.mode;
        merged.comparison.secondAudioName = sanitizeStringValue(
          comparison.secondAudioName,
          MAX_TEXT_FIELD_CHARS
        );
        merged.comparison.offsetSeconds = sanitizeFloat(
          comparison.offsetSeconds,
          merged.comparison.offsetSeconds,
          -30,
          30
        );
      }

      const metrics = asRecord(restoredState.metrics);
      if (metrics) {
        merged.metrics.audio = sanitizeBooleanValue(metrics.audio, merged.metrics.audio);
        merged.metrics.speech = sanitizeBooleanValue(metrics.speech, merged.metrics.speech);
        merged.metrics.statistical = sanitizeBooleanValue(
          metrics.statistical,
          merged.metrics.statistical
        );
        merged.metrics.distributional = sanitizeBooleanValue(
          metrics.distributional,
          merged.metrics.distributional
        );
        merged.metrics.classwise = sanitizeBooleanValue(metrics.classwise, merged.metrics.classwise);
      }

      const features = asRecord(restoredState.features);
      if (features) {
        merged.features.power = sanitizeBooleanValue(features.power, merged.features.power);
        merged.features.autocorrelation = sanitizeBooleanValue(
          features.autocorrelation,
          merged.features.autocorrelation
        );
        merged.features.shortTimePower = sanitizeBooleanValue(
          features.shortTimePower,
          merged.features.shortTimePower
        );
        merged.features.shortTimeAutocorrelation = sanitizeBooleanValue(
          features.shortTimeAutocorrelation,
          merged.features.shortTimeAutocorrelation
        );
      }

      const pca = asRecord(restoredState.pca);
      if (pca) {
        merged.pca.enabled = sanitizeBooleanValue(pca.enabled, merged.pca.enabled);
        merged.pca.goal = sanitizePcaGoal(pca.goal, merged.pca.goal);
        merged.pca.classwise = sanitizeBooleanValue(pca.classwise, merged.pca.classwise);
      }

      const multichannel = asRecord(restoredState.multichannel);
      if (multichannel) {
        merged.multichannel.enabled = sanitizeBooleanValue(
          multichannel.enabled,
          merged.multichannel.enabled
        );
        merged.multichannel.splitViewsByChannel = sanitizeBooleanValue(
          multichannel.splitViewsByChannel,
          merged.multichannel.splitViewsByChannel
        );
      }

      const transformParams = asRecord(restoredState.transformParams);
      if (transformParams) {
        const stft = asRecord(transformParams.stft);
        if (stft) {
          merged.transformParams.stft = sanitizeStftParams(stft);
        }

        const mel = asRecord(transformParams.mel);
        if (mel) {
          merged.transformParams.mel = sanitizeMelParams(mel, 48000);
        }

        const mfcc = asRecord(transformParams.mfcc);
        if (mfcc) {
          merged.transformParams.mfcc = sanitizeMfccParams(mfcc, 128);
        }

        const dct = asRecord(transformParams.dct);
        if (dct) {
          merged.transformParams.dct = sanitizeDctParams(dct, 256);
        }
      }
    }

    return enforceStatePersistenceBounds(merged);
  }

  function normalizeLegacyTransformKinds() {
    if (!Array.isArray(state.stack)) {
      return;
    }

    state.stack.forEach(function (item) {
      if (!item || typeof item !== "object") {
        return;
      }

      if (item.kind === "magnitude_spectrogram") {
        item.kind = "stft";
        if (!item.params || typeof item.params !== "object") {
          item.params = {};
        }
        if (!item.params.stft || typeof item.params.stft !== "object") {
          item.params.stft = {};
        }
        item.params.stft.mode = "magnitude";
        return;
      }

      if (item.kind === "phase_spectrogram") {
        item.kind = "stft";
        if (!item.params || typeof item.params !== "object") {
          item.params = {};
        }
        if (!item.params.stft || typeof item.params.stft !== "object") {
          item.params.stft = {};
        }
        item.params.stft.mode = "phase";
        return;
      }

      if (item.kind === "stft") {
        if (!item.params || typeof item.params !== "object") {
          item.params = {};
        }
        if (!item.params.stft || typeof item.params.stft !== "object") {
          item.params.stft = {};
        }
        if (item.params.stft.mode !== "phase") {
          item.params.stft.mode = "magnitude";
        }
      }
    });
  }

  function normalizeStackItems() {
    if (!Array.isArray(state.stack)) {
      state.stack = [];
      return;
    }

    if (state.stack.length > MAX_STACK_ITEMS) {
      state.stack = state.stack.slice(0, MAX_STACK_ITEMS);
    }

    state.stack.forEach(function (item, index) {
      if (!item || typeof item !== "object") {
        state.stack[index] = {
          id: "view-" + Date.now() + "-" + index,
          kind: "timeseries",
          params: {}
        };
        return;
      }

      const kindInfo = sanitizeStackKind(item.kind);
      item.kind = kindInfo.kind;

      if (typeof item.id !== "string" || !item.id.trim()) {
        item.id = "view-" + Date.now() + "-" + index;
      } else if (item.id.length > 128) {
        item.id = item.id.slice(0, 128);
      }

      ensureStackItemParams(item);

      if (kindInfo.forceStftMode) {
        if (!item.params.stft || typeof item.params.stft !== "object") {
          item.params.stft = {};
        }
        item.params.stft.mode = kindInfo.forceStftMode;
      }
    });
  }

  function ensureTransformParamState() {
    if (!state.transformParams || typeof state.transformParams !== "object") {
      state.transformParams = copyDefaultTransformParams();
      return;
    }

    const defaults = copyDefaultTransformParams();
    const sections = Object.keys(defaults);
    for (let index = 0; index < sections.length; index += 1) {
      const sectionKey = sections[index];
      if (!state.transformParams[sectionKey] || typeof state.transformParams[sectionKey] !== "object") {
        state.transformParams[sectionKey] = defaults[sectionKey];
        continue;
      }

      const keys = Object.keys(defaults[sectionKey]);
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        const key = keys[keyIndex];
        if (state.transformParams[sectionKey][key] === undefined) {
          state.transformParams[sectionKey][key] = defaults[sectionKey][key];
        }
      }
    }
  }

  function ensureOverlayState() {
    if (!state.overlay || typeof state.overlay !== "object") {
      state.overlay = {
        enabled: false,
        mode: "flag",
        csvName: null,
        csvText: null,
        flagColor: DEFAULT_FLAG_OVERLAY_COLOR
      };
      return;
    }

    if (typeof state.overlay.csvText !== "string") {
      state.overlay.csvText = null;
    }

    if (typeof state.overlay.flagColor !== "string") {
      state.overlay.flagColor = DEFAULT_FLAG_OVERLAY_COLOR;
    }

    state.overlay.flagColor = sanitizeHexColor(state.overlay.flagColor, DEFAULT_FLAG_OVERLAY_COLOR);
  }

  function ensureComparisonState() {
    if (!state.comparison || typeof state.comparison !== "object") {
      state.comparison = {
        mode: "none",
        secondAudioName: null,
        offsetSeconds: 0
      };
      return;
    }

    if (!Number.isFinite(Number(state.comparison.offsetSeconds))) {
      state.comparison.offsetSeconds = 0;
    }

    if (COMPARISON_MODES.indexOf(state.comparison.mode) === -1) {
      state.comparison.mode = "none";
    }

    state.comparison.offsetSeconds = sanitizeFloat(state.comparison.offsetSeconds, 0, -30, 30);
  }

  function createEmptyDerivedCache() {
    return {
      stftByKey: Object.create(null),
      melByKey: Object.create(null),
      mfccByKey: Object.create(null),
      dctByKey: Object.create(null),
      customFilterbankByKey: Object.create(null)
    };
  }

  function clearDerivedCache() {
    derivedCache = createEmptyDerivedCache();
    comparisonDerivedCache = createEmptyDerivedCache();
    metricsCache = { cacheKey: "", report: null };
    metricsRenderSignature = "";
  }

  function sanitizeInt(raw, fallback, min, max) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.round(clamp(parsed, min, max));
  }

  function sanitizeFloat(raw, fallback, min, max) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return clamp(parsed, min, max);
  }

  function sanitizeHexColor(raw, fallback) {
    if (typeof raw !== "string") {
      return fallback;
    }

    const trimmed = raw.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }

    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
      const r = trimmed.charAt(1);
      const g = trimmed.charAt(2);
      const b = trimmed.charAt(3);
      return ("#" + r + r + g + g + b + b).toLowerCase();
    }

    return fallback;
  }

  function hexToRgb(hexColor) {
    const normalized = sanitizeHexColor(hexColor, DEFAULT_FLAG_OVERLAY_COLOR);
    const value = normalized.slice(1);
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16)
    };
  }

  function rgbToRgbaString(rgb, alpha) {
    return "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + alpha + ")";
  }

  function sanitizeWindowSize(raw) {
    const parsed = sanitizeInt(raw, DEFAULT_TRANSFORM_PARAMS.stft.windowSize, 128, 4096);
    if (STFT_WINDOW_SIZE_OPTIONS.indexOf(parsed) !== -1) {
      return parsed;
    }

    let best = STFT_WINDOW_SIZE_OPTIONS[0];
    let bestDistance = Math.abs(best - parsed);
    for (let index = 1; index < STFT_WINDOW_SIZE_OPTIONS.length; index += 1) {
      const candidate = STFT_WINDOW_SIZE_OPTIONS[index];
      const distance = Math.abs(candidate - parsed);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    return best;
  }

  function sanitizeStftParams(stftSource) {
    const stft = stftSource || DEFAULT_TRANSFORM_PARAMS.stft;
    const mode = STFT_MODES.indexOf(stft.mode) !== -1 ? stft.mode : "magnitude";
    const windowSize = sanitizeWindowSize(stft.windowSize);
    const overlapPercent = sanitizeInt(stft.overlapPercent, DEFAULT_TRANSFORM_PARAMS.stft.overlapPercent, 0, 95);
    const windowType = STFT_WINDOW_TYPES.indexOf(stft.windowType) !== -1 ? stft.windowType : "hann";
    const maxAnalysisSeconds = sanitizeInt(
      stft.maxAnalysisSeconds,
      DEFAULT_TRANSFORM_PARAMS.stft.maxAnalysisSeconds,
      1,
      600
    );
    const maxFrames = sanitizeInt(
      stft.maxFrames,
      DEFAULT_TRANSFORM_PARAMS.stft.maxFrames,
      32,
      MAX_STFT_FRAMES
    );
    const hopSize = Math.max(1, Math.round(windowSize * (1 - overlapPercent / 100)));

    return {
      mode,
      windowSize,
      overlapPercent,
      windowType,
      maxAnalysisSeconds,
      maxFrames,
      hopSize
    };
  }

  function sanitizeMelParams(melSource, sampleRate) {
    const mel = melSource || DEFAULT_TRANSFORM_PARAMS.mel;
    const nyquist = sampleRate / 2;
    const minHz = sanitizeFloat(mel.minHz, DEFAULT_TRANSFORM_PARAMS.mel.minHz, 0, Math.max(0, nyquist - 2));
    const maxHz = sanitizeFloat(
      mel.maxHz,
      Math.min(DEFAULT_TRANSFORM_PARAMS.mel.maxHz, nyquist),
      minHz + 1,
      nyquist
    );
    const bands = sanitizeInt(mel.bands, DEFAULT_TRANSFORM_PARAMS.mel.bands, 8, 256);

    return {
      bands,
      minHz,
      maxHz
    };
  }

  function sanitizeMfccParams(mfccSource, maxCoeff) {
    const upper = Math.max(2, maxCoeff);
    const source = mfccSource || DEFAULT_TRANSFORM_PARAMS.mfcc;
    return {
      coeffs: sanitizeInt(source.coeffs, DEFAULT_TRANSFORM_PARAMS.mfcc.coeffs, 2, upper)
    };
  }

  function sanitizeDctParams(dctSource, maxCoeff) {
    const upper = Math.max(2, maxCoeff);
    const source = dctSource || DEFAULT_TRANSFORM_PARAMS.dct;
    return {
      coeffs: sanitizeInt(source.coeffs, DEFAULT_TRANSFORM_PARAMS.dct.coeffs, 2, upper)
    };
  }

  function getDefaultStftParams() {
    ensureTransformParamState();
    return sanitizeStftParams(state.transformParams.stft);
  }

  function getDefaultMelParams(sampleRate) {
    ensureTransformParamState();
    return sanitizeMelParams(state.transformParams.mel, sampleRate);
  }

  function getDefaultMfccParams(maxCoeff) {
    ensureTransformParamState();
    return sanitizeMfccParams(state.transformParams.mfcc, maxCoeff);
  }

  function getDefaultDctParams(maxCoeff) {
    ensureTransformParamState();
    return sanitizeDctParams(state.transformParams.dct, maxCoeff);
  }

  function cloneParams(source) {
    return JSON.parse(JSON.stringify(source));
  }

  function createDefaultParamsForKind(kind, stftMode) {
    ensureTransformParamState();
    const defaults = state.transformParams || DEFAULT_TRANSFORM_PARAMS;

    if (kind === "stft") {
      const stft = cloneParams(defaults.stft);
      if (stftMode === "phase" || stftMode === "magnitude") {
        stft.mode = stftMode;
      }
      return {
        stft
      };
    }

    if (kind === "mel") {
      return {
        stft: cloneParams(defaults.stft),
        mel: cloneParams(defaults.mel)
      };
    }

    if (kind === "mfcc") {
      return {
        stft: cloneParams(defaults.stft),
        mel: cloneParams(defaults.mel),
        mfcc: cloneParams(defaults.mfcc)
      };
    }

    if (kind === "dct") {
      return {
        stft: cloneParams(defaults.stft),
        dct: cloneParams(defaults.dct)
      };
    }

    if (kind === "custom_filterbank") {
      return {
        stft: cloneParams(defaults.stft)
      };
    }

    return {};
  }

  function ensureStackItemParams(item) {
    if (!item.params || typeof item.params !== "object") {
      item.params = createDefaultParamsForKind(item.kind);
      return;
    }

    const defaults = createDefaultParamsForKind(item.kind);
    const sections = Object.keys(defaults);
    for (let index = 0; index < sections.length; index += 1) {
      const key = sections[index];
      if (!item.params[key] || typeof item.params[key] !== "object") {
        item.params[key] = cloneParams(defaults[key]);
      }
    }
  }

  function getItemStftParams(item) {
    ensureStackItemParams(item);
    const source = item.params.stft || state.transformParams.stft;
    return sanitizeStftParams(source);
  }

  function getItemStftMode(item) {
    return getItemStftParams(item).mode;
  }

  function getTransformSelectorValue(item) {
    if (item.kind === "stft") {
      return "stft::" + getItemStftMode(item);
    }

    return item.kind;
  }

  function getTransformDisplayLabel(item) {
    if (item.kind === "stft") {
      return "stft (" + getItemStftMode(item) + ")";
    }

    return item.kind;
  }

  function getItemMelParams(item, sampleRate) {
    ensureStackItemParams(item);
    const source = item.params.mel || state.transformParams.mel;
    return sanitizeMelParams(source, sampleRate);
  }

  function getItemMfccParams(item, maxCoeff) {
    ensureStackItemParams(item);
    const source = item.params.mfcc || state.transformParams.mfcc;
    return sanitizeMfccParams(source, maxCoeff);
  }

  function getItemDctParams(item, maxCoeff) {
    ensureStackItemParams(item);
    const source = item.params.dct || state.transformParams.dct;
    return sanitizeDctParams(source, maxCoeff);
  }

  function stftParamsToKey(params) {
    return [
      params.windowSize,
      params.overlapPercent,
      params.windowType,
      params.maxAnalysisSeconds,
      params.maxFrames
    ].join("|");
  }

  function melParamsToKey(params) {
    return [params.bands, params.minHz.toFixed(4), params.maxHz.toFixed(4)].join("|");
  }

  function syncTransformParamControls() {
    const stftParams = getDefaultStftParams();

    stftWindowSize.value = String(stftParams.windowSize);
    stftOverlapPercent.value = String(stftParams.overlapPercent);
    stftWindowType.value = stftParams.windowType;
    stftMaxAnalysisSeconds.value = String(stftParams.maxAnalysisSeconds);
    stftMaxFrames.value = String(stftParams.maxFrames);

    const melParams = primaryAudio ? getDefaultMelParams(primaryAudio.sampleRate) : getDefaultMelParams(16000);
    melBands.value = String(melParams.bands);
    melMinHz.value = String(Math.round(melParams.minHz));
    melMaxHz.value = String(Math.round(melParams.maxHz));

    const mfccParams = getDefaultMfccParams(128);
    const dctParams = getDefaultDctParams(256);
    mfccCoeffs.value = String(mfccParams.coeffs);
    dctCoeffs.value = String(dctParams.coeffs);
  }

  function onTransformParamsChanged() {
    clearDerivedCache();
    syncTransformParamControls();
    renderTransformStack();
    postState();
  }

  function nextStackItem() {
    const count = state.stack.length + 1;
    const kind = "timeseries";
    return {
      id: "view-" + Date.now() + "-" + count,
      kind,
      params: createDefaultParamsForKind(kind)
    };
  }

  function updateOverlayCsvHint() {
    const statusSuffix = overlayStatusMessage ? " | " + overlayStatusMessage : "";

    if (state.overlay.mode === "flag") {
      overlayCsvHint.textContent = "Expected columns: t,flag" + statusSuffix;
      return;
    }

    overlayCsvHint.textContent = "Expected columns: flag,t_start,t_end" + statusSuffix;
  }

  function updatePcaGuidance() {
    pcaGuidance.textContent = pcaGuidanceByGoal[state.pca.goal] || "";
  }

  function setAudioStatus(text) {
    audioStatus.textContent = text;
  }

  function setPrimaryAudioInputLocked(locked, fileName) {
    primaryAudioLocked = locked;
    primaryAudioFileInput.disabled = locked;
    primaryAudioFileInput.classList.toggle("is-locked", locked);
    primaryAudioFileInput.hidden = locked;
    primaryAudioFileLocked.hidden = !locked;
    primaryAudioFileLocked.value = locked ? fileName || "" : "";

    if (locked) {
      audioLockStatus.textContent =
        "Primary audio locked to " +
        fileName +
        " from workspace selection. Open another file from sidebar to change it.";
      return;
    }

    audioLockStatus.textContent = "";
  }

  function setFilterbankStatus(text) {
    filterbankStatus.textContent = text;
  }

  function setComparisonStatus(text) {
    comparisonStatus.textContent = text;
  }

  function createPresetStack(kinds) {
    const seed = Date.now();
    return kinds.map(function (entry, index) {
      const kind = typeof entry === "string" ? entry : entry.kind;
      const stftMode =
        typeof entry === "object" && entry && entry.mode === "phase" ? "phase" : "magnitude";
      return {
        id: "preset-" + seed + "-" + index,
        kind,
        params: createDefaultParamsForKind(kind, kind === "stft" ? stftMode : undefined)
      };
    });
  }

  function applyWorkspacePreset(presetId) {
    if (presetId === "transforms") {
      state.stack = createPresetStack([
        "timeseries",
        { kind: "stft", mode: "magnitude" },
        { kind: "stft", mode: "phase" },
        "mel",
        "mfcc",
        "dct",
        "custom_filterbank"
      ]);
      state.pca.enabled = false;
    } else if (presetId === "metrics") {
      state.stack = createPresetStack(["timeseries", { kind: "stft", mode: "magnitude" }, "mel"]);
      state.metrics.audio = true;
      state.metrics.speech = true;
      state.metrics.statistical = true;
      state.metrics.distributional = true;
      state.metrics.classwise = false;
      state.pca.enabled = false;
    } else if (presetId === "pca") {
      state.stack = createPresetStack(["mel", "mfcc", "dct"]);
      state.pca.enabled = true;
      state.pca.goal = "eda";
      state.pca.classwise = false;
    } else {
      state.stack = createPresetStack(["timeseries", { kind: "stft", mode: "magnitude" }, "mel"]);
      state.pca.enabled = false;
    }

    syncControlsFromState();
    renderStackControls();
    renderTransformStack();
    postState();
  }

  function syncControlsFromState() {
    overlayEnabled.checked = state.overlay.enabled;
    overlayMode.value = state.overlay.mode;
    overlayFlagColor.value = sanitizeHexColor(state.overlay.flagColor, DEFAULT_FLAG_OVERLAY_COLOR);
    overlayFlagColor.disabled = state.overlay.mode !== "flag";
    comparisonMode.value = state.comparison.mode;
    comparisonOffsetSeconds.value = Number(state.comparison.offsetSeconds || 0).toFixed(2);
    comparisonOffsetSeconds.disabled = state.comparison.mode === "none";

    metricAudio.checked = state.metrics.audio;
    metricSpeech.checked = state.metrics.speech;
    metricStatistical.checked = state.metrics.statistical;
    metricDistributional.checked = state.metrics.distributional;
    metricClasswise.checked = state.metrics.classwise;

    featurePower.checked = state.features.power;
    featureAutocorrelation.checked = state.features.autocorrelation;
    featureShorttimePower.checked = state.features.shortTimePower;
    featureShorttimeAutocorrelation.checked = state.features.shortTimeAutocorrelation;

    pcaEnabled.checked = state.pca.enabled;
    pcaGoal.value = state.pca.goal;
    pcaClasswise.checked = state.pca.classwise;

    multichannelEnabled.checked = state.multichannel.enabled;
    multichannelSplit.checked = state.multichannel.splitViewsByChannel;

    syncTransformParamControls();
    updateOverlayCsvHint();
    updatePcaGuidance();
  }

  function createPersistableStateSnapshot() {
    return mergeBootstrapState(DEFAULT_BOOTSTRAP_STATE, state);
  }

  function applyPersistableStateSnapshot(snapshot) {
    state.stack = snapshot.stack;
    state.overlay = snapshot.overlay;
    state.comparison = snapshot.comparison;
    state.metrics = snapshot.metrics;
    state.features = snapshot.features;
    state.pca = snapshot.pca;
    state.multichannel = snapshot.multichannel;
    state.transformParams = snapshot.transformParams;
  }

  function postState() {
    const snapshot = createPersistableStateSnapshot();
    applyPersistableStateSnapshot(snapshot);

    if (typeof vscode.setState === "function") {
      vscode.setState(snapshot);
    }

    vscode.postMessage({
      type: "stateChanged",
      payload: snapshot
    });
  }

  function scheduleRenderTransformStack() {
    if (resizeTick) {
      return;
    }

    resizeTick = window.requestAnimationFrame(function () {
      resizeTick = 0;
      renderTransformStack();
    });
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toErrorText(error) {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  function formatBytes(bytes) {
    const numeric = Number(bytes);
    if (!Number.isFinite(numeric)) {
      return "unknown size";
    }
    if (numeric <= 0) {
      return "0 B";
    }
    const units = ["B", "KB", "MB", "GB"];
    let value = numeric;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return value.toFixed(precision) + " " + units[unitIndex];
  }

  function metricsAudioKey(audioData) {
    if (!audioData) {
      return "";
    }
    return (
      (audioData.audioKey || audioData.fileName || "audio") +
      "::" +
      audioData.sampleRate +
      "::" +
      audioData.samples.length +
      "::" +
      audioData.channelCount
    );
  }

  function sampleForDistribution(values, maxCount) {
    if (!values || values.length === 0) {
      return [];
    }
    if (values.length <= maxCount) {
      return Array.from(values);
    }

    const output = new Array(maxCount);
    const stride = values.length / maxCount;
    let cursor = 0;
    for (let index = 0; index < maxCount; index += 1) {
      output[index] = values[Math.floor(cursor)];
      cursor += stride;
    }
    return output;
  }

  function quantileSorted(sortedValues, quantile) {
    if (!sortedValues || sortedValues.length === 0) {
      return 0;
    }
    const q = clamp(quantile, 0, 1);
    const scaledIndex = q * (sortedValues.length - 1);
    const low = Math.floor(scaledIndex);
    const high = Math.min(sortedValues.length - 1, low + 1);
    const weight = scaledIndex - low;
    return sortedValues[low] * (1 - weight) + sortedValues[high] * weight;
  }

  function summarizeFrames(samples, sampleRate) {
    const frameSize = Math.max(128, Math.round(sampleRate * METRICS_FRAME_SIZE_SECONDS));
    const hopSize = Math.max(64, Math.round(sampleRate * METRICS_HOP_SIZE_SECONDS));
    const totalFrames = Math.max(
      1,
      Math.floor((Math.max(samples.length, frameSize) - frameSize) / hopSize) + 1
    );
    const frameStride = Math.max(1, Math.floor(totalFrames / METRICS_FRAME_SCAN_LIMIT));
    const energyByFrame = [];
    const zcrByFrame = [];

    for (let frame = 0; frame < totalFrames; frame += frameStride) {
      const offset = frame * hopSize;
      let sumSquares = 0;
      let zeroCrossings = 0;
      let previousSign = 0;

      for (let index = 0; index < frameSize; index += 1) {
        const sampleIndex = offset + index;
        const value = sampleIndex < samples.length ? samples[sampleIndex] : 0;
        sumSquares += value * value;

        const sign = value > 0 ? 1 : value < 0 ? -1 : 0;
        if (previousSign !== 0 && sign !== 0 && sign !== previousSign) {
          zeroCrossings += 1;
        }
        if (sign !== 0) {
          previousSign = sign;
        }
      }

      energyByFrame.push(sumSquares / frameSize);
      zcrByFrame.push(zeroCrossings / Math.max(1, frameSize - 1));
    }

    return {
      frameSize,
      hopSize,
      frameCount: energyByFrame.length,
      energyByFrame,
      zcrByFrame
    };
  }

  function summarizeAutocorrelation(samples, sampleRate) {
    const maxScan = Math.min(samples.length, 16384);
    if (maxScan < 4 || sampleRate <= 0) {
      return {
        bestLag: 0,
        bestCorrelation: 0,
        estimatedF0Hz: 0
      };
    }

    let zeroLag = 0;
    for (let index = 0; index < maxScan; index += 1) {
      const value = samples[index];
      zeroLag += value * value;
    }

    if (zeroLag <= 1e-12) {
      return {
        bestLag: 0,
        bestCorrelation: 0,
        estimatedF0Hz: 0
      };
    }

    const maxLag = Math.min(maxScan - 1, Math.max(16, Math.floor(sampleRate / 40)));
    const minLag = Math.min(maxLag, Math.max(1, Math.floor(sampleRate / 500)));
    let bestLag = 0;
    let bestCorrelation = Number.NEGATIVE_INFINITY;

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let sum = 0;
      for (let index = 0; index + lag < maxScan; index += 1) {
        sum += samples[index] * samples[index + lag];
      }
      const normalized = sum / zeroLag;
      if (normalized > bestCorrelation) {
        bestCorrelation = normalized;
        bestLag = lag;
      }
    }

    const estimatedF0Hz =
      bestLag > 0 && Number.isFinite(bestCorrelation) && bestCorrelation > 0
        ? sampleRate / bestLag
        : 0;

    return {
      bestLag,
      bestCorrelation: Number.isFinite(bestCorrelation) ? bestCorrelation : 0,
      estimatedF0Hz
    };
  }

  function summarizeHistogram(values, bins, minValue, maxValue) {
    const safeBins = Math.max(4, sanitizeInt(bins, METRICS_HISTOGRAM_BINS, 4, 512));
    const counts = new Array(safeBins).fill(0);
    if (!values || values.length === 0) {
      return {
        min: minValue,
        max: maxValue,
        binWidth: (maxValue - minValue) / safeBins,
        counts,
        total: 0,
        entropyBits: 0
      };
    }

    const range = Math.max(1e-9, maxValue - minValue);
    for (let index = 0; index < values.length; index += 1) {
      const normalized = (values[index] - minValue) / range;
      const bin = clamp(Math.floor(normalized * safeBins), 0, safeBins - 1);
      counts[bin] += 1;
    }

    let entropyBits = 0;
    for (let index = 0; index < counts.length; index += 1) {
      const probability = counts[index] / values.length;
      if (probability > 0) {
        entropyBits -= probability * Math.log2(probability);
      }
    }

    return {
      min: minValue,
      max: maxValue,
      binWidth: range / safeBins,
      counts,
      total: values.length,
      entropyBits
    };
  }

  function meanOfNumbers(values) {
    if (!values || values.length === 0) {
      return 0;
    }
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[index];
    }
    return sum / values.length;
  }

  function stdOfNumbers(values, meanValue) {
    if (!values || values.length === 0) {
      return 0;
    }
    const mean = Number.isFinite(meanValue) ? meanValue : meanOfNumbers(values);
    let sumSquares = 0;
    for (let index = 0; index < values.length; index += 1) {
      const centered = values[index] - mean;
      sumSquares += centered * centered;
    }
    return Math.sqrt(sumSquares / values.length);
  }

  function truePeakLinear(samples, oversampleFactor) {
    if (!samples || samples.length === 0) {
      return 0;
    }

    const factor = Math.max(1, Math.round(oversampleFactor));
    let peak = Math.abs(samples[0]);
    for (let index = 0; index < samples.length - 1; index += 1) {
      const left = samples[index];
      const right = samples[index + 1];
      const leftAbs = Math.abs(left);
      if (leftAbs > peak) {
        peak = leftAbs;
      }

      for (let step = 1; step < factor; step += 1) {
        const alpha = step / factor;
        const interpolated = left + (right - left) * alpha;
        const absolute = Math.abs(interpolated);
        if (absolute > peak) {
          peak = absolute;
        }
      }
    }

    const tail = Math.abs(samples[samples.length - 1]);
    return tail > peak ? tail : peak;
  }

  function detectOnsetsFromFrameEnergy(frameEnergyDb, hopSeconds) {
    if (!frameEnergyDb || frameEnergyDb.length < 3 || hopSeconds <= 0) {
      return {
        onsetCount: 0,
        onsetRateHz: 0,
        interOnsetMeanSeconds: 0,
        interOnsetMedianSeconds: 0,
        interOnsetCv: 0,
        fluxThreshold: 0
      };
    }

    const flux = [];
    for (let index = 1; index < frameEnergyDb.length; index += 1) {
      const delta = frameEnergyDb[index] - frameEnergyDb[index - 1];
      flux.push(Math.max(0, delta));
    }

    const sortedFlux = flux.slice().sort(function (a, b) {
      return a - b;
    });
    const fluxMedian = quantileSorted(sortedFlux, 0.5);
    const fluxIqr = quantileSorted(sortedFlux, 0.75) - quantileSorted(sortedFlux, 0.25);
    const fluxThreshold = Math.max(0.1, fluxMedian + 1.5 * fluxIqr);
    const minSpacingFrames = Math.max(1, Math.round(METRICS_ONSET_MIN_SPACING_SECONDS / hopSeconds));

    const onsetFrames = [];
    let lastOnsetFrame = Number.NEGATIVE_INFINITY;
    for (let index = 1; index < flux.length - 1; index += 1) {
      const localPeak = flux[index] >= flux[index - 1] && flux[index] >= flux[index + 1];
      if (!localPeak || flux[index] < fluxThreshold) {
        continue;
      }
      if (index - lastOnsetFrame < minSpacingFrames) {
        continue;
      }
      onsetFrames.push(index + 1);
      lastOnsetFrame = index;
    }

    const intervals = [];
    for (let index = 1; index < onsetFrames.length; index += 1) {
      intervals.push((onsetFrames[index] - onsetFrames[index - 1]) * hopSeconds);
    }
    const sortedIntervals = intervals.slice().sort(function (a, b) {
      return a - b;
    });
    const duration = frameEnergyDb.length * hopSeconds;
    const onsetRateHz = duration > 0 ? onsetFrames.length / duration : 0;
    const interOnsetMeanSeconds = meanOfNumbers(intervals);
    const interOnsetMedianSeconds = quantileSorted(sortedIntervals, 0.5);
    const interOnsetCv =
      interOnsetMeanSeconds > 0 ? stdOfNumbers(intervals, interOnsetMeanSeconds) / interOnsetMeanSeconds : 0;

    return {
      onsetCount: onsetFrames.length,
      onsetRateHz,
      interOnsetMeanSeconds,
      interOnsetMedianSeconds,
      interOnsetCv,
      fluxThreshold
    };
  }

  function summarizeSlopeDistribution(frameEnergyDb, hopSeconds) {
    if (!frameEnergyDb || frameEnergyDb.length < 2 || hopSeconds <= 0) {
      return {
        attackMedianDbPerSecond: 0,
        attackP95DbPerSecond: 0,
        decayMedianDbPerSecond: 0,
        decayP95DbPerSecond: 0
      };
    }

    const attack = [];
    const decay = [];
    for (let index = 1; index < frameEnergyDb.length; index += 1) {
      const slope = (frameEnergyDb[index] - frameEnergyDb[index - 1]) / hopSeconds;
      if (slope > 0) {
        attack.push(slope);
      } else if (slope < 0) {
        decay.push(-slope);
      }
    }

    const sortedAttack = attack.slice().sort(function (a, b) {
      return a - b;
    });
    const sortedDecay = decay.slice().sort(function (a, b) {
      return a - b;
    });

    return {
      attackMedianDbPerSecond: quantileSorted(sortedAttack, 0.5),
      attackP95DbPerSecond: quantileSorted(sortedAttack, 0.95),
      decayMedianDbPerSecond: quantileSorted(sortedDecay, 0.5),
      decayP95DbPerSecond: quantileSorted(sortedDecay, 0.95)
    };
  }

  function estimateCorrelationTime(samples, sampleRate) {
    if (!samples || samples.length < 4 || sampleRate <= 0) {
      return 0;
    }

    const maxScan = Math.min(samples.length, 8192);
    let zeroLag = 0;
    for (let index = 0; index < maxScan; index += 1) {
      const value = samples[index];
      zeroLag += value * value;
    }
    if (zeroLag <= 1e-12) {
      return 0;
    }

    const target = Math.exp(-1);
    const maxLag = Math.min(maxScan - 1, Math.max(16, Math.floor(sampleRate * 0.1)));
    for (let lag = 1; lag <= maxLag; lag += 1) {
      let sum = 0;
      for (let index = 0; index + lag < maxScan; index += 1) {
        sum += samples[index] * samples[index + lag];
      }
      const normalized = sum / zeroLag;
      if (normalized <= target) {
        return lag / sampleRate;
      }
    }

    return maxLag / sampleRate;
  }

  function estimatePitchStats(samples, sampleRate, frameSize, hopSize, frameEnergyDb, activeThresholdDb) {
    if (!samples || samples.length < frameSize || sampleRate <= 0) {
      return {
        analyzedFrames: 0,
        voicedFrames: 0,
        voicedRatio: 0,
        f0MeanHz: 0,
        f0StdHz: 0,
        f0MinHz: 0,
        f0MaxHz: 0,
        f0MedianHz: 0,
        jitterLocal: 0,
        shimmerLocal: 0
      };
    }

    const lagMin = Math.max(1, Math.floor(sampleRate / METRICS_MAX_PITCH_HZ));
    const lagMax = Math.max(lagMin + 1, Math.floor(sampleRate / METRICS_MIN_PITCH_HZ));
    const totalFrames = Math.max(1, Math.floor((samples.length - frameSize) / hopSize) + 1);
    const frameStride = Math.max(1, Math.floor(totalFrames / METRICS_MAX_PITCH_FRAMES));

    const f0Values = [];
    const periods = [];
    const amplitudes = [];
    let analyzedFrames = 0;
    let voicedFrames = 0;

    for (let frame = 0; frame < totalFrames; frame += frameStride) {
      const energyDb = frame < frameEnergyDb.length ? frameEnergyDb[frame] : -120;
      if (energyDb < activeThresholdDb) {
        continue;
      }

      const offset = frame * hopSize;
      if (offset + frameSize > samples.length) {
        break;
      }

      analyzedFrames += 1;
      let zeroLag = 0;
      let frameRmsAccum = 0;
      for (let index = 0; index < frameSize; index += 1) {
        const value = samples[offset + index];
        zeroLag += value * value;
        frameRmsAccum += value * value;
      }
      if (zeroLag <= 1e-12) {
        continue;
      }

      let bestLag = 0;
      let bestCorrelation = Number.NEGATIVE_INFINITY;
      for (let lag = lagMin; lag <= lagMax; lag += 1) {
        let sum = 0;
        for (let index = 0; index + lag < frameSize; index += 1) {
          sum += samples[offset + index] * samples[offset + index + lag];
        }
        const normalized = sum / zeroLag;
        if (normalized > bestCorrelation) {
          bestCorrelation = normalized;
          bestLag = lag;
        }
      }

      if (bestLag <= 0 || bestCorrelation < 0.3) {
        continue;
      }

      const f0 = sampleRate / bestLag;
      if (!Number.isFinite(f0) || f0 < METRICS_MIN_PITCH_HZ || f0 > METRICS_MAX_PITCH_HZ) {
        continue;
      }

      voicedFrames += 1;
      f0Values.push(f0);
      periods.push(bestLag / sampleRate);
      amplitudes.push(Math.sqrt(frameRmsAccum / frameSize));
    }

    const sortedF0 = f0Values.slice().sort(function (a, b) {
      return a - b;
    });
    let jitterNumerator = 0;
    for (let index = 1; index < periods.length; index += 1) {
      jitterNumerator += Math.abs(periods[index] - periods[index - 1]);
    }
    const meanPeriod = meanOfNumbers(periods);
    const jitterLocal =
      periods.length > 1 && meanPeriod > 1e-12
        ? (jitterNumerator / (periods.length - 1)) / meanPeriod
        : 0;

    let shimmerNumerator = 0;
    for (let index = 1; index < amplitudes.length; index += 1) {
      shimmerNumerator += Math.abs(amplitudes[index] - amplitudes[index - 1]);
    }
    const meanAmplitude = meanOfNumbers(amplitudes);
    const shimmerLocal =
      amplitudes.length > 1 && meanAmplitude > 1e-12
        ? (shimmerNumerator / (amplitudes.length - 1)) / meanAmplitude
        : 0;

    return {
      analyzedFrames,
      voicedFrames,
      voicedRatio: analyzedFrames > 0 ? voicedFrames / analyzedFrames : 0,
      f0MeanHz: meanOfNumbers(f0Values),
      f0StdHz: stdOfNumbers(f0Values),
      f0MinHz: sortedF0.length ? sortedF0[0] : 0,
      f0MaxHz: sortedF0.length ? sortedF0[sortedF0.length - 1] : 0,
      f0MedianHz: quantileSorted(sortedF0, 0.5),
      jitterLocal,
      shimmerLocal
    };
  }

  function summarizeBandPower(avgPsd, sampleRate, fftSize) {
    const nyquist = sampleRate / 2;
    const ranges = [
      { key: "low20_250", minHz: 20, maxHz: Math.min(250, nyquist) },
      { key: "mid250_2k", minHz: 250, maxHz: Math.min(2000, nyquist) },
      { key: "high2k_8k", minHz: 2000, maxHz: Math.min(8000, nyquist) },
      { key: "air8k_nyq", minHz: 8000, maxHz: nyquist }
    ];

    const totals = Object.create(null);
    ranges.forEach(function (range) {
      totals[range.key] = 0;
    });

    let total = 0;
    for (let bin = 0; bin < avgPsd.length; bin += 1) {
      const frequency = (bin * sampleRate) / fftSize;
      const power = avgPsd[bin];
      total += power;
      for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
        const range = ranges[rangeIndex];
        if (frequency >= range.minHz && frequency < range.maxHz) {
          totals[range.key] += power;
          break;
        }
      }
    }

    const out = {};
    ranges.forEach(function (range) {
      const value = totals[range.key];
      out[range.key] = {
        power: value,
        ratio: total > 0 ? value / total : 0,
        db: 10 * Math.log10(value + 1e-12)
      };
    });
    out.total = total;
    return out;
  }

  function summarizeSpectralFeatures(stft) {
    if (!stft || !stft.powerFrames || stft.powerFrames.length === 0) {
      return null;
    }

    const eps = 1e-12;
    const binCount = stft.binCount;
    const frameCount = stft.powerFrames.length;
    const frequencies = new Float64Array(binCount);
    for (let bin = 0; bin < binCount; bin += 1) {
      frequencies[bin] = (bin * stft.sampleRate) / stft.fftSize;
    }

    const avgPsd = new Float64Array(binCount);
    const centroidValues = [];
    const spreadValues = [];
    const skewnessValues = [];
    const kurtosisValues = [];
    const flatnessValues = [];
    const entropyValues = [];
    const rolloffValues = [];

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const frame = stft.powerFrames[frameIndex];
      let sumPower = 0;
      for (let bin = 0; bin < binCount; bin += 1) {
        const value = frame[bin];
        avgPsd[bin] += value;
        sumPower += value;
      }
      if (sumPower <= eps) {
        continue;
      }

      let centroidNumerator = 0;
      let geometricLogSum = 0;
      let entropy = 0;
      for (let bin = 0; bin < binCount; bin += 1) {
        const power = frame[bin] + eps;
        const probability = power / sumPower;
        centroidNumerator += frequencies[bin] * power;
        geometricLogSum += Math.log(power);
        entropy -= probability * Math.log2(probability);
      }

      const centroid = centroidNumerator / (sumPower + eps);
      let spreadAccum = 0;
      let skewAccum = 0;
      let kurtAccum = 0;
      let cumulative = 0;
      let rolloffHz = frequencies[frequencies.length - 1];

      for (let bin = 0; bin < binCount; bin += 1) {
        const power = frame[bin] + eps;
        const centered = frequencies[bin] - centroid;
        spreadAccum += centered * centered * power;
        cumulative += power;
        if (cumulative >= 0.85 * sumPower) {
          rolloffHz = frequencies[bin];
          break;
        }
      }

      const spread = Math.sqrt(spreadAccum / (sumPower + eps));
      if (spread > eps) {
        for (let bin = 0; bin < binCount; bin += 1) {
          const power = frame[bin] + eps;
          const z = (frequencies[bin] - centroid) / spread;
          skewAccum += z * z * z * power;
          kurtAccum += z * z * z * z * power;
        }
        skewnessValues.push(skewAccum / (sumPower + eps));
        kurtosisValues.push(kurtAccum / (sumPower + eps) - 3);
      }

      centroidValues.push(centroid);
      spreadValues.push(spread);
      flatnessValues.push(Math.exp(geometricLogSum / binCount) / (sumPower / binCount + eps));
      entropyValues.push(entropy / Math.log2(binCount));
      rolloffValues.push(rolloffHz);
    }

    for (let bin = 0; bin < avgPsd.length; bin += 1) {
      avgPsd[bin] /= Math.max(1, frameCount);
    }

    let dominantBin = 0;
    for (let bin = 1; bin < avgPsd.length; bin += 1) {
      if (avgPsd[bin] > avgPsd[dominantBin]) {
        dominantBin = bin;
      }
    }

    let xMean = 0;
    let yMean = 0;
    let regressionCount = 0;
    for (let bin = 1; bin < avgPsd.length; bin += 1) {
      const frequency = frequencies[bin];
      if (frequency <= 0) {
        continue;
      }
      const x = Math.log10(frequency);
      const y = 10 * Math.log10(avgPsd[bin] + eps);
      xMean += x;
      yMean += y;
      regressionCount += 1;
    }
    xMean /= Math.max(1, regressionCount);
    yMean /= Math.max(1, regressionCount);

    let covariance = 0;
    let varianceX = 0;
    for (let bin = 1; bin < avgPsd.length; bin += 1) {
      const frequency = frequencies[bin];
      if (frequency <= 0) {
        continue;
      }
      const x = Math.log10(frequency);
      const y = 10 * Math.log10(avgPsd[bin] + eps);
      covariance += (x - xMean) * (y - yMean);
      varianceX += (x - xMean) * (x - xMean);
    }
    const spectralSlopeDbPerDecade = varianceX > eps ? covariance / varianceX : 0;
    const bandPower = summarizeBandPower(avgPsd, stft.sampleRate, stft.fftSize);

    return {
      frameCount,
      dominantFrequencyHz: frequencies[dominantBin],
      spectralSlopeDbPerDecade,
      centroidMeanHz: meanOfNumbers(centroidValues),
      centroidStdHz: stdOfNumbers(centroidValues),
      spreadMeanHz: meanOfNumbers(spreadValues),
      spreadStdHz: stdOfNumbers(spreadValues),
      skewnessMean: meanOfNumbers(skewnessValues),
      kurtosisExcessMean: meanOfNumbers(kurtosisValues),
      flatnessMean: meanOfNumbers(flatnessValues),
      entropyMean: meanOfNumbers(entropyValues),
      rolloff85MeanHz: meanOfNumbers(rolloffValues),
      tonalityProxy: Math.max(0, 1 - meanOfNumbers(flatnessValues)),
      bandPower
    };
  }

  function summarizeMelMfccFeatures(stft) {
    if (!stft || !stft.powerFrames || stft.powerFrames.length === 0) {
      return null;
    }

    const melBands = 40;
    const minHz = 0;
    const maxHz = Math.min(8000, stft.sampleRate / 2);
    const melFilterbank = createMelFilterbank(stft.sampleRate, stft.fftSize, melBands, minHz, maxHz);
    const melPower = applyFilterbankLinear(stft.powerFrames, melFilterbank);
    if (!melPower.length) {
      return null;
    }

    const frameCount = melPower.length;
    const melLog = new Array(frameCount);
    let globalSum = 0;
    let globalCount = 0;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const source = melPower[frameIndex];
      const row = new Float32Array(source.length);
      for (let band = 0; band < source.length; band += 1) {
        const value = 10 * Math.log10(source[band] + 1e-12);
        row[band] = value;
        globalSum += value;
        globalCount += 1;
      }
      melLog[frameIndex] = row;
    }
    const globalMean = globalCount > 0 ? globalSum / globalCount : 0;
    let globalVar = 0;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const row = melLog[frameIndex];
      for (let band = 0; band < row.length; band += 1) {
        const centered = row[band] - globalMean;
        globalVar += centered * centered;
      }
    }
    globalVar /= Math.max(1, globalCount);

    const bandMeans = new Array(melBands).fill(0);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const row = melLog[frameIndex];
      for (let band = 0; band < melBands; band += 1) {
        bandMeans[band] += row[band];
      }
    }
    for (let band = 0; band < melBands; band += 1) {
      bandMeans[band] /= Math.max(1, frameCount);
    }

    const bandStd = new Array(melBands).fill(0);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const row = melLog[frameIndex];
      for (let band = 0; band < melBands; band += 1) {
        const centered = row[band] - bandMeans[band];
        bandStd[band] += centered * centered;
      }
    }
    for (let band = 0; band < melBands; band += 1) {
      bandStd[band] = Math.sqrt(bandStd[band] / Math.max(1, frameCount));
    }

    const sortedBandMeans = bandMeans.slice().sort(function (a, b) {
      return a - b;
    });
    let adjacentCorrelationSum = 0;
    let adjacentCorrelationCount = 0;
    for (let band = 0; band < melBands - 1; band += 1) {
      const stdLeft = bandStd[band];
      const stdRight = bandStd[band + 1];
      if (stdLeft <= 1e-12 || stdRight <= 1e-12) {
        continue;
      }
      let covariance = 0;
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        covariance +=
          (melLog[frameIndex][band] - bandMeans[band]) *
          (melLog[frameIndex][band + 1] - bandMeans[band + 1]);
      }
      covariance /= Math.max(1, frameCount);
      adjacentCorrelationSum += covariance / (stdLeft * stdRight);
      adjacentCorrelationCount += 1;
    }

    const frameMelMean = new Array(frameCount).fill(0);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      frameMelMean[frameIndex] = meanOfNumbers(melLog[frameIndex]);
    }
    const delta = [];
    for (let index = 1; index < frameMelMean.length; index += 1) {
      delta.push(frameMelMean[index] - frameMelMean[index - 1]);
    }
    const delta2 = [];
    for (let index = 1; index < delta.length; index += 1) {
      delta2.push(delta[index] - delta[index - 1]);
    }
    const deltaRms = Math.sqrt(meanOfNumbers(delta.map(function (value) {
      return value * value;
    })));
    const delta2Rms = Math.sqrt(meanOfNumbers(delta2.map(function (value) {
      return value * value;
    })));

    const mfccMatrix = dctRows(melLog, 13);
    const coeffCount = mfccMatrix.length > 0 ? mfccMatrix[0].length : 0;
    const coeffMeans = new Array(coeffCount).fill(0);
    for (let frameIndex = 0; frameIndex < mfccMatrix.length; frameIndex += 1) {
      for (let coeff = 0; coeff < coeffCount; coeff += 1) {
        coeffMeans[coeff] += mfccMatrix[frameIndex][coeff];
      }
    }
    for (let coeff = 0; coeff < coeffCount; coeff += 1) {
      coeffMeans[coeff] /= Math.max(1, mfccMatrix.length);
    }

    const coeffStd = new Array(coeffCount).fill(0);
    for (let frameIndex = 0; frameIndex < mfccMatrix.length; frameIndex += 1) {
      for (let coeff = 0; coeff < coeffCount; coeff += 1) {
        const centered = mfccMatrix[frameIndex][coeff] - coeffMeans[coeff];
        coeffStd[coeff] += centered * centered;
      }
    }
    for (let coeff = 0; coeff < coeffCount; coeff += 1) {
      coeffStd[coeff] = Math.sqrt(coeffStd[coeff] / Math.max(1, mfccMatrix.length));
    }

    return {
      mel: {
        bands: melBands,
        minHz,
        maxHz,
        globalMeanDb: globalMean,
        globalStdDb: Math.sqrt(globalVar),
        bandMeanRangeDb:
          sortedBandMeans.length > 0
            ? sortedBandMeans[sortedBandMeans.length - 1] - sortedBandMeans[0]
            : 0,
        adjacentBandCorrelationMean:
          adjacentCorrelationCount > 0 ? adjacentCorrelationSum / adjacentCorrelationCount : 0
      },
      mfcc: {
        coeffs: coeffCount,
        c0Mean: coeffCount > 0 ? coeffMeans[0] : 0,
        c0Std: coeffCount > 0 ? coeffStd[0] : 0,
        coeffMeanAbs: meanOfNumbers(
          coeffMeans.map(function (value) {
            return Math.abs(value);
          })
        )
      },
      delta: {
        melDeltaRms: deltaRms,
        melDeltaDeltaRms: delta2Rms
      }
    };
  }

  function summarizeModulation(frameEnergyDb, hopSeconds) {
    if (!frameEnergyDb || frameEnergyDb.length < 8 || hopSeconds <= 0) {
      return {
        frameRateHz: 0,
        dominantModulationHz: 0,
        bandEnergy: {
          hz_0_5_2: 0,
          hz_2_4: 0,
          hz_4_8: 0,
          hz_8_16: 0,
          hz_16_32: 0
        },
        lowToHighRatio: 0
      };
    }

    const envelope = frameEnergyDb.slice();
    const envelopeMean = meanOfNumbers(envelope);
    for (let index = 0; index < envelope.length; index += 1) {
      envelope[index] -= envelopeMean;
    }

    let nfft = 1;
    while (nfft < envelope.length) {
      nfft *= 2;
    }

    const re = new Float64Array(nfft);
    const im = new Float64Array(nfft);
    for (let index = 0; index < envelope.length; index += 1) {
      re[index] = envelope[index];
    }
    fftInPlace(re, im);

    const frameRateHz = 1 / hopSeconds;
    const bandEnergy = {
      hz_0_5_2: 0,
      hz_2_4: 0,
      hz_4_8: 0,
      hz_8_16: 0,
      hz_16_32: 0
    };

    let dominantFrequency = 0;
    let dominantPower = 0;
    for (let bin = 1; bin < nfft / 2; bin += 1) {
      const frequency = (bin * frameRateHz) / nfft;
      const power = re[bin] * re[bin] + im[bin] * im[bin];

      if (frequency >= 0.5 && frequency <= 32 && power > dominantPower) {
        dominantPower = power;
        dominantFrequency = frequency;
      }

      if (frequency >= 0.5 && frequency < 2) {
        bandEnergy.hz_0_5_2 += power;
      } else if (frequency >= 2 && frequency < 4) {
        bandEnergy.hz_2_4 += power;
      } else if (frequency >= 4 && frequency < 8) {
        bandEnergy.hz_4_8 += power;
      } else if (frequency >= 8 && frequency < 16) {
        bandEnergy.hz_8_16 += power;
      } else if (frequency >= 16 && frequency <= 32) {
        bandEnergy.hz_16_32 += power;
      }
    }

    const low = bandEnergy.hz_0_5_2 + bandEnergy.hz_2_4;
    const high = bandEnergy.hz_4_8 + bandEnergy.hz_8_16;

    return {
      frameRateHz,
      dominantModulationHz: dominantFrequency,
      bandEnergy,
      lowToHighRatio: high > 0 ? low / high : 0
    };
  }

  function computeMetricsReport(audioData) {
    if (!audioData || !audioData.samples || audioData.samples.length === 0) {
      return null;
    }

    const samples = audioData.samples;
    const sampleRate = audioData.sampleRate || 0;
    const sampleCount = samples.length;
    const channelCount = Math.max(1, audioData.channelCount || 1);
    const durationSeconds = sampleRate > 0 ? sampleCount / sampleRate : 0;

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    let sumSquares = 0;
    let sumAbs = 0;
    let zeroCrossings = 0;
    let previousSign = 0;
    let clippingCount = 0;

    for (let index = 0; index < sampleCount; index += 1) {
      const value = samples[index];
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
      sum += value;
      sumSquares += value * value;
      sumAbs += Math.abs(value);
      if (Math.abs(value) >= 0.999) {
        clippingCount += 1;
      }

      const sign = value > 0 ? 1 : value < 0 ? -1 : 0;
      if (previousSign !== 0 && sign !== 0 && sign !== previousSign) {
        zeroCrossings += 1;
      }
      if (sign !== 0) {
        previousSign = sign;
      }
    }

    const mean = sum / sampleCount;
    const meanAbs = sumAbs / sampleCount;
    const variance = Math.max(0, sumSquares / sampleCount - mean * mean);
    const std = Math.sqrt(variance);
    const rms = Math.sqrt(sumSquares / sampleCount);
    const peakAbs = Math.max(Math.abs(min), Math.abs(max));
    const truePeakAbs = truePeakLinear(samples, METRICS_TRUE_PEAK_OVERSAMPLE);
    const crestFactor = truePeakAbs / Math.max(1e-12, rms);
    const zcr = zeroCrossings / Math.max(1, sampleCount - 1);
    const clippingRatio = clippingCount / sampleCount;
    const energy = sumSquares;
    const meanPower = sumSquares / sampleCount;
    const meanPowerDb = 10 * Math.log10(meanPower + 1e-12);

    const distributionSample = sampleForDistribution(samples, METRICS_DISTRIBUTION_SAMPLE_LIMIT);
    const sortedDistribution = distributionSample.slice().sort(function (a, b) {
      return a - b;
    });
    const median = quantileSorted(sortedDistribution, 0.5);
    const q05 = quantileSorted(sortedDistribution, 0.05);
    const q25 = quantileSorted(sortedDistribution, 0.25);
    const q75 = quantileSorted(sortedDistribution, 0.75);
    const q95 = quantileSorted(sortedDistribution, 0.95);
    const iqr = q75 - q25;

    const absDistribution = distributionSample.map(function (value) {
      return Math.abs(value);
    });
    const sortedAbsDistribution = absDistribution.slice().sort(function (a, b) {
      return a - b;
    });
    const p05Abs = quantileSorted(sortedAbsDistribution, 0.05);
    const p95Abs = quantileSorted(sortedAbsDistribution, 0.95);

    let moment3 = 0;
    let moment4 = 0;
    for (let index = 0; index < distributionSample.length; index += 1) {
      const centered = distributionSample[index] - mean;
      const square = centered * centered;
      moment3 += square * centered;
      moment4 += square * square;
    }
    const sampleDenominator = Math.max(1, distributionSample.length);
    moment3 /= sampleDenominator;
    moment4 /= sampleDenominator;
    const skewness = std > 1e-12 ? moment3 / Math.pow(std, 3) : 0;
    const kurtosisExcess = std > 1e-12 ? moment4 / Math.pow(std, 4) - 3 : 0;

    const frameSummary = summarizeFrames(samples, sampleRate);
    const hopSeconds = sampleRate > 0 ? frameSummary.hopSize / sampleRate : METRICS_HOP_SIZE_SECONDS;
    const frameEnergyDb = frameSummary.energyByFrame.map(function (value) {
      return 10 * Math.log10(value + 1e-12);
    });
    const sortedFrameEnergyDb = frameEnergyDb.slice().sort(function (a, b) {
      return a - b;
    });
    const frameEnergyMean = meanOfNumbers(frameSummary.energyByFrame);
    const frameEnergyVariance = Math.pow(stdOfNumbers(frameSummary.energyByFrame, frameEnergyMean), 2);
    const frameEnergyStd = Math.sqrt(Math.max(0, frameEnergyVariance));
    const maxFrameDb = sortedFrameEnergyDb.length
      ? sortedFrameEnergyDb[sortedFrameEnergyDb.length - 1]
      : -120;
    const silenceThresholdDb = maxFrameDb - METRICS_SPEECH_SILENCE_DB_OFFSET;
    const activeThresholdDb = maxFrameDb - METRICS_SPEECH_ACTIVITY_DB_OFFSET;

    let silenceFrames = 0;
    let activeFrames = 0;
    let activeEnergyAccum = 0;
    let activeEnergyCount = 0;
    let inactiveEnergyAccum = 0;
    let inactiveEnergyCount = 0;

    for (let index = 0; index < frameEnergyDb.length; index += 1) {
      const energyDb = frameEnergyDb[index];
      const isSilent = energyDb < silenceThresholdDb;
      const isActive = energyDb >= activeThresholdDb;
      if (isSilent) {
        silenceFrames += 1;
      }
      if (isActive) {
        activeFrames += 1;
        activeEnergyAccum += energyDb;
        activeEnergyCount += 1;
      } else {
        inactiveEnergyAccum += energyDb;
        inactiveEnergyCount += 1;
      }
    }

    const frameCount = Math.max(1, frameSummary.frameCount);
    const speechActivityRatio = activeFrames / frameCount;
    const silenceRatio = silenceFrames / frameCount;
    const meanFrameEnergyDb = meanOfNumbers(frameEnergyDb);
    const frameEnergyP95 = quantileSorted(sortedFrameEnergyDb, 0.95);
    const frameEnergyP50 = quantileSorted(sortedFrameEnergyDb, 0.5);
    const frameEnergyP05 = quantileSorted(sortedFrameEnergyDb, 0.05);
    const dynamicRangeDb = frameEnergyP95 - frameEnergyP05;
    const speechSnrProxyDb =
      activeEnergyCount > 0 && inactiveEnergyCount > 0
        ? activeEnergyAccum / activeEnergyCount - inactiveEnergyAccum / inactiveEnergyCount
        : 0;

    const histogram = summarizeHistogram(distributionSample, METRICS_HISTOGRAM_BINS, -1, 1);
    const autocorrelation = summarizeAutocorrelation(samples, sampleRate);
    const shortTimeAuto = summarizeAutocorrelation(Float32Array.from(frameSummary.energyByFrame), 100);
    const correlationTimeSeconds = estimateCorrelationTime(samples, sampleRate);
    const onset = detectOnsetsFromFrameEnergy(frameEnergyDb, hopSeconds);
    const slopes = summarizeSlopeDistribution(frameEnergyDb, hopSeconds);
    const pitch = estimatePitchStats(
      samples,
      sampleRate,
      frameSummary.frameSize,
      frameSummary.hopSize,
      frameEnergyDb,
      activeThresholdDb
    );
    const modulation = summarizeModulation(frameEnergyDb, hopSeconds);

    const sortedFrameEnergyLinear = frameSummary.energyByFrame.slice().sort(function (a, b) {
      return a - b;
    });

    const stftParams = getDefaultStftParams();
    const metricsStft = computeStft(
      samples,
      sampleRate,
      stftParams.windowSize,
      stftParams.hopSize,
      Math.min(stftParams.maxFrames, 1200),
      stftParams.windowType
    );
    const spectral = summarizeSpectralFeatures(metricsStft);
    const melMfcc = summarizeMelMfccFeatures(metricsStft);

    const standards = {
      leqDbfs: meanPowerDb,
      l10Dbfs: frameEnergyP95,
      l50Dbfs: frameEnergyP50,
      l90Dbfs: frameEnergyP05,
      calibrationNote:
        "dBFS-relative values only (not calibrated SPL/LUFS). Absolute acoustics need calibration and standard weighting."
    };

    const availability = {
      intrusiveMetrics:
        "Unavailable without clean reference clip (SI-SDR/STOI/PESQ/POLQA require reference).",
      roomAcoustics:
        "Unavailable without RIR / room measurement chain (RT/EDT/C50/D50/STI/SII).",
      classwise:
        "Unavailable without class labels (planned Phase 8)."
    };

    return {
      generatedAt: new Date().toISOString(),
      fileName: audioData.fileName || "audio",
      sampleCount,
      audio: {
        sampleRate,
        channelCount,
        durationSeconds,
        mean,
        dcOffset: mean,
        meanAbs,
        variance,
        std,
        min,
        max,
        rms,
        peakAbs,
        truePeakAbs,
        crestFactor,
        zcr,
        clippingRatio,
        silenceRatio,
        energy,
        meanPower,
        meanPowerDb,
        amplitudeP95P05: p95Abs - p05Abs
      },
      temporal: {
        autocorrelation,
        correlationTimeSeconds,
        onset,
        stationarity: {
          frameEnergyStd,
          frameEnergyCv: frameEnergyMean > 1e-12 ? frameEnergyStd / frameEnergyMean : 0,
          changePointCount: frameEnergyDb.reduce(function (acc, value, index) {
            if (index === 0) {
              return acc;
            }
            return acc + (Math.abs(value - frameEnergyDb[index - 1]) >= METRICS_CHANGEPOINT_DB ? 1 : 0);
          }, 0)
        },
        envelope: {
          frameEnergyMean,
          frameEnergyStd,
          frameEnergyP05,
          frameEnergyP50,
          frameEnergyP95,
          attackDecay: slopes
        }
      },
      speech: {
        frameSize: frameSummary.frameSize,
        hopSize: frameSummary.hopSize,
        frameCount: frameSummary.frameCount,
        silenceRatio,
        speechActivityRatio,
        voicedRatio: pitch.voicedRatio,
        meanFrameEnergyDb,
        dynamicRangeDb,
        speechSnrProxyDb,
        f0: pitch,
        speakingRateProxyHz: onset.onsetRateHz,
        heuristic: "Energy + autocorrelation heuristics (diagnostic, not ASR-grade VAD/pitch)."
      },
      spectral,
      spectrogramFeatures: melMfcc,
      modulation,
      spatial: audioData.spatialSummary || {
        note: "Requires at least 2 decoded channels."
      },
      standards,
      statistical: {
        mean,
        std,
        variance,
        min,
        max,
        median,
        q05,
        q25,
        q75,
        q95,
        iqr,
        skewness,
        kurtosisExcess
      },
      distributional: {
        histogram,
        moments: {
          m1: mean,
          m2: variance,
          m3: moment3,
          m4: moment4
        },
        entropyBits: histogram.entropyBits
      },
      features: {
        power: {
          meanPower,
          meanPowerDb
        },
        autocorrelation,
        shortTimePower: {
          frameMean: frameEnergyMean,
          frameStd: Math.sqrt(Math.max(0, frameEnergyVariance)),
          frameP95: quantileSorted(sortedFrameEnergyLinear, 0.95),
          frameP05: quantileSorted(sortedFrameEnergyLinear, 0.05)
        },
        shortTimeAutocorrelation: shortTimeAuto
      },
      availability
    };
  }

  function getPrimaryMetricsReport() {
    if (!primaryAudio || !primaryAudio.samples || primaryAudio.samples.length === 0) {
      return null;
    }

    const cacheKey = metricsAudioKey(primaryAudio);
    if (metricsCache.cacheKey === cacheKey && metricsCache.report) {
      return metricsCache.report;
    }

    const report = computeMetricsReport(primaryAudio);
    metricsCache = { cacheKey, report };
    return report;
  }

  function formatMetricNumber(value, decimals) {
    if (!Number.isFinite(value)) {
      return "n/a";
    }
    const places = Number.isFinite(decimals) ? decimals : 4;
    const absolute = Math.abs(value);
    if (absolute >= 100000 || (absolute > 0 && absolute < 1e-4)) {
      return value.toExponential(3);
    }
    if (absolute >= 1000) {
      return value.toFixed(1);
    }
    return value.toFixed(places);
  }

  function formatMetricPercent(value) {
    if (!Number.isFinite(value)) {
      return "n/a";
    }
    return (value * 100).toFixed(2) + "%";
  }

  function createMetricsGroup(title, rows) {
    const group = document.createElement("section");
    group.className = "metrics-group";

    const heading = document.createElement("h3");
    heading.textContent = title;
    group.appendChild(heading);

    const table = document.createElement("table");
    table.className = "metrics-table";
    const body = document.createElement("tbody");

    rows.forEach(function (row) {
      const tr = document.createElement("tr");
      const key = document.createElement("td");
      key.textContent = row[0];
      const value = document.createElement("td");
      value.textContent = row[1];
      tr.appendChild(key);
      tr.appendChild(value);
      body.appendChild(tr);
    });

    table.appendChild(body);
    group.appendChild(table);
    return group;
  }

  function getHistogramCanvasContext(canvas) {
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    const cssWidth = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 720));
    const cssHeight = Math.max(1, Math.round(canvas.clientHeight || 220));
    const ratio = window.devicePixelRatio || 1;
    const targetWidth = Math.max(1, Math.round(cssWidth * ratio));
    const targetHeight = Math.max(1, Math.round(cssHeight * ratio));

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.scale(ratio, ratio);
    return { context, width: cssWidth, height: cssHeight };
  }

  function clearMetricsHistogram(message) {
    const prepared = getHistogramCanvasContext(metricsHistogramCanvas);
    if (!prepared) {
      return;
    }
    const ctx = prepared.context;
    ctx.clearRect(0, 0, prepared.width, prepared.height);
    ctx.fillStyle = "rgba(127,127,127,0.18)";
    ctx.fillRect(0, 0, prepared.width, prepared.height);
    if (message) {
      ctx.fillStyle = "rgba(200,200,200,0.85)";
      ctx.font = "12px sans-serif";
      ctx.fillText(message, 14, Math.max(20, Math.floor(prepared.height / 2)));
    }
  }

  function drawMetricsHistogram(histogram) {
    const prepared = getHistogramCanvasContext(metricsHistogramCanvas);
    if (!prepared) {
      return;
    }

    const ctx = prepared.context;
    const width = prepared.width;
    const height = prepared.height;
    ctx.clearRect(0, 0, width, height);

    const paddingLeft = 44;
    const paddingRight = 12;
    const paddingTop = 12;
    const paddingBottom = 28;
    const plotWidth = Math.max(10, width - paddingLeft - paddingRight);
    const plotHeight = Math.max(10, height - paddingTop - paddingBottom);
    const counts = histogram.counts || [];
    const maxCount = counts.length
      ? counts.reduce(function (max, value) {
          return value > max ? value : max;
        }, 0)
      : 0;

    ctx.fillStyle = "rgba(90,140,170,0.18)";
    ctx.fillRect(paddingLeft, paddingTop, plotWidth, plotHeight);

    if (maxCount <= 0 || counts.length === 0) {
      ctx.fillStyle = "rgba(200,200,200,0.85)";
      ctx.font = "12px sans-serif";
      ctx.fillText("No histogram data.", paddingLeft + 8, paddingTop + 20);
      return;
    }

    const barWidth = plotWidth / counts.length;
    for (let index = 0; index < counts.length; index += 1) {
      const ratio = counts[index] / maxCount;
      const barHeight = ratio * plotHeight;
      const x = paddingLeft + index * barWidth;
      const y = paddingTop + plotHeight - barHeight;
      ctx.fillStyle = "rgba(56,189,248,0.9)";
      ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
    }

    ctx.strokeStyle = "rgba(170,210,235,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, paddingTop);
    ctx.lineTo(paddingLeft, paddingTop + plotHeight);
    ctx.lineTo(paddingLeft + plotWidth, paddingTop + plotHeight);
    ctx.stroke();

    ctx.fillStyle = "rgba(220,220,220,0.9)";
    ctx.font = "11px sans-serif";
    ctx.fillText(formatMetricNumber(histogram.min, 2), paddingLeft, height - 8);
    const maxLabel = formatMetricNumber(histogram.max, 2);
    const labelWidth = ctx.measureText(maxLabel).width;
    ctx.fillText(maxLabel, paddingLeft + plotWidth - labelWidth, height - 8);
    ctx.fillText("0", 24, paddingTop + plotHeight + 4);
    ctx.fillText(formatMetricNumber(maxCount, 0), 8, paddingTop + 8);
  }

  function metricsExportBaseName() {
    const candidate = primaryAudio && primaryAudio.fileName ? primaryAudio.fileName : "audio";
    const withoutExtension = candidate.replace(/\.[^./\\]+$/, "");
    const normalized = withoutExtension.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
    return normalized || "audio";
  }

  function escapeCsvField(value) {
    const text = String(value);
    if (text.indexOf(",") === -1 && text.indexOf("\"") === -1 && text.indexOf("\n") === -1) {
      return text;
    }
    return "\"" + text.replace(/"/g, "\"\"") + "\"";
  }

  function buildMetricsExportModel(report) {
    const output = {
      generatedAt: report.generatedAt,
      fileName: report.fileName,
      sampleCount: report.sampleCount,
      sections: {}
    };

    if (state.metrics.audio) {
      output.sections.audio = report.audio;
      output.sections.temporal = report.temporal;
      output.sections.spectral = report.spectral;
      output.sections.spectrogramFeatures = report.spectrogramFeatures;
      output.sections.modulation = report.modulation;
      output.sections.spatial = report.spatial;
      output.sections.standards = report.standards;
    }
    if (state.metrics.speech) {
      output.sections.speech = report.speech;
    }
    if (state.metrics.statistical) {
      output.sections.statistical = report.statistical;
    }
    if (state.metrics.distributional) {
      output.sections.distributional = report.distributional;
    }
    if (state.metrics.classwise) {
      output.sections.classwise = {
        note: "Classwise metrics require label metadata (Phase 8)."
      };
    }

    const selectedFeatures = {};
    if (state.features.power) {
      selectedFeatures.power = report.features.power;
    }
    if (state.features.autocorrelation) {
      selectedFeatures.autocorrelation = report.features.autocorrelation;
    }
    if (state.features.shortTimePower) {
      selectedFeatures.shortTimePower = report.features.shortTimePower;
    }
    if (state.features.shortTimeAutocorrelation) {
      selectedFeatures.shortTimeAutocorrelation = report.features.shortTimeAutocorrelation;
    }
    if (Object.keys(selectedFeatures).length > 0) {
      output.sections.features = selectedFeatures;
    }

    return output;
  }

  function flattenExportSection(lines, sectionName, value, prefix) {
    const labelPrefix = prefix ? prefix + "." : "";
    if (value === null || value === undefined) {
      lines.push([sectionName, labelPrefix.replace(/\.$/, ""), ""]);
      return;
    }
    if (typeof value !== "object") {
      lines.push([sectionName, labelPrefix.replace(/\.$/, ""), String(value)]);
      return;
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length && lines.length < METRICS_EXPORT_MAX_ROWS; index += 1) {
        flattenExportSection(lines, sectionName, value[index], labelPrefix + index);
      }
      return;
    }

    const keys = Object.keys(value);
    for (let index = 0; index < keys.length && lines.length < METRICS_EXPORT_MAX_ROWS; index += 1) {
      const key = keys[index];
      flattenExportSection(lines, sectionName, value[key], labelPrefix + key);
    }
  }

  function buildMetricsCsv(exportModel) {
    const rows = [["section", "metric", "value"]];
    const sections = exportModel.sections || {};
    const sectionNames = Object.keys(sections);
    for (let index = 0; index < sectionNames.length && rows.length < METRICS_EXPORT_MAX_ROWS; index += 1) {
      const sectionName = sectionNames[index];
      flattenExportSection(rows, sectionName, sections[sectionName], "");
    }
    return rows
      .map(function (row) {
        return row.map(escapeCsvField).join(",");
      })
      .join("\n");
  }

  function triggerTextDownload(fileName, mimeType, content) {
    const blob = new Blob([content], { type: mimeType + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function renderMetricsReport() {
    if (!metricsContent || !metricsStatus || !metricsHistogramCanvas) {
      return;
    }
    const report = getPrimaryMetricsReport();
    const widthSignature = Math.round(metricsHistogramCanvas.clientWidth || 0);
    const signature =
      (report ? metricsAudioKey(primaryAudio) : "none") +
      "|" +
      widthSignature +
      "|" +
      [state.metrics.audio, state.metrics.speech, state.metrics.statistical, state.metrics.distributional, state.metrics.classwise].join(",") +
      "|" +
      [
        state.features.power,
        state.features.autocorrelation,
        state.features.shortTimePower,
        state.features.shortTimeAutocorrelation
      ].join(",");

    if (signature === metricsRenderSignature) {
      return;
    }
    metricsRenderSignature = signature;
    metricsContent.innerHTML = "";

    if (!report) {
      metricsExportJson.disabled = true;
      metricsExportCsv.disabled = true;
      metricsStatus.textContent = "Load a primary audio clip to compute metrics.";
      clearMetricsHistogram("Load audio to show histogram.");
      return;
    }

    metricsExportJson.disabled = false;
    metricsExportCsv.disabled = false;
    metricsStatus.textContent =
      "Computed on " +
      report.sampleCount +
      " samples (" +
      formatMetricNumber(report.audio.durationSeconds, 3) +
      " s).";

    if (state.metrics.audio) {
      const timeRows = [
        ["Duration", formatMetricNumber(report.audio.durationSeconds, 3) + " s"],
        ["Sample rate", formatMetricNumber(report.audio.sampleRate, 0) + " Hz"],
        ["Channels", String(report.audio.channelCount)],
        ["DC offset", formatMetricNumber(report.audio.dcOffset, 7)],
        ["RMS", formatMetricNumber(report.audio.rms, 6)],
        ["Peak |x|", formatMetricNumber(report.audio.peakAbs, 6)],
        ["True peak (4x linear)", formatMetricNumber(report.audio.truePeakAbs, 6)],
        ["Crest factor", formatMetricNumber(report.audio.crestFactor, 3)],
        ["ZCR", formatMetricNumber(report.audio.zcr, 6)],
        ["Mean power", formatMetricNumber(report.features.power.meanPower, 8)],
        ["Mean power (dB)", formatMetricNumber(report.audio.meanPowerDb, 2) + " dB"],
        ["Clipping ratio", formatMetricPercent(report.audio.clippingRatio)],
        ["Silence ratio", formatMetricPercent(report.audio.silenceRatio)],
        ["|x| P95-P05", formatMetricNumber(report.audio.amplitudeP95P05, 6)]
      ];
      metricsContent.appendChild(createMetricsGroup("Time-Domain & Dynamics", timeRows));

      const temporalRows = [
        ["Autocorr peak lag", String(report.temporal.autocorrelation.bestLag)],
        ["Autocorr peak corr", formatMetricNumber(report.temporal.autocorrelation.bestCorrelation, 5)],
        [
          "Autocorr F0 proxy",
          report.temporal.autocorrelation.estimatedF0Hz > 0
            ? formatMetricNumber(report.temporal.autocorrelation.estimatedF0Hz, 2) + " Hz"
            : "n/a"
        ],
        [
          "Correlation time",
          formatMetricNumber(report.temporal.correlationTimeSeconds * 1000, 2) + " ms"
        ],
        ["Onset count", String(report.temporal.onset.onsetCount)],
        ["Onset rate", formatMetricNumber(report.temporal.onset.onsetRateHz, 3) + " Hz"],
        [
          "Inter-onset median",
          formatMetricNumber(report.temporal.onset.interOnsetMedianSeconds, 3) + " s"
        ],
        [
          "Change points (>=6 dB/frame)",
          String(report.temporal.stationarity.changePointCount)
        ],
        [
          "Frame-energy CV",
          formatMetricNumber(report.temporal.stationarity.frameEnergyCv, 4)
        ],
        [
          "Attack P95",
          formatMetricNumber(report.temporal.envelope.attackDecay.attackP95DbPerSecond, 1) +
            " dB/s"
        ],
        [
          "Decay P95",
          formatMetricNumber(report.temporal.envelope.attackDecay.decayP95DbPerSecond, 1) +
            " dB/s"
        ]
      ];
      metricsContent.appendChild(createMetricsGroup("Temporal Structure", temporalRows));

      if (report.spectral) {
        const spectralRows = [
          [
            "Dominant frequency",
            formatMetricNumber(report.spectral.dominantFrequencyHz, 2) + " Hz"
          ],
          [
            "Spectral centroid mean",
            formatMetricNumber(report.spectral.centroidMeanHz, 2) + " Hz"
          ],
          [
            "Spectral spread mean",
            formatMetricNumber(report.spectral.spreadMeanHz, 2) + " Hz"
          ],
          [
            "Spectral slope",
            formatMetricNumber(report.spectral.spectralSlopeDbPerDecade, 3) + " dB/dec"
          ],
          ["Flatness mean", formatMetricNumber(report.spectral.flatnessMean, 4)],
          ["Entropy mean", formatMetricNumber(report.spectral.entropyMean, 4)],
          ["Roll-off 85% mean", formatMetricNumber(report.spectral.rolloff85MeanHz, 2) + " Hz"],
          ["Tonality proxy", formatMetricNumber(report.spectral.tonalityProxy, 4)],
          [
            "Band power low/mid/high",
            formatMetricPercent(report.spectral.bandPower.low20_250.ratio) +
              " / " +
              formatMetricPercent(report.spectral.bandPower.mid250_2k.ratio) +
              " / " +
              formatMetricPercent(report.spectral.bandPower.high2k_8k.ratio)
          ]
        ];
        metricsContent.appendChild(createMetricsGroup("Spectral & PSD", spectralRows));
      }

      if (report.spectrogramFeatures) {
        const tfRows = [
          [
            "Mel global mean/std",
            formatMetricNumber(report.spectrogramFeatures.mel.globalMeanDb, 2) +
              " / " +
              formatMetricNumber(report.spectrogramFeatures.mel.globalStdDb, 2) +
              " dB"
          ],
          [
            "Mel band-mean range",
            formatMetricNumber(report.spectrogramFeatures.mel.bandMeanRangeDb, 2) + " dB"
          ],
          [
            "Adjacent-band corr mean",
            formatMetricNumber(report.spectrogramFeatures.mel.adjacentBandCorrelationMean, 4)
          ],
          [
            "MFCC c0 mean/std",
            formatMetricNumber(report.spectrogramFeatures.mfcc.c0Mean, 3) +
              " / " +
              formatMetricNumber(report.spectrogramFeatures.mfcc.c0Std, 3)
          ],
          [
            "Mel delta RMS",
            formatMetricNumber(report.spectrogramFeatures.delta.melDeltaRms, 4)
          ],
          [
            "Mel delta-delta RMS",
            formatMetricNumber(report.spectrogramFeatures.delta.melDeltaDeltaRms, 4)
          ]
        ];
        metricsContent.appendChild(createMetricsGroup("Spectrogram Feature Stats", tfRows));
      }

      const modulationRows = [
        [
          "Dominant modulation",
          formatMetricNumber(report.modulation.dominantModulationHz, 3) + " Hz"
        ],
        ["Low/high modulation ratio", formatMetricNumber(report.modulation.lowToHighRatio, 4)],
        [
          "Band 0.5-2 / 2-4 / 4-8",
          formatMetricNumber(report.modulation.bandEnergy.hz_0_5_2, 3) +
            " / " +
            formatMetricNumber(report.modulation.bandEnergy.hz_2_4, 3) +
            " / " +
            formatMetricNumber(report.modulation.bandEnergy.hz_4_8, 3)
        ]
      ];
      metricsContent.appendChild(createMetricsGroup("Modulation Domain", modulationRows));

      if (report.spatial && report.spatial.note) {
        metricsContent.appendChild(
          createMetricsGroup("Spatial / Multichannel", [["Status", report.spatial.note]])
        );
      } else if (report.spatial) {
        const spatialRows = [
          [
            "Inter-channel correlation",
            formatMetricNumber(report.spatial.interChannelCorrelation, 4)
          ],
          ["Coherence proxy", formatMetricNumber(report.spatial.coherenceProxy, 4)],
          ["ILD", formatMetricNumber(report.spatial.ildDb, 2) + " dB"],
          [
            "Best lag (samples/ms)",
            String(report.spatial.bestLagSamples) +
              " / " +
              formatMetricNumber(report.spatial.bestLagMs, 3)
          ]
        ];
        metricsContent.appendChild(createMetricsGroup("Spatial / Multichannel", spatialRows));
      }

      const standardsRows = [
        ["Leq (dBFS)", formatMetricNumber(report.standards.leqDbfs, 2) + " dBFS"],
        ["L10/L50/L90 (dBFS)", formatMetricNumber(report.standards.l10Dbfs, 2) +
            " / " + formatMetricNumber(report.standards.l50Dbfs, 2) +
            " / " + formatMetricNumber(report.standards.l90Dbfs, 2)],
        ["Note", report.standards.calibrationNote]
      ];
      metricsContent.appendChild(createMetricsGroup("Acoustics / Standards Proxy", standardsRows));
    }

    if (state.metrics.speech) {
      const rows = [
        ["Frame size", String(report.speech.frameSize) + " samples"],
        ["Hop size", String(report.speech.hopSize) + " samples"],
        ["Frame count", String(report.speech.frameCount)],
        ["Silence ratio", formatMetricPercent(report.speech.silenceRatio)],
        ["Speech activity ratio", formatMetricPercent(report.speech.speechActivityRatio)],
        ["Voiced ratio", formatMetricPercent(report.speech.voicedRatio)],
        ["Mean frame energy", formatMetricNumber(report.speech.meanFrameEnergyDb, 2) + " dB"],
        ["Energy dynamic range", formatMetricNumber(report.speech.dynamicRangeDb, 2) + " dB"],
        ["Speech SNR proxy", formatMetricNumber(report.speech.speechSnrProxyDb, 2) + " dB"],
        ["F0 mean", formatMetricNumber(report.speech.f0.f0MeanHz, 2) + " Hz"],
        [
          "F0 min/med/max",
          formatMetricNumber(report.speech.f0.f0MinHz, 2) +
            " / " +
            formatMetricNumber(report.speech.f0.f0MedianHz, 2) +
            " / " +
            formatMetricNumber(report.speech.f0.f0MaxHz, 2) +
            " Hz"
        ],
        ["Jitter (local)", formatMetricPercent(report.speech.f0.jitterLocal)],
        ["Shimmer (local)", formatMetricPercent(report.speech.f0.shimmerLocal)],
        ["Syllable/onset proxy", formatMetricNumber(report.speech.speakingRateProxyHz, 3) + " Hz"]
      ];
      metricsContent.appendChild(createMetricsGroup("Speech Metrics (Heuristic)", rows));
    }

    if (state.metrics.statistical) {
      const rows = [
        ["Mean", formatMetricNumber(report.statistical.mean, 6)],
        ["Std", formatMetricNumber(report.statistical.std, 6)],
        ["Variance", formatMetricNumber(report.statistical.variance, 6)],
        ["Min", formatMetricNumber(report.statistical.min, 6)],
        ["Max", formatMetricNumber(report.statistical.max, 6)],
        ["Q05", formatMetricNumber(report.statistical.q05, 6)],
        ["Median", formatMetricNumber(report.statistical.median, 6)],
        ["Q25", formatMetricNumber(report.statistical.q25, 6)],
        ["Q75", formatMetricNumber(report.statistical.q75, 6)],
        ["Q95", formatMetricNumber(report.statistical.q95, 6)],
        ["IQR", formatMetricNumber(report.statistical.iqr, 6)],
        ["Skewness", formatMetricNumber(report.statistical.skewness, 4)],
        ["Kurtosis excess", formatMetricNumber(report.statistical.kurtosisExcess, 4)]
      ];
      metricsContent.appendChild(createMetricsGroup("Statistical Metrics", rows));
    }

    if (state.metrics.distributional) {
      const rows = [
        ["Entropy", formatMetricNumber(report.distributional.entropyBits, 4) + " bits"],
        ["Moment m1", formatMetricNumber(report.distributional.moments.m1, 6)],
        ["Moment m2", formatMetricNumber(report.distributional.moments.m2, 6)],
        ["Moment m3", formatMetricNumber(report.distributional.moments.m3, 6)],
        ["Moment m4", formatMetricNumber(report.distributional.moments.m4, 6)],
        ["Histogram bins", String(report.distributional.histogram.counts.length)]
      ];
      metricsContent.appendChild(createMetricsGroup("Distributional Metrics", rows));
      drawMetricsHistogram(report.distributional.histogram);
    } else {
      clearMetricsHistogram("Enable Distributional info to show histogram.");
    }

    if (state.metrics.classwise) {
      metricsContent.appendChild(
        createMetricsGroup("Classwise Metrics", [
          ["Status", report.availability.classwise]
        ])
      );
    }

    const featureRows = [];
    if (state.features.power) {
      featureRows.push([
        "Power (mean)",
        formatMetricNumber(report.features.power.meanPower, 8) +
          " (" +
          formatMetricNumber(report.features.power.meanPowerDb, 2) +
          " dB)"
      ]);
    }
    if (state.features.autocorrelation) {
      featureRows.push([
        "Autocorr peak lag",
        String(report.features.autocorrelation.bestLag) +
          " (corr=" +
          formatMetricNumber(report.features.autocorrelation.bestCorrelation, 4) +
          ")"
      ]);
      featureRows.push([
        "Estimated F0",
        report.features.autocorrelation.estimatedF0Hz > 0
          ? formatMetricNumber(report.features.autocorrelation.estimatedF0Hz, 2) + " Hz"
          : "n/a"
      ]);
    }
    if (state.features.shortTimePower) {
      featureRows.push([
        "Short-time power mean",
        formatMetricNumber(report.features.shortTimePower.frameMean, 8)
      ]);
      featureRows.push([
        "Short-time power std",
        formatMetricNumber(report.features.shortTimePower.frameStd, 8)
      ]);
      featureRows.push([
        "Short-time power p05/p95",
        formatMetricNumber(report.features.shortTimePower.frameP05, 8) +
          " / " +
          formatMetricNumber(report.features.shortTimePower.frameP95, 8)
      ]);
    }
    if (state.features.shortTimeAutocorrelation) {
      featureRows.push([
        "Short-time autocorr lag",
        String(report.features.shortTimeAutocorrelation.bestLag) +
          " (corr=" +
          formatMetricNumber(report.features.shortTimeAutocorrelation.bestCorrelation, 4) +
          ")"
      ]);
    }
    if (featureRows.length > 0) {
      metricsContent.appendChild(createMetricsGroup("Feature Diagnostics", featureRows));
    }

    metricsContent.appendChild(
      createMetricsGroup("Availability Notes", [
        ["Intrusive metrics", report.availability.intrusiveMetrics],
        ["Room/intelligibility metrics", report.availability.roomAcoustics]
      ])
    );

    if (metricsContent.childElementCount === 0) {
      metricsContent.appendChild(
        createMetricsGroup("Metrics", [
          ["Status", "Enable one or more metrics toggles in the right panel."]
        ])
      );
    }
  }

  function splitCsvLine(line) {
    return line.split(",").map(function (value) {
      return value.trim();
    });
  }

  function normalizeColumnName(name) {
    return name.trim().toLowerCase();
  }

  function parseFlagValue(raw) {
    const normalized = String(raw).trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y") {
      return true;
    }

    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "n") {
      return false;
    }

    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric !== 0 : false;
  }

  function estimateFlagStepSeconds(sortedTimes) {
    const diffs = [];
    for (let index = 1; index < sortedTimes.length; index += 1) {
      const delta = sortedTimes[index] - sortedTimes[index - 1];
      if (Number.isFinite(delta) && delta > 0) {
        diffs.push(delta);
      }
    }

    if (diffs.length > 0) {
      diffs.sort(function (a, b) {
        return a - b;
      });
      return diffs[Math.floor(diffs.length / 2)];
    }

    if (primaryAudio && primaryAudio.sampleRate > 0) {
      return 1 / primaryAudio.sampleRate;
    }

    return 0.01;
  }

  function mergeIntervals(intervals) {
    if (intervals.length === 0) {
      return [];
    }

    const sorted = intervals
      .map(function (interval) {
        return {
          startSec: Math.min(interval.startSec, interval.endSec),
          endSec: Math.max(interval.startSec, interval.endSec)
        };
      })
      .filter(function (interval) {
        return Number.isFinite(interval.startSec) && Number.isFinite(interval.endSec);
      })
      .sort(function (a, b) {
        return a.startSec - b.startSec;
      });

    if (sorted.length === 0) {
      return [];
    }

    const merged = [sorted[0]];
    for (let index = 1; index < sorted.length; index += 1) {
      const current = sorted[index];
      const last = merged[merged.length - 1];
      if (current.startSec <= last.endSec + 1e-9) {
        last.endSec = Math.max(last.endSec, current.endSec);
      } else {
        merged.push(current);
      }
    }

    return merged;
  }

  function convertCsvTimeToSeconds(value, columnName) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error("Invalid numeric value in column " + columnName + ": " + value);
    }

    if (numeric < 0) {
      return 0;
    }

    if (primaryAudio && primaryAudio.sampleRate > 0 && primaryAudio.duration > 0) {
      if (numeric > primaryAudio.duration * 1.5) {
        return numeric / primaryAudio.sampleRate;
      }
    }

    return numeric;
  }

  function parseOverlayCsvTable(csvText) {
    const rawLines = csvText.split(/\r?\n/);
    const lines = rawLines
      .map(function (line) {
        return line.trim();
      })
      .filter(function (line) {
        return line && !line.startsWith("#");
      });

    if (lines.length === 0) {
      throw new Error("CSV is empty.");
    }

    const headerColumns = splitCsvLine(lines[0]).map(normalizeColumnName);
    if (headerColumns.length === 0) {
      throw new Error("CSV header is empty.");
    }
    if (headerColumns.length > MAX_OVERLAY_CSV_COLUMNS) {
      throw new Error("CSV has too many columns; max is " + MAX_OVERLAY_CSV_COLUMNS + ".");
    }

    const columnIndexByName = Object.create(null);
    headerColumns.forEach(function (name, index) {
      if (!(name in columnIndexByName)) {
        columnIndexByName[name] = index;
      }
    });

    const rows = [];
    const bodyLines = lines.slice(1);
    for (let rowIndex = 0; rowIndex < bodyLines.length; rowIndex += 1) {
      if (rows.length >= MAX_OVERLAY_CSV_ROWS) {
        throw new Error("CSV has too many rows; max is " + MAX_OVERLAY_CSV_ROWS + ".");
      }
      const values = splitCsvLine(bodyLines[rowIndex]);
      if (values.length > MAX_OVERLAY_CSV_COLUMNS) {
        throw new Error("CSV row has too many columns on line " + (rowIndex + 2) + ".");
      }
      rows.push({
        lineNumber: rowIndex + 2,
        values
      });
    }

    return {
      columnIndexByName,
      rows
    };
  }

  function parseOverlayCsvText(csvText, mode) {
    const table = parseOverlayCsvTable(csvText);

    if (mode === "flag") {
      if (!("t" in table.columnIndexByName) || !("flag" in table.columnIndexByName)) {
        throw new Error("Flag mode requires columns: t,flag");
      }

      const tIndex = table.columnIndexByName.t;
      const flagIndex = table.columnIndexByName.flag;
      const flaggedTimes = [];
      let activeRows = 0;

      table.rows.forEach(function (row) {
        const tRaw = row.values[tIndex];
        const flagRaw = row.values[flagIndex];
        if (tRaw === undefined || flagRaw === undefined) {
          throw new Error("Missing value on line " + row.lineNumber);
        }

        if (parseFlagValue(flagRaw)) {
          activeRows += 1;
          flaggedTimes.push(convertCsvTimeToSeconds(tRaw, "t"));
        }
      });

      flaggedTimes.sort(function (a, b) {
        return a - b;
      });

      const step = estimateFlagStepSeconds(flaggedTimes);
      const halfStep = Math.max(1e-6, step / 2);
      const intervals = mergeIntervals(
        flaggedTimes.map(function (timeSec) {
          return {
            startSec: Math.max(0, timeSec - halfStep),
            endSec: timeSec + halfStep
          };
        })
      );

      return {
        mode,
        intervals,
        activeRows,
        totalRows: table.rows.length
      };
    }

    if (!("flag" in table.columnIndexByName) || !("t_start" in table.columnIndexByName) || !("t_end" in table.columnIndexByName)) {
      throw new Error("Timestamped mode requires columns: flag,t_start,t_end");
    }

    const flagIndex = table.columnIndexByName.flag;
    const startIndex = table.columnIndexByName.t_start;
    const endIndex = table.columnIndexByName.t_end;
    const intervals = [];
    let activeRows = 0;

    table.rows.forEach(function (row) {
      const flagRaw = row.values[flagIndex];
      const startRaw = row.values[startIndex];
      const endRaw = row.values[endIndex];
      if (flagRaw === undefined || startRaw === undefined || endRaw === undefined) {
        throw new Error("Missing value on line " + row.lineNumber);
      }

      if (!parseFlagValue(flagRaw)) {
        return;
      }

      activeRows += 1;
      intervals.push({
        startSec: convertCsvTimeToSeconds(startRaw, "t_start"),
        endSec: convertCsvTimeToSeconds(endRaw, "t_end")
      });
    });

    return {
      mode,
      intervals: mergeIntervals(intervals),
      activeRows,
      totalRows: table.rows.length
    };
  }

  function parseOverlayCsvFromRawText(csvText, sourceLabel, persistToState) {
    try {
      overlayParsed = parseOverlayCsvText(csvText, state.overlay.mode);
      overlayStatusMessage =
        "Loaded " +
        overlayParsed.intervals.length +
        " intervals (" +
        overlayParsed.activeRows +
        "/" +
        overlayParsed.totalRows +
        " active rows) from " +
        sourceLabel +
        ".";

      if (persistToState) {
        if (csvText.length <= MAX_PERSISTED_OVERLAY_CSV_CHARS) {
          state.overlay.csvText = csvText;
        } else {
          state.overlay.csvText = null;
          overlayStatusMessage += " CSV too large to persist across reopen.";
        }
      }
    } catch (error) {
      overlayParsed = null;
      overlayStatusMessage = "Invalid CSV: " + toErrorText(error);
      if (persistToState) {
        state.overlay.csvText = null;
      }
    }
  }

  async function parseOverlayCsvFromInputFile(file) {
    if (!file) {
      overlayParsed = null;
      overlayStatusMessage = "";
      state.overlay.csvText = null;
      updateOverlayCsvHint();
      renderTransformStack();
      postState();
      return;
    }

    if (file.size > MAX_OVERLAY_CSV_INPUT_BYTES) {
      overlayParsed = null;
      overlayStatusMessage =
        "CSV too large: " +
        formatBytes(file.size) +
        " (max " +
        formatBytes(MAX_OVERLAY_CSV_INPUT_BYTES) +
        ").";
      state.overlay.csvText = null;
      updateOverlayCsvHint();
      renderTransformStack();
      postState();
      return;
    }

    try {
      const csvText = await file.text();
      parseOverlayCsvFromRawText(csvText, file.name, true);
    } catch (error) {
      overlayParsed = null;
      overlayStatusMessage = "Invalid CSV: " + toErrorText(error);
      state.overlay.csvText = null;
    }

    updateOverlayCsvHint();
    renderTransformStack();
    postState();
  }

  function parseOverlayCsvFromPersistedText() {
    if (typeof state.overlay.csvText !== "string" || !state.overlay.csvText.trim()) {
      overlayParsed = null;
      overlayStatusMessage = "";
      updateOverlayCsvHint();
      renderTransformStack();
      return false;
    }

    parseOverlayCsvFromRawText(
      state.overlay.csvText,
      state.overlay.csvName || "saved CSV",
      false
    );
    updateOverlayCsvHint();
    renderTransformStack();
    return true;
  }

  async function reparseOverlayCsvIfPresent() {
    const file = overlayCsv.files && overlayCsv.files[0] ? overlayCsv.files[0] : null;
    if (file) {
      await parseOverlayCsvFromInputFile(file);
      return;
    }

    parseOverlayCsvFromPersistedText();
  }

  function swapStackItems(fromIndex, toIndex) {
    if (fromIndex === toIndex) {
      return;
    }

    const moved = state.stack.splice(fromIndex, 1);
    if (moved.length === 0) {
      return;
    }

    state.stack.splice(toIndex, 0, moved[0]);
  }

  function cleanupViewStateCache() {
    const liveIds = new Set(state.stack.map(function (item) {
      return item.id;
    }));

    Object.keys(viewStateById).forEach(function (id) {
      if (!liveIds.has(id)) {
        delete viewStateById[id];
      }
    });

    Array.from(expandedRowSettingsIds).forEach(function (id) {
      if (!liveIds.has(id)) {
        expandedRowSettingsIds.delete(id);
      }
    });

    if (selectedViewId && !liveIds.has(selectedViewId)) {
      selectedViewId = null;
    }
  }

  function ensureViewState(viewId) {
    if (!viewStateById[viewId]) {
      viewStateById[viewId] = {
        zoom: 1,
        offset: 0,
        showSpectralBar: true
      };
    }

    return viewStateById[viewId];
  }

  function getMinVisibleCount(domainLength) {
    if (domainLength <= 1) {
      return 1;
    }

    return Math.min(domainLength, 24);
  }

  function computeViewWindow(domainLength, viewId) {
    const safeDomainLength = Math.max(1, domainLength);
    const viewState = ensureViewState(viewId);

    const minVisibleCount = getMinVisibleCount(safeDomainLength);
    const maxZoom = Math.max(1, safeDomainLength / minVisibleCount);

    viewState.zoom = clamp(viewState.zoom, 1, maxZoom);

    let visibleCount = Math.round(safeDomainLength / viewState.zoom);
    visibleCount = clamp(visibleCount, minVisibleCount, safeDomainLength);

    const maxStart = Math.max(0, safeDomainLength - visibleCount);
    viewState.offset = clamp(viewState.offset, 0, 1);

    const startIndex = maxStart > 0 ? Math.round(viewState.offset * maxStart) : 0;
    const normalizedOffset = maxStart > 0 ? startIndex / maxStart : 0;

    viewState.offset = normalizedOffset;

    return {
      zoom: viewState.zoom,
      maxZoom,
      minVisibleCount,
      visibleCount,
      startIndex,
      endIndex: startIndex + visibleCount,
      maxStart,
      offsetNormalized: normalizedOffset,
      visibleRatio: visibleCount / safeDomainLength
    };
  }

  function setViewZoom(viewId, domainLength, nextZoom, anchorRatio) {
    const viewState = ensureViewState(viewId);
    const oldWindow = computeViewWindow(domainLength, viewId);

    const clampedAnchor = clamp(anchorRatio, 0, 1);
    const anchorIndex =
      oldWindow.startIndex + clampedAnchor * Math.max(0, oldWindow.visibleCount - 1);

    viewState.zoom = nextZoom;

    const newWindow = computeViewWindow(domainLength, viewId);
    const targetStart = Math.round(
      anchorIndex - clampedAnchor * Math.max(0, newWindow.visibleCount - 1)
    );
    const clampedStart = clamp(targetStart, 0, newWindow.maxStart);

    viewState.offset = newWindow.maxStart > 0 ? clampedStart / newWindow.maxStart : 0;
  }

  function setViewOffsetFromStartRatio(viewId, domainLength, startRatio) {
    const viewState = ensureViewState(viewId);
    const windowInfo = computeViewWindow(domainLength, viewId);

    const availableStartRatio = Math.max(0, 1 - windowInfo.visibleRatio);
    if (availableStartRatio <= 1e-9 || windowInfo.maxStart <= 0) {
      viewState.offset = 0;
      return;
    }

    const clampedStartRatio = clamp(startRatio, 0, availableStartRatio);
    viewState.offset = clampedStartRatio / availableStartRatio;
  }

  function localRatioToGlobalRatio(viewId, domainLength, localRatio) {
    const windowInfo = computeViewWindow(domainLength, viewId);
    const clampedLocal = clamp(localRatio, 0, 1);

    const globalIndex =
      windowInfo.startIndex + clampedLocal * Math.max(0, windowInfo.visibleCount - 1);

    return globalIndex / Math.max(1, domainLength - 1);
  }

  function seekAudioAtGlobalRatio(globalRatio) {
    if (!primaryAudio || !Number.isFinite(primaryAudio.duration) || primaryAudio.duration <= 0) {
      return;
    }

    const clamped = clamp(globalRatio, 0, 1);
    primaryAudioPlayer.currentTime = clamped * primaryAudio.duration;
  }

  function selectView(viewId) {
    if (selectedViewId !== viewId) {
      selectedViewId = viewId;
      scheduleRenderTransformStack();
    }
  }

  async function onPrimaryAudioSelected() {
    if (primaryAudioLocked) {
      setAudioStatus("Primary audio is locked to workspace-selected file.");
      return;
    }

    const file = primaryAudioFileInput.files && primaryAudioFileInput.files[0] ? primaryAudioFileInput.files[0] : null;
    if (!file) {
      primaryAudio = null;
      clearDerivedCache();
      setAudioStatus("Select an audio file to render transforms.");
      renderTransformStack();
      postState();
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    if (file.size > MAX_AUDIO_DECODE_BYTES) {
      loadPlaybackOnlyAudio(
        objectUrl,
        file.name,
        false,
        "File too large for in-browser decoding (" +
          formatBytes(file.size) +
          ", max " +
          formatBytes(MAX_AUDIO_DECODE_BYTES) +
          ")."
      );
      return;
    }

    setAudioStatus("Decoding audio file ...");

    try {
      const decoded = await decodeAudioToMono(file);
      loadDecodedAudio(decoded, objectUrl, file.name, false);
    } catch (error) {
      loadPlaybackOnlyAudio(
        objectUrl,
        file.name,
        false,
        "Decode failed; playback-only mode. " + toErrorText(error)
      );
    }
  }

  function loadDecodedAudio(decoded, sourceUrl, sourceName, lockInput) {
    primaryAudio = decoded;

    if (primaryAudioUrl && primaryAudioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(primaryAudioUrl);
    }

    primaryAudioUrl = sourceUrl;
    primaryAudioPlayer.src = sourceUrl;

    setPrimaryAudioInputLocked(lockInput, sourceName);
    clearDerivedCache();
    syncTransformParamControls();

    setAudioStatus(
      "Loaded " +
        sourceName +
        " | " +
        decoded.sampleRate +
        " Hz | " +
        decoded.channelCount +
        " ch | " +
        decoded.duration.toFixed(2) +
        " s"
    );

    void reparseOverlayCsvIfPresent();
    renderTransformStack();
    postState();
  }

  function loadPlaybackOnlyAudio(sourceUrl, sourceName, lockInput, reason) {
    primaryAudio = null;

    if (primaryAudioUrl && primaryAudioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(primaryAudioUrl);
    }

    primaryAudioUrl = sourceUrl;
    primaryAudioPlayer.src = sourceUrl;

    setPrimaryAudioInputLocked(lockInput, sourceName);
    clearDerivedCache();
    syncTransformParamControls();
    setAudioStatus("Loaded " + sourceName + " (playback only). " + reason);

    void reparseOverlayCsvIfPresent();
    renderTransformStack();
    postState();
  }

  function summarizeStereoSpatial(channelA, channelB, sampleRate) {
    if (!channelA || !channelB || channelA.length === 0 || channelB.length === 0 || sampleRate <= 0) {
      return null;
    }

    const scanCount = Math.min(channelA.length, channelB.length, Math.max(sampleRate * 30, 48000));
    if (scanCount < 8) {
      return null;
    }

    const stride = Math.max(1, Math.floor(scanCount / 200000));
    let leftMean = 0;
    let rightMean = 0;
    let count = 0;
    for (let index = 0; index < scanCount; index += stride) {
      leftMean += channelA[index];
      rightMean += channelB[index];
      count += 1;
    }
    leftMean /= Math.max(1, count);
    rightMean /= Math.max(1, count);

    let leftVar = 0;
    let rightVar = 0;
    let covariance = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = 0; index < scanCount; index += stride) {
      const left = channelA[index] - leftMean;
      const right = channelB[index] - rightMean;
      leftVar += left * left;
      rightVar += right * right;
      covariance += left * right;

      const rawLeft = channelA[index];
      const rawRight = channelB[index];
      leftEnergy += rawLeft * rawLeft;
      rightEnergy += rawRight * rawRight;
    }

    const denom = Math.max(1e-12, Math.sqrt(leftVar * rightVar));
    const interChannelCorrelation = covariance / denom;
    const coherenceProxy = interChannelCorrelation * interChannelCorrelation;
    const leftRms = Math.sqrt(leftEnergy / Math.max(1, count));
    const rightRms = Math.sqrt(rightEnergy / Math.max(1, count));
    const ildDb = 20 * Math.log10((leftRms + 1e-12) / (rightRms + 1e-12));

    const maxLag = Math.max(1, Math.min(Math.floor(sampleRate * 0.01), 512));
    let bestLag = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let lag = -maxLag; lag <= maxLag; lag += 1) {
      let sum = 0;
      let lagCount = 0;
      const start = lag < 0 ? -lag : 0;
      const end = lag < 0 ? scanCount : scanCount - lag;
      for (let index = start; index < end; index += stride) {
        sum += channelA[index] * channelB[index + lag];
        lagCount += 1;
      }
      const normalized = lagCount > 0 ? sum / lagCount : Number.NEGATIVE_INFINITY;
      if (normalized > bestScore) {
        bestScore = normalized;
        bestLag = lag;
      }
    }

    return {
      interChannelCorrelation,
      coherenceProxy,
      ildDb,
      bestLagSamples: bestLag,
      bestLagMs: (bestLag * 1000) / sampleRate,
      leftRms,
      rightRms
    };
  }

  async function decodeAudioToMono(file) {
    const arrayBuffer = await file.arrayBuffer();
    return decodeAudioArrayBufferToMono(arrayBuffer, file.name);
  }

  async function decodeAudioArrayBufferToMono(arrayBuffer, fileName) {
    const audioContext = new AudioContext();

    try {
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const decodedChannels = Math.max(1, decoded.numberOfChannels);
      const estimatedDecodedBytes = decoded.length * decodedChannels * 4;
      if (!Number.isFinite(estimatedDecodedBytes) || estimatedDecodedBytes > MAX_DECODED_PCM_BYTES) {
        throw new Error(
          "Decoded audio exceeds safe in-browser limit (" +
            formatBytes(estimatedDecodedBytes) +
            ", max " +
            formatBytes(MAX_DECODED_PCM_BYTES) +
            ")."
        );
      }

      const totalSamples = decoded.length;
      const channelCount = decodedChannels;
      const mono = new Float32Array(totalSamples);
      let firstChannel = null;
      let secondChannel = null;

      for (let channel = 0; channel < channelCount; channel += 1) {
        const channelData = decoded.getChannelData(channel);
        if (channel === 0) {
          firstChannel = channelData;
        } else if (channel === 1) {
          secondChannel = channelData;
        }
        for (let index = 0; index < totalSamples; index += 1) {
          mono[index] += channelData[index];
        }
      }

      for (let index = 0; index < totalSamples; index += 1) {
        mono[index] /= channelCount;
      }

      const spatialSummary =
        firstChannel && secondChannel
          ? summarizeStereoSpatial(firstChannel, secondChannel, decoded.sampleRate)
          : null;

      return {
        audioKey:
          fileName +
          "::" +
          decoded.sampleRate +
          "::" +
          decoded.length +
          "::" +
          Date.now() +
          "::" +
          Math.random().toString(16).slice(2),
        fileName,
        sampleRate: decoded.sampleRate,
        channelCount,
        duration: decoded.duration,
        samples: mono,
        spatialSummary
      };
    } finally {
      await audioContext.close();
    }
  }

  async function preloadAudioFromWebviewUri(uri, fileName) {
    setAudioStatus("Loading preselected workspace audio ...");

    let response;
    try {
      response = await fetch(uri);
    } catch (error) {
      loadPlaybackOnlyAudio(
        uri,
        fileName,
        true,
        "Fetch failed; playback-only mode. " + toErrorText(error)
      );
      return;
    }

    if (!response.ok) {
      loadPlaybackOnlyAudio(
        uri,
        fileName,
        true,
        "Fetch failed (" + response.status + "); playback-only mode."
      );
      return;
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_DECODE_BYTES) {
        loadPlaybackOnlyAudio(
          uri,
          fileName,
          true,
          "File too large for in-browser decoding (" +
            formatBytes(contentLength) +
            ", max " +
            formatBytes(MAX_AUDIO_DECODE_BYTES) +
            ")."
        );
        return;
      }
    }

    let arrayBuffer;
    try {
      arrayBuffer = await response.arrayBuffer();
    } catch (error) {
      loadPlaybackOnlyAudio(
        uri,
        fileName,
        true,
        "Read failed; playback-only mode. " + toErrorText(error)
      );
      return;
    }

    if (arrayBuffer.byteLength > MAX_AUDIO_DECODE_BYTES) {
      loadPlaybackOnlyAudio(
        uri,
        fileName,
        true,
        "File too large for in-browser decoding (" +
          formatBytes(arrayBuffer.byteLength) +
          ", max " +
          formatBytes(MAX_AUDIO_DECODE_BYTES) +
          ")."
      );
      return;
    }

    try {
      const decoded = await decodeAudioArrayBufferToMono(arrayBuffer, fileName);
      loadDecodedAudio(decoded, uri, fileName, true);
    } catch (error) {
      loadPlaybackOnlyAudio(
        uri,
        fileName,
        true,
        "Decode failed; playback-only mode. " + toErrorText(error)
      );
    }
  }

  async function onComparisonAudioSelected() {
    const file = comparisonAudio.files && comparisonAudio.files[0] ? comparisonAudio.files[0] : null;

    if (!file) {
      comparisonAudioData = null;
      comparisonDerivedCache = createEmptyDerivedCache();
      setComparisonStatus("Load a second clip to enable comparison rendering.");
      renderTransformStack();
      return;
    }

    setComparisonStatus("Decoding second clip ...");

    if (file.size > MAX_AUDIO_DECODE_BYTES) {
      comparisonAudioData = null;
      comparisonDerivedCache = createEmptyDerivedCache();
      setComparisonStatus(
        "Second clip too large for in-browser decoding (" +
          formatBytes(file.size) +
          ", max " +
          formatBytes(MAX_AUDIO_DECODE_BYTES) +
          ")."
      );
      renderTransformStack();
      return;
    }

    try {
      const decoded = await decodeAudioToMono(file);
      comparisonAudioData = decoded;
      comparisonDerivedCache = createEmptyDerivedCache();
      setComparisonStatus(
        "Loaded " +
          file.name +
          " | " +
          decoded.sampleRate +
          " Hz | " +
          decoded.channelCount +
          " ch | " +
          decoded.duration.toFixed(2) +
          " s"
      );
    } catch (error) {
      comparisonAudioData = null;
      comparisonDerivedCache = createEmptyDerivedCache();
      setComparisonStatus("Failed to decode second clip: " + toErrorText(error));
    }

    renderTransformStack();
  }

  async function onCustomFilterbankSelected() {
    const file = customFilterbankInput.files && customFilterbankInput.files[0] ? customFilterbankInput.files[0] : null;
    if (!file) {
      customFilterbank = null;
      clearDerivedCache();
      setFilterbankStatus("Required for custom_filterbank transform. Rows are filters; columns are weights.");
      renderTransformStack();
      postState();
      return;
    }

    if (file.size > MAX_FILTERBANK_CSV_INPUT_BYTES) {
      customFilterbank = null;
      clearDerivedCache();
      setFilterbankStatus(
        "CSV too large: " +
          formatBytes(file.size) +
          " (max " +
          formatBytes(MAX_FILTERBANK_CSV_INPUT_BYTES) +
          ")."
      );
      renderTransformStack();
      postState();
      return;
    }

    try {
      const csv = await file.text();
      const rows = parseFilterbankCsv(csv);
      customFilterbank = {
        fileName: file.name,
        rows
      };
      clearDerivedCache();
      setFilterbankStatus("Loaded " + file.name + " with " + rows.length + " filter rows.");
      renderTransformStack();
      postState();
    } catch (error) {
      customFilterbank = null;
      clearDerivedCache();
      setFilterbankStatus("Invalid CSV: " + toErrorText(error));
      renderTransformStack();
      postState();
    }
  }

  function parseFilterbankCsv(csvText) {
    const lines = csvText.split(/\r?\n/);
    const rows = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const values = trimmed.split(",");
      if (values.length > MAX_FILTERBANK_COLUMNS) {
        throw new Error("Filterbank row has too many columns (max " + MAX_FILTERBANK_COLUMNS + ").");
      }
      const numericValues = [];

      for (const value of values) {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) {
          numericValues.push(parsed);
        }
      }

      if (numericValues.length >= 2) {
        if (rows.length >= MAX_FILTERBANK_ROWS) {
          throw new Error("Too many filter rows (max " + MAX_FILTERBANK_ROWS + ").");
        }
        rows.push(Float32Array.from(numericValues));
      }
    }

    if (rows.length === 0) {
      throw new Error("No numeric filter rows found.");
    }

    return rows;
  }

  function buildNormalizedFilterbank(rows, targetBins) {
    return rows.map(function (row) {
      const resized = row.length === targetBins ? row : resampleVector(row, targetBins);
      return normalizeWeightVector(resized);
    });
  }

  function resampleVector(vector, targetLength) {
    if (targetLength <= 1) {
      return Float32Array.from([vector[0] || 0]);
    }

    if (vector.length === targetLength) {
      return Float32Array.from(vector);
    }

    const out = new Float32Array(targetLength);
    const sourceLast = vector.length - 1;

    for (let index = 0; index < targetLength; index += 1) {
      const position = (index / (targetLength - 1)) * sourceLast;
      const left = Math.floor(position);
      const right = Math.min(sourceLast, left + 1);
      const frac = position - left;
      out[index] = vector[left] * (1 - frac) + vector[right] * frac;
    }

    return out;
  }

  function normalizeWeightVector(vector) {
    const out = new Float32Array(vector.length);
    let sum = 0;

    for (let index = 0; index < vector.length; index += 1) {
      const positive = Math.max(0, vector[index]);
      out[index] = positive;
      sum += positive;
    }

    if (sum <= 1e-12) {
      const uniform = 1 / Math.max(1, vector.length);
      out.fill(uniform);
      return out;
    }

    for (let index = 0; index < out.length; index += 1) {
      out[index] /= sum;
    }

    return out;
  }

  function getAudioCachePrefix(audioData) {
    if (!audioData) {
      return "audio:none";
    }

    return (
      (audioData.audioKey || audioData.fileName || "audio") +
      "::" +
      audioData.sampleRate +
      "::" +
      audioData.samples.length
    );
  }

  function ensureStftForAudio(item, audioData, cache) {
    if (!audioData) {
      throw new Error("Select an audio file first.");
    }

    const stftParams = getItemStftParams(item);
    const stftKey = getAudioCachePrefix(audioData) + "::" + stftParamsToKey(stftParams);
    if (cache.stftByKey[stftKey]) {
      return cache.stftByKey[stftKey];
    }

    const maxSamples = Math.floor(audioData.sampleRate * stftParams.maxAnalysisSeconds);
    const analysisSamples =
      audioData.samples.length <= maxSamples
        ? audioData.samples
        : audioData.samples.slice(0, maxSamples);

    const stft = computeStft(
      analysisSamples,
      audioData.sampleRate,
      stftParams.windowSize,
      stftParams.hopSize,
      stftParams.maxFrames,
      stftParams.windowType
    );
    stft.cacheKey = stftKey;
    stft.overlapPercent = stftParams.overlapPercent;
    stft.windowType = stftParams.windowType;
    cache.stftByKey[stftKey] = stft;
    return stft;
  }

  function ensureStft(item) {
    return ensureStftForAudio(item, primaryAudio, derivedCache);
  }

  function computeStft(samples, sampleRate, fftSize, hopSize, maxFrames, windowType) {
    const safeHopSize = Math.max(1, hopSize);
    const window = createWindow(fftSize, windowType);
    const binCount = fftSize / 2 + 1;

    const totalFrames = Math.max(
      1,
      Math.floor((Math.max(samples.length, fftSize) - fftSize) / safeHopSize) + 1
    );
    const frameStride = Math.max(1, Math.floor(totalFrames / maxFrames));

    const powerFrames = [];
    const logMagnitudeFrames = [];
    const phaseFrames = [];

    for (let frame = 0; frame < totalFrames; frame += frameStride) {
      const offset = frame * safeHopSize;
      const re = new Float64Array(fftSize);
      const im = new Float64Array(fftSize);

      for (let index = 0; index < fftSize; index += 1) {
        const source = offset + index;
        const value = source < samples.length ? samples[source] : 0;
        re[index] = value * window[index];
      }

      fftInPlace(re, im);

      const power = new Float32Array(binCount);
      const logMagnitude = new Float32Array(binCount);
      const phase = new Float32Array(binCount);

      for (let bin = 0; bin < binCount; bin += 1) {
        const magnitude = Math.hypot(re[bin], im[bin]);
        const p = magnitude * magnitude;
        power[bin] = p;
        logMagnitude[bin] = 20 * Math.log10(magnitude + 1e-9);
        phase[bin] = Math.atan2(im[bin], re[bin]);
      }

      powerFrames.push(power);
      logMagnitudeFrames.push(logMagnitude);
      phaseFrames.push(phase);
    }

    return {
      fftSize,
      hopSize: safeHopSize,
      sampleRate,
      binCount,
      frameCount: powerFrames.length,
      durationSeconds: samples.length / sampleRate,
      powerFrames,
      logMagnitudeFrames,
      phaseFrames
    };
  }

  function createWindow(size, windowType) {
    const window = new Float32Array(size);

    if (size <= 1) {
      window[0] = 1;
      return window;
    }

    const denominator = size - 1;

    for (let index = 0; index < size; index += 1) {
      const angle = (2 * Math.PI * index) / denominator;
      if (windowType === "hamming") {
        window[index] = 0.54 - 0.46 * Math.cos(angle);
      } else if (windowType === "blackman") {
        window[index] = 0.42 - 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle);
      } else if (windowType === "rectangular") {
        window[index] = 1;
      } else {
        window[index] = 0.5 - 0.5 * Math.cos(angle);
      }
    }

    return window;
  }

  function fftInPlace(re, im) {
    const size = re.length;
    const bits = Math.log2(size);

    if (!Number.isInteger(bits)) {
      throw new Error("FFT size must be power of two.");
    }

    for (let index = 0; index < size; index += 1) {
      const reversed = reverseBits(index, bits);
      if (reversed > index) {
        const tmpRe = re[index];
        const tmpIm = im[index];
        re[index] = re[reversed];
        im[index] = im[reversed];
        re[reversed] = tmpRe;
        im[reversed] = tmpIm;
      }
    }

    for (let blockSize = 2; blockSize <= size; blockSize *= 2) {
      const half = blockSize / 2;
      const phaseStep = (-2 * Math.PI) / blockSize;

      for (let start = 0; start < size; start += blockSize) {
        for (let index = 0; index < half; index += 1) {
          const even = start + index;
          const odd = even + half;
          const phase = phaseStep * index;
          const wr = Math.cos(phase);
          const wi = Math.sin(phase);

          const oddRe = wr * re[odd] - wi * im[odd];
          const oddIm = wr * im[odd] + wi * re[odd];

          const evenRe = re[even];
          const evenIm = im[even];

          re[even] = evenRe + oddRe;
          im[even] = evenIm + oddIm;
          re[odd] = evenRe - oddRe;
          im[odd] = evenIm - oddIm;
        }
      }
    }
  }

  function reverseBits(value, bits) {
    let reversed = 0;
    let temp = value;

    for (let index = 0; index < bits; index += 1) {
      reversed = (reversed << 1) | (temp & 1);
      temp >>= 1;
    }

    return reversed;
  }

  function ensureMelForAudio(item, audioData, cache) {
    const stft = ensureStftForAudio(item, audioData, cache);
    const melParams = getItemMelParams(item, stft.sampleRate);
    const melKey = stft.cacheKey + "::" + melParamsToKey(melParams);
    if (cache.melByKey[melKey]) {
      return cache.melByKey[melKey];
    }

    const filterbank = createMelFilterbank(
      stft.sampleRate,
      stft.fftSize,
      melParams.bands,
      melParams.minHz,
      melParams.maxHz
    );
    const melMatrix = applyFilterbank(stft.powerFrames, filterbank);

    const melResult = {
      cacheKey: melKey,
      matrix: melMatrix,
      bands: melParams.bands,
      minHz: melParams.minHz,
      maxHz: melParams.maxHz,
      durationSeconds: stft.durationSeconds
    };

    cache.melByKey[melKey] = melResult;
    return melResult;
  }

  function ensureMel(item) {
    return ensureMelForAudio(item, primaryAudio, derivedCache);
  }

  function createMelFilterbank(sampleRate, fftSize, melBands, minHz, maxHz) {
    const nyquist = sampleRate / 2;
    const binCount = fftSize / 2 + 1;

    const boundedMinHz = clamp(minHz, 0, Math.max(0, nyquist - 1));
    const boundedMaxHz = clamp(maxHz, boundedMinHz + 1, nyquist);

    const melMin = hzToMel(boundedMinHz);
    const melMax = hzToMel(boundedMaxHz);

    const melPoints = [];
    for (let index = 0; index < melBands + 2; index += 1) {
      melPoints.push(melMin + ((melMax - melMin) * index) / (melBands + 1));
    }

    const hzPoints = melPoints.map(melToHz);
    const binPoints = hzPoints.map(function (hz) {
      const raw = Math.floor(((fftSize + 1) * hz) / sampleRate);
      return clamp(raw, 0, binCount - 1);
    });

    const bank = [];

    for (let band = 1; band <= melBands; band += 1) {
      const left = binPoints[band - 1];
      const center = Math.max(left + 1, binPoints[band]);
      const right = Math.max(center + 1, binPoints[band + 1]);
      const row = new Float32Array(binCount);

      for (let bin = left; bin < center && bin < binCount; bin += 1) {
        row[bin] = (bin - left) / Math.max(1, center - left);
      }

      for (let bin = center; bin < right && bin < binCount; bin += 1) {
        row[bin] = (right - bin) / Math.max(1, right - center);
      }

      bank.push(normalizeWeightVector(row));
    }

    return bank;
  }

  function hzToMel(hz) {
    return 2595 * Math.log10(1 + hz / 700);
  }

  function melToHz(mel) {
    return 700 * (Math.pow(10, mel / 2595) - 1);
  }

  function applyFilterbank(powerFrames, filterbank) {
    const output = new Array(powerFrames.length);

    for (let frameIndex = 0; frameIndex < powerFrames.length; frameIndex += 1) {
      const spectrum = powerFrames[frameIndex];
      const row = new Float32Array(filterbank.length);

      for (let filterIndex = 0; filterIndex < filterbank.length; filterIndex += 1) {
        const weights = filterbank[filterIndex];
        let energy = 0;

        for (let bin = 0; bin < weights.length; bin += 1) {
          energy += spectrum[bin] * weights[bin];
        }

        row[filterIndex] = Math.log10(energy + 1e-12);
      }

      output[frameIndex] = row;
    }

    return output;
  }

  function applyFilterbankLinear(powerFrames, filterbank) {
    const output = new Array(powerFrames.length);

    for (let frameIndex = 0; frameIndex < powerFrames.length; frameIndex += 1) {
      const spectrum = powerFrames[frameIndex];
      const row = new Float32Array(filterbank.length);

      for (let filterIndex = 0; filterIndex < filterbank.length; filterIndex += 1) {
        const weights = filterbank[filterIndex];
        let energy = 0;

        for (let bin = 0; bin < weights.length; bin += 1) {
          energy += spectrum[bin] * weights[bin];
        }

        row[filterIndex] = Math.max(0, energy);
      }

      output[frameIndex] = row;
    }

    return output;
  }

  function ensureMfccForAudio(item, audioData, cache) {
    const mel = ensureMelForAudio(item, audioData, cache);
    const mfccParams = getItemMfccParams(item, mel.bands);
    const mfccKey = mel.cacheKey + "::" + mfccParams.coeffs;
    if (cache.mfccByKey[mfccKey]) {
      return cache.mfccByKey[mfccKey];
    }

    const mfccMatrix = dctRows(mel.matrix, mfccParams.coeffs);

    const mfccResult = {
      matrix: mfccMatrix,
      coeffs: mfccParams.coeffs,
      durationSeconds: mel.durationSeconds
    };

    cache.mfccByKey[mfccKey] = mfccResult;
    return mfccResult;
  }

  function ensureMfcc(item) {
    return ensureMfccForAudio(item, primaryAudio, derivedCache);
  }

  function ensureDctForAudio(item, audioData, cache) {
    const stft = ensureStftForAudio(item, audioData, cache);
    const dctParams = getItemDctParams(item, stft.binCount);
    const dctKey = stft.cacheKey + "::" + dctParams.coeffs;
    if (cache.dctByKey[dctKey]) {
      return cache.dctByKey[dctKey];
    }

    const dctMatrix = dctRows(stft.logMagnitudeFrames, dctParams.coeffs);

    const dctResult = {
      matrix: dctMatrix,
      coeffs: dctParams.coeffs,
      durationSeconds: stft.durationSeconds
    };

    cache.dctByKey[dctKey] = dctResult;
    return dctResult;
  }

  function ensureDct(item) {
    return ensureDctForAudio(item, primaryAudio, derivedCache);
  }

  function ensureCustomFilterbankForAudio(item, audioData, cache) {
    if (!customFilterbank) {
      throw new Error("Upload a custom filterbank CSV first.");
    }

    const stft = ensureStftForAudio(item, audioData, cache);
    const key = customFilterbank.fileName + "::" + stft.cacheKey + "::" + stft.binCount;

    if (cache.customFilterbankByKey[key]) {
      return cache.customFilterbankByKey[key];
    }

    const normalized = buildNormalizedFilterbank(customFilterbank.rows, stft.binCount);
    const matrix = applyFilterbank(stft.powerFrames, normalized);

    const customResult = {
      matrix,
      filters: normalized.length,
      sourceName: customFilterbank.fileName,
      durationSeconds: stft.durationSeconds
    };

    cache.customFilterbankByKey[key] = customResult;

    return customResult;
  }

  function ensureCustomFilterbank(item) {
    return ensureCustomFilterbankForAudio(item, primaryAudio, derivedCache);
  }

  function dctRows(matrix, coeffCount) {
    const out = new Array(matrix.length);
    for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
      out[rowIndex] = dctVector(matrix[rowIndex], coeffCount);
    }
    return out;
  }

  function dctVector(vector, coeffCount) {
    const length = vector.length;
    const outLength = Math.min(coeffCount, length);
    const out = new Float32Array(outLength);
    const factor = Math.PI / length;

    for (let k = 0; k < outLength; k += 1) {
      let sum = 0;
      for (let n = 0; n < length; n += 1) {
        sum += vector[n] * Math.cos((n + 0.5) * k * factor);
      }
      out[k] = sum;
    }

    return out;
  }

  function transformMetaLabel(item) {
    const kind = item.kind;
    if (!primaryAudio) {
      return "Awaiting audio input";
    }

    switch (kind) {
      case "timeseries":
        return "Raw waveform";
      case "stft": {
        const stft = ensureStft(item);
        const mode = getItemStftMode(item);
        const modeSuffix = mode === "phase" ? "phase(rad), " : "";
        return (
          stft.frameCount +
          " frames x " +
          stft.binCount +
          " bins | " +
          modeSuffix +
          "win=" +
          stft.fftSize +
          ", overlap=" +
          stft.overlapPercent +
          "%"
        );
      }
      case "mel": {
        const mel = ensureMel(item);
        return (
          mel.bands +
          " mel bands | " +
          Math.round(mel.minHz) +
          "-" +
          Math.round(mel.maxHz) +
          " Hz"
        );
      }
      case "mfcc": {
        const mfcc = ensureMfcc(item);
        return mfcc.coeffs + " cepstral coefficients";
      }
      case "dct": {
        const dct = ensureDct(item);
        return dct.coeffs + " DCT coefficients";
      }
      case "custom_filterbank":
        return customFilterbank ? "CSV: " + customFilterbank.fileName : "Requires filterbank CSV";
      default:
        return "";
    }
  }

  function buildTransformRenderSpecForAudio(item, audioData, cache, audioRoleLabel) {
    const kind = item.kind;
    if (!audioData) {
      throw new Error("Load the " + audioRoleLabel + " to render this view.");
    }

    if (kind === "timeseries") {
      return {
        type: "waveform",
        domainLength: audioData.samples.length,
        durationSeconds: audioData.duration,
        sampleRate: audioData.sampleRate,
        samples: audioData.samples,
        caption:
          "Raw samples from " +
          audioRoleLabel +
          " decoded mono mixdown (" +
          audioData.sampleRate +
          " Hz, " +
          audioData.duration.toFixed(2) +
          " s)."
      };
    }

    if (kind === "stft") {
      const stft = ensureStftForAudio(item, audioData, cache);
      if (getItemStftMode(item) === "phase") {
        return {
          type: "matrix",
          domainLength: stft.phaseFrames.length,
          durationSeconds: stft.durationSeconds,
          matrix: stft.phaseFrames,
          valueRange: [-Math.PI, Math.PI],
          valueUnit: "rad",
          caption:
            "STFT phase spectrogram (wrapped phase, radians) | fft=" +
            stft.fftSize +
            ", hop=" +
            stft.hopSize +
            ", overlap=" +
            stft.overlapPercent +
            "%, window=" +
            stft.windowType
        };
      }

      return {
        type: "matrix",
        domainLength: stft.logMagnitudeFrames.length,
        durationSeconds: stft.durationSeconds,
        matrix: stft.logMagnitudeFrames,
        valueUnit: "dB",
        caption:
          "STFT magnitude spectrogram | fft=" +
          stft.fftSize +
          ", hop=" +
          stft.hopSize +
          ", overlap=" +
          stft.overlapPercent +
          "%, window=" +
          stft.windowType +
          ", shown frames=" +
          stft.frameCount +
          ", analyzed=" +
          stft.durationSeconds.toFixed(2) +
          " s"
      };
    }

    if (kind === "mel") {
      const mel = ensureMelForAudio(item, audioData, cache);
      return {
        type: "matrix",
        domainLength: mel.matrix.length,
        durationSeconds: mel.durationSeconds,
        matrix: mel.matrix,
        caption:
          "Mel transform from STFT power using " +
          mel.bands +
          " bands over " +
          Math.round(mel.minHz) +
          "-" +
          Math.round(mel.maxHz) +
          " Hz."
      };
    }

    if (kind === "mfcc") {
      const mfcc = ensureMfccForAudio(item, audioData, cache);
      return {
        type: "matrix",
        domainLength: mfcc.matrix.length,
        durationSeconds: mfcc.durationSeconds,
        matrix: mfcc.matrix,
        caption: "MFCC from DCT(log-mel), showing first " + mfcc.coeffs + " coefficients."
      };
    }

    if (kind === "dct") {
      const dct = ensureDctForAudio(item, audioData, cache);
      return {
        type: "matrix",
        domainLength: dct.matrix.length,
        durationSeconds: dct.durationSeconds,
        matrix: dct.matrix,
        caption: "DCT-II on log STFT magnitudes, first " + dct.coeffs + " coefficients."
      };
    }

    if (kind === "custom_filterbank") {
      const custom = ensureCustomFilterbankForAudio(item, audioData, cache);
      return {
        type: "matrix",
        domainLength: custom.matrix.length,
        durationSeconds: custom.durationSeconds,
        matrix: custom.matrix,
        caption:
          "Custom filterbank energies from " +
          custom.sourceName +
          ", filters=" +
          custom.filters +
          ". Column counts are auto-resampled to FFT bins."
      };
    }

    throw new Error("Unsupported transform: " + kind);
  }

  function buildTransformRenderSpec(item) {
    return buildTransformRenderSpecForAudio(item, primaryAudio, derivedCache, "primary clip");
  }

  function pickCanvasWidth(panelCount) {
    const safePanelCount = Math.max(1, panelCount || 1);
    const containerWidth = Math.floor(renderStackContainer.clientWidth || 700);
    const gapTotal = (safePanelCount - 1) * 8;
    const targetWidth = (containerWidth - 24 - gapTotal) / safePanelCount;
    return clamp(Math.floor(targetWidth), 240, 1800);
  }

  function getCanvasWidthPanelDivisor(comparisonMode, panelCount) {
    if (comparisonMode === "side_by_side" || comparisonMode === "side_by_side_difference") {
      return Math.max(1, panelCount || 1);
    }

    return 1;
  }

  function drawWaveform(canvas, samples, startIndex, endIndex, zoomLevel, options) {
    const opts = options || {};
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;

    if (opts.clear !== false) {
      ctx.fillStyle = opts.backgroundColor || "#0b1220";
      ctx.fillRect(0, 0, width, height);
    }

    const mid = Math.floor(height / 2);
    const visibleCount = Math.max(1, endIndex - startIndex);
    const shouldDrawConnectedDots = Number.isFinite(zoomLevel) && zoomLevel >= 30;

    if (shouldDrawConnectedDots) {
      const maxPoints = Math.max(64, Math.min(width * 2, 6000));
      const stride = Math.max(1, Math.ceil(visibleCount / maxPoints));
      const points = [];

      for (let index = startIndex; index < endIndex; index += stride) {
        const boundedIndex = clamp(index, 0, samples.length - 1);
        const value = samples[boundedIndex];
        const sampleRatio = (index - startIndex) / Math.max(1, visibleCount - 1);
        const x = sampleRatio * (width - 1);
        const y = mid + value * (height * 0.46);
        points.push({ x, y });
      }

      const finalIndex = clamp(endIndex - 1, 0, samples.length - 1);
      if (points.length === 0 || finalIndex > startIndex) {
        const finalRatio = (endIndex - 1 - startIndex) / Math.max(1, visibleCount - 1);
        points.push({
          x: finalRatio * (width - 1),
          y: mid + samples[finalIndex] * (height * 0.46)
        });
      }

      ctx.save();
      ctx.globalAlpha = Number.isFinite(opts.alpha) ? clamp(opts.alpha, 0, 1) : 1;
      ctx.strokeStyle = opts.strokeColor || "#7dd3fc";
      ctx.lineWidth = opts.lineWidth || 1.2;
      ctx.beginPath();

      for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        const point = points[pointIndex];
        if (pointIndex === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
      ctx.stroke();

      const pointRadius = points.length > 1200 ? 0.7 : points.length > 600 ? 0.9 : 1.2;
      ctx.fillStyle = opts.pointColor || "#38bdf8";

      for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        const point = points[pointIndex];
        if (pointRadius <= 0.75) {
          ctx.fillRect(point.x, point.y, 1.2, 1.2);
        } else {
          ctx.beginPath();
          ctx.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = Number.isFinite(opts.alpha) ? clamp(opts.alpha, 0, 1) : 1;
      ctx.strokeStyle = opts.strokeColor || "#7dd3fc";
      ctx.lineWidth = opts.lineWidth || 1;
      ctx.beginPath();

      for (let x = 0; x < width; x += 1) {
        const from = startIndex + Math.floor((x / width) * visibleCount);
        const to = startIndex + Math.floor(((x + 1) / width) * visibleCount);

        let min = 1;
        let max = -1;
        const boundedTo = clamp(to, 0, samples.length);
        const boundedFrom = clamp(from, 0, samples.length - 1);

        for (let index = boundedFrom; index < Math.max(boundedFrom + 1, boundedTo); index += 1) {
          const value = samples[index];
          if (value < min) {
            min = value;
          }
          if (value > max) {
            max = value;
          }
        }

        const yMin = mid + min * (height * 0.46);
        const yMax = mid + max * (height * 0.46);
        ctx.moveTo(x + 0.5, yMin);
        ctx.lineTo(x + 0.5, yMax);
      }

      ctx.stroke();
      ctx.restore();
    }

    if (opts.drawMidline !== false) {
      ctx.strokeStyle = opts.midlineColor || "rgba(255,255,255,0.24)";
      ctx.beginPath();
      ctx.moveTo(0, mid + 0.5);
      ctx.lineTo(width, mid + 0.5);
      ctx.stroke();
    }
  }

  function drawHeatmap(canvas, matrix, startFrame, endFrame, fixedRange) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;

    if (!matrix.length || !matrix[0].length) {
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, width, height);
      return;
    }

    const visibleFrameCount = Math.max(1, endFrame - startFrame);
    const bins = matrix[0].length;
    const range = resolveMatrixRange(matrix, startFrame, endFrame, fixedRange);

    const minValue = range.min;
    const maxValue = range.max;
    const span = Math.max(1e-9, maxValue - minValue);
    const image = createHeatmapImageData(
      width,
      height,
      matrix,
      startFrame,
      visibleFrameCount,
      bins,
      minValue,
      span,
      heatColor
    );
    ctx.putImageData(image, 0, 0);

    ctx.strokeStyle = "rgba(255,255,255,0.20)";
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  }

  function createHeatmapImageData(
    width,
    height,
    matrix,
    startFrame,
    visibleFrameCount,
    bins,
    minValue,
    span,
    colorMapper
  ) {
    const image = new ImageData(width, height);

    for (let y = 0; y < height; y += 1) {
      const normalizedY = 1 - y / Math.max(1, height - 1);
      const binIndex = Math.floor(normalizedY * (bins - 1));

      for (let x = 0; x < width; x += 1) {
        const normalizedX = x / Math.max(1, width - 1);
        const frameIndex = startFrame + Math.floor(normalizedX * Math.max(0, visibleFrameCount - 1));
        const frame = matrix[clamp(frameIndex, 0, matrix.length - 1)];
        const value = frame[binIndex];
        const normalized = clamp((value - minValue) / span, 0, 1);
        const color = colorMapper(normalized);

        const offset = (y * width + x) * 4;
        image.data[offset] = color[0];
        image.data[offset + 1] = color[1];
        image.data[offset + 2] = color[2];
        image.data[offset + 3] = 255;
      }
    }

    return image;
  }

  function drawActivationOverlay(canvas, renderSpec, windowInfo) {
    if (!state.overlay.enabled || !overlayParsed || !Array.isArray(overlayParsed.intervals)) {
      return;
    }

    if (!Number.isFinite(renderSpec.durationSeconds) || renderSpec.durationSeconds <= 0) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const domainLastIndex = Math.max(1, renderSpec.domainLength - 1);
    const visibleLastIndex = Math.max(1, windowInfo.visibleCount - 1);
    const duration = renderSpec.durationSeconds;

    ctx.save();
    if (overlayParsed.mode === "timestamped") {
      ctx.fillStyle = "rgba(244, 63, 94, 0.20)";
      ctx.strokeStyle = "rgba(251, 113, 133, 0.85)";
    } else {
      const overlayColor = hexToRgb(state.overlay.flagColor);
      ctx.fillStyle = rgbToRgbaString(overlayColor, 0.2);
      ctx.strokeStyle = rgbToRgbaString(overlayColor, 0.9);
    }
    ctx.lineWidth = 1;

    overlayParsed.intervals.forEach(function (interval) {
      const startSec = clamp(interval.startSec, 0, duration);
      const endSec = clamp(interval.endSec, startSec, duration);

      const startGlobal = (startSec / duration) * domainLastIndex;
      const endGlobal = (endSec / duration) * domainLastIndex;

      const localStartRatio = (startGlobal - windowInfo.startIndex) / visibleLastIndex;
      const localEndRatio = (endGlobal - windowInfo.startIndex) / visibleLastIndex;

      if (localEndRatio < 0 || localStartRatio > 1) {
        return;
      }

      const x1 = clamp(localStartRatio, 0, 1) * (canvas.width - 1);
      const x2 = clamp(localEndRatio, 0, 1) * (canvas.width - 1);
      const width = Math.max(1.5, x2 - x1);

      ctx.fillRect(x1, 1, width, canvas.height - 2);
      ctx.strokeRect(x1 + 0.5, 1.5, Math.max(1, width - 1), canvas.height - 3);
    });

    ctx.restore();
  }

  function domainIndexToTimeSec(renderSpec, index) {
    if (!renderSpec || renderSpec.domainLength <= 1 || renderSpec.durationSeconds <= 0) {
      return 0;
    }

    const last = renderSpec.domainLength - 1;
    return (clamp(index, 0, last) / last) * renderSpec.durationSeconds;
  }

  function timeSecToDomainIndex(renderSpec, timeSec) {
    if (!renderSpec || renderSpec.domainLength <= 1 || renderSpec.durationSeconds <= 0) {
      return 0;
    }

    const last = renderSpec.domainLength - 1;
    const clampedTime = clamp(timeSec, 0, renderSpec.durationSeconds);
    return (clampedTime / renderSpec.durationSeconds) * last;
  }

  function sampleAtIndex(samples, indexFloat) {
    if (!samples || samples.length === 0) {
      return 0;
    }

    const left = clamp(Math.floor(indexFloat), 0, samples.length - 1);
    const right = clamp(left + 1, 0, samples.length - 1);
    const frac = clamp(indexFloat - left, 0, 1);
    return samples[left] * (1 - frac) + samples[right] * frac;
  }

  function getMatrixValueAtTime(renderSpec, timeSec, binIndexFloat) {
    if (!renderSpec || !Array.isArray(renderSpec.matrix) || renderSpec.matrix.length === 0) {
      return 0;
    }

    const frameFloat = timeSecToDomainIndex(renderSpec, timeSec);
    const frameIndex = clamp(Math.round(frameFloat), 0, renderSpec.matrix.length - 1);
    const row = renderSpec.matrix[frameIndex];
    if (!row || row.length === 0) {
      return 0;
    }

    const binIndex = clamp(Math.round(binIndexFloat), 0, row.length - 1);
    return row[binIndex];
  }

  function mapPrimaryWindowToSecondaryWindow(primarySpec, secondarySpec, primaryWindow, offsetSeconds) {
    const startTime = domainIndexToTimeSec(primarySpec, primaryWindow.startIndex) + offsetSeconds;
    const endTime = domainIndexToTimeSec(primarySpec, primaryWindow.endIndex - 1) + offsetSeconds;
    const hasOverlap = endTime >= 0 && startTime <= secondarySpec.durationSeconds;

    const startIndex = Math.floor(timeSecToDomainIndex(secondarySpec, startTime));
    const endIndex = Math.ceil(timeSecToDomainIndex(secondarySpec, endTime)) + 1;

    return {
      hasOverlap,
      startIndex: clamp(startIndex, 0, Math.max(0, secondarySpec.domainLength - 1)),
      endIndex: clamp(endIndex, 1, secondarySpec.domainLength),
      visibleCount: Math.max(1, endIndex - startIndex)
    };
  }

  function secondaryHeatColor(t) {
    const x = clamp(t, 0, 1);
    const r = Math.round(255 * clamp(1.25 * x + 0.1, 0, 1));
    const g = Math.round(255 * clamp(1.5 - Math.abs(1.9 * x - 0.95), 0, 1));
    const b = Math.round(255 * clamp(1.6 - 0.9 * x, 0, 1));
    return [r, g, b];
  }

  function divergingDiffColor(t) {
    const x = clamp(t, 0, 1);
    if (x <= 0.5) {
      const p = x / 0.5;
      return [Math.round(255 * p), Math.round(255 * p), 255];
    }

    const p = (x - 0.5) / 0.5;
    return [255, Math.round(255 * (1 - p)), Math.round(255 * (1 - p))];
  }

  function estimateMatrixDifferenceMaxAbs(primarySpec, secondarySpec, primaryWindow, offsetSeconds) {
    const frameCount = Math.max(1, primaryWindow.visibleCount);
    const frameStep = Math.max(1, Math.floor(frameCount / 240));
    const bins = primarySpec.matrix && primarySpec.matrix[0] ? primarySpec.matrix[0].length : 0;
    const binStep = Math.max(1, Math.floor(Math.max(1, bins) / 96));
    let maxAbs = 0;

    for (let frame = primaryWindow.startIndex; frame < primaryWindow.endIndex; frame += frameStep) {
      const timeSec = domainIndexToTimeSec(primarySpec, frame);
      const secondaryTimeSec = timeSec + offsetSeconds;
      for (let bin = 0; bin < bins; bin += binStep) {
        const primaryValue = getMatrixValueAtTime(primarySpec, timeSec, bin);
        const secondaryValue = getMatrixValueAtTime(secondarySpec, secondaryTimeSec, bin);
        const absDiff = Math.abs(primaryValue - secondaryValue);
        if (absDiff > maxAbs) {
          maxAbs = absDiff;
        }
      }
    }

    return Math.max(1e-9, maxAbs);
  }

  function drawWaveformOverlayComparison(canvas, primarySpec, secondarySpec, primaryWindow, offsetSeconds) {
    drawWaveform(
      canvas,
      primarySpec.samples,
      primaryWindow.startIndex,
      primaryWindow.endIndex,
      primaryWindow.zoom,
      {
        clear: true,
        strokeColor: "#7dd3fc",
        pointColor: "#38bdf8",
        alpha: 1
      }
    );

    const secondaryWindow = mapPrimaryWindowToSecondaryWindow(
      primarySpec,
      secondarySpec,
      primaryWindow,
      offsetSeconds
    );
    if (!secondaryWindow.hasOverlap) {
      return;
    }

    drawWaveform(
      canvas,
      secondarySpec.samples,
      secondaryWindow.startIndex,
      secondaryWindow.endIndex,
      primaryWindow.zoom,
      {
        clear: false,
        strokeColor: "#f472b6",
        pointColor: "#f9a8d4",
        alpha: 0.82,
        drawMidline: false
      }
    );
  }

  function drawWaveformDifferenceComparison(canvas, primarySpec, secondarySpec, primaryWindow, offsetSeconds) {
    const secondaryWindow = mapPrimaryWindowToSecondaryWindow(
      primarySpec,
      secondarySpec,
      primaryWindow,
      offsetSeconds
    );
    if (!secondaryWindow.hasOverlap) {
      drawNoOverlapPlaceholder(canvas, "No overlap at current offset");
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    const mid = Math.floor(height / 2);

    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(255,255,255,0.24)";
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(width, mid + 0.5);
    ctx.stroke();

    ctx.strokeStyle = "#fb7185";
    ctx.lineWidth = 1.1;
    ctx.beginPath();

    for (let x = 0; x < width; x += 1) {
      const localRatio = x / Math.max(1, width - 1);
      const primaryIndex =
        primaryWindow.startIndex + localRatio * Math.max(1, primaryWindow.visibleCount - 1);
      const timeSec = domainIndexToTimeSec(primarySpec, primaryIndex);
      const secondaryTimeSec = timeSec + offsetSeconds;
      const primaryValue = sampleAtIndex(primarySpec.samples, primaryIndex);
      const secondaryIndex = timeSecToDomainIndex(secondarySpec, secondaryTimeSec);
      const secondaryValue = sampleAtIndex(secondarySpec.samples, secondaryIndex);
      const diff = clamp(primaryValue - secondaryValue, -1, 1);
      const y = mid + diff * (height * 0.46);

      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
  }

  function drawHeatmapOverlayComparison(
    canvas,
    primarySpec,
    secondarySpec,
    primaryWindow,
    offsetSeconds
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;

    const primaryRange = resolveMatrixRange(
      primarySpec.matrix,
      primaryWindow.startIndex,
      primaryWindow.endIndex,
      primarySpec.valueRange
    );
    const primarySpan = Math.max(1e-9, primaryRange.max - primaryRange.min);

    const secondaryWindow = mapPrimaryWindowToSecondaryWindow(
      primarySpec,
      secondarySpec,
      primaryWindow,
      offsetSeconds
    );
    if (!secondaryWindow.hasOverlap) {
      drawHeatmap(
        canvas,
        primarySpec.matrix,
        primaryWindow.startIndex,
        primaryWindow.endIndex,
        primarySpec.valueRange
      );
      return;
    }
    const secondaryRange = resolveMatrixRange(
      secondarySpec.matrix,
      secondaryWindow.startIndex,
      secondaryWindow.endIndex,
      secondarySpec.valueRange
    );
    const secondarySpan = Math.max(1e-9, secondaryRange.max - secondaryRange.min);

    const bins = primarySpec.matrix[0].length;
    const image = new ImageData(width, height);

    for (let y = 0; y < height; y += 1) {
      const normalizedY = 1 - y / Math.max(1, height - 1);
      const bin = normalizedY * Math.max(0, bins - 1);

      for (let x = 0; x < width; x += 1) {
        const localRatio = x / Math.max(1, width - 1);
        const primaryIndex =
          primaryWindow.startIndex + localRatio * Math.max(1, primaryWindow.visibleCount - 1);
        const timeSec = domainIndexToTimeSec(primarySpec, primaryIndex);
        const secondaryTimeSec = timeSec + offsetSeconds;

        const primaryValue = getMatrixValueAtTime(primarySpec, timeSec, bin);
        const secondaryValue = getMatrixValueAtTime(secondarySpec, secondaryTimeSec, bin);
        const primaryColor = heatColor((primaryValue - primaryRange.min) / primarySpan);
        const secondaryColor = secondaryHeatColor((secondaryValue - secondaryRange.min) / secondarySpan);

        const mixed = [
          Math.round(primaryColor[0] * 0.58 + secondaryColor[0] * 0.42),
          Math.round(primaryColor[1] * 0.58 + secondaryColor[1] * 0.42),
          Math.round(primaryColor[2] * 0.58 + secondaryColor[2] * 0.42)
        ];

        const offset = (y * width + x) * 4;
        image.data[offset] = mixed[0];
        image.data[offset + 1] = mixed[1];
        image.data[offset + 2] = mixed[2];
        image.data[offset + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    ctx.strokeStyle = "rgba(255,255,255,0.20)";
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  }

  function drawHeatmapDifferenceComparison(
    canvas,
    primarySpec,
    secondarySpec,
    primaryWindow,
    offsetSeconds
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    const bins = primarySpec.matrix[0].length;
    const overlapWindow = mapPrimaryWindowToSecondaryWindow(
      primarySpec,
      secondarySpec,
      primaryWindow,
      offsetSeconds
    );
    if (!overlapWindow.hasOverlap) {
      drawNoOverlapPlaceholder(canvas, "No overlap at current offset");
      return;
    }
    const maxAbs = estimateMatrixDifferenceMaxAbs(
      primarySpec,
      secondarySpec,
      primaryWindow,
      offsetSeconds
    );

    const image = new ImageData(width, height);
    for (let y = 0; y < height; y += 1) {
      const normalizedY = 1 - y / Math.max(1, height - 1);
      const bin = normalizedY * Math.max(0, bins - 1);

      for (let x = 0; x < width; x += 1) {
        const localRatio = x / Math.max(1, width - 1);
        const primaryIndex =
          primaryWindow.startIndex + localRatio * Math.max(1, primaryWindow.visibleCount - 1);
        const timeSec = domainIndexToTimeSec(primarySpec, primaryIndex);
        const secondaryTimeSec = timeSec + offsetSeconds;

        const primaryValue = getMatrixValueAtTime(primarySpec, timeSec, bin);
        const secondaryValue = getMatrixValueAtTime(secondarySpec, secondaryTimeSec, bin);
        const diff = (primaryValue - secondaryValue) / maxAbs;
        const color = divergingDiffColor(diff * 0.5 + 0.5);

        const offset = (y * width + x) * 4;
        image.data[offset] = color[0];
        image.data[offset + 1] = color[1];
        image.data[offset + 2] = color[2];
        image.data[offset + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    ctx.strokeStyle = "rgba(255,255,255,0.20)";
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  }

  function resolveMatrixRange(matrix, startFrame, endFrame, fixedRange) {
    if (
      fixedRange &&
      Array.isArray(fixedRange) &&
      fixedRange.length === 2 &&
      Number.isFinite(fixedRange[0]) &&
      Number.isFinite(fixedRange[1]) &&
      fixedRange[0] < fixedRange[1]
    ) {
      return {
        min: fixedRange[0],
        max: fixedRange[1]
      };
    }

    return matrixRange(matrix, startFrame, endFrame);
  }

  function matrixRange(matrix, startFrame, endFrame) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    const boundedStart = clamp(startFrame, 0, matrix.length - 1);
    const boundedEnd = clamp(endFrame, boundedStart + 1, matrix.length);

    for (let rowIndex = boundedStart; rowIndex < boundedEnd; rowIndex += 1) {
      const row = matrix[rowIndex];
      for (let col = 0; col < row.length; col += 1) {
        const value = row[col];
        if (value < min) {
          min = value;
        }
        if (value > max) {
          max = value;
        }
      }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: 0, max: 1 };
    }

    if (min === max) {
      return { min: min - 1, max: max + 1 };
    }

    return { min, max };
  }

  function shouldShowSpectralBar(viewId) {
    return ensureViewState(viewId).showSpectralBar !== false;
  }

  function formatRangeValue(value, unit) {
    if (!Number.isFinite(value)) {
      return "n/a";
    }

    if (Math.abs(value) >= 100) {
      return value.toFixed(0) + (unit ? " " + unit : "");
    }

    if (Math.abs(value) >= 10) {
      return value.toFixed(1) + (unit ? " " + unit : "");
    }

    return value.toFixed(3) + (unit ? " " + unit : "");
  }

  function buildSpectralBar(renderSpec, windowInfo) {
    const wrapper = document.createElement("div");
    wrapper.className = "spectral-bar";

    const range = resolveMatrixRange(
      renderSpec.matrix,
      windowInfo.startIndex,
      windowInfo.endIndex,
      renderSpec.valueRange
    );

    const minLabel = document.createElement("span");
    minLabel.className = "spectral-bar-label";
    minLabel.textContent = formatRangeValue(range.min, renderSpec.valueUnit);

    const maxLabel = document.createElement("span");
    maxLabel.className = "spectral-bar-label";
    maxLabel.textContent = formatRangeValue(range.max, renderSpec.valueUnit);

    const track = document.createElement("canvas");
    track.className = "spectral-bar-track";
    track.width = 260;
    track.height = 12;

    drawHeatGradientTrack(track);

    wrapper.appendChild(minLabel);
    wrapper.appendChild(track);
    wrapper.appendChild(maxLabel);
    return wrapper;
  }

  function drawHeatGradientTrack(trackCanvas) {
    const ctx = trackCanvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const image = ctx.createImageData(trackCanvas.width, trackCanvas.height);
    for (let x = 0; x < trackCanvas.width; x += 1) {
      const t = x / Math.max(1, trackCanvas.width - 1);
      const color = heatColor(t);
      for (let y = 0; y < trackCanvas.height; y += 1) {
        const offset = (y * trackCanvas.width + x) * 4;
        image.data[offset] = color[0];
        image.data[offset + 1] = color[1];
        image.data[offset + 2] = color[2];
        image.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  function computeWaveformStats(samples, startIndex, endIndex, sampleRate) {
    const boundedStart = clamp(startIndex, 0, samples.length - 1);
    const boundedEnd = clamp(endIndex, boundedStart + 1, samples.length);
    const count = Math.max(1, boundedEnd - boundedStart);

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    let sumSquares = 0;
    let zeroCrossings = 0;
    let previousSign = 0;

    for (let index = boundedStart; index < boundedEnd; index += 1) {
      const value = samples[index];
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }

      sum += value;
      sumSquares += value * value;

      const sign = value > 0 ? 1 : value < 0 ? -1 : 0;
      if (previousSign !== 0 && sign !== 0 && sign !== previousSign) {
        zeroCrossings += 1;
      }
      if (sign !== 0) {
        previousSign = sign;
      }
    }

    const mean = sum / count;
    const rms = Math.sqrt(sumSquares / count);
    const variance = Math.max(0, sumSquares / count - mean * mean);
    const std = Math.sqrt(variance);
    const peakAbs = Math.max(Math.abs(min), Math.abs(max));
    const peakToPeak = max - min;
    const zcr = zeroCrossings / Math.max(1, count - 1);
    const durationSeconds = sampleRate > 0 ? count / sampleRate : 0;

    return {
      min,
      max,
      mean,
      rms,
      std,
      peakAbs,
      peakToPeak,
      zcr,
      durationSeconds
    };
  }

  function buildTimeseriesBar(renderSpec, windowInfo) {
    const stats = computeWaveformStats(
      renderSpec.samples,
      windowInfo.startIndex,
      windowInfo.endIndex,
      renderSpec.sampleRate || 0
    );

    const wrapper = document.createElement("div");
    wrapper.className = "spectral-bar";

    const minLabel = document.createElement("span");
    minLabel.className = "spectral-bar-label";
    minLabel.textContent = formatRangeValue(stats.min, "amp");

    const maxLabel = document.createElement("span");
    maxLabel.className = "spectral-bar-label";
    maxLabel.textContent = formatRangeValue(stats.max, "amp");

    const track = document.createElement("canvas");
    track.className = "spectral-bar-track";
    track.width = 260;
    track.height = 12;
    drawHeatGradientTrack(track);

    wrapper.appendChild(minLabel);
    wrapper.appendChild(track);
    wrapper.appendChild(maxLabel);
    return wrapper;
  }

  function appendStatItem(container, label, value) {
    const item = document.createElement("div");
    item.className = "timeseries-stat-item";

    const key = document.createElement("span");
    key.className = "timeseries-stat-key";
    key.textContent = label;

    const val = document.createElement("span");
    val.className = "timeseries-stat-value";
    val.textContent = value;

    item.appendChild(key);
    item.appendChild(val);
    container.appendChild(item);
  }

  function buildTimeseriesStatsPanel(renderSpec, windowInfo) {
    const stats = computeWaveformStats(
      renderSpec.samples,
      windowInfo.startIndex,
      windowInfo.endIndex,
      renderSpec.sampleRate || 0
    );

    const panel = document.createElement("div");
    panel.className = "timeseries-stats";

    appendStatItem(panel, "RMS", stats.rms.toFixed(5));
    appendStatItem(panel, "Mean", stats.mean.toFixed(5));
    appendStatItem(panel, "Std", stats.std.toFixed(5));
    appendStatItem(panel, "Min", stats.min.toFixed(5));
    appendStatItem(panel, "Max", stats.max.toFixed(5));
    appendStatItem(panel, "Peak |x|", stats.peakAbs.toFixed(5));
    appendStatItem(panel, "Peak-to-peak", stats.peakToPeak.toFixed(5));
    appendStatItem(panel, "ZCR", stats.zcr.toFixed(5));
    appendStatItem(panel, "Window (s)", stats.durationSeconds.toFixed(3));

    return panel;
  }

  function heatColor(t) {
    const x = clamp(t, 0, 1);
    const r = Math.round(255 * clamp(1.5 * x - 0.2, 0, 1));
    const g = Math.round(255 * clamp(1.6 - Math.abs(2.2 * x - 1), 0, 1));
    const b = Math.round(255 * clamp(1.35 - 1.55 * x, 0, 1));
    return [r, g, b];
  }

  function buildTransformToolbar(item, renderSpec) {
    const toolbar = document.createElement("div");
    toolbar.className = "transform-toolbar";

    const left = document.createElement("div");
    left.className = "transform-toolbar-group";

    const zoomOutButton = document.createElement("button");
    zoomOutButton.type = "button";
    zoomOutButton.textContent = "-";
    zoomOutButton.title = "Zoom out";

    const zoomValue = document.createElement("span");
    zoomValue.className = "zoom-value";
    const windowInfo = computeViewWindow(renderSpec.domainLength, item.id);
    zoomValue.textContent = "x" + windowInfo.zoom.toFixed(2);

    const zoomInButton = document.createElement("button");
    zoomInButton.type = "button";
    zoomInButton.textContent = "+";
    zoomInButton.title = "Zoom in";

    const zoomResetButton = document.createElement("button");
    zoomResetButton.type = "button";
    zoomResetButton.textContent = "Reset";
    zoomResetButton.title = "Reset zoom and pan";

    zoomOutButton.addEventListener("click", function () {
      const current = computeViewWindow(renderSpec.domainLength, item.id);
      setViewZoom(item.id, renderSpec.domainLength, current.zoom / 1.2, 0.5);
      renderTransformStack();
    });

    zoomInButton.addEventListener("click", function () {
      const current = computeViewWindow(renderSpec.domainLength, item.id);
      setViewZoom(item.id, renderSpec.domainLength, current.zoom * 1.2, 0.5);
      renderTransformStack();
    });

    zoomResetButton.addEventListener("click", function () {
      const viewState = ensureViewState(item.id);
      viewState.zoom = 1;
      viewState.offset = 0;
      renderTransformStack();
    });

    left.appendChild(zoomOutButton);
    left.appendChild(zoomValue);
    left.appendChild(zoomInButton);
    left.appendChild(zoomResetButton);

    if (renderSpec.type === "matrix") {
      const barToggle = document.createElement("button");
      barToggle.type = "button";
      barToggle.textContent = shouldShowSpectralBar(item.id)
        ? "Hide Spectral Bar"
        : "Show Spectral Bar";
      barToggle.title = "Toggle spectral color bar";
      barToggle.addEventListener("click", function () {
        const viewState = ensureViewState(item.id);
        viewState.showSpectralBar = !shouldShowSpectralBar(item.id);
        renderTransformStack();
      });
      left.appendChild(barToggle);
    }

    const right = document.createElement("div");
    right.className = "transform-toolbar-group hint-group";
    right.textContent = "Click = seek | Wheel = zoom | Drag = pan";

    toolbar.appendChild(left);
    toolbar.appendChild(right);

    return toolbar;
  }

  function attachCanvasInteractions(canvas, item, renderSpec) {
    let drag = null;

    canvas.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) {
        return;
      }

      selectView(item.id);

      const viewState = ensureViewState(item.id);
      drag = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startOffset: viewState.offset,
        didPan: false
      };

      canvas.classList.add("is-dragging");
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", function (event) {
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }

      const dx = event.clientX - drag.startClientX;
      if (Math.abs(dx) <= 2) {
        return;
      }

      drag.didPan = true;

      const viewState = ensureViewState(item.id);
      const windowInfo = computeViewWindow(renderSpec.domainLength, item.id);

      const deltaStartRatio = (-dx / Math.max(1, canvas.clientWidth)) * windowInfo.visibleRatio;
      const availableStartRatio = Math.max(1e-9, 1 - windowInfo.visibleRatio);
      const deltaOffset = deltaStartRatio / availableStartRatio;

      viewState.offset = clamp(drag.startOffset + deltaOffset, 0, 1);
      scheduleRenderTransformStack();
    });

    canvas.addEventListener("pointerup", function (event) {
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }

      const wasPan = drag.didPan;
      drag = null;
      canvas.classList.remove("is-dragging");
      canvas.releasePointerCapture(event.pointerId);

      if (!wasPan) {
        const rect = canvas.getBoundingClientRect();
        const localRatio = clamp(
          (event.clientX - rect.left) / Math.max(1, rect.width),
          0,
          1
        );

        const globalRatio = localRatioToGlobalRatio(item.id, renderSpec.domainLength, localRatio);
        seekAudioAtGlobalRatio(globalRatio);
        updateAnimatedPlayheads();
      }
    });

    canvas.addEventListener("pointercancel", function (event) {
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }

      drag = null;
      canvas.classList.remove("is-dragging");
    });

    canvas.addEventListener(
      "wheel",
      function (event) {
        event.preventDefault();

        const rect = canvas.getBoundingClientRect();
        const anchorRatio = clamp(
          (event.clientX - rect.left) / Math.max(1, rect.width),
          0,
          1
        );

        const current = computeViewWindow(renderSpec.domainLength, item.id);
        const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
        setViewZoom(item.id, renderSpec.domainLength, current.zoom * factor, anchorRatio);

        scheduleRenderTransformStack();
      },
      { passive: false }
    );

    canvas.addEventListener("dblclick", function () {
      const viewState = ensureViewState(item.id);
      viewState.zoom = 1;
      viewState.offset = 0;
      scheduleRenderTransformStack();
    });
  }

  function buildTransformScrollbar(item, renderSpec) {
    const wrapper = document.createElement("div");
    wrapper.className = "transform-scrollbar";

    const track = document.createElement("div");
    track.className = "transform-scrollbar-track";

    const thumb = document.createElement("div");
    thumb.className = "transform-scrollbar-thumb";

    const playhead = document.createElement("div");
    playhead.className = "transform-scrollbar-playhead";

    track.appendChild(thumb);
    track.appendChild(playhead);
    wrapper.appendChild(track);

    const windowInfo = computeViewWindow(renderSpec.domainLength, item.id);
    const widthPercent = Math.max(3, windowInfo.visibleRatio * 100);
    const maxLeftPercent = Math.max(0, 100 - widthPercent);
    const leftPercent = windowInfo.offsetNormalized * maxLeftPercent;

    thumb.style.width = widthPercent.toFixed(4) + "%";
    thumb.style.left = leftPercent.toFixed(4) + "%";

    track.addEventListener("pointerdown", function (event) {
      if (event.target === thumb) {
        return;
      }

      selectView(item.id);

      const rect = track.getBoundingClientRect();
      const pointerRatio = clamp(
        (event.clientX - rect.left) / Math.max(1, rect.width),
        0,
        1
      );

      const currentWindow = computeViewWindow(renderSpec.domainLength, item.id);
      const availableStartRatio = Math.max(0, 1 - currentWindow.visibleRatio);
      const desiredStartRatio = clamp(
        pointerRatio - currentWindow.visibleRatio / 2,
        0,
        availableStartRatio
      );

      setViewOffsetFromStartRatio(item.id, renderSpec.domainLength, desiredStartRatio);
      renderTransformStack();
    });

    let thumbDrag = null;

    thumb.addEventListener("pointerdown", function (event) {
      event.stopPropagation();
      selectView(item.id);

      const currentWindow = computeViewWindow(renderSpec.domainLength, item.id);
      thumbDrag = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startOffset: ensureViewState(item.id).offset,
        visibleRatio: currentWindow.visibleRatio
      };

      thumb.classList.add("is-dragging");
      thumb.setPointerCapture(event.pointerId);
    });

    thumb.addEventListener("pointermove", function (event) {
      if (!thumbDrag || thumbDrag.pointerId !== event.pointerId) {
        return;
      }

      const rect = track.getBoundingClientRect();
      const dx = event.clientX - thumbDrag.startClientX;
      const deltaStartRatio = dx / Math.max(1, rect.width);
      const availableStartRatio = Math.max(1e-9, 1 - thumbDrag.visibleRatio);
      const deltaOffset = deltaStartRatio / availableStartRatio;

      const viewState = ensureViewState(item.id);
      viewState.offset = clamp(thumbDrag.startOffset + deltaOffset, 0, 1);

      scheduleRenderTransformStack();
    });

    thumb.addEventListener("pointerup", function (event) {
      if (!thumbDrag || thumbDrag.pointerId !== event.pointerId) {
        return;
      }

      thumbDrag = null;
      thumb.classList.remove("is-dragging");
      thumb.releasePointerCapture(event.pointerId);
    });

    thumb.addEventListener("pointercancel", function (event) {
      if (!thumbDrag || thumbDrag.pointerId !== event.pointerId) {
        return;
      }

      thumbDrag = null;
      thumb.classList.remove("is-dragging");
    });

    return {
      element: wrapper,
      playhead
    };
  }

  function rowUsesStft(kind) {
    return (
      kind === "stft" ||
      kind === "mel" ||
      kind === "mfcc" ||
      kind === "dct" ||
      kind === "custom_filterbank"
    );
  }

  function rowUsesMel(kind) {
    return kind === "mel" || kind === "mfcc";
  }

  function onRowParamsChanged() {
    clearDerivedCache();
    renderTransformStack();
    postState();
  }

  function makeRowSettingLabel(text) {
    const label = document.createElement("label");
    label.className = "stack-row-settings-label";
    label.textContent = text;
    return label;
  }

  function addRowSettingNumber(container, text, value, min, max, step, onChange) {
    const label = makeRowSettingLabel(text);
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.className = "stack-row-settings-input";
    input.addEventListener("change", function () {
      onChange(Number(input.value));
    });
    label.appendChild(input);
    container.appendChild(label);
  }

  function addRowSettingSelect(container, text, value, options, onChange) {
    const label = makeRowSettingLabel(text);
    const select = document.createElement("select");
    select.className = "stack-row-settings-input";

    options.forEach(function (optionDef) {
      const option = document.createElement("option");
      option.value = String(optionDef.value);
      option.textContent = optionDef.label;
      if (String(optionDef.value) === String(value)) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    select.addEventListener("change", function () {
      onChange(select.value);
    });

    label.appendChild(select);
    container.appendChild(label);
  }

  function buildRowSettingsPanel(item) {
    ensureStackItemParams(item);

    const panel = document.createElement("div");
    panel.className = "stack-row-settings";

    if (!rowUsesStft(item.kind)) {
      const note = document.createElement("div");
      note.className = "stack-row-settings-note";
      note.textContent =
        item.kind === "timeseries"
          ? "No per-row transform hyperparameters for timeseries."
          : "No extra settings for this row.";
      panel.appendChild(note);
      return panel;
    }

    if (rowUsesStft(item.kind)) {
      const stftParams = getItemStftParams(item);
      if (item.kind === "stft") {
        addRowSettingSelect(
          panel,
          "STFT mode",
          stftParams.mode,
          STFT_MODES.map(function (mode) {
            return {
              value: mode,
              label: mode
            };
          }),
          function (nextValue) {
            item.params.stft.mode = nextValue;
            onRowParamsChanged();
          }
        );
      }
      addRowSettingSelect(
        panel,
        "Window size",
        stftParams.windowSize,
        STFT_WINDOW_SIZE_OPTIONS.map(function (size) {
          return { value: size, label: String(size) };
        }),
        function (nextValue) {
          item.params.stft.windowSize = Number(nextValue);
          onRowParamsChanged();
        }
      );
      addRowSettingNumber(panel, "Overlap (%)", stftParams.overlapPercent, 0, 95, 1, function (nextValue) {
        item.params.stft.overlapPercent = nextValue;
        onRowParamsChanged();
      });
      addRowSettingSelect(
        panel,
        "Window type",
        stftParams.windowType,
        STFT_WINDOW_TYPES.map(function (windowType) {
          return {
            value: windowType,
            label: windowType
          };
        }),
        function (nextValue) {
          item.params.stft.windowType = nextValue;
          onRowParamsChanged();
        }
      );
      addRowSettingNumber(
        panel,
        "Max analysis seconds",
        stftParams.maxAnalysisSeconds,
        1,
        600,
        1,
        function (nextValue) {
          item.params.stft.maxAnalysisSeconds = nextValue;
          onRowParamsChanged();
        }
      );
      addRowSettingNumber(
        panel,
        "Max frames",
        stftParams.maxFrames,
        32,
        MAX_STFT_FRAMES,
        1,
        function (nextValue) {
          item.params.stft.maxFrames = nextValue;
          onRowParamsChanged();
        }
      );
    }

    if (rowUsesMel(item.kind)) {
      const melParams = getItemMelParams(item, primaryAudio ? primaryAudio.sampleRate : 16000);
      addRowSettingNumber(panel, "Mel bands", melParams.bands, 8, 256, 1, function (nextValue) {
        item.params.mel.bands = nextValue;
        onRowParamsChanged();
      });
      addRowSettingNumber(panel, "Mel min Hz", Math.round(melParams.minHz), 0, 20000, 1, function (nextValue) {
        item.params.mel.minHz = nextValue;
        onRowParamsChanged();
      });
      addRowSettingNumber(panel, "Mel max Hz", Math.round(melParams.maxHz), 1, 24000, 1, function (nextValue) {
        item.params.mel.maxHz = nextValue;
        onRowParamsChanged();
      });
    }

    if (item.kind === "mfcc") {
      const mfccParams = getItemMfccParams(item, 128);
      addRowSettingNumber(panel, "MFCC coeffs", mfccParams.coeffs, 2, 128, 1, function (nextValue) {
        item.params.mfcc.coeffs = nextValue;
        onRowParamsChanged();
      });
    }

    if (item.kind === "dct") {
      const dctParams = getItemDctParams(item, 256);
      addRowSettingNumber(panel, "DCT coeffs", dctParams.coeffs, 2, 256, 1, function (nextValue) {
        item.params.dct.coeffs = nextValue;
        onRowParamsChanged();
      });
    }

    if (item.kind === "custom_filterbank") {
      const note = document.createElement("div");
      note.className = "stack-row-settings-note";
      note.textContent = "Custom filterbank uses STFT settings above plus uploaded CSV weights.";
      panel.appendChild(note);
    }

    return panel;
  }

  function renderStackControls() {
    stackList.innerHTML = "";
    const atCapacity = state.stack.length >= MAX_STACK_ITEMS;
    addTransformButton.disabled = atCapacity;
    addTransformButton.title = atCapacity
      ? "Maximum of " + MAX_STACK_ITEMS + " views reached."
      : "Add View";

    state.stack.forEach(function (item, index) {
      ensureStackItemParams(item);

      const row = document.createElement("li");
      row.className = "stack-item";
      row.draggable = true;
      row.dataset.index = String(index);
      let suppressDragStart = false;

      const markSuppressDragStart = function () {
        suppressDragStart = true;
      };
      const clearSuppressDragStartSoon = function () {
        window.setTimeout(function () {
          suppressDragStart = false;
        }, 0);
      };

      row.addEventListener("dragstart", function (event) {
        if (suppressDragStart) {
          event.preventDefault();
          return;
        }

        dragIndex = index;
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(index));
        }
        row.classList.add("dragging");
      });

      row.addEventListener("dragend", function () {
        dragIndex = null;
        row.classList.remove("dragging");
        row.classList.remove("drag-over");
      });

      row.addEventListener("dragover", function (event) {
        event.preventDefault();
        row.classList.add("drag-over");
      });

      row.addEventListener("dragleave", function () {
        row.classList.remove("drag-over");
      });

      row.addEventListener("drop", function (event) {
        event.preventDefault();
        row.classList.remove("drag-over");

        if (dragIndex === null) {
          return;
        }

        swapStackItems(dragIndex, index);
        renderStackControls();
        renderTransformStack();
        postState();
      });

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "drag-handle";
      handle.textContent = "|||";
      handle.title = "Drag to reorder";
      handle.setAttribute("aria-label", "Drag to reorder");

      const transformSelect = document.createElement("select");
      transformSelect.className = "transform-select";
      transformKinds.forEach(function (kindOption) {
        const option = document.createElement("option");
        option.value = kindOption.value;
        option.textContent = kindOption.label;
        if (kindOption.value === getTransformSelectorValue(item)) {
          option.selected = true;
        }
        transformSelect.appendChild(option);
      });

      const applyTransformSelection = function () {
        if (transformSelect.value.indexOf("stft::") === 0) {
          const mode = transformSelect.value.split("::")[1] === "phase" ? "phase" : "magnitude";
          item.kind = "stft";
          item.params = createDefaultParamsForKind("stft", mode);
        } else {
          item.kind = transformSelect.value;
          item.params = createDefaultParamsForKind(item.kind);
        }
        clearDerivedCache();
        renderStackControls();
        renderTransformStack();
        postState();
      };

      transformSelect.addEventListener("pointerdown", markSuppressDragStart);
      transformSelect.addEventListener("mousedown", markSuppressDragStart);
      transformSelect.addEventListener("touchstart", markSuppressDragStart, { passive: true });
      transformSelect.addEventListener("focus", markSuppressDragStart);
      transformSelect.addEventListener("blur", clearSuppressDragStartSoon);
      transformSelect.addEventListener("change", function () {
        applyTransformSelection();
        clearSuppressDragStartSoon();
      });
      transformSelect.addEventListener("input", applyTransformSelection);

      const settingsButton = document.createElement("button");
      settingsButton.type = "button";
      settingsButton.className = "row-settings-button";
      settingsButton.textContent = expandedRowSettingsIds.has(item.id) ? "Hide Settings" : "Settings";
      settingsButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        suppressDragStart = true;
        if (expandedRowSettingsIds.has(item.id)) {
          expandedRowSettingsIds.delete(item.id);
        } else {
          expandedRowSettingsIds.add(item.id);
        }
        renderStackControls();
      });

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "remove-button";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", function () {
        suppressDragStart = true;
        state.stack.splice(index, 1);
        expandedRowSettingsIds.delete(item.id);
        renderStackControls();
        renderTransformStack();
        postState();
      });

      row.appendChild(handle);
      row.appendChild(transformSelect);
      row.appendChild(settingsButton);
      row.appendChild(removeButton);

      if (expandedRowSettingsIds.has(item.id)) {
        const settingsPanel = buildRowSettingsPanel(item);
        row.appendChild(settingsPanel);
      }
      stackList.appendChild(row);
    });
  }

  function drawNoOverlapPlaceholder(canvas, message) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255,255,255,0.20)";
    ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
    ctx.fillStyle = "rgba(255,255,255,0.74)";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(message || "No overlap in current window", canvas.width / 2, canvas.height / 2);
  }

  function drawPanelCanvasForComparisonRole(
    role,
    canvas,
    primaryRenderSpec,
    secondaryRenderSpec,
    windowInfo,
    offsetSeconds
  ) {
    if (role === "primary") {
      if (primaryRenderSpec.type === "waveform") {
        drawWaveform(
          canvas,
          primaryRenderSpec.samples,
          windowInfo.startIndex,
          windowInfo.endIndex,
          windowInfo.zoom
        );
      } else {
        drawHeatmap(
          canvas,
          primaryRenderSpec.matrix,
          windowInfo.startIndex,
          windowInfo.endIndex,
          primaryRenderSpec.valueRange
        );
      }
      return;
    }

    if (!secondaryRenderSpec) {
      drawNoOverlapPlaceholder(canvas, "Load second clip for comparison");
      return;
    }

    if (role === "secondary") {
      const secondaryWindow = mapPrimaryWindowToSecondaryWindow(
        primaryRenderSpec,
        secondaryRenderSpec,
        windowInfo,
        offsetSeconds
      );

      if (!secondaryWindow.hasOverlap) {
        drawNoOverlapPlaceholder(canvas, "No overlap at current offset");
        return;
      }

      if (secondaryRenderSpec.type === "waveform") {
        drawWaveform(
          canvas,
          secondaryRenderSpec.samples,
          secondaryWindow.startIndex,
          secondaryWindow.endIndex,
          windowInfo.zoom,
          {
            strokeColor: "#f472b6",
            pointColor: "#f9a8d4"
          }
        );
      } else {
        drawHeatmap(
          canvas,
          secondaryRenderSpec.matrix,
          secondaryWindow.startIndex,
          secondaryWindow.endIndex,
          secondaryRenderSpec.valueRange
        );
      }
      return;
    }

    if (role === "overlay") {
      if (primaryRenderSpec.type === "waveform") {
        drawWaveformOverlayComparison(
          canvas,
          primaryRenderSpec,
          secondaryRenderSpec,
          windowInfo,
          offsetSeconds
        );
      } else {
        drawHeatmapOverlayComparison(
          canvas,
          primaryRenderSpec,
          secondaryRenderSpec,
          windowInfo,
          offsetSeconds
        );
      }
      return;
    }

    if (role === "difference") {
      if (primaryRenderSpec.type === "waveform") {
        drawWaveformDifferenceComparison(
          canvas,
          primaryRenderSpec,
          secondaryRenderSpec,
          windowInfo,
          offsetSeconds
        );
      } else {
        drawHeatmapDifferenceComparison(
          canvas,
          primaryRenderSpec,
          secondaryRenderSpec,
          windowInfo,
          offsetSeconds
        );
      }
    }
  }

  function renderTransformStack() {
    cleanupViewStateCache();
    playheadElementsByViewId.clear();
    renderStackContainer.innerHTML = "";

    if (state.stack.length === 0) {
      const empty = document.createElement("div");
      empty.className = "transform-empty";
      empty.textContent = "No transform views selected. Add one with \"Add View\".";
      renderStackContainer.appendChild(empty);
      renderMetricsReport();
      return;
    }

    for (let index = 0; index < state.stack.length; index += 1) {
      const item = state.stack[index];
      const card = document.createElement("article");
      card.className = "transform-card" + (selectedViewId === item.id ? " is-selected" : "");

      const header = document.createElement("header");
      header.className = "transform-card-header";

      const title = document.createElement("div");
      title.className = "transform-card-title";
      title.textContent = (index + 1).toString() + ". " + getTransformDisplayLabel(item);

      const meta = document.createElement("div");
      meta.className = "transform-card-meta";

      try {
        meta.textContent = transformMetaLabel(item);
      } catch {
        meta.textContent = "Awaiting transform data";
      }

      header.appendChild(title);
      header.appendChild(meta);

      const body = document.createElement("div");
      body.className = "transform-card-body";

      try {
        const primaryRenderSpec = buildTransformRenderSpec(item);
        const activeComparisonMode =
          state.comparison.mode !== "none" && comparisonAudioData ? state.comparison.mode : "none";
        const offsetSeconds = sanitizeFloat(state.comparison.offsetSeconds, 0, -30, 30);
        const secondaryRenderSpec =
          activeComparisonMode === "none"
            ? null
            : buildTransformRenderSpecForAudio(
                item,
                comparisonAudioData,
                comparisonDerivedCache,
                "second clip"
              );

        const panelDescriptors =
          activeComparisonMode === "none"
            ? [{ role: "primary", label: "Primary" }]
            : activeComparisonMode === "overlay"
              ? [{ role: "overlay", label: "Primary + Second Overlay" }]
              : activeComparisonMode === "side_by_side" || activeComparisonMode === "stacked"
                ? [
                    { role: "primary", label: "Primary" },
                    { role: "secondary", label: "Second" }
                  ]
                : [
                    { role: "primary", label: "Primary" },
                    { role: "secondary", label: "Second" },
                    { role: "difference", label: "Difference (Primary - Second)" }
                  ];

        const toolbar = buildTransformToolbar(item, primaryRenderSpec);
        body.appendChild(toolbar);

        const grid = document.createElement("div");
        grid.className = "transform-comparison-grid mode-" + activeComparisonMode;
        const panelWidthDivisor = getCanvasWidthPanelDivisor(
          activeComparisonMode,
          panelDescriptors.length
        );

        const windowInfo = computeViewWindow(primaryRenderSpec.domainLength, item.id);
        const viewportPlayheads = [];

        panelDescriptors.forEach(function (panel) {
          const panelWrap = document.createElement("section");
          panelWrap.className = "comparison-panel";

          if (panelDescriptors.length > 1) {
            const panelLabel = document.createElement("p");
            panelLabel.className = "comparison-panel-label";
            panelLabel.textContent = panel.label;
            panelWrap.appendChild(panelLabel);
          }

          const viewport = document.createElement("div");
          viewport.className = "transform-viewport";

          const canvas = document.createElement("canvas");
          canvas.className = "transform-canvas";
          canvas.width = pickCanvasWidth(panelWidthDivisor);
          canvas.height =
            primaryRenderSpec.type === "waveform" ? WAVEFORM_CANVAS_HEIGHT : MATRIX_CANVAS_HEIGHT;

          drawPanelCanvasForComparisonRole(
            panel.role,
            canvas,
            primaryRenderSpec,
            secondaryRenderSpec,
            windowInfo,
            offsetSeconds
          );

          if (panel.role !== "secondary") {
            drawActivationOverlay(canvas, primaryRenderSpec, windowInfo);
          }

          attachCanvasInteractions(canvas, item, primaryRenderSpec);

          const viewportPlayhead = document.createElement("div");
          viewportPlayhead.className = "transform-playhead";
          viewportPlayheads.push(viewportPlayhead);

          viewport.appendChild(canvas);
          viewport.appendChild(viewportPlayhead);
          panelWrap.appendChild(viewport);
          grid.appendChild(panelWrap);
        });

        body.appendChild(grid);

        const scrollbar = buildTransformScrollbar(item, primaryRenderSpec);
        body.appendChild(scrollbar.element);

        if (primaryRenderSpec.type === "waveform") {
          const waveformBar = buildTimeseriesBar(primaryRenderSpec, windowInfo);
          body.appendChild(waveformBar);

          const timeseriesStats = buildTimeseriesStatsPanel(primaryRenderSpec, windowInfo);
          body.appendChild(timeseriesStats);
        }

        if (primaryRenderSpec.type === "matrix" && shouldShowSpectralBar(item.id)) {
          const spectralBar = buildSpectralBar(primaryRenderSpec, windowInfo);
          body.appendChild(spectralBar);
        }

        playheadElementsByViewId.set(item.id, {
          viewportPlayheads,
          scrollbarPlayhead: scrollbar.playhead,
          domainLength: primaryRenderSpec.domainLength,
          durationSeconds: primaryRenderSpec.durationSeconds
        });

        const caption = document.createElement("p");
        caption.className = "transform-caption";
        if (activeComparisonMode === "none") {
          caption.textContent = primaryRenderSpec.caption;
        } else {
          caption.textContent =
            primaryRenderSpec.caption +
            " | comparison=" +
            activeComparisonMode +
            ", offset=" +
            offsetSeconds.toFixed(2) +
            " s";
        }
        body.appendChild(caption);
      } catch (error) {
        const empty = document.createElement("div");
        empty.className = "transform-empty";
        empty.textContent = toErrorText(error);
        body.appendChild(empty);
      }

      card.appendChild(header);
      card.appendChild(body);
      renderStackContainer.appendChild(card);
    }

    updateAnimatedPlayheads();
    renderMetricsReport();
  }

  function updateAnimatedPlayheads() {
    if (!primaryAudio || primaryAudio.duration <= 0) {
      playheadElementsByViewId.forEach(function (entry) {
        entry.viewportPlayheads.forEach(function (playhead) {
          playhead.style.opacity = "0";
        });
        entry.scrollbarPlayhead.style.left = "0%";
      });
      return;
    }

    const globalRatio = clamp(
      primaryAudioPlayer.currentTime / Math.max(1e-9, primaryAudio.duration),
      0,
      1
    );

    playheadElementsByViewId.forEach(function (entry, viewId) {
      const windowInfo = computeViewWindow(entry.domainLength, viewId);
      const globalIndex = globalRatio * Math.max(1, entry.domainLength - 1);
      const localRatio =
        (globalIndex - windowInfo.startIndex) / Math.max(1, windowInfo.visibleCount - 1);

      entry.viewportPlayheads.forEach(function (playhead) {
        if (localRatio >= 0 && localRatio <= 1) {
          playhead.style.opacity = "1";
          playhead.style.left = (localRatio * 100).toFixed(4) + "%";
        } else {
          playhead.style.opacity = "0";
        }
      });

      entry.scrollbarPlayhead.style.left = (globalRatio * 100).toFixed(4) + "%";
    });
  }

  function playheadAnimationTick() {
    playheadFrameToken = 0;
    updateAnimatedPlayheads();

    if (!primaryAudioPlayer.paused && !primaryAudioPlayer.ended) {
      playheadFrameToken = window.requestAnimationFrame(playheadAnimationTick);
    }
  }

  function startPlayheadAnimation() {
    if (playheadFrameToken) {
      return;
    }

    playheadFrameToken = window.requestAnimationFrame(playheadAnimationTick);
  }

  function stopPlayheadAnimation() {
    if (playheadFrameToken) {
      window.cancelAnimationFrame(playheadFrameToken);
      playheadFrameToken = 0;
    }

    updateAnimatedPlayheads();
  }

  addTransformButton.addEventListener("click", function () {
    if (state.stack.length >= MAX_STACK_ITEMS) {
      setAudioStatus(
        "View limit reached (" + MAX_STACK_ITEMS + "). Remove a view before adding another."
      );
      return;
    }
    state.stack.push(nextStackItem());
    renderStackControls();
    renderTransformStack();
    postState();
  });

  primaryAudioFileInput.addEventListener("change", function () {
    void onPrimaryAudioSelected();
  });

  primaryAudioPlayer.addEventListener("play", startPlayheadAnimation);
  primaryAudioPlayer.addEventListener("pause", stopPlayheadAnimation);
  primaryAudioPlayer.addEventListener("ended", stopPlayheadAnimation);
  primaryAudioPlayer.addEventListener("timeupdate", updateAnimatedPlayheads);
  primaryAudioPlayer.addEventListener("seeked", updateAnimatedPlayheads);

  customFilterbankInput.addEventListener("change", function () {
    void onCustomFilterbankSelected();
  });

  window.addEventListener("message", function (event) {
    const message = asRecord(event.data);
    if (!message || typeof message.type !== "string") {
      return;
    }

    if (message.type === "preloadAudio") {
      const payload = asRecord(message.payload);
      if (!payload) {
        return;
      }

      const payloadUri = sanitizeWebviewAudioUri(payload.uri);
      const payloadName = sanitizeStringValue(payload.name, MAX_TEXT_FIELD_CHARS);
      if (!payloadUri || !payloadName) {
        return;
      }

      void preloadAudioFromWebviewUri(payloadUri, payloadName).catch(function (error) {
        setAudioStatus("Failed to preload workspace audio: " + toErrorText(error));
      });
      return;
    }

    if (message.type === "unlockAudioPicker") {
      setPrimaryAudioInputLocked(false, "");
      return;
    }

    if (message.type === "applyPreset") {
      const payload = asRecord(message.payload);
      if (!payload) {
        return;
      }

      const presetId = sanitizeStringValue(payload.presetId, 64);
      if (!presetId || WORKSPACE_PRESET_IDS.indexOf(presetId) === -1) {
        return;
      }

      applyWorkspacePreset(presetId);
    }
  });

  overlayEnabled.addEventListener("change", function () {
    state.overlay.enabled = overlayEnabled.checked;
    renderTransformStack();
    postState();
  });

  overlayMode.addEventListener("change", function () {
    state.overlay.mode = overlayMode.value;
    overlayFlagColor.disabled = state.overlay.mode !== "flag";
    void reparseOverlayCsvIfPresent().finally(function () {
      updateOverlayCsvHint();
    });
    renderTransformStack();
    postState();
  });

  overlayCsv.addEventListener("change", function () {
    const file = overlayCsv.files && overlayCsv.files[0] ? overlayCsv.files[0] : null;
    state.overlay.csvName = file ? file.name : null;
    void parseOverlayCsvFromInputFile(file);
  });

  overlayFlagColor.addEventListener("input", function () {
    state.overlay.flagColor = sanitizeHexColor(overlayFlagColor.value, DEFAULT_FLAG_OVERLAY_COLOR);
    overlayFlagColor.value = state.overlay.flagColor;
    renderTransformStack();
    postState();
  });

  comparisonMode.value = state.comparison.mode;
  comparisonMode.addEventListener("change", function () {
    state.comparison.mode = comparisonMode.value;
    comparisonOffsetSeconds.disabled = state.comparison.mode === "none";
    if (state.comparison.mode === "none") {
      setComparisonStatus("Comparison disabled.");
    } else if (!comparisonAudioData) {
      setComparisonStatus("Select a second clip to render " + state.comparison.mode + " mode.");
    }
    renderTransformStack();
    postState();
  });

  comparisonAudio.addEventListener("change", function () {
    const file = comparisonAudio.files && comparisonAudio.files[0] ? comparisonAudio.files[0] : null;
    state.comparison.secondAudioName = file ? file.name : null;
    void onComparisonAudioSelected();
    postState();
  });

  comparisonOffsetSeconds.addEventListener("change", function () {
    state.comparison.offsetSeconds = sanitizeFloat(comparisonOffsetSeconds.value, 0, -30, 30);
    comparisonOffsetSeconds.value = Number(state.comparison.offsetSeconds).toFixed(2);
    renderTransformStack();
    postState();
  });

  stftWindowSize.addEventListener("change", function () {
    state.transformParams.stft.windowSize = Number(stftWindowSize.value);
    onTransformParamsChanged();
  });

  stftOverlapPercent.addEventListener("change", function () {
    state.transformParams.stft.overlapPercent = Number(stftOverlapPercent.value);
    onTransformParamsChanged();
  });

  stftWindowType.addEventListener("change", function () {
    state.transformParams.stft.windowType = stftWindowType.value;
    onTransformParamsChanged();
  });

  stftMaxAnalysisSeconds.addEventListener("change", function () {
    state.transformParams.stft.maxAnalysisSeconds = Number(stftMaxAnalysisSeconds.value);
    onTransformParamsChanged();
  });

  stftMaxFrames.addEventListener("change", function () {
    state.transformParams.stft.maxFrames = Number(stftMaxFrames.value);
    onTransformParamsChanged();
  });

  melBands.addEventListener("change", function () {
    state.transformParams.mel.bands = Number(melBands.value);
    onTransformParamsChanged();
  });

  melMinHz.addEventListener("change", function () {
    state.transformParams.mel.minHz = Number(melMinHz.value);
    onTransformParamsChanged();
  });

  melMaxHz.addEventListener("change", function () {
    state.transformParams.mel.maxHz = Number(melMaxHz.value);
    onTransformParamsChanged();
  });

  mfccCoeffs.addEventListener("change", function () {
    state.transformParams.mfcc.coeffs = Number(mfccCoeffs.value);
    onTransformParamsChanged();
  });

  dctCoeffs.addEventListener("change", function () {
    state.transformParams.dct.coeffs = Number(dctCoeffs.value);
    onTransformParamsChanged();
  });

  metricAudio.addEventListener("change", function () {
    state.metrics.audio = metricAudio.checked;
    renderMetricsReport();
    postState();
  });

  metricSpeech.addEventListener("change", function () {
    state.metrics.speech = metricSpeech.checked;
    renderMetricsReport();
    postState();
  });

  metricStatistical.addEventListener("change", function () {
    state.metrics.statistical = metricStatistical.checked;
    renderMetricsReport();
    postState();
  });

  metricDistributional.addEventListener("change", function () {
    state.metrics.distributional = metricDistributional.checked;
    renderMetricsReport();
    postState();
  });

  metricClasswise.addEventListener("change", function () {
    state.metrics.classwise = metricClasswise.checked;
    renderMetricsReport();
    postState();
  });

  featurePower.addEventListener("change", function () {
    state.features.power = featurePower.checked;
    renderMetricsReport();
    postState();
  });

  featureAutocorrelation.addEventListener("change", function () {
    state.features.autocorrelation = featureAutocorrelation.checked;
    renderMetricsReport();
    postState();
  });

  featureShorttimePower.addEventListener("change", function () {
    state.features.shortTimePower = featureShorttimePower.checked;
    renderMetricsReport();
    postState();
  });

  featureShorttimeAutocorrelation.addEventListener("change", function () {
    state.features.shortTimeAutocorrelation = featureShorttimeAutocorrelation.checked;
    renderMetricsReport();
    postState();
  });

  metricsExportJson.addEventListener("click", function () {
    const report = getPrimaryMetricsReport();
    if (!report) {
      setAudioStatus("No decoded primary audio loaded for metrics export.");
      return;
    }

    try {
      const payload = buildMetricsExportModel(report);
      const json = JSON.stringify(payload, null, 2);
      triggerTextDownload(metricsExportBaseName() + "-metrics.json", "application/json", json);
      metricsStatus.textContent = "Exported metrics JSON.";
    } catch (error) {
      metricsStatus.textContent = "Failed to export JSON: " + toErrorText(error);
    }
  });

  metricsExportCsv.addEventListener("click", function () {
    const report = getPrimaryMetricsReport();
    if (!report) {
      setAudioStatus("No decoded primary audio loaded for metrics export.");
      return;
    }

    try {
      const payload = buildMetricsExportModel(report);
      const csv = buildMetricsCsv(payload);
      triggerTextDownload(metricsExportBaseName() + "-metrics.csv", "text/csv", csv);
      metricsStatus.textContent = "Exported metrics CSV.";
    } catch (error) {
      metricsStatus.textContent = "Failed to export CSV: " + toErrorText(error);
    }
  });

  pcaEnabled.addEventListener("change", function () {
    state.pca.enabled = pcaEnabled.checked;
    postState();
  });

  pcaGoal.addEventListener("change", function () {
    state.pca.goal = pcaGoal.value;
    updatePcaGuidance();
    postState();
  });

  pcaClasswise.addEventListener("change", function () {
    state.pca.classwise = pcaClasswise.checked;
    postState();
  });

  multichannelEnabled.addEventListener("change", function () {
    state.multichannel.enabled = multichannelEnabled.checked;
    postState();
  });

  multichannelSplit.addEventListener("change", function () {
    state.multichannel.splitViewsByChannel = multichannelSplit.checked;
    postState();
  });

  window.addEventListener("resize", scheduleRenderTransformStack);

  syncControlsFromState();
  if (state.comparison.secondAudioName) {
    setComparisonStatus(
      "Second clip remembered as " +
        state.comparison.secondAudioName +
        ". Re-select it to decode for this session."
    );
  } else {
    setComparisonStatus("Load a second clip to enable comparison rendering.");
  }
  setPrimaryAudioInputLocked(false, "");
  parseOverlayCsvFromPersistedText();
  renderStackControls();
  renderTransformStack();
  postState();
  vscode.postMessage({ type: "ready" });
})();

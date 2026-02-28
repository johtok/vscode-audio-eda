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
    { value: "tempogram", label: "tempogram" },
    { value: "fourier_tempogram", label: "fourier_tempogram" },
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
  const STACK_ITEM_KINDS = [
    "timeseries",
    "stft",
    "mel",
    "mfcc",
    "dct",
    "tempogram",
    "fourier_tempogram",
    "custom_filterbank"
  ];
  const OVERLAY_MODES = ["flag", "timestamped"];
  const ANALYSIS_TOOLS = ["rcluster", "random_forest", "castor", "spf"];
  const WORKSPACE_PRESET_IDS = ["default", "transforms", "metrics", "pca"];
  const DEFAULT_FLAG_OVERLAY_COLOR = "#ef4444";
  const MAX_STACK_ITEMS = 24;
  const MAX_RESTORED_STACK_SCAN = MAX_STACK_ITEMS * 4;
  const MAX_LOCAL_WEBVIEW_STATE_BYTES = 1000000;
  const MAX_TEXT_FIELD_CHARS = 256;
  const MAX_PERSISTED_OVERLAY_CSV_CHARS = 500000;
  const MAX_STFT_FRAMES = 2000;
  const MAX_COMPARISON_TRIM_SECONDS = 86400;
  const MAX_AUDIO_DECODE_BYTES = 128 * 1024 * 1024;
  const MAX_DECODED_PCM_BYTES = 256 * 1024 * 1024;
  const MAX_OVERLAY_CSV_INPUT_BYTES = 2 * 1024 * 1024;
  const MAX_OVERLAY_CSV_ROWS = 200000;
  const MAX_OVERLAY_CSV_COLUMNS = 64;
  const MAX_FILTERBANK_CSV_INPUT_BYTES = 2 * 1024 * 1024;
  const MAX_FILTERBANK_ROWS = 2048;
  const MAX_FILTERBANK_COLUMNS = 8192;
  const RCLUSTER_MAX_ROWS = 2500;
  const RCLUSTER_MAX_COLUMNS = 256;
  const RANDOM_FOREST_MAX_ROWS = 4000;
  const RANDOM_FOREST_MAX_COLUMNS = 384;
  const RANDOM_FOREST_MIN_CLASS_FRAMES = 4;
  const CASTOR_MAX_ROWS = 4000;
  const CASTOR_MAX_SEQUENCE_LENGTH = 512;
  const METRICS_HISTOGRAM_BINS = 128;
  const METRICS_HISTOGRAM_RANGE_MIN = -10;
  const METRICS_HISTOGRAM_RANGE_MAX = 10;
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
  const MAX_PCA_FRAMES = 1200;
  const MAX_PCA_FEATURES = 96;
  const MAX_PCA_COMPONENTS = 6;
  const PCA_POWER_ITERATIONS = 24;
  const PCA_VIRTUAL_VIEW_ID = "__pca_feature_view__";
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
    comparison: {
      mode: "none",
      secondAudioName: null,
      offsetSeconds: 0,
      trimStartSeconds: 0,
      trimDurationSeconds: 0
    },
    metrics: {
      audio: true,
      speech: false,
      statistical: true,
      distributional: true,
      classwise: false,
      histogramBins: METRICS_HISTOGRAM_BINS,
      histogramRangeMin: -1,
      histogramRangeMax: 1
    },
    features: {
      power: true,
      autocorrelation: true,
      shortTimePower: false,
      shortTimeAutocorrelation: false
    },
    pca: { enabled: false, goal: "eda", classwise: false, componentSelection: null },
    analysis: { tool: "random_forest" },
    multichannel: { enabled: false, splitViewsByChannel: true, analysisChannelIndex: 0 },
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
  ensureAnalysisState();
  ensureTransformParamState();
  normalizeLegacyTransformKinds();
  normalizeStackItems();

  const stackList = byId("stack-list");
  const stackReorderHint = byId("stack-reorder-hint");
  const stackA11yStatus = byId("stack-a11y-status");
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
  const comparisonTrimStartSeconds = byId("comparison-trim-start-seconds");
  const comparisonTrimDurationSeconds = byId("comparison-trim-duration-seconds");
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
  const metricsHistogramBinsInput = byId("metrics-histogram-bins");
  const metricsHistogramRangeMinInput = byId("metrics-histogram-range-min");
  const metricsHistogramRangeMaxInput = byId("metrics-histogram-range-max");
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
  const pcaComponents = byId("pca-components");
  const pcaGuidance = byId("pca-guidance");
  const analysisToolSelect = byId("analysis-tool-select");
  const analysisPanelRcluster = byId("analysis-panel-rcluster");
  const analysisPanelRandomForest = byId("analysis-panel-random-forest");
  const analysisPanelCastor = byId("analysis-panel-castor");
  const analysisPanelSpf = byId("analysis-panel-spf");

  const multichannelEnabled = byId("multichannel-enabled");
  const multichannelSplit = byId("multichannel-split");
  const multichannelAnalysisChannel = byId("multichannel-analysis-channel");
  const multichannelNote = byId("multichannel-note");
  const multichannelEnabledRow = byId("multichannel-enabled-row");
  const multichannelSplitRow = byId("multichannel-split-row");
  const multichannelAnalysisRow = byId("multichannel-analysis-row");

  const rclusterRepresentation = byId("rcluster-representation");
  const rclusterFeaturePath = byId("rcluster-feature-path");
  const rclusterLabelsPath = byId("rcluster-labels-path");
  const rclusterK = byId("rcluster-k");
  const rclusterSeed = byId("rcluster-seed");
  const rclusterMaxIter = byId("rcluster-max-iter");
  const rclusterStabilityRuns = byId("rcluster-stability-runs");
  const rclusterRowRatio = byId("rcluster-row-ratio");
  const rclusterFeatureRatio = byId("rcluster-feature-ratio");
  const rclusterRun = byId("rcluster-run");
  const rclusterProgress = byId("rcluster-progress");
  const rclusterStatus = byId("rcluster-status");
  const rclusterResults = byId("rcluster-results");
  const rfSource = byId("rf-source");
  const rfFeatureHint = byId("rf-feature-hint");
  const rfLabelHint = byId("rf-label-hint");
  const rfTreeCount = byId("rf-tree-count");
  const rfMaxDepth = byId("rf-max-depth");
  const rfMinLeaf = byId("rf-min-leaf");
  const rfFeatureRatio = byId("rf-feature-ratio");
  const rfMaxFrames = byId("rf-max-frames");
  const rfTopFeatures = byId("rf-top-features");
  const rfRun = byId("rf-run");
  const rfProgress = byId("rf-progress");
  const rfStatus = byId("rf-status");
  const rfResults = byId("rf-results");
  const castorSource = byId("castor-source");
  const castorFeatureHint = byId("castor-feature-hint");
  const castorLabelHint = byId("castor-label-hint");
  const castorPreset = byId("castor-preset");
  const castorMaxFrames = byId("castor-max-frames");
  const castorPadLength = byId("castor-pad-length");
  const castorTopDims = byId("castor-top-dims");
  const castorNormalize = byId("castor-normalize");
  const castorRun = byId("castor-run");
  const castorProgress = byId("castor-progress");
  const castorStatus = byId("castor-status");
  const castorResults = byId("castor-results");

  const spfSource = byId("spf-source");
  const spfFeatureHint = byId("spf-feature-hint");
  const spfLabelHint = byId("spf-label-hint");
  const spfAlphabetSize = byId("spf-alphabet-size");
  const spfWordLength = byId("spf-word-length");
  const spfMaxFrames = byId("spf-max-frames");
  const spfTopPatterns = byId("spf-top-patterns");
  const spfForestTrees = byId("spf-forest-trees");
  const spfRun = byId("spf-run");
  const spfProgress = byId("spf-progress");
  const spfStatus = byId("spf-status");
  const spfResults = byId("spf-results");

  let dragIndex = null;
  let pendingStackHandleFocusId = null;
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
  let rClusterRepresentationMode = "mel";
  let rClusterResult = null;
  let rClusterRunning = false;
  let rClusterProgressIntervalId = null;
  let rClusterProgressResetTimerId = null;
  let activeAnalysisTool = "random_forest";
  let randomForestSourceMode = "mel";
  let randomForestRunning = false;
  let randomForestResult = null;
  let randomForestLastRunContext = null;
  let castorSourceMode = "mel";
  let castorPresetMode = "balanced";
  let castorRunning = false;
  let castorResult = null;
  let castorLastRunContext = null;
  let spfSourceMode = "mel";
  let spfRunning = false;
  let spfResult = null;
  let spfLastRunContext = null;
  const pendingSaveTextRequests = new Map();
  let saveTextRequestCounter = 0;

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
      item.kind === "tempogram" ||
      item.kind === "fourier_tempogram" ||
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

  function sanitizeAnalysisTool(rawTool, fallback) {
    if (typeof rawTool === "string" && ANALYSIS_TOOLS.indexOf(rawTool) !== -1) {
      return rawTool;
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
        merged.comparison.trimStartSeconds = sanitizeFloat(
          comparison.trimStartSeconds,
          merged.comparison.trimStartSeconds,
          0,
          MAX_COMPARISON_TRIM_SECONDS
        );
        merged.comparison.trimDurationSeconds = sanitizeFloat(
          comparison.trimDurationSeconds,
          merged.comparison.trimDurationSeconds,
          0,
          MAX_COMPARISON_TRIM_SECONDS
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
        merged.metrics.histogramBins = sanitizeInt(
          metrics.histogramBins,
          merged.metrics.histogramBins,
          4,
          512
        );
        merged.metrics.histogramRangeMin = sanitizeFloat(
          metrics.histogramRangeMin,
          merged.metrics.histogramRangeMin,
          METRICS_HISTOGRAM_RANGE_MIN,
          METRICS_HISTOGRAM_RANGE_MAX
        );
        merged.metrics.histogramRangeMax = sanitizeFloat(
          metrics.histogramRangeMax,
          merged.metrics.histogramRangeMax,
          METRICS_HISTOGRAM_RANGE_MIN,
          METRICS_HISTOGRAM_RANGE_MAX
        );
        if (merged.metrics.histogramRangeMax <= merged.metrics.histogramRangeMin) {
          if (merged.metrics.histogramRangeMin >= METRICS_HISTOGRAM_RANGE_MAX) {
            merged.metrics.histogramRangeMin = METRICS_HISTOGRAM_RANGE_MAX - 0.001;
          }
          merged.metrics.histogramRangeMax = Math.min(
            METRICS_HISTOGRAM_RANGE_MAX,
            merged.metrics.histogramRangeMin + 0.001
          );
        }
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
        merged.pca.componentSelection = sanitizeStringValue(pca.componentSelection, 128);
      }

      const analysis = asRecord(restoredState.analysis);
      if (analysis) {
        merged.analysis.tool = sanitizeAnalysisTool(analysis.tool, merged.analysis.tool);
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
        merged.multichannel.analysisChannelIndex = sanitizeInt(
          multichannel.analysisChannelIndex,
          merged.multichannel.analysisChannelIndex,
          -1,
          63
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
        offsetSeconds: 0,
        trimStartSeconds: 0,
        trimDurationSeconds: 0
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
    state.comparison.trimStartSeconds = sanitizeFloat(
      state.comparison.trimStartSeconds,
      0,
      0,
      MAX_COMPARISON_TRIM_SECONDS
    );
    state.comparison.trimDurationSeconds = sanitizeFloat(
      state.comparison.trimDurationSeconds,
      0,
      0,
      MAX_COMPARISON_TRIM_SECONDS
    );
  }

  function ensureAnalysisState() {
    if (!state.analysis || typeof state.analysis !== "object") {
      state.analysis = { tool: "random_forest" };
      return;
    }
    state.analysis.tool = sanitizeAnalysisTool(state.analysis.tool, "random_forest");
  }

  function createEmptyDerivedCache() {
    return {
      stftByKey: Object.create(null),
      onsetByKey: Object.create(null),
      melByKey: Object.create(null),
      mfccByKey: Object.create(null),
      dctByKey: Object.create(null),
      tempogramByKey: Object.create(null),
      fourierTempogramByKey: Object.create(null),
      pcaByKey: Object.create(null),
      customFilterbankByKey: Object.create(null)
    };
  }

  function getPcaVirtualViewId() {
    return PCA_VIRTUAL_VIEW_ID + "::" + state.pca.goal;
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

    if (kind === "tempogram" || kind === "fourier_tempogram") {
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

  function normalizeComparisonTrimForAudioData(audioData) {
    if (!audioData || !Number.isFinite(Number(audioData.duration))) {
      state.comparison.trimStartSeconds = sanitizeFloat(
        state.comparison.trimStartSeconds,
        0,
        0,
        MAX_COMPARISON_TRIM_SECONDS
      );
      state.comparison.trimDurationSeconds = sanitizeFloat(
        state.comparison.trimDurationSeconds,
        0,
        0,
        MAX_COMPARISON_TRIM_SECONDS
      );
      return;
    }

    const duration = Math.max(0, Number(audioData.duration));
    state.comparison.trimStartSeconds = sanitizeFloat(
      state.comparison.trimStartSeconds,
      0,
      0,
      duration
    );
    const maxDuration = Math.max(0, duration - state.comparison.trimStartSeconds);
    state.comparison.trimDurationSeconds = sanitizeFloat(
      state.comparison.trimDurationSeconds,
      0,
      0,
      maxDuration
    );
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
        "tempogram",
        "fourier_tempogram",
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

  function setComparisonControlsDisabled(disabled) {
    comparisonOffsetSeconds.disabled = disabled;
    comparisonTrimStartSeconds.disabled = disabled;
    comparisonTrimDurationSeconds.disabled = disabled;
  }

  function syncControlsFromState() {
    const histogramConfig = getMetricsHistogramConfig();
    overlayEnabled.checked = state.overlay.enabled;
    overlayMode.value = state.overlay.mode;
    overlayFlagColor.value = sanitizeHexColor(state.overlay.flagColor, DEFAULT_FLAG_OVERLAY_COLOR);
    overlayFlagColor.disabled = state.overlay.mode !== "flag";
    normalizeComparisonTrimForAudioData(comparisonAudioData);
    comparisonMode.value = state.comparison.mode;
    comparisonOffsetSeconds.value = Number(state.comparison.offsetSeconds || 0).toFixed(2);
    comparisonTrimStartSeconds.value = Number(state.comparison.trimStartSeconds || 0).toFixed(2);
    comparisonTrimDurationSeconds.value = Number(state.comparison.trimDurationSeconds || 0).toFixed(
      2
    );
    setComparisonControlsDisabled(state.comparison.mode === "none");

    metricAudio.checked = state.metrics.audio;
    metricSpeech.checked = state.metrics.speech;
    metricStatistical.checked = state.metrics.statistical;
    metricDistributional.checked = state.metrics.distributional;
    metricClasswise.checked = state.metrics.classwise;
    metricsHistogramBinsInput.value = String(histogramConfig.bins);
    metricsHistogramRangeMinInput.value = formatMetricNumber(histogramConfig.min, 3);
    metricsHistogramRangeMaxInput.value = formatMetricNumber(histogramConfig.max, 3);

    featurePower.checked = state.features.power;
    featureAutocorrelation.checked = state.features.autocorrelation;
    featureShorttimePower.checked = state.features.shortTimePower;
    featureShorttimeAutocorrelation.checked = state.features.shortTimeAutocorrelation;

    pcaEnabled.checked = state.pca.enabled;
    pcaGoal.value = state.pca.goal;
    pcaClasswise.checked = state.pca.classwise;
    pcaComponents.value = state.pca.componentSelection || "";
    state.analysis.tool = sanitizeAnalysisTool(
      state.analysis && state.analysis.tool,
      "random_forest"
    );
    activeAnalysisTool = state.analysis.tool;
    analysisToolSelect.value = activeAnalysisTool;

    updateMultichannelControlsFromAudio();

    syncTransformParamControls();
    updateOverlayCsvHint();
    updatePcaGuidance();
    updateAnalysisToolPanelVisibility();
  }

  function createPersistableStateSnapshot() {
    return mergeBootstrapState(DEFAULT_BOOTSTRAP_STATE, state);
  }

  function postState() {
    const snapshot = createPersistableStateSnapshot();

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

  function getClasswiseMetricsCacheKeyPart() {
    if (!state.overlay.enabled) {
      return "overlay:off";
    }

    if (!overlayParsed || !Array.isArray(overlayParsed.intervals)) {
      return "overlay:on:none";
    }

    const intervalSignature =
      typeof overlayParsed.signature === "string"
        ? overlayParsed.signature
        : buildIntervalSignature(overlayParsed.intervals);

    return (
      "overlay:on:" +
      (overlayParsed.mode || state.overlay.mode || "unknown") +
      ":" +
      overlayParsed.activeRows +
      ":" +
      overlayParsed.totalRows +
      ":" +
      intervalSignature
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

  function getMetricsHistogramConfig() {
    const bins = sanitizeInt(state.metrics.histogramBins, METRICS_HISTOGRAM_BINS, 4, 512);
    let min = sanitizeFloat(
      state.metrics.histogramRangeMin,
      -1,
      METRICS_HISTOGRAM_RANGE_MIN,
      METRICS_HISTOGRAM_RANGE_MAX
    );
    let max = sanitizeFloat(
      state.metrics.histogramRangeMax,
      1,
      METRICS_HISTOGRAM_RANGE_MIN,
      METRICS_HISTOGRAM_RANGE_MAX
    );

    if (max <= min) {
      if (min >= METRICS_HISTOGRAM_RANGE_MAX) {
        min = METRICS_HISTOGRAM_RANGE_MAX - 0.001;
      }
      max = Math.min(METRICS_HISTOGRAM_RANGE_MAX, min + 0.001);
      if (max <= min) {
        min = Math.max(METRICS_HISTOGRAM_RANGE_MIN, max - 0.001);
      }
    }

    state.metrics.histogramBins = bins;
    state.metrics.histogramRangeMin = min;
    state.metrics.histogramRangeMax = max;

    return { bins, min, max };
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

  function buildSampleRangesFromIntervals(intervals, sampleRate, sampleCount) {
    if (!Array.isArray(intervals) || intervals.length === 0 || sampleRate <= 0 || sampleCount <= 0) {
      return [];
    }

    const ranges = [];
    for (let index = 0; index < intervals.length; index += 1) {
      const interval = intervals[index];
      if (!interval || !Number.isFinite(interval.startSec) || !Number.isFinite(interval.endSec)) {
        continue;
      }

      const start = clamp(Math.floor(Math.min(interval.startSec, interval.endSec) * sampleRate), 0, sampleCount);
      const end = clamp(Math.ceil(Math.max(interval.startSec, interval.endSec) * sampleRate), 0, sampleCount);
      if (end <= start) {
        continue;
      }

      const last = ranges.length > 0 ? ranges[ranges.length - 1] : null;
      if (last && start <= last.end) {
        last.end = Math.max(last.end, end);
      } else {
        ranges.push({ start, end });
      }
    }

    return ranges;
  }

  function invertSampleRanges(ranges, sampleCount) {
    if (sampleCount <= 0) {
      return [];
    }

    if (!Array.isArray(ranges) || ranges.length === 0) {
      return [{ start: 0, end: sampleCount }];
    }

    const complement = [];
    let cursor = 0;
    for (let index = 0; index < ranges.length; index += 1) {
      const range = ranges[index];
      const start = clamp(range.start, 0, sampleCount);
      const end = clamp(range.end, start, sampleCount);
      if (start > cursor) {
        complement.push({ start: cursor, end: start });
      }
      cursor = Math.max(cursor, end);
    }

    if (cursor < sampleCount) {
      complement.push({ start: cursor, end: sampleCount });
    }

    return complement;
  }

  function summarizeSamplesByRanges(samples, ranges) {
    if (!samples || samples.length === 0 || !Array.isArray(ranges) || ranges.length === 0) {
      return null;
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    let sumSquares = 0;
    let clippingCount = 0;
    let zeroCrossings = 0;
    let sampleCount = 0;

    for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
      const range = ranges[rangeIndex];
      const start = clamp(range.start, 0, samples.length);
      const end = clamp(range.end, start, samples.length);
      let previousSign = 0;

      for (let index = start; index < end; index += 1) {
        const value = samples[index];
        if (value < min) {
          min = value;
        }
        if (value > max) {
          max = value;
        }
        sum += value;
        sumSquares += value * value;
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
        sampleCount += 1;
      }
    }

    if (sampleCount === 0) {
      return null;
    }

    const mean = sum / sampleCount;
    const meanPower = sumSquares / sampleCount;
    const variance = Math.max(0, meanPower - mean * mean);
    const std = Math.sqrt(variance);
    const rms = Math.sqrt(meanPower);
    const peakAbs = Math.max(Math.abs(min), Math.abs(max));

    return {
      sampleCount,
      mean,
      rms,
      std,
      variance,
      min,
      max,
      peakAbs,
      meanPower,
      meanPowerDb: 10 * Math.log10(meanPower + 1e-12),
      clippingRatio: clippingCount / sampleCount,
      zcr: zeroCrossings / Math.max(1, sampleCount - 1)
    };
  }

  function summarizeClasswiseFromOverlay(samples, sampleRate, sampleCount) {
    if (!state.overlay.enabled) {
      return {
        available: false,
        reason: "Enable Activation Overlay and load CSV labels to compute classwise metrics."
      };
    }

    if (!overlayParsed || !Array.isArray(overlayParsed.intervals)) {
      return {
        available: false,
        reason: "Load a valid overlay CSV (flag or timestamped) to derive active/inactive classes."
      };
    }

    const activeRanges = buildSampleRangesFromIntervals(overlayParsed.intervals, sampleRate, sampleCount);
    const inactiveRanges = invertSampleRanges(activeRanges, sampleCount);
    const activeStats = summarizeSamplesByRanges(samples, activeRanges);
    const inactiveStats = summarizeSamplesByRanges(samples, inactiveRanges);

    if (!activeStats) {
      return {
        available: false,
        reason: "Overlay intervals contain no active samples in the current clip."
      };
    }

    if (!inactiveStats) {
      return {
        available: false,
        reason: "Overlay covers the full clip; no inactive class remains for comparison."
      };
    }

    const total = Math.max(1, sampleCount);
    const activeCoverageRatio = activeStats.sampleCount / total;
    const inactiveCoverageRatio = inactiveStats.sampleCount / total;
    const rmsDeltaDb = 20 * Math.log10((activeStats.rms + 1e-12) / (inactiveStats.rms + 1e-12));
    const meanPowerDeltaDb = activeStats.meanPowerDb - inactiveStats.meanPowerDb;

    return {
      available: true,
      note:
        "Classes are derived from overlay labels: active=flagged regions, inactive=non-flagged complement.",
      source: {
        mode: overlayParsed.mode,
        intervals: overlayParsed.intervals.length,
        activeRows: overlayParsed.activeRows,
        totalRows: overlayParsed.totalRows
      },
      active: Object.assign({}, activeStats, {
        durationSeconds: activeStats.sampleCount / Math.max(1, sampleRate),
        coverageRatio: activeCoverageRatio
      }),
      inactive: Object.assign({}, inactiveStats, {
        durationSeconds: inactiveStats.sampleCount / Math.max(1, sampleRate),
        coverageRatio: inactiveCoverageRatio
      }),
      deltas: {
        rmsDb: rmsDeltaDb,
        meanPowerDb: meanPowerDeltaDb,
        peakAbs: activeStats.peakAbs - inactiveStats.peakAbs,
        clippingRatio: activeStats.clippingRatio - inactiveStats.clippingRatio,
        zcr: activeStats.zcr - inactiveStats.zcr
      }
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

    const histogramConfig = getMetricsHistogramConfig();
    const histogram = summarizeHistogram(
      distributionSample,
      histogramConfig.bins,
      histogramConfig.min,
      histogramConfig.max
    );
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
    const classwise = summarizeClasswiseFromOverlay(samples, sampleRate, sampleCount);

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
      classwise: classwise.available ? classwise.note : classwise.reason
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
        histogramConfig,
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
      classwise: classwise.available ? classwise : null,
      availability
    };
  }

  function getPrimaryMetricsReport() {
    const analysisAudio = getSingleChannelAnalysisAudio();
    if (!analysisAudio || !analysisAudio.samples || analysisAudio.samples.length === 0) {
      return null;
    }

    const histogramConfig = getMetricsHistogramConfig();
    const classwiseKey = getClasswiseMetricsCacheKeyPart();
    const cacheKey =
      metricsAudioKey(analysisAudio) +
      "::hist::" +
      histogramConfig.bins +
      "::" +
      histogramConfig.min.toFixed(6) +
      "::" +
      histogramConfig.max.toFixed(6) +
      "::classwise::" +
      classwiseKey;
    if (metricsCache.cacheKey === cacheKey && metricsCache.report) {
      return metricsCache.report;
    }

    const report = computeMetricsReport(analysisAudio);
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

  function analysisPaletteColor(index) {
    const palette = [
      "#38bdf8",
      "#f59e0b",
      "#34d399",
      "#f472b6",
      "#a78bfa",
      "#f87171",
      "#22d3ee",
      "#facc15",
      "#4ade80",
      "#fb7185"
    ];
    return palette[Math.abs(index) % palette.length];
  }

  function createAnalysisVizCard(title, subtitle) {
    const card = document.createElement("section");
    card.className = "metrics-group analysis-viz-card";

    const heading = document.createElement("h3");
    heading.textContent = title;
    card.appendChild(heading);

    if (typeof subtitle === "string" && subtitle.trim().length > 0) {
      const text = document.createElement("p");
      text.className = "analysis-viz-subtitle";
      text.textContent = subtitle;
      card.appendChild(text);
    }

    return card;
  }

  function createAnalysisCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.className = "analysis-viz-canvas";
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function drawAnalysisScatter(canvas, points, categoryLabels) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const width = canvas.width;
    const height = canvas.height;
    const padLeft = 34;
    const padRight = 12;
    const padTop = 12;
    const padBottom = 24;
    const plotWidth = Math.max(8, width - padLeft - padRight);
    const plotHeight = Math.max(8, height - padTop - padBottom);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(90,140,170,0.14)";
    ctx.fillRect(padLeft, padTop, plotWidth, plotHeight);

    if (!Array.isArray(points) || points.length === 0) {
      ctx.fillStyle = "rgba(210,210,210,0.9)";
      ctx.font = "11px sans-serif";
      ctx.fillText("No map data.", padLeft + 8, padTop + 18);
      return;
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const x = Number(point.x);
      const y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      if (x < minX) {
        minX = x;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (y > maxY) {
        maxY = y;
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
      minX = -1;
      maxX = 1;
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
      minY = -1;
      maxY = 1;
    }
    if (Math.abs(maxX - minX) < 1e-9) {
      minX -= 1;
      maxX += 1;
    }
    if (Math.abs(maxY - minY) < 1e-9) {
      minY -= 1;
      maxY += 1;
    }

    const toX = function (value) {
      return padLeft + ((value - minX) / (maxX - minX)) * plotWidth;
    };
    const toY = function (value) {
      return padTop + (1 - (value - minY) / (maxY - minY)) * plotHeight;
    };

    const legendMap = new Map();
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const x = Number(point.x);
      const y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      const category = String(point.category || "group-0");
      const categoryIndex = sanitizeInt(point.categoryIndex, 0, 0, 1000000);
      const color = analysisPaletteColor(categoryIndex);
      if (!legendMap.has(category)) {
        legendMap.set(category, color);
      }

      ctx.fillStyle = color;
      const px = toX(x);
      const py = toY(y);
      ctx.globalAlpha = point.highlighted ? 1 : 0.84;
      ctx.beginPath();
      ctx.arc(px, py, point.highlighted ? 3.4 : 2.3, 0, Math.PI * 2);
      ctx.fill();
      if (point.highlighted) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(170,210,235,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop);
    ctx.lineTo(padLeft, padTop + plotHeight);
    ctx.lineTo(padLeft + plotWidth, padTop + plotHeight);
    ctx.stroke();

    if (categoryLabels && categoryLabels.length > 0) {
      const legendY = height - 8;
      ctx.font = "10px sans-serif";
      let cursorX = padLeft;
      for (let index = 0; index < categoryLabels.length; index += 1) {
        const label = categoryLabels[index];
        const color =
          legendMap.get(label.key) || analysisPaletteColor(sanitizeInt(label.index, index, 0, 10000));
        ctx.fillStyle = color;
        ctx.fillRect(cursorX, legendY - 7, 8, 8);
        cursorX += 12;
        ctx.fillStyle = "rgba(220,220,220,0.9)";
        const text = String(label.label || label.key);
        ctx.fillText(text, cursorX, legendY);
        cursorX += ctx.measureText(text).width + 12;
        if (cursorX > width - 90) {
          break;
        }
      }
    }
  }

  function drawAnalysisHeatmap(canvas, matrix, rowLabels, colLabels) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const width = canvas.width;
    const height = canvas.height;
    const padLeft = 64;
    const padRight = 12;
    const padTop = 14;
    const padBottom = 30;
    const plotWidth = Math.max(8, width - padLeft - padRight);
    const plotHeight = Math.max(8, height - padTop - padBottom);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, width, height);

    if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0])) {
      ctx.fillStyle = "rgba(210,210,210,0.9)";
      ctx.font = "11px sans-serif";
      ctx.fillText("No heatmap data.", padLeft + 8, padTop + 18);
      return;
    }

    const rows = matrix.length;
    const cols = matrix[0].length;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const value = Number(matrix[r][c]);
        if (!Number.isFinite(value)) {
          continue;
        }
        if (value < min) {
          min = value;
        }
        if (value > max) {
          max = value;
        }
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || Math.abs(max - min) < 1e-12) {
      min = 0;
      max = 1;
    }
    const range = max - min;

    const cellW = plotWidth / cols;
    const cellH = plotHeight / rows;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const value = Number(matrix[r][c]);
        const ratio = Number.isFinite(value) ? (value - min) / range : 0;
        const hue = 210 - clamp(ratio, 0, 1) * 170;
        const light = 24 + clamp(ratio, 0, 1) * 48;
        ctx.fillStyle = "hsl(" + hue + " 78% " + light + "%)";
        ctx.fillRect(padLeft + c * cellW, padTop + r * cellH, Math.ceil(cellW), Math.ceil(cellH));
      }
    }

    ctx.strokeStyle = "rgba(170,210,235,0.72)";
    ctx.lineWidth = 1;
    ctx.strokeRect(padLeft + 0.5, padTop + 0.5, plotWidth, plotHeight);

    ctx.fillStyle = "rgba(220,220,220,0.92)";
    ctx.font = "10px sans-serif";
    const maxRowLabels = Math.min(rows, rowLabels ? rowLabels.length : 0);
    for (let r = 0; r < maxRowLabels; r += 1) {
      const y = padTop + (r + 0.5) * cellH + 3;
      ctx.fillText(String(rowLabels[r]), 6, y);
    }

    if (Array.isArray(colLabels) && colLabels.length > 0) {
      const first = String(colLabels[0]);
      const mid = String(colLabels[Math.floor((colLabels.length - 1) / 2)]);
      const last = String(colLabels[colLabels.length - 1]);
      ctx.fillText(first, padLeft, height - 9);
      ctx.fillText(mid, padLeft + plotWidth * 0.45, height - 9);
      const lastWidth = ctx.measureText(last).width;
      ctx.fillText(last, padLeft + plotWidth - lastWidth, height - 9);
    }
  }

  function drawAnalysisBarChart(canvas, labels, values, color) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const width = canvas.width;
    const height = canvas.height;
    const padLeft = 86;
    const padRight = 12;
    const padTop = 12;
    const padBottom = 20;
    const plotWidth = Math.max(8, width - padLeft - padRight);
    const plotHeight = Math.max(8, height - padTop - padBottom);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(90,140,170,0.14)";
    ctx.fillRect(padLeft, padTop, plotWidth, plotHeight);

    if (!Array.isArray(values) || values.length === 0) {
      ctx.fillStyle = "rgba(210,210,210,0.9)";
      ctx.font = "11px sans-serif";
      ctx.fillText("No bar-chart data.", padLeft + 8, padTop + 18);
      return;
    }

    const maxValue = values.reduce(function (acc, value) {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > acc ? numeric : acc;
    }, 0);
    const safeMax = maxValue > 1e-12 ? maxValue : 1;
    const count = values.length;
    const rowHeight = plotHeight / Math.max(1, count);

    ctx.font = "10px sans-serif";
    for (let index = 0; index < count; index += 1) {
      const value = Math.max(0, Number(values[index]) || 0);
      const ratio = value / safeMax;
      const barWidth = ratio * plotWidth;
      const y = padTop + index * rowHeight + 1;
      const h = Math.max(1, rowHeight - 2);
      ctx.fillStyle = color || analysisPaletteColor(index);
      ctx.fillRect(padLeft, y, barWidth, h);

      ctx.fillStyle = "rgba(220,220,220,0.9)";
      const rawLabel = labels && labels[index] ? String(labels[index]) : "item-" + (index + 1);
      const label = rawLabel.length > 16 ? rawLabel.slice(0, 16) + "..." : rawLabel;
      ctx.fillText(label, 6, y + h * 0.72);
      ctx.fillText(formatMetricNumber(value, 3), padLeft + barWidth + 4, y + h * 0.72);
    }

    ctx.strokeStyle = "rgba(170,210,235,0.72)";
    ctx.strokeRect(padLeft + 0.5, padTop + 0.5, plotWidth, plotHeight);
  }

  function createAnalysisExamplesTable(headers, rows) {
    const table = document.createElement("table");
    table.className = "metrics-table analysis-examples-table";
    const body = document.createElement("tbody");

    const headerRow = document.createElement("tr");
    for (let index = 0; index < headers.length; index += 1) {
      const cell = document.createElement("td");
      cell.textContent = headers[index];
      cell.className = "analysis-examples-header";
      headerRow.appendChild(cell);
    }
    body.appendChild(headerRow);

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const tr = document.createElement("tr");
      for (let col = 0; col < headers.length; col += 1) {
        const cell = document.createElement("td");
        cell.textContent = row[col] !== undefined && row[col] !== null ? String(row[col]) : "";
        tr.appendChild(cell);
      }
      body.appendChild(tr);
    }

    table.appendChild(body);
    return table;
  }

  function buildProjectionForVisualization(rows, maxRows, seed) {
    if (!Array.isArray(rows) || rows.length < 2) {
      return null;
    }
    const limit = Math.max(8, Math.min(rows.length, sanitizeInt(maxRows, 900, 8, 4000)));
    let indices;
    if (rows.length <= limit) {
      indices = new Array(rows.length);
      for (let index = 0; index < rows.length; index += 1) {
        indices[index] = index;
      }
    } else {
      const random = createSeededRandom(sanitizeInt(seed, 1009, -2147483648, 2147483647));
      indices = sampleIndicesWithoutReplacement(rows.length, limit, random);
    }

    const sampledRows = new Array(indices.length);
    for (let index = 0; index < indices.length; index += 1) {
      sampledRows[index] = rows[indices[index]];
    }

    let pca;
    try {
      pca = computePcaProjection(sampledRows, 2);
    } catch {
      pca = null;
    }
    if (!pca || !Array.isArray(pca.projectionMatrix) || pca.projectionMatrix.length === 0) {
      return null;
    }

    const points = new Array(pca.projectionMatrix.length);
    for (let index = 0; index < pca.projectionMatrix.length; index += 1) {
      const row = pca.projectionMatrix[index];
      points[index] = {
        x: Number(row[0] || 0),
        y: Number(row[1] || 0)
      };
    }

    return {
      indices,
      points,
      explainedRatios: Array.isArray(pca.explainedRatios) ? pca.explainedRatios : []
    };
  }

  function computeTopFeatureIndicesByClusterSeparation(rows, labels, k, maxFeatures) {
    if (!Array.isArray(rows) || rows.length === 0 || !labels || rows.length !== labels.length) {
      return [];
    }
    const featureCount = rows[0] ? rows[0].length : 0;
    if (featureCount <= 0) {
      return [];
    }

    const sums = new Array(k);
    const counts = new Array(k).fill(0);
    for (let cluster = 0; cluster < k; cluster += 1) {
      sums[cluster] = new Float64Array(featureCount);
    }
    const global = new Float64Array(featureCount);

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const label = sanitizeInt(labels[rowIndex], 0, 0, Math.max(0, k - 1));
      counts[label] += 1;
      const row = rows[rowIndex];
      for (let feature = 0; feature < featureCount; feature += 1) {
        const value = Number(row[feature] || 0);
        sums[label][feature] += value;
        global[feature] += value;
      }
    }

    for (let feature = 0; feature < featureCount; feature += 1) {
      global[feature] /= Math.max(1, rows.length);
    }

    const scores = new Array(featureCount);
    for (let feature = 0; feature < featureCount; feature += 1) {
      let between = 0;
      for (let cluster = 0; cluster < k; cluster += 1) {
        if (counts[cluster] <= 0) {
          continue;
        }
        const mean = sums[cluster][feature] / counts[cluster];
        const delta = mean - global[feature];
        between += counts[cluster] * delta * delta;
      }
      scores[feature] = { feature, score: between / Math.max(1, rows.length) };
    }
    scores.sort(function (left, right) {
      return right.score - left.score;
    });

    return scores
      .slice(0, Math.max(1, Math.min(featureCount, sanitizeInt(maxFeatures, 12, 1, 48))))
      .map(function (entry) {
        return entry.feature;
      });
  }

  function buildClusterFeatureMeanMatrix(rows, labels, k, featureIndices) {
    const matrix = new Array(k);
    const counts = new Array(k).fill(0);
    for (let cluster = 0; cluster < k; cluster += 1) {
      matrix[cluster] = new Float64Array(featureIndices.length);
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const cluster = sanitizeInt(labels[rowIndex], 0, 0, Math.max(0, k - 1));
      counts[cluster] += 1;
      const row = rows[rowIndex];
      for (let col = 0; col < featureIndices.length; col += 1) {
        const featureIndex = featureIndices[col];
        matrix[cluster][col] += Number(row[featureIndex] || 0);
      }
    }

    const output = new Array(k);
    for (let cluster = 0; cluster < k; cluster += 1) {
      output[cluster] = new Array(featureIndices.length).fill(0);
      const scale = 1 / Math.max(1, counts[cluster]);
      for (let col = 0; col < featureIndices.length; col += 1) {
        output[cluster][col] = matrix[cluster][col] * scale;
      }
    }
    return output;
  }

  function formatBinaryClassLabel(value) {
    if (value === 1 || value === "1" || value === true || value === "active") {
      return "active";
    }
    return "inactive";
  }

  function computeRClusterExampleRows(rows, labels, centroids, rowTimesSeconds, classLabels) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { medoids: [], borderlines: [] };
    }
    const perCluster = new Map();
    const globalMargins = [];

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const cluster = sanitizeInt(labels[rowIndex], 0, 0, Math.max(0, centroids.length - 1));
      let nearest = Number.POSITIVE_INFINITY;
      let second = Number.POSITIVE_INFINITY;
      for (let c = 0; c < centroids.length; c += 1) {
        const distance = squaredDistanceForFeatureSet(rows[rowIndex], centroids[c], null);
        if (distance < nearest) {
          second = nearest;
          nearest = distance;
        } else if (distance < second) {
          second = distance;
        }
      }
      const margin = Math.sqrt(Math.max(0, second)) - Math.sqrt(Math.max(0, nearest));
      const entry = {
        cluster,
        rowIndex,
        timeSec:
          Array.isArray(rowTimesSeconds) && Number.isFinite(Number(rowTimesSeconds[rowIndex]))
            ? Number(rowTimesSeconds[rowIndex])
            : Number.NaN,
        classLabel:
          Array.isArray(classLabels) && rowIndex < classLabels.length
            ? String(classLabels[rowIndex])
            : "unknown",
        distance: Math.sqrt(Math.max(0, nearest)),
        margin
      };
      if (!perCluster.has(cluster)) {
        perCluster.set(cluster, []);
      }
      perCluster.get(cluster).push(entry);
      globalMargins.push(entry);
    }

    const medoids = [];
    perCluster.forEach(function (entries, cluster) {
      entries.sort(function (left, right) {
        return left.distance - right.distance;
      });
      for (let index = 0; index < Math.min(3, entries.length); index += 1) {
        medoids.push(entries[index]);
      }
      if (entries.length > 0) {
        const borderline = entries.reduce(function (best, current) {
          return current.margin < best.margin ? current : best;
        }, entries[0]);
        borderline.isBorderline = true;
      }
    });

    globalMargins.sort(function (left, right) {
      return left.margin - right.margin;
    });
    const borderlines = globalMargins.slice(0, Math.min(8, globalMargins.length));
    return { medoids, borderlines };
  }

  function getRClusterParamsFromInputs() {
    const params = {
      k: sanitizeInt(rclusterK.value, 2, 2, 64),
      seed: sanitizeInt(rclusterSeed.value, 0, -2147483648, 2147483647),
      maxIter: sanitizeInt(rclusterMaxIter.value, 32, 4, 512),
      stabilityRuns: sanitizeInt(rclusterStabilityRuns.value, 6, 1, 48),
      rowRatio: sanitizeFloat(rclusterRowRatio.value, 0.8, 0.1, 1),
      featureRatio: sanitizeFloat(rclusterFeatureRatio.value, 0.8, 0.1, 1)
    };
    return params;
  }

  function syncRClusterParamInputs() {
    const params = getRClusterParamsFromInputs();
    const representation =
      typeof rclusterRepresentation.value === "string" &&
      (rclusterRepresentation.value === "mel" || rclusterRepresentation.value === "stft")
        ? rclusterRepresentation.value
        : "mel";
    rClusterRepresentationMode = representation;
    rclusterRepresentation.value = representation;
    rclusterK.value = String(params.k);
    rclusterSeed.value = String(params.seed);
    rclusterMaxIter.value = String(params.maxIter);
    rclusterStabilityRuns.value = String(params.stabilityRuns);
    rclusterRowRatio.value = formatMetricNumber(params.rowRatio, 2);
    rclusterFeatureRatio.value = formatMetricNumber(params.featureRatio, 2);
  }

  function setRClusterStatus(message) {
    rclusterStatus.textContent = message;
  }

  function clearRClusterProgressInterval() {
    if (rClusterProgressIntervalId !== null) {
      window.clearInterval(rClusterProgressIntervalId);
      rClusterProgressIntervalId = null;
    }
  }

  function clearRClusterProgressResetTimer() {
    if (rClusterProgressResetTimerId !== null) {
      window.clearTimeout(rClusterProgressResetTimerId);
      rClusterProgressResetTimerId = null;
    }
  }

  function setRClusterProgress(value) {
    const numeric = Number(value);
    const clampedValue = Number.isFinite(numeric) ? clamp(numeric, 0, 100) : 0;
    rclusterProgress.value = clampedValue;
    rclusterProgress.classList.toggle("is-active", clampedValue > 0 && clampedValue < 100);
  }

  function startRClusterProgress(initialValue) {
    clearRClusterProgressInterval();
    clearRClusterProgressResetTimer();
    const numericInitial = Number(initialValue);
    const clampedInitial = Number.isFinite(numericInitial) ? clamp(numericInitial, 0, 100) : 0;
    setRClusterProgress(clampedInitial);
    rClusterProgressIntervalId = window.setInterval(function () {
      const current = Number(rclusterProgress.value) || 0;
      const next = Math.min(92, current + Math.max(0.8, (92 - current) * 0.08));
      setRClusterProgress(next);
    }, 220);
  }

  function completeRClusterProgress() {
    clearRClusterProgressInterval();
    clearRClusterProgressResetTimer();
    setRClusterProgress(100);
    rClusterProgressResetTimerId = window.setTimeout(function () {
      if (!rClusterRunning) {
        setRClusterProgress(0);
      }
      rClusterProgressResetTimerId = null;
    }, 850);
  }

  function failRClusterProgress() {
    clearRClusterProgressInterval();
    clearRClusterProgressResetTimer();
    setRClusterProgress(0);
  }

  let rClusterLastRunContext = null;

  function buildRClusterClassLabels(frameTimesSeconds, intervals) {
    if (!Array.isArray(frameTimesSeconds) || frameTimesSeconds.length === 0) {
      return null;
    }
    if (!Array.isArray(intervals) || intervals.length === 0) {
      return null;
    }

    const labels = new Array(frameTimesSeconds.length);
    let activeCount = 0;
    let inactiveCount = 0;
    let intervalIndex = 0;

    for (let index = 0; index < frameTimesSeconds.length; index += 1) {
      const timeSeconds = Number(frameTimesSeconds[index]);
      if (!Number.isFinite(timeSeconds)) {
        labels[index] = "inactive";
        inactiveCount += 1;
        continue;
      }

      while (
        intervalIndex < intervals.length &&
        Number.isFinite(intervals[intervalIndex].endSec) &&
        intervals[intervalIndex].endSec < timeSeconds - 1e-9
      ) {
        intervalIndex += 1;
      }

      let isActive = false;
      if (intervalIndex < intervals.length) {
        const interval = intervals[intervalIndex];
        isActive =
          Number.isFinite(interval.startSec) &&
          Number.isFinite(interval.endSec) &&
          interval.startSec <= timeSeconds + 1e-9 &&
          interval.endSec >= timeSeconds - 1e-9;
      }

      labels[index] = isActive ? "active" : "inactive";
      if (isActive) {
        activeCount += 1;
      } else {
        inactiveCount += 1;
      }
    }

    return {
      labels,
      activeCount,
      inactiveCount
    };
  }

  function buildShortTimeFeatureRowsForMode(analysisAudio, representationMode) {
    const stftDefaults = getDefaultStftParams();
    if (representationMode === "mel") {
      const melItem = createPcaReferenceItem("mel");
      melItem.params.stft = cloneParams(stftDefaults);
      melItem.params.mel = cloneParams(getDefaultMelParams(analysisAudio.sampleRate || 16000));
      const mel = ensureMelForAudio(melItem, analysisAudio, derivedCache);
      const stft = ensureStftForAudio(melItem, analysisAudio, derivedCache);
      return {
        featureRows: mel.matrix,
        frameTimesSeconds: stft.frameTimesSeconds || [],
        sourceDescription: "short-time mel feature frames"
      };
    }

    const stftItem = createPcaReferenceItem("stft");
    stftItem.params.stft = cloneParams(stftDefaults);
    stftItem.params.stft.mode = "magnitude";
    const stft = ensureStftForAudio(stftItem, analysisAudio, derivedCache);
    return {
      featureRows: stft.logMagnitudeFrames,
      frameTimesSeconds: stft.frameTimesSeconds || [],
      sourceDescription: "short-time STFT log-magnitude spectrogram frames"
    };
  }

  function buildRClusterDataset() {
    const analysisAudio = getSingleChannelAnalysisAudio();
    if (!analysisAudio || !analysisAudio.samples || analysisAudio.samples.length === 0) {
      throw new Error("Load a primary audio clip first.");
    }

    if (!state.overlay.enabled || !overlayParsed || !Array.isArray(overlayParsed.intervals)) {
      throw new Error(
        "Enable Activation Overlay and load a valid overlay CSV to derive active/inactive labels."
      );
    }

    const representationMode = rClusterRepresentationMode === "stft" ? "stft" : "mel";
    const featureSource = buildShortTimeFeatureRowsForMode(analysisAudio, representationMode);
    const featureRows = featureSource.featureRows;
    const frameTimesSeconds = featureSource.frameTimesSeconds;
    const sourceDescription = featureSource.sourceDescription;

    const frameCount = Math.min(featureRows.length, frameTimesSeconds.length);
    if (frameCount < 4) {
      throw new Error("Not enough short-time frames for clustering. Load longer audio or adjust STFT settings.");
    }

    const classLabels = buildRClusterClassLabels(
      frameTimesSeconds.slice(0, frameCount),
      overlayParsed.intervals
    );
    if (!classLabels) {
      throw new Error("Unable to derive class labels from activation overlay.");
    }
    if (classLabels.activeCount < 2 || classLabels.inactiveCount < 2) {
      throw new Error(
        "Need at least 2 active and 2 inactive frames for classwise diagnostics. " +
          "active=" +
          classLabels.activeCount +
          ", inactive=" +
          classLabels.inactiveCount +
          "."
      );
    }

    const rowStride = Math.max(1, Math.ceil(frameCount / RCLUSTER_MAX_ROWS));
    const sampledRows = [];
    const sampledLabels = [];
    const sampledTimesSeconds = [];
    for (let rowIndex = 0; rowIndex < frameCount; rowIndex += rowStride) {
      sampledRows.push(featureRows[rowIndex]);
      sampledLabels.push(classLabels.labels[rowIndex]);
      sampledTimesSeconds.push(Number(frameTimesSeconds[rowIndex] || 0));
    }
    if (sampledRows.length < 2) {
      throw new Error("Not enough frames after sampling for clustering.");
    }

    const sourceFeatureCount = sampledRows[0] ? sampledRows[0].length : 0;
    const outputFeatureCount = Math.min(RCLUSTER_MAX_COLUMNS, Math.max(1, sourceFeatureCount));

    const featureHeader = new Array(outputFeatureCount);
    for (let index = 0; index < outputFeatureCount; index += 1) {
      featureHeader[index] = representationMode + "_f" + index;
    }
    const processedRows = new Array(sampledRows.length);
    for (let rowIndex = 0; rowIndex < sampledRows.length; rowIndex += 1) {
      const sourceRow = sampledRows[rowIndex];
      const values =
        sourceRow.length > outputFeatureCount
          ? resampleVectorToLength(sourceRow, outputFeatureCount)
          : sourceRow;
      const processedRow = new Float32Array(outputFeatureCount);
      for (let colIndex = 0; colIndex < outputFeatureCount; colIndex += 1) {
        const numeric = Number(values[colIndex] || 0);
        processedRow[colIndex] = Number.isFinite(numeric) ? numeric : 0;
      }
      processedRows[rowIndex] = processedRow;
    }

    return {
      rows: processedRows,
      classLabels: sampledLabels,
      rowTimesSeconds: sampledTimesSeconds,
      featureColumns: featureHeader,
      runContext: {
        representationMode,
        sourceDescription,
        frameCountOriginal: frameCount,
        frameCountUsed: sampledRows.length,
        rowStride,
        featureCountOriginal: sourceFeatureCount,
        featureCountUsed: outputFeatureCount,
        activeFrames: sampledLabels.reduce(function (acc, label) {
          return acc + (label === "active" ? 1 : 0);
        }, 0),
        inactiveFrames: sampledLabels.reduce(function (acc, label) {
          return acc + (label === "inactive" ? 1 : 0);
        }, 0),
        analysisSource: getSingleChannelAnalysisLabel(),
        overlayMode: overlayParsed.mode,
        backend: "javascript"
      }
    };
  }

  function waitForUiFrame() {
    return new Promise(function (resolve) {
      window.requestAnimationFrame(function () {
        resolve();
      });
    });
  }

  function createSeededRandom(seed) {
    let state = (seed | 0) ^ 0x9e3779b9;
    return function () {
      state = (state + 0x6d2b79f5) | 0;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sampleIndicesWithoutReplacement(totalCount, sampleCount, random) {
    const boundedCount = Math.max(0, Math.min(totalCount, sampleCount));
    const pool = new Uint32Array(totalCount);
    for (let index = 0; index < totalCount; index += 1) {
      pool[index] = index;
    }

    const sampled = new Array(boundedCount);
    for (let index = 0; index < boundedCount; index += 1) {
      const pickIndex = index + Math.floor(random() * Math.max(1, totalCount - index));
      const tmp = pool[index];
      pool[index] = pool[pickIndex];
      pool[pickIndex] = tmp;
      sampled[index] = pool[index];
    }
    sampled.sort(function (a, b) {
      return a - b;
    });
    return sampled;
  }

  function squaredDistanceForFeatureSet(a, b, featureIndices) {
    let sum = 0;
    if (!featureIndices) {
      const length = Math.min(a.length, b.length);
      for (let index = 0; index < length; index += 1) {
        const delta = a[index] - b[index];
        sum += delta * delta;
      }
      return sum;
    }

    for (let index = 0; index < featureIndices.length; index += 1) {
      const feature = featureIndices[index];
      const delta = (a[feature] || 0) - (b[feature] || 0);
      sum += delta * delta;
    }
    return sum;
  }

  function copyRowToFloat64(row) {
    const out = new Float64Array(row.length);
    for (let index = 0; index < row.length; index += 1) {
      out[index] = row[index];
    }
    return out;
  }

  function assignRowsToCentroids(rows, centroids, featureIndices) {
    const rowCount = rows.length;
    const labels = new Int32Array(rowCount);
    let inertia = 0;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row = rows[rowIndex];
      let bestCluster = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let clusterIndex = 0; clusterIndex < centroids.length; clusterIndex += 1) {
        const distance = squaredDistanceForFeatureSet(row, centroids[clusterIndex], featureIndices);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCluster = clusterIndex;
        }
      }
      labels[rowIndex] = bestCluster;
      inertia += bestDistance;
    }
    return { labels, inertia };
  }

  function initializeCentroidsKmeansPlusPlus(rows, k, random, featureIndices) {
    const centroids = [];
    centroids.push(copyRowToFloat64(rows[Math.floor(random() * rows.length)]));
    while (centroids.length < k) {
      const distances = new Float64Array(rows.length);
      let total = 0;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        let nearest = Number.POSITIVE_INFINITY;
        for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex += 1) {
          const distance = squaredDistanceForFeatureSet(
            rows[rowIndex],
            centroids[centroidIndex],
            featureIndices
          );
          if (distance < nearest) {
            nearest = distance;
          }
        }
        const bounded = Math.max(0, nearest);
        distances[rowIndex] = bounded;
        total += bounded;
      }

      if (total <= 1e-12) {
        centroids.push(copyRowToFloat64(rows[Math.floor(random() * rows.length)]));
        continue;
      }

      const threshold = random() * total;
      let cursor = 0;
      let pickedIndex = rows.length - 1;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        cursor += distances[rowIndex];
        if (cursor >= threshold) {
          pickedIndex = rowIndex;
          break;
        }
      }
      centroids.push(copyRowToFloat64(rows[pickedIndex]));
    }
    return centroids;
  }

  function runKmeansLocal(rows, k, seed, maxIter, featureIndices) {
    if (k < 2) {
      throw new Error("k must be >= 2.");
    }
    if (k > rows.length) {
      throw new Error("k cannot exceed row count.");
    }

    const random = createSeededRandom(seed);
    const colCount = rows[0] ? rows[0].length : 0;
    let centroids = initializeCentroidsKmeansPlusPlus(rows, k, random, featureIndices);
    let labels = new Int32Array(rows.length);

    for (let iter = 0; iter < maxIter; iter += 1) {
      labels = assignRowsToCentroids(rows, centroids, featureIndices).labels;

      const nextCentroids = new Array(k);
      const counts = new Uint32Array(k);
      for (let cluster = 0; cluster < k; cluster += 1) {
        nextCentroids[cluster] = new Float64Array(colCount);
      }

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const label = labels[rowIndex];
        const row = rows[rowIndex];
        counts[label] += 1;
        for (let col = 0; col < colCount; col += 1) {
          nextCentroids[label][col] += row[col];
        }
      }

      for (let cluster = 0; cluster < k; cluster += 1) {
        if (counts[cluster] === 0) {
          nextCentroids[cluster] = copyRowToFloat64(rows[Math.floor(random() * rows.length)]);
          continue;
        }
        const scale = 1 / counts[cluster];
        for (let col = 0; col < colCount; col += 1) {
          nextCentroids[cluster][col] *= scale;
        }
      }

      let maxShift = 0;
      for (let cluster = 0; cluster < k; cluster += 1) {
        const shift = Math.sqrt(squaredDistanceForFeatureSet(centroids[cluster], nextCentroids[cluster], null));
        if (shift > maxShift) {
          maxShift = shift;
        }
      }
      centroids = nextCentroids;
      if (maxShift <= 1e-6) {
        break;
      }
    }

    const finalAssignment = assignRowsToCentroids(rows, centroids, featureIndices);
    return {
      labels: finalAssignment.labels,
      centroids,
      inertia: finalAssignment.inertia
    };
  }

  function zscoreRowsByColumn(rows) {
    const rowCount = rows.length;
    const colCount = rows[0] ? rows[0].length : 0;
    const means = new Float64Array(colCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row = rows[rowIndex];
      for (let col = 0; col < colCount; col += 1) {
        means[col] += row[col];
      }
    }
    for (let col = 0; col < colCount; col += 1) {
      means[col] /= Math.max(1, rowCount);
    }

    const variances = new Float64Array(colCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row = rows[rowIndex];
      for (let col = 0; col < colCount; col += 1) {
        const delta = row[col] - means[col];
        variances[col] += delta * delta;
      }
    }
    const stds = new Float64Array(colCount);
    for (let col = 0; col < colCount; col += 1) {
      const variance = variances[col] / Math.max(1, rowCount);
      stds[col] = variance > 1e-12 ? Math.sqrt(variance) : 1;
    }

    const normalizedRows = new Array(rowCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row = rows[rowIndex];
      const normalized = new Float32Array(colCount);
      for (let col = 0; col < colCount; col += 1) {
        normalized[col] = (row[col] - means[col]) / stds[col];
      }
      normalizedRows[rowIndex] = normalized;
    }

    return normalizedRows;
  }

  function computeSilhouetteLocal(rows, labels, k, seed) {
    if (rows.length < 3 || k < 2) {
      return 0;
    }

    const maxPoints = 300;
    let sampledIndices;
    if (rows.length <= maxPoints) {
      sampledIndices = new Array(rows.length);
      for (let index = 0; index < rows.length; index += 1) {
        sampledIndices[index] = index;
      }
    } else {
      const random = createSeededRandom(seed);
      sampledIndices = sampleIndicesWithoutReplacement(rows.length, maxPoints, random);
    }

    const byCluster = new Map();
    for (let index = 0; index < sampledIndices.length; index += 1) {
      const rowIndex = sampledIndices[index];
      const cluster = labels[rowIndex];
      if (!byCluster.has(cluster)) {
        byCluster.set(cluster, []);
      }
      byCluster.get(cluster).push(rowIndex);
    }
    if (byCluster.size < 2) {
      return 0;
    }

    function meanDistance(source, targets) {
      if (!targets || targets.length === 0) {
        return 0;
      }
      let sum = 0;
      for (let idx = 0; idx < targets.length; idx += 1) {
        sum += Math.sqrt(squaredDistanceForFeatureSet(rows[source], rows[targets[idx]], null));
      }
      return sum / targets.length;
    }

    const scores = [];
    for (let idx = 0; idx < sampledIndices.length; idx += 1) {
      const sourceIndex = sampledIndices[idx];
      const ownCluster = labels[sourceIndex];
      const ownMembers = byCluster.get(ownCluster).filter(function (candidate) {
        return candidate !== sourceIndex;
      });
      if (ownMembers.length === 0) {
        scores.push(0);
        continue;
      }

      const a = meanDistance(sourceIndex, ownMembers);
      let b = Number.POSITIVE_INFINITY;
      byCluster.forEach(function (members, clusterId) {
        if (clusterId === ownCluster || members.length === 0) {
          return;
        }
        b = Math.min(b, meanDistance(sourceIndex, members));
      });
      if (!Number.isFinite(b)) {
        scores.push(0);
        continue;
      }
      const denom = Math.max(a, b, 1e-12);
      scores.push((b - a) / denom);
    }

    if (scores.length === 0) {
      return 0;
    }
    let sum = 0;
    for (let index = 0; index < scores.length; index += 1) {
      sum += scores[index];
    }
    return sum / scores.length;
  }

  function computeClusterSizesLocal(labels, k) {
    const counts = new Array(k).fill(0);
    for (let index = 0; index < labels.length; index += 1) {
      counts[labels[index]] += 1;
    }
    return counts;
  }

  function computeCentroidDistanceSummaryLocal(centroids) {
    if (centroids.length < 2) {
      return { min: 0, mean: 0 };
    }
    const distances = [];
    for (let left = 0; left < centroids.length; left += 1) {
      for (let right = left + 1; right < centroids.length; right += 1) {
        distances.push(
          Math.sqrt(squaredDistanceForFeatureSet(centroids[left], centroids[right], null))
        );
      }
    }
    if (distances.length === 0) {
      return { min: 0, mean: 0 };
    }
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    for (let index = 0; index < distances.length; index += 1) {
      const value = distances[index];
      sum += value;
      if (value < min) {
        min = value;
      }
    }
    return { min, mean: sum / distances.length };
  }

  function computeBestLabelAgreementLocal(referenceLabels, candidateLabels, k) {
    const counts = new Array(k);
    for (let ref = 0; ref < k; ref += 1) {
      counts[ref] = new Array(k).fill(0);
    }
    for (let index = 0; index < referenceLabels.length; index += 1) {
      counts[referenceLabels[index]][candidateLabels[index]] += 1;
    }

    const ranked = [];
    for (let ref = 0; ref < k; ref += 1) {
      for (let cand = 0; cand < k; cand += 1) {
        ranked.push([counts[ref][cand], ref, cand]);
      }
    }
    ranked.sort(function (left, right) {
      return right[0] - left[0];
    });

    const candidateToRef = new Map();
    const usedRefs = new Set();
    for (let index = 0; index < ranked.length; index += 1) {
      const value = ranked[index][0];
      const ref = ranked[index][1];
      const cand = ranked[index][2];
      if (value <= 0) {
        break;
      }
      if (candidateToRef.has(cand) || usedRefs.has(ref)) {
        continue;
      }
      candidateToRef.set(cand, ref);
      usedRefs.add(ref);
    }

    const remainingRefs = [];
    for (let ref = 0; ref < k; ref += 1) {
      if (!usedRefs.has(ref)) {
        remainingRefs.push(ref);
      }
    }
    for (let cand = 0; cand < k; cand += 1) {
      if (!candidateToRef.has(cand)) {
        candidateToRef.set(cand, remainingRefs.length > 0 ? remainingRefs.shift() : cand);
      }
    }

    let matches = 0;
    for (let index = 0; index < referenceLabels.length; index += 1) {
      const mapped = candidateToRef.get(candidateLabels[index]);
      if (mapped === referenceLabels[index]) {
        matches += 1;
      }
    }
    return matches / Math.max(1, referenceLabels.length);
  }

  async function computeStabilityLocal(
    rows,
    baselineLabels,
    k,
    seed,
    maxIter,
    runs,
    rowRatio,
    featureRatio,
    onProgress
  ) {
    if (runs <= 0) {
      return { mean: 0, std: 0, min: 0, max: 0 };
    }

    const rowCount = rows.length;
    const colCount = rows[0] ? rows[0].length : 0;
    if (rowCount < k || colCount <= 0) {
      return { mean: 0, std: 0, min: 0, max: 0 };
    }

    const random = createSeededRandom(seed);
    const rowSampleSize = Math.max(k, Math.min(rowCount, Math.round(rowCount * rowRatio)));
    const featureSampleSize = Math.max(1, Math.min(colCount, Math.round(colCount * featureRatio)));
    const scores = [];

    for (let runIndex = 0; runIndex < runs; runIndex += 1) {
      const sampledRowIndices = sampleIndicesWithoutReplacement(rowCount, rowSampleSize, random);
      const sampledFeatureIndices = sampleIndicesWithoutReplacement(colCount, featureSampleSize, random);
      const sampledRows = new Array(sampledRowIndices.length);
      for (let index = 0; index < sampledRowIndices.length; index += 1) {
        sampledRows[index] = rows[sampledRowIndices[index]];
      }

      const runModel = runKmeansLocal(
        sampledRows,
        k,
        seed + 7919 * (runIndex + 1),
        maxIter,
        sampledFeatureIndices
      );
      const fullAssignment = assignRowsToCentroids(rows, runModel.centroids, sampledFeatureIndices);
      const score = computeBestLabelAgreementLocal(baselineLabels, fullAssignment.labels, k);
      scores.push(score);

      if (typeof onProgress === "function") {
        onProgress(runIndex + 1, runs);
      }
      await waitForUiFrame();
    }

    if (scores.length === 0) {
      return { mean: 0, std: 0, min: 0, max: 0 };
    }

    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < scores.length; index += 1) {
      const value = scores[index];
      sum += value;
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
    const mean = sum / scores.length;
    let variance = 0;
    for (let index = 0; index < scores.length; index += 1) {
      const delta = scores[index] - mean;
      variance += delta * delta;
    }
    const std = scores.length > 1 ? Math.sqrt(variance / scores.length) : 0;
    return { mean, std, min, max };
  }

  function computeClusterPurityLocal(labels, classLabels, k) {
    if (labels.length !== classLabels.length) {
      throw new Error("Class labels length mismatch.");
    }

    const perCluster = [];
    let weightedPurityNumerator = 0;
    for (let clusterId = 0; clusterId < k; clusterId += 1) {
      const memberIndices = [];
      for (let index = 0; index < labels.length; index += 1) {
        if (labels[index] === clusterId) {
          memberIndices.push(index);
        }
      }

      if (memberIndices.length === 0) {
        perCluster.push({
          cluster: clusterId,
          size: 0,
          top_label: null,
          purity: 0,
          class_counts: {}
        });
        continue;
      }

      const counts = Object.create(null);
      for (let index = 0; index < memberIndices.length; index += 1) {
        const key = classLabels[memberIndices[index]];
        counts[key] = (counts[key] || 0) + 1;
      }

      let topLabel = "";
      let topCount = 0;
      Object.keys(counts).forEach(function (key) {
        if (counts[key] > topCount) {
          topCount = counts[key];
          topLabel = key;
        }
      });
      const purity = topCount / Math.max(1, memberIndices.length);
      weightedPurityNumerator += topCount;
      perCluster.push({
        cluster: clusterId,
        size: memberIndices.length,
        top_label: topLabel,
        purity,
        class_counts: counts
      });
    }

    return {
      overall_purity: weightedPurityNumerator / Math.max(1, labels.length),
      per_cluster: perCluster
    };
  }

  async function runRClusterInBrowserLocal(dataset, params) {
    if (!dataset || !Array.isArray(dataset.rows) || dataset.rows.length < 2) {
      throw new Error("Not enough rows to run clustering.");
    }

    setRClusterProgress(24);
    await waitForUiFrame();
    const normalizedRows = zscoreRowsByColumn(dataset.rows);

    setRClusterProgress(46);
    await waitForUiFrame();
    const baseline = runKmeansLocal(
      normalizedRows,
      params.k,
      params.seed,
      params.maxIter,
      null
    );

    setRClusterProgress(64);
    await waitForUiFrame();
    const silhouette = computeSilhouetteLocal(
      normalizedRows,
      baseline.labels,
      params.k,
      params.seed + 17
    );

    setRClusterProgress(72);
    const stability = await computeStabilityLocal(
      normalizedRows,
      baseline.labels,
      params.k,
      params.seed + 101,
      params.maxIter,
      params.stabilityRuns,
      params.rowRatio,
      params.featureRatio,
      function (done, total) {
        const ratio = total > 0 ? done / total : 1;
        setRClusterProgress(72 + ratio * 22);
      }
    );

    const centroidDistance = computeCentroidDistanceSummaryLocal(baseline.centroids);
    const sizes = computeClusterSizesLocal(baseline.labels, params.k);
    const clusters = [];
    for (let clusterId = 0; clusterId < sizes.length; clusterId += 1) {
      const centroid = baseline.centroids[clusterId];
      let normSquared = 0;
      for (let index = 0; index < centroid.length; index += 1) {
        normSquared += centroid[index] * centroid[index];
      }
      clusters.push({
        cluster: clusterId,
        size: sizes[clusterId],
        ratio: sizes[clusterId] / Math.max(1, normalizedRows.length),
        centroid_norm: Math.sqrt(Math.max(0, normSquared))
      });
    }

    const purity = computeClusterPurityLocal(baseline.labels, dataset.classLabels, params.k);
    const projection = buildProjectionForVisualization(normalizedRows, 900, params.seed + 313);
    const topFeatureIndices = computeTopFeatureIndicesByClusterSeparation(
      normalizedRows,
      baseline.labels,
      params.k,
      12
    );
    const featureMeans = buildClusterFeatureMeanMatrix(
      normalizedRows,
      baseline.labels,
      params.k,
      topFeatureIndices
    );
    const examples = computeRClusterExampleRows(
      normalizedRows,
      baseline.labels,
      baseline.centroids,
      Array.isArray(dataset.rowTimesSeconds) ? dataset.rowTimesSeconds : [],
      dataset.classLabels
    );
    const mapPoints = projection
      ? projection.points.map(function (point, index) {
          const sourceIndex = projection.indices[index];
          const cluster = sanitizeInt(baseline.labels[sourceIndex], 0, 0, Math.max(0, params.k - 1));
          const classLabel =
            Array.isArray(dataset.classLabels) && sourceIndex < dataset.classLabels.length
              ? dataset.classLabels[sourceIndex]
              : "unknown";
          const timeSec =
            Array.isArray(dataset.rowTimesSeconds) &&
            Number.isFinite(Number(dataset.rowTimesSeconds[sourceIndex]))
              ? Number(dataset.rowTimesSeconds[sourceIndex])
              : Number.NaN;
          return {
            x: point.x,
            y: point.y,
            category: "cluster_" + cluster,
            categoryIndex: cluster,
            classLabel,
            timeSec,
            rowIndex: sourceIndex
          };
        })
      : [];
    return {
      command: "r-cluster",
      schema_version: "0.2.0-js",
      status: "ok",
      input: {
        source: "webview-js",
        sample_count: normalizedRows.length,
        feature_count: dataset.featureColumns.length,
        feature_columns: dataset.featureColumns
      },
      params: {
        k: params.k,
        seed: params.seed,
        max_iter: params.maxIter,
        stability_runs: params.stabilityRuns,
        row_ratio: params.rowRatio,
        feature_ratio: params.featureRatio,
        representation: "zscore(feature columns) + euclidean distance",
        backend: "javascript"
      },
      diagnostics: {
        inertia: baseline.inertia,
        silhouette,
        stability,
        centroid_distance: centroidDistance
      },
      clusters,
      classwise: {
        labels_source: "activation_overlay",
        purity
      },
      visualization: {
        map: {
          points: mapPoints,
          explained_ratios:
            projection && Array.isArray(projection.explainedRatios)
              ? projection.explainedRatios.slice(0, 2)
              : []
        },
        summary: {
          cluster_sizes: sizes.map(function (size, cluster) {
            return { cluster, size };
          })
        },
        why: {
          feature_indices: topFeatureIndices,
          feature_labels: topFeatureIndices.map(function (featureIndex) {
            return dataset.featureColumns[featureIndex] || "f" + featureIndex;
          }),
          cluster_feature_means: featureMeans
        },
        examples: {
          medoids: examples.medoids,
          borderlines: examples.borderlines
        }
      }
    };
  }

  function renderRClusterResults() {
    if (!rclusterResults) {
      return;
    }

    rclusterResults.innerHTML = "";
    if (!rClusterResult || typeof rClusterResult !== "object") {
      rclusterResults.appendChild(
        createMetricsGroup("r-Clustering", [["Status", "Run clustering to view diagnostics."]])
      );
      return;
    }

    const result = asRecord(rClusterResult);
    if (!result) {
      rclusterResults.appendChild(
        createMetricsGroup("r-Clustering", [["Status", "Invalid result payload."]])
      );
      return;
    }

    const input = asRecord(result.input);
    const params = asRecord(result.params);
    const diagnostics = asRecord(result.diagnostics);
    const stability = diagnostics ? asRecord(diagnostics.stability) : null;
    const centroidDistance = diagnostics ? asRecord(diagnostics.centroid_distance) : null;

    rclusterResults.appendChild(
      createMetricsGroup("r-Clustering Input", [
        [
          "Feature source",
          rClusterLastRunContext && rClusterLastRunContext.sourceDescription
            ? rClusterLastRunContext.sourceDescription
            : rClusterRepresentationMode === "stft"
              ? "short-time STFT spectrogram features"
              : "short-time mel features"
        ],
        [
          "Frames / features (used)",
          String(
            rClusterLastRunContext && Number.isFinite(rClusterLastRunContext.frameCountUsed)
              ? rClusterLastRunContext.frameCountUsed
              : sanitizeInt(input && input.sample_count, 0, 0, 1000000000)
          ) +
            " / " +
            String(
              rClusterLastRunContext && Number.isFinite(rClusterLastRunContext.featureCountUsed)
                ? rClusterLastRunContext.featureCountUsed
                : sanitizeInt(input && input.feature_count, 0, 0, 1000000000)
            )
        ],
        [
          "Frames / features (original)",
          String(
            rClusterLastRunContext && Number.isFinite(rClusterLastRunContext.frameCountOriginal)
              ? rClusterLastRunContext.frameCountOriginal
              : sanitizeInt(input && input.sample_count, 0, 0, 1000000000)
          ) +
            " / " +
            String(
              rClusterLastRunContext && Number.isFinite(rClusterLastRunContext.featureCountOriginal)
                ? rClusterLastRunContext.featureCountOriginal
                : sanitizeInt(input && input.feature_count, 0, 0, 1000000000)
            )
        ],
        [
          "Derived classes (active/inactive)",
          String(
            rClusterLastRunContext && Number.isFinite(rClusterLastRunContext.activeFrames)
              ? rClusterLastRunContext.activeFrames
              : 0
          ) +
            " / " +
            String(
              rClusterLastRunContext && Number.isFinite(rClusterLastRunContext.inactiveFrames)
                ? rClusterLastRunContext.inactiveFrames
                : 0
            )
        ],
        [
          "Analysis channel",
          rClusterLastRunContext && rClusterLastRunContext.analysisSource
            ? rClusterLastRunContext.analysisSource
            : getSingleChannelAnalysisLabel()
        ],
        [
          "k / seed / max_iter",
          String(sanitizeInt(params && params.k, 0, 0, 1024)) +
            " / " +
            String(sanitizeInt(params && params.seed, 0, -2147483648, 2147483647)) +
            " / " +
            String(sanitizeInt(params && params.max_iter, 0, 0, 1000000))
        ]
      ])
    );

    rclusterResults.appendChild(
      createMetricsGroup("r-Clustering Diagnostics", [
        ["Inertia", formatMetricNumber(Number(diagnostics && diagnostics.inertia), 5)],
        ["Silhouette", formatMetricNumber(Number(diagnostics && diagnostics.silhouette), 5)],
        [
          "Stability (mean/std/min/max)",
          formatMetricNumber(Number(stability && stability.mean), 4) +
            " / " +
            formatMetricNumber(Number(stability && stability.std), 4) +
            " / " +
            formatMetricNumber(Number(stability && stability.min), 4) +
            " / " +
            formatMetricNumber(Number(stability && stability.max), 4)
        ],
        [
          "Centroid distance (min/mean)",
          formatMetricNumber(Number(centroidDistance && centroidDistance.min), 4) +
            " / " +
            formatMetricNumber(Number(centroidDistance && centroidDistance.mean), 4)
        ]
      ])
    );

    const clusters = Array.isArray(result.clusters) ? result.clusters : [];
    if (clusters.length > 0) {
      for (let index = 0; index < clusters.length; index += 1) {
        const cluster = asRecord(clusters[index]);
        if (!cluster) {
          continue;
        }
        rclusterResults.appendChild(
          createMetricsGroup("Cluster " + sanitizeInt(cluster.cluster, index, 0, 1000000), [
            ["Size", String(sanitizeInt(cluster.size, 0, 0, 1000000000))],
            ["Ratio", formatMetricPercent(Number(cluster.ratio))],
            ["Centroid norm", formatMetricNumber(Number(cluster.centroid_norm), 4)]
          ])
        );
      }
    }

    const classwise = asRecord(result.classwise);
    const purity = classwise ? asRecord(classwise.purity) : null;
    if (purity) {
      rclusterResults.appendChild(
        createMetricsGroup("Classwise Purity", [
          [
            "Overall purity",
            formatMetricPercent(Number(purity.overall_purity))
          ]
        ])
      );
    }

    renderRClusterVisualizations(result);
  }

  function renderRClusterVisualizations(result) {
    const visualization = result ? asRecord(result.visualization) : null;
    if (!visualization) {
      return;
    }

    const map = asRecord(visualization.map);
    const summary = asRecord(visualization.summary);
    const why = asRecord(visualization.why);
    const examples = asRecord(visualization.examples);

    const mapPoints = map && Array.isArray(map.points) ? map.points : [];
    if (mapPoints.length > 0) {
      const explained = Array.isArray(map.explained_ratios) ? map.explained_ratios : [];
      const card = createAnalysisVizCard(
        "Map",
        "PCA(2D) of clustering feature space" +
          (explained.length > 0
            ? " | explained=" +
              formatMetricPercent(Number(explained[0] || 0)) +
              ", " +
              formatMetricPercent(Number(explained[1] || 0))
            : "")
      );
      const canvas = createAnalysisCanvas(760, 280);
      const clusterKeys = new Set();
      for (let index = 0; index < mapPoints.length; index += 1) {
        const point = asRecord(mapPoints[index]);
        if (!point) {
          continue;
        }
        clusterKeys.add(String(point.category || "cluster_0"));
      }
      const legend = Array.from(clusterKeys)
        .sort()
        .map(function (key, index) {
          return { key, label: key.replace("cluster_", "cluster "), index };
        });
      drawAnalysisScatter(
        canvas,
        mapPoints.map(function (entry) {
          const point = asRecord(entry);
          return {
            x: point ? Number(point.x || 0) : 0,
            y: point ? Number(point.y || 0) : 0,
            category: point ? String(point.category || "cluster_0") : "cluster_0",
            categoryIndex: point ? sanitizeInt(String(point.category || "").replace("cluster_", ""), 0, 0, 1000) : 0
          };
        }),
        legend
      );
      card.appendChild(canvas);
      rclusterResults.appendChild(card);
    }

    const clusterSizes = summary && Array.isArray(summary.cluster_sizes) ? summary.cluster_sizes : [];
    if (clusterSizes.length > 0) {
      const labels = [];
      const values = [];
      for (let index = 0; index < clusterSizes.length; index += 1) {
        const item = asRecord(clusterSizes[index]);
        if (!item) {
          continue;
        }
        labels.push("cluster " + sanitizeInt(item.cluster, index, 0, 1000));
        values.push(sanitizeInt(item.size, 0, 0, 1000000000));
      }
      const summaryCard = createAnalysisVizCard("Summary", "Cluster size distribution");
      const canvas = createAnalysisCanvas(760, Math.max(180, labels.length * 24 + 40));
      drawAnalysisBarChart(canvas, labels, values, "#38bdf8");
      summaryCard.appendChild(canvas);
      rclusterResults.appendChild(summaryCard);
    }

    const featureLabels = why && Array.isArray(why.feature_labels) ? why.feature_labels : [];
    const featureMeans = why && Array.isArray(why.cluster_feature_means) ? why.cluster_feature_means : [];
    if (featureLabels.length > 0 && featureMeans.length > 0) {
      const whyCard = createAnalysisVizCard(
        "Why",
        "Cluster x feature fingerprint heatmap (top separating features)"
      );
      const rowLabels = featureMeans.map(function (_, rowIndex) {
        return "c" + rowIndex;
      });
      const colLabels = featureLabels.map(function (label) {
        return String(label);
      });
      const heatmap = createAnalysisCanvas(760, Math.max(220, featureMeans.length * 28 + 56));
      drawAnalysisHeatmap(heatmap, featureMeans, rowLabels, colLabels);
      whyCard.appendChild(heatmap);
      rclusterResults.appendChild(whyCard);
    }

    const medoids = examples && Array.isArray(examples.medoids) ? examples.medoids : [];
    const borderlines = examples && Array.isArray(examples.borderlines) ? examples.borderlines : [];
    if (medoids.length > 0 || borderlines.length > 0) {
      const examplesCard = createAnalysisVizCard(
        "Examples",
        "Representatives (medoids) and borderline frames"
      );
      const rows = [];
      for (let index = 0; index < Math.min(8, medoids.length); index += 1) {
        const item = asRecord(medoids[index]);
        if (!item) {
          continue;
        }
        rows.push([
          "medoid",
          sanitizeInt(item.cluster, 0, 0, 1000),
          sanitizeInt(item.rowIndex, 0, 0, 1000000000),
          formatMetricNumber(Number(item.timeSec), 3),
          String(item.classLabel || ""),
          formatMetricNumber(Number(item.distance), 4)
        ]);
      }
      for (let index = 0; index < Math.min(6, borderlines.length); index += 1) {
        const item = asRecord(borderlines[index]);
        if (!item) {
          continue;
        }
        rows.push([
          "borderline",
          sanitizeInt(item.cluster, 0, 0, 1000),
          sanitizeInt(item.rowIndex, 0, 0, 1000000000),
          formatMetricNumber(Number(item.timeSec), 3),
          String(item.classLabel || ""),
          formatMetricNumber(Number(item.margin), 4)
        ]);
      }
      if (rows.length > 0) {
        examplesCard.appendChild(
          createAnalysisExamplesTable(
            ["type", "cluster", "row", "time(s)", "class", "score"],
            rows
          )
        );
        rclusterResults.appendChild(examplesCard);
      }
    }
  }

  function updateAnalysisToolPanelVisibility() {
    const selectedTool = sanitizeAnalysisTool(
      analysisToolSelect.value || (state.analysis && state.analysis.tool),
      "random_forest"
    );
    activeAnalysisTool = selectedTool;
    state.analysis.tool = selectedTool;
    analysisToolSelect.value = selectedTool;
    analysisPanelRcluster.classList.toggle("is-active", selectedTool === "rcluster");
    analysisPanelRandomForest.classList.toggle("is-active", selectedTool === "random_forest");
    analysisPanelCastor.classList.toggle("is-active", selectedTool === "castor");
    analysisPanelSpf.classList.toggle("is-active", selectedTool === "spf");
  }

  function updateAnalysisPanelsAndControls() {
    updateAnalysisToolPanelVisibility();
    updateRClusterControls();
    updateRandomForestControls();
    updateCastorControls();
    updateSpfControls();
  }

  function updateRClusterControls() {
    const hasAudio = Boolean(primaryAudio && primaryAudio.samples && primaryAudio.samples.length > 0);
    const hasOverlay = Boolean(state.overlay.enabled && overlayParsed && overlayParsed.intervals.length > 0);

    rclusterFeaturePath.textContent =
      "Feature source: " +
      (rClusterRepresentationMode === "stft"
        ? "short-time STFT log-magnitude spectrogram frames"
        : "short-time mel frames") +
      ". Backend: in-browser JavaScript.";
    rclusterLabelsPath.textContent = hasOverlay
      ? "Activation overlay loaded: " +
        overlayParsed.intervals.length +
        " intervals, mode=" +
        overlayParsed.mode +
        "."
      : "Activation overlay required to derive active/inactive labels.";

    rclusterRun.disabled = rClusterRunning || !hasAudio || !hasOverlay;
    rclusterRepresentation.disabled = rClusterRunning;
  }

  function getRandomForestParamsFromInputs() {
    return {
      source:
        typeof rfSource.value === "string" && (rfSource.value === "mel" || rfSource.value === "stft")
          ? rfSource.value
          : "mel",
      treeCount: sanitizeInt(rfTreeCount.value, 96, 8, 512),
      maxDepth: sanitizeInt(rfMaxDepth.value, 8, 1, 24),
      minLeaf: sanitizeInt(rfMinLeaf.value, 4, 1, 128),
      featureRatio: sanitizeFloat(rfFeatureRatio.value, 0.35, 0.05, 1),
      maxFrames: sanitizeInt(rfMaxFrames.value, 2200, 128, RANDOM_FOREST_MAX_ROWS),
      topFeatures: sanitizeInt(rfTopFeatures.value, 20, 5, 200)
    };
  }

  function syncRandomForestParamsFromInputs() {
    const params = getRandomForestParamsFromInputs();
    randomForestSourceMode = params.source;
    rfSource.value = params.source;
    rfTreeCount.value = String(params.treeCount);
    rfMaxDepth.value = String(params.maxDepth);
    rfMinLeaf.value = String(params.minLeaf);
    rfFeatureRatio.value = formatMetricNumber(params.featureRatio, 2);
    rfMaxFrames.value = String(params.maxFrames);
    rfTopFeatures.value = String(params.topFeatures);
    return params;
  }

  function setRandomForestStatus(message) {
    rfStatus.textContent = message;
  }

  function setRandomForestProgress(value) {
    const numeric = Number(value);
    const clampedValue = Number.isFinite(numeric) ? clamp(numeric, 0, 100) : 0;
    rfProgress.value = clampedValue;
    rfProgress.classList.toggle("is-active", clampedValue > 0 && clampedValue < 100);
  }

  function buildRandomForestDataset(params) {
    const analysisAudio = getSingleChannelAnalysisAudio();
    if (!analysisAudio || !analysisAudio.samples || analysisAudio.samples.length === 0) {
      throw new Error("Load a primary audio clip first.");
    }
    if (!state.overlay.enabled || !overlayParsed || !Array.isArray(overlayParsed.intervals)) {
      throw new Error("Enable Activation Overlay and load overlay CSV labels first.");
    }

    const featureSource = buildShortTimeFeatureRowsForMode(analysisAudio, params.source);
    const featureRows = featureSource.featureRows;
    const frameTimesSeconds = featureSource.frameTimesSeconds;
    const frameCount = Math.min(featureRows.length, frameTimesSeconds.length);
    if (frameCount < 16) {
      throw new Error("Not enough short-time frames for random forest diagnostics.");
    }

    const classSummary = buildRClusterClassLabels(
      frameTimesSeconds.slice(0, frameCount),
      overlayParsed.intervals
    );
    if (!classSummary) {
      throw new Error("Unable to derive active/inactive frame labels from overlay.");
    }
    if (
      classSummary.activeCount < RANDOM_FOREST_MIN_CLASS_FRAMES ||
      classSummary.inactiveCount < RANDOM_FOREST_MIN_CLASS_FRAMES
    ) {
      throw new Error(
        "Need at least " +
          RANDOM_FOREST_MIN_CLASS_FRAMES +
          " active and inactive frames. active=" +
          classSummary.activeCount +
          ", inactive=" +
          classSummary.inactiveCount +
          "."
      );
    }

    const rowStride = Math.max(1, Math.ceil(frameCount / params.maxFrames));
    const rows = [];
    const labels = [];
    const rowTimesSeconds = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += rowStride) {
      rows.push(featureRows[frameIndex]);
      labels.push(classSummary.labels[frameIndex] === "active" ? 1 : 0);
      rowTimesSeconds.push(Number(frameTimesSeconds[frameIndex] || 0));
    }
    if (rows.length < 16) {
      throw new Error("Not enough frames after sampling for random forest.");
    }

    const sourceFeatureCount = rows[0] ? rows[0].length : 0;
    const outputFeatureCount = Math.min(
      RANDOM_FOREST_MAX_COLUMNS,
      Math.max(1, sourceFeatureCount)
    );
    const processedRows = new Array(rows.length);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const sourceRow = rows[rowIndex];
      const values =
        sourceRow.length > outputFeatureCount
          ? resampleVectorToLength(sourceRow, outputFeatureCount)
          : sourceRow;
      const processed = new Float32Array(outputFeatureCount);
      for (let col = 0; col < outputFeatureCount; col += 1) {
        const numeric = Number(values[col] || 0);
        processed[col] = Number.isFinite(numeric) ? numeric : 0;
      }
      processedRows[rowIndex] = processed;
    }

    let activeFrames = 0;
    for (let index = 0; index < labels.length; index += 1) {
      activeFrames += labels[index] ? 1 : 0;
    }
    const inactiveFrames = labels.length - activeFrames;
    if (
      activeFrames < RANDOM_FOREST_MIN_CLASS_FRAMES ||
      inactiveFrames < RANDOM_FOREST_MIN_CLASS_FRAMES
    ) {
      throw new Error(
        "Insufficient class balance after sampling. active=" +
          activeFrames +
          ", inactive=" +
          inactiveFrames +
          "."
      );
    }

    const featureColumns = new Array(outputFeatureCount);
    for (let featureIndex = 0; featureIndex < outputFeatureCount; featureIndex += 1) {
      featureColumns[featureIndex] = params.source + "_f" + featureIndex;
    }

    return {
      rows: processedRows,
      labels,
      rowTimesSeconds,
      featureColumns,
      runContext: {
        source: params.source,
        sourceDescription: featureSource.sourceDescription,
        frameCountOriginal: frameCount,
        frameCountUsed: processedRows.length,
        featureCountOriginal: sourceFeatureCount,
        featureCountUsed: outputFeatureCount,
        rowStride,
        activeFrames,
        inactiveFrames,
        overlayMode: overlayParsed.mode,
        analysisSource: getSingleChannelAnalysisLabel(),
        backend: "javascript"
      }
    };
  }

  function computeBinaryGiniForCounts(positive, negative) {
    const total = positive + negative;
    if (total <= 0) {
      return 0;
    }
    const p = positive / total;
    const q = negative / total;
    return 1 - (p * p + q * q);
  }

  function chooseRandomForestSplit(rows, labels, indices, featureIndices, minLeaf) {
    if (!Array.isArray(indices) || indices.length === 0) {
      return null;
    }

    let parentPositive = 0;
    for (let index = 0; index < indices.length; index += 1) {
      parentPositive += labels[indices[index]] ? 1 : 0;
    }
    const parentNegative = indices.length - parentPositive;
    if (parentPositive === 0 || parentNegative === 0) {
      return null;
    }

    const parentGini = computeBinaryGiniForCounts(parentPositive, parentNegative);
    let bestGain = 0;
    let bestFeatureIndex = -1;
    let bestThreshold = 0;

    const thresholdTrials = Math.max(3, Math.min(7, Math.floor(Math.sqrt(indices.length) / 3)));
    for (let featureCursor = 0; featureCursor < featureIndices.length; featureCursor += 1) {
      const featureIndex = featureIndices[featureCursor];
      let minValue = Number.POSITIVE_INFINITY;
      let maxValue = Number.NEGATIVE_INFINITY;
      for (let rowCursor = 0; rowCursor < indices.length; rowCursor += 1) {
        const value = Number(rows[indices[rowCursor]][featureIndex] || 0);
        if (value < minValue) {
          minValue = value;
        }
        if (value > maxValue) {
          maxValue = value;
        }
      }
      if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue - minValue <= 1e-12) {
        continue;
      }

      for (let trial = 1; trial <= thresholdTrials; trial += 1) {
        const threshold = minValue + ((maxValue - minValue) * trial) / (thresholdTrials + 1);
        let leftPositive = 0;
        let leftNegative = 0;
        let rightPositive = 0;
        let rightNegative = 0;

        for (let rowCursor = 0; rowCursor < indices.length; rowCursor += 1) {
          const rowIndex = indices[rowCursor];
          const goesLeft = Number(rows[rowIndex][featureIndex] || 0) <= threshold;
          if (goesLeft) {
            if (labels[rowIndex]) {
              leftPositive += 1;
            } else {
              leftNegative += 1;
            }
          } else if (labels[rowIndex]) {
            rightPositive += 1;
          } else {
            rightNegative += 1;
          }
        }

        const leftCount = leftPositive + leftNegative;
        const rightCount = rightPositive + rightNegative;
        if (leftCount < minLeaf || rightCount < minLeaf) {
          continue;
        }

        const weightedGini =
          (leftCount / indices.length) * computeBinaryGiniForCounts(leftPositive, leftNegative) +
          (rightCount / indices.length) * computeBinaryGiniForCounts(rightPositive, rightNegative);
        const gain = parentGini - weightedGini;
        if (gain > bestGain + 1e-12) {
          bestGain = gain;
          bestFeatureIndex = featureIndex;
          bestThreshold = threshold;
        }
      }
    }

    if (bestFeatureIndex < 0) {
      return null;
    }

    const leftIndices = [];
    const rightIndices = [];
    for (let index = 0; index < indices.length; index += 1) {
      const rowIndex = indices[index];
      if (Number(rows[rowIndex][bestFeatureIndex] || 0) <= bestThreshold) {
        leftIndices.push(rowIndex);
      } else {
        rightIndices.push(rowIndex);
      }
    }

    if (leftIndices.length < minLeaf || rightIndices.length < minLeaf) {
      return null;
    }

    return {
      featureIndex: bestFeatureIndex,
      threshold: bestThreshold,
      gain: bestGain,
      leftIndices,
      rightIndices
    };
  }

  function trainRandomForestTree(rows, labels, bootstrapIndices, params, random, featureImportance) {
    const featureCount = rows[0] ? rows[0].length : 0;
    const root = {};
    const stack = [{ node: root, indices: bootstrapIndices, depth: 0 }];

    while (stack.length > 0) {
      const workItem = stack.pop();
      const node = workItem.node;
      const indices = workItem.indices;
      const depth = workItem.depth;

      if (!Array.isArray(indices) || indices.length === 0) {
        node.leafProbability = 0.5;
        node.sampleCount = 0;
        continue;
      }

      let positive = 0;
      for (let index = 0; index < indices.length; index += 1) {
        positive += labels[indices[index]] ? 1 : 0;
      }
      const negative = indices.length - positive;
      const leafProbability = positive / Math.max(1, indices.length);

      const shouldStop =
        depth >= params.maxDepth ||
        indices.length <= params.minLeaf * 2 ||
        positive === 0 ||
        negative === 0 ||
        featureCount <= 0;
      if (shouldStop) {
        node.leafProbability = leafProbability;
        node.sampleCount = indices.length;
        node.positiveCount = positive;
        continue;
      }

      const mtry = Math.max(1, Math.min(featureCount, Math.round(featureCount * params.featureRatio)));
      const candidateFeatures = sampleIndicesWithoutReplacement(featureCount, mtry, random);
      const split = chooseRandomForestSplit(
        rows,
        labels,
        indices,
        candidateFeatures,
        params.minLeaf
      );

      if (!split) {
        node.leafProbability = leafProbability;
        node.sampleCount = indices.length;
        node.positiveCount = positive;
        continue;
      }

      node.featureIndex = split.featureIndex;
      node.threshold = split.threshold;
      node.sampleCount = indices.length;
      node.positiveCount = positive;
      node.left = {};
      node.right = {};
      featureImportance[split.featureIndex] += split.gain * indices.length;

      stack.push({ node: node.right, indices: split.rightIndices, depth: depth + 1 });
      stack.push({ node: node.left, indices: split.leftIndices, depth: depth + 1 });
    }

    return root;
  }

  function predictRandomForestTreeProbability(
    tree,
    row,
    overrideFeatureIndex,
    overrideFeatureValue
  ) {
    let node = tree;
    while (node && typeof node === "object" && !Number.isFinite(node.leafProbability)) {
      const featureIndex = sanitizeInt(node.featureIndex, -1, -1, 1000000);
      const threshold = Number(node.threshold);
      if (featureIndex < 0 || !Number.isFinite(threshold)) {
        break;
      }
      const value =
        Number.isFinite(overrideFeatureIndex) && featureIndex === overrideFeatureIndex
          ? Number(overrideFeatureValue || 0)
          : Number(row[featureIndex] || 0);
      node = value <= threshold ? node.left : node.right;
    }

    if (node && Number.isFinite(node.leafProbability)) {
      return clamp(Number(node.leafProbability), 0, 1);
    }
    return 0.5;
  }

  function predictRandomForestProbability(
    forestTrees,
    row,
    overrideFeatureIndex,
    overrideFeatureValue
  ) {
    if (!Array.isArray(forestTrees) || forestTrees.length === 0) {
      return 0.5;
    }
    let sum = 0;
    let count = 0;
    for (let index = 0; index < forestTrees.length; index += 1) {
      const tree = forestTrees[index];
      if (!tree || typeof tree !== "object") {
        continue;
      }
      sum += predictRandomForestTreeProbability(
        tree,
        row,
        overrideFeatureIndex,
        overrideFeatureValue
      );
      count += 1;
    }
    return count > 0 ? sum / count : 0.5;
  }

  function computeRandomForestAccuracyForIndices(
    rows,
    labels,
    forestTrees,
    indices,
    overrideFeatureIndex,
    replacementValues
  ) {
    if (!Array.isArray(indices) || indices.length === 0) {
      return 0;
    }
    let correct = 0;
    for (let sampleIndex = 0; sampleIndex < indices.length; sampleIndex += 1) {
      const rowIndex = indices[sampleIndex];
      const row = rows[rowIndex];
      const overrideValue =
        Number.isFinite(overrideFeatureIndex) && Array.isArray(replacementValues)
          ? replacementValues[sampleIndex]
          : undefined;
      const probability = predictRandomForestProbability(
        forestTrees,
        row,
        overrideFeatureIndex,
        overrideValue
      );
      const prediction = probability >= 0.5 ? 1 : 0;
      if (prediction === (labels[rowIndex] ? 1 : 0)) {
        correct += 1;
      }
    }
    return correct / Math.max(1, indices.length);
  }

  function buildRandomForestPdp(
    rows,
    labels,
    forestTrees,
    featureIndex,
    evalIndices,
    iceCount,
    gridPoints
  ) {
    if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(evalIndices)) {
      return null;
    }
    const values = evalIndices.map(function (rowIndex) {
      return Number(rows[rowIndex][featureIndex] || 0);
    });
    const sorted = values.slice().sort(function (a, b) {
      return a - b;
    });
    if (sorted.length === 0) {
      return null;
    }

    const grid = [];
    const steps = Math.max(5, sanitizeInt(gridPoints, 12, 5, 32));
    for (let step = 0; step < steps; step += 1) {
      const q = steps <= 1 ? 0 : step / (steps - 1);
      grid.push(quantileSorted(sorted, q));
    }

    const meanProbabilities = new Array(grid.length);
    for (let gridIndex = 0; gridIndex < grid.length; gridIndex += 1) {
      const fixedValue = grid[gridIndex];
      let sum = 0;
      for (let sampleIndex = 0; sampleIndex < evalIndices.length; sampleIndex += 1) {
        const rowIndex = evalIndices[sampleIndex];
        sum += predictRandomForestProbability(forestTrees, rows[rowIndex], featureIndex, fixedValue);
      }
      meanProbabilities[gridIndex] = sum / Math.max(1, evalIndices.length);
    }

    const random = createSeededRandom(5011 + featureIndex * 31 + evalIndices.length);
    const iceSampleCount = Math.max(1, Math.min(evalIndices.length, sanitizeInt(iceCount, 8, 1, 24)));
    const iceIndices =
      evalIndices.length <= iceSampleCount
        ? evalIndices.slice()
        : sampleIndicesWithoutReplacement(evalIndices.length, iceSampleCount, random).map(
            function (idx) {
              return evalIndices[idx];
            }
          );
    const ice = iceIndices.map(function (rowIndex) {
      const valuesForRow = new Array(grid.length);
      for (let gridIndex = 0; gridIndex < grid.length; gridIndex += 1) {
        valuesForRow[gridIndex] = predictRandomForestProbability(
          forestTrees,
          rows[rowIndex],
          featureIndex,
          grid[gridIndex]
        );
      }
      return { rowIndex, values: valuesForRow, classLabel: labels[rowIndex] ? "active" : "inactive" };
    });

    return {
      featureIndex,
      grid,
      meanProbabilities,
      ice
    };
  }

  function computeBinaryMetricsFromProbabilities(labels, probabilitySums, voteCounts) {
    let evaluated = 0;
    let correct = 0;
    let tp = 0;
    let tn = 0;
    let fp = 0;
    let fn = 0;

    for (let index = 0; index < labels.length; index += 1) {
      const count = voteCounts[index];
      if (!count) {
        continue;
      }
      evaluated += 1;
      const probability = probabilitySums[index] / count;
      const prediction = probability >= 0.5 ? 1 : 0;
      const target = labels[index] ? 1 : 0;
      if (prediction === target) {
        correct += 1;
      }
      if (prediction === 1 && target === 1) {
        tp += 1;
      } else if (prediction === 0 && target === 0) {
        tn += 1;
      } else if (prediction === 1 && target === 0) {
        fp += 1;
      } else {
        fn += 1;
      }
    }

    const accuracy = evaluated > 0 ? correct / evaluated : 0;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    return {
      evaluated,
      accuracy,
      precision,
      recall,
      f1,
      coverage: evaluated / Math.max(1, labels.length),
      confusion: { tp, tn, fp, fn }
    };
  }

  async function runRandomForestInBrowserLocal(dataset, params) {
    if (!dataset || !Array.isArray(dataset.rows) || dataset.rows.length < 4) {
      throw new Error("Not enough rows to run random forest.");
    }

    setRandomForestProgress(16);
    await waitForUiFrame();
    const normalizedRows = zscoreRowsByColumn(dataset.rows);
    const rowCount = normalizedRows.length;
    const featureCount = normalizedRows[0] ? normalizedRows[0].length : 0;
    if (featureCount <= 0) {
      throw new Error("No feature columns available for random forest.");
    }

    const featureImportance = new Float64Array(featureCount);
    const inSampleProbabilitySums = new Float64Array(rowCount);
    const inSampleVoteCounts = new Uint16Array(rowCount);
    const oobProbabilitySums = new Float64Array(rowCount);
    const oobVoteCounts = new Uint16Array(rowCount);

    const seed =
      123457 +
      params.treeCount * 17 +
      params.maxDepth * 31 +
      params.minLeaf * 101 +
      Math.round(params.featureRatio * 1000);
    const random = createSeededRandom(seed);
    let fittedTrees = 0;
    const forestTrees = [];

    for (let treeIndex = 0; treeIndex < params.treeCount; treeIndex += 1) {
      const bootstrapIndices = new Array(rowCount);
      const inBag = new Uint8Array(rowCount);
      for (let sampleIndex = 0; sampleIndex < rowCount; sampleIndex += 1) {
        const picked = Math.floor(random() * rowCount);
        bootstrapIndices[sampleIndex] = picked;
        inBag[picked] = 1;
      }

      const tree = trainRandomForestTree(
        normalizedRows,
        dataset.labels,
        bootstrapIndices,
        params,
        random,
        featureImportance
      );
      fittedTrees += 1;
      forestTrees.push(tree);

      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const probability = predictRandomForestTreeProbability(tree, normalizedRows[rowIndex]);
        inSampleProbabilitySums[rowIndex] += probability;
        inSampleVoteCounts[rowIndex] += 1;
        if (!inBag[rowIndex]) {
          oobProbabilitySums[rowIndex] += probability;
          oobVoteCounts[rowIndex] += 1;
        }
      }

      const progressRatio = (treeIndex + 1) / Math.max(1, params.treeCount);
      setRandomForestProgress(20 + progressRatio * 72);
      if ((treeIndex + 1) % 4 === 0 || treeIndex + 1 === params.treeCount) {
        await waitForUiFrame();
      }
    }

    setRandomForestProgress(96);
    await waitForUiFrame();

    const inSampleMetrics = computeBinaryMetricsFromProbabilities(
      dataset.labels,
      inSampleProbabilitySums,
      inSampleVoteCounts
    );
    const oobMetrics = computeBinaryMetricsFromProbabilities(
      dataset.labels,
      oobProbabilitySums,
      oobVoteCounts
    );

    let totalImportance = 0;
    for (let featureIndex = 0; featureIndex < featureImportance.length; featureIndex += 1) {
      totalImportance += featureImportance[featureIndex];
    }
    const rankedFeatureImportances = [];
    for (let featureIndex = 0; featureIndex < featureImportance.length; featureIndex += 1) {
      const importance = featureImportance[featureIndex];
      if (importance <= 0) {
        continue;
      }
      rankedFeatureImportances.push({
        feature: dataset.featureColumns[featureIndex] || "f" + featureIndex,
        index: featureIndex,
        importance,
        normalized_importance: totalImportance > 0 ? importance / totalImportance : 0
      });
    }
    rankedFeatureImportances.sort(function (left, right) {
      return right.importance - left.importance;
    });

    const mapProjection = buildProjectionForVisualization(normalizedRows, 900, seed + 701);
    const inSampleMeanProbabilities = new Array(rowCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const count = inSampleVoteCounts[rowIndex];
      inSampleMeanProbabilities[rowIndex] = count > 0 ? inSampleProbabilitySums[rowIndex] / count : 0.5;
    }
    const mapPoints = mapProjection
      ? mapProjection.points.map(function (point, index) {
          const sourceIndex = mapProjection.indices[index];
          const probability = inSampleMeanProbabilities[sourceIndex];
          const predicted = probability >= 0.5 ? "active" : "inactive";
          const actual = dataset.labels[sourceIndex] ? "active" : "inactive";
          const timeSec =
            Array.isArray(dataset.rowTimesSeconds) &&
            Number.isFinite(Number(dataset.rowTimesSeconds[sourceIndex]))
              ? Number(dataset.rowTimesSeconds[sourceIndex])
              : Number.NaN;
          return {
            x: point.x,
            y: point.y,
            category: predicted,
            categoryIndex: predicted === "active" ? 0 : 1,
            highlighted: predicted !== actual,
            predicted,
            actual,
            probability,
            rowIndex: sourceIndex,
            timeSec
          };
        })
      : [];

    const evalSampleSize = Math.max(100, Math.min(rowCount, 700));
    const evalIndices =
      rowCount <= evalSampleSize
        ? Array.from({ length: rowCount }, function (_, index) {
            return index;
          })
        : sampleIndicesWithoutReplacement(rowCount, evalSampleSize, random);
    const baselineEvalAccuracy = computeRandomForestAccuracyForIndices(
      normalizedRows,
      dataset.labels,
      forestTrees,
      evalIndices
    );

    const permutationCandidates = rankedFeatureImportances
      .slice(0, Math.min(24, rankedFeatureImportances.length))
      .map(function (item) {
        return sanitizeInt(item.index, 0, 0, Math.max(0, featureCount - 1));
      });
    const permutationImportances = [];
    for (let idx = 0; idx < permutationCandidates.length; idx += 1) {
      const featureIndex = permutationCandidates[idx];
      const replacementValues = evalIndices.map(function (rowIndex) {
        return Number(normalizedRows[rowIndex][featureIndex] || 0);
      });
      for (let swap = replacementValues.length - 1; swap > 0; swap -= 1) {
        const pick = Math.floor(random() * (swap + 1));
        const tmp = replacementValues[swap];
        replacementValues[swap] = replacementValues[pick];
        replacementValues[pick] = tmp;
      }

      const permutedAccuracy = computeRandomForestAccuracyForIndices(
        normalizedRows,
        dataset.labels,
        forestTrees,
        evalIndices,
        featureIndex,
        replacementValues
      );
      const drop = baselineEvalAccuracy - permutedAccuracy;
      permutationImportances.push({
        feature: dataset.featureColumns[featureIndex] || "f" + featureIndex,
        index: featureIndex,
        accuracy_drop: drop,
        baseline_accuracy: baselineEvalAccuracy,
        permuted_accuracy: permutedAccuracy
      });
    }
    permutationImportances.sort(function (left, right) {
      return right.accuracy_drop - left.accuracy_drop;
    });

    const pdpFeatureIndices = permutationImportances
      .slice(0, Math.min(2, permutationImportances.length))
      .map(function (item) {
        return sanitizeInt(item.index, 0, 0, Math.max(0, featureCount - 1));
      });
    if (pdpFeatureIndices.length === 0 && rankedFeatureImportances.length > 0) {
      pdpFeatureIndices.push(
        sanitizeInt(rankedFeatureImportances[0].index, 0, 0, Math.max(0, featureCount - 1))
      );
    }
    const pdp = [];
    for (let idx = 0; idx < pdpFeatureIndices.length; idx += 1) {
      const featureIndex = pdpFeatureIndices[idx];
      const pdpEntry = buildRandomForestPdp(
        normalizedRows,
        dataset.labels,
        forestTrees,
        featureIndex,
        evalIndices,
        8,
        12
      );
      if (pdpEntry) {
        pdp.push({
          feature: dataset.featureColumns[featureIndex] || "f" + featureIndex,
          index: featureIndex,
          grid: pdpEntry.grid,
          mean_probabilities: pdpEntry.meanProbabilities,
          ice: pdpEntry.ice
        });
      }
    }

    const misclassified = [];
    const borderline = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const probability = inSampleMeanProbabilities[rowIndex];
      const predicted = probability >= 0.5 ? 1 : 0;
      const actual = dataset.labels[rowIndex] ? 1 : 0;
      const margin = Math.abs(probability - 0.5);
      const entry = {
        rowIndex,
        timeSec:
          Array.isArray(dataset.rowTimesSeconds) && Number.isFinite(Number(dataset.rowTimesSeconds[rowIndex]))
            ? Number(dataset.rowTimesSeconds[rowIndex])
            : Number.NaN,
        actual: actual === 1 ? "active" : "inactive",
        predicted: predicted === 1 ? "active" : "inactive",
        probability,
        margin
      };
      if (predicted !== actual) {
        misclassified.push(entry);
      }
      borderline.push(entry);
    }
    misclassified.sort(function (left, right) {
      return right.margin - left.margin;
    });
    borderline.sort(function (left, right) {
      return left.margin - right.margin;
    });

    return {
      command: "random-forest",
      schema_version: "0.1.0-js",
      status: "ok",
      input: {
        source: "webview-js",
        sample_count: rowCount,
        feature_count: featureCount,
        feature_columns: dataset.featureColumns
      },
      params: {
        source: params.source,
        tree_count: params.treeCount,
        max_depth: params.maxDepth,
        min_leaf: params.minLeaf,
        feature_ratio: params.featureRatio,
        max_frames: params.maxFrames,
        top_features: params.topFeatures,
        backend: "javascript"
      },
      diagnostics: {
        trees_fit: fittedTrees,
        in_sample: inSampleMetrics,
        oob: oobMetrics
      },
      feature_importances: rankedFeatureImportances.slice(0, params.topFeatures),
      permutation_importances: permutationImportances.slice(0, params.topFeatures),
      visualization: {
        map: {
          points: mapPoints,
          explained_ratios:
            mapProjection && Array.isArray(mapProjection.explainedRatios)
              ? mapProjection.explainedRatios.slice(0, 2)
              : []
        },
        summary: {
          confusion: oobMetrics.confusion
        },
        why: {
          gain_importances: rankedFeatureImportances.slice(0, params.topFeatures),
          permutation_importances: permutationImportances.slice(0, params.topFeatures),
          pdp
        },
        examples: {
          misclassified: misclassified.slice(0, 12),
          borderline: borderline.slice(0, 12)
        }
      }
    };
  }

  function renderRandomForestResults() {
    if (!rfResults) {
      return;
    }
    rfResults.innerHTML = "";
    if (!randomForestResult || typeof randomForestResult !== "object") {
      rfResults.appendChild(
        createMetricsGroup("Random Forest", [["Status", "Run random forest to view diagnostics."]])
      );
      return;
    }

    const result = asRecord(randomForestResult);
    if (!result) {
      rfResults.appendChild(
        createMetricsGroup("Random Forest", [["Status", "Invalid random forest result payload."]])
      );
      return;
    }

    const input = asRecord(result.input);
    const params = asRecord(result.params);
    const diagnostics = asRecord(result.diagnostics);
    const inSample = diagnostics ? asRecord(diagnostics.in_sample) : null;
    const oob = diagnostics ? asRecord(diagnostics.oob) : null;
    const oobConfusion = oob ? asRecord(oob.confusion) : null;
    const featureImportances = Array.isArray(result.feature_importances)
      ? result.feature_importances
      : [];
    const permutationImportances = Array.isArray(result.permutation_importances)
      ? result.permutation_importances
      : [];

    rfResults.appendChild(
      createMetricsGroup("Random Forest Input", [
        [
          "Feature source",
          randomForestLastRunContext && randomForestLastRunContext.sourceDescription
            ? randomForestLastRunContext.sourceDescription
            : randomForestSourceMode === "stft"
              ? "short-time STFT spectrogram features"
              : "short-time mel features"
        ],
        [
          "Frames / features (used)",
          String(
            randomForestLastRunContext &&
              Number.isFinite(randomForestLastRunContext.frameCountUsed)
              ? randomForestLastRunContext.frameCountUsed
              : sanitizeInt(input && input.sample_count, 0, 0, 1000000000)
          ) +
            " / " +
            String(
              randomForestLastRunContext &&
                Number.isFinite(randomForestLastRunContext.featureCountUsed)
                ? randomForestLastRunContext.featureCountUsed
                : sanitizeInt(input && input.feature_count, 0, 0, 1000000000)
            )
        ],
        [
          "Frames / features (original)",
          String(
            randomForestLastRunContext &&
              Number.isFinite(randomForestLastRunContext.frameCountOriginal)
              ? randomForestLastRunContext.frameCountOriginal
              : sanitizeInt(input && input.sample_count, 0, 0, 1000000000)
          ) +
            " / " +
            String(
              randomForestLastRunContext &&
                Number.isFinite(randomForestLastRunContext.featureCountOriginal)
                ? randomForestLastRunContext.featureCountOriginal
                : sanitizeInt(input && input.feature_count, 0, 0, 1000000000)
            )
        ],
        [
          "Derived classes (active/inactive)",
          String(
            randomForestLastRunContext && Number.isFinite(randomForestLastRunContext.activeFrames)
              ? randomForestLastRunContext.activeFrames
              : 0
          ) +
            " / " +
            String(
              randomForestLastRunContext &&
                Number.isFinite(randomForestLastRunContext.inactiveFrames)
                ? randomForestLastRunContext.inactiveFrames
                : 0
            )
        ],
        [
          "Analysis channel",
          randomForestLastRunContext && randomForestLastRunContext.analysisSource
            ? randomForestLastRunContext.analysisSource
            : getSingleChannelAnalysisLabel()
        ],
        [
          "Trees / depth / min leaf",
          String(sanitizeInt(params && params.tree_count, 0, 0, 1000000)) +
            " / " +
            String(sanitizeInt(params && params.max_depth, 0, 0, 1000000)) +
            " / " +
            String(sanitizeInt(params && params.min_leaf, 0, 0, 1000000))
        ]
      ])
    );

    rfResults.appendChild(
      createMetricsGroup("Random Forest Diagnostics", [
        [
          "In-sample accuracy",
          formatMetricPercent(Number(inSample && inSample.accuracy))
        ],
        ["OOB accuracy", formatMetricPercent(Number(oob && oob.accuracy))],
        ["OOB precision", formatMetricPercent(Number(oob && oob.precision))],
        ["OOB recall", formatMetricPercent(Number(oob && oob.recall))],
        ["OOB F1", formatMetricPercent(Number(oob && oob.f1))],
        ["OOB coverage", formatMetricPercent(Number(oob && oob.coverage))],
        [
          "Trees fit",
          String(sanitizeInt(diagnostics && diagnostics.trees_fit, 0, 0, 1000000000))
        ]
      ])
    );

    if (oobConfusion) {
      rfResults.appendChild(
        createMetricsGroup("OOB Confusion", [
          ["TP", String(sanitizeInt(oobConfusion.tp, 0, 0, 1000000000))],
          ["TN", String(sanitizeInt(oobConfusion.tn, 0, 0, 1000000000))],
          ["FP", String(sanitizeInt(oobConfusion.fp, 0, 0, 1000000000))],
          ["FN", String(sanitizeInt(oobConfusion.fn, 0, 0, 1000000000))]
        ])
      );
    }

    if (featureImportances.length === 0) {
      rfResults.appendChild(
        createMetricsGroup("Feature Importances", [["Status", "No non-zero feature importances produced."]])
      );
    } else {
      for (let index = 0; index < featureImportances.length; index += 1) {
        const item = asRecord(featureImportances[index]);
        if (!item) {
          continue;
        }
        rfResults.appendChild(
          createMetricsGroup("Feature " + (index + 1), [
            ["Name", String(item.feature || "f" + sanitizeInt(item.index, index, 0, 1000000))],
            ["Index", String(sanitizeInt(item.index, index, 0, 1000000))],
            ["Importance", formatMetricNumber(Number(item.importance), 6)],
            ["Normalized importance", formatMetricPercent(Number(item.normalized_importance))]
          ])
        );
      }
    }

    for (let index = 0; index < Math.min(10, permutationImportances.length); index += 1) {
      const item = asRecord(permutationImportances[index]);
      if (!item) {
        continue;
      }
      rfResults.appendChild(
        createMetricsGroup("Permutation " + (index + 1), [
          ["Name", String(item.feature || "f" + sanitizeInt(item.index, index, 0, 1000000))],
          ["Index", String(sanitizeInt(item.index, index, 0, 1000000))],
          ["Accuracy drop", formatMetricNumber(Number(item.accuracy_drop), 6)],
          ["Baseline acc", formatMetricPercent(Number(item.baseline_accuracy))],
          ["Permuted acc", formatMetricPercent(Number(item.permuted_accuracy))]
        ])
      );
    }

    renderRandomForestVisualizations(result);
  }

  function renderRandomForestVisualizations(result) {
    const visualization = result ? asRecord(result.visualization) : null;
    if (!visualization) {
      return;
    }

    const map = asRecord(visualization.map);
    const summary = asRecord(visualization.summary);
    const why = asRecord(visualization.why);
    const examples = asRecord(visualization.examples);

    const mapPoints = map && Array.isArray(map.points) ? map.points : [];
    if (mapPoints.length > 0) {
      const explained = Array.isArray(map.explained_ratios) ? map.explained_ratios : [];
      const card = createAnalysisVizCard(
        "Map",
        "PCA(2D) of RF feature space, colored by predicted class" +
          (explained.length > 0
            ? " | explained=" +
              formatMetricPercent(Number(explained[0] || 0)) +
              ", " +
              formatMetricPercent(Number(explained[1] || 0))
            : "") +
          " | white-ring points are misclassified."
      );
      const canvas = createAnalysisCanvas(760, 280);
      drawAnalysisScatter(
        canvas,
        mapPoints.map(function (entry) {
          const point = asRecord(entry);
          const category = point ? String(point.category || "inactive") : "inactive";
          return {
            x: point ? Number(point.x || 0) : 0,
            y: point ? Number(point.y || 0) : 0,
            category,
            categoryIndex: category === "active" ? 0 : 1,
            highlighted: Boolean(point && point.highlighted)
          };
        }),
        [
          { key: "active", label: "pred active", index: 0 },
          { key: "inactive", label: "pred inactive", index: 1 }
        ]
      );
      card.appendChild(canvas);
      rfResults.appendChild(card);
    }

    const confusion = summary ? asRecord(summary.confusion) : null;
    if (confusion) {
      const matrix = [
        [Number(confusion.tp || 0), Number(confusion.fn || 0)],
        [Number(confusion.fp || 0), Number(confusion.tn || 0)]
      ];
      const summaryCard = createAnalysisVizCard(
        "Summary",
        "OOB confusion matrix (rows=true active/inactive, cols=pred active/inactive)"
      );
      const heatmap = createAnalysisCanvas(760, 220);
      drawAnalysisHeatmap(
        heatmap,
        matrix,
        ["true active", "true inactive"],
        ["pred active", "pred inactive"]
      );
      summaryCard.appendChild(heatmap);
      rfResults.appendChild(summaryCard);
    }

    const permutation = why && Array.isArray(why.permutation_importances) ? why.permutation_importances : [];
    if (permutation.length > 0) {
      const whyCard = createAnalysisVizCard(
        "Why",
        "Permutation feature importance (accuracy drop after shuffle)"
      );
      const labels = [];
      const values = [];
      for (let index = 0; index < Math.min(16, permutation.length); index += 1) {
        const item = asRecord(permutation[index]);
        if (!item) {
          continue;
        }
        labels.push(String(item.feature || "f" + index));
        values.push(Math.max(0, Number(item.accuracy_drop) || 0));
      }
      const bar = createAnalysisCanvas(760, Math.max(220, labels.length * 24 + 40));
      drawAnalysisBarChart(bar, labels, values, "#f59e0b");
      whyCard.appendChild(bar);

      const pdp = why && Array.isArray(why.pdp) ? why.pdp : [];
      for (let index = 0; index < Math.min(2, pdp.length); index += 1) {
        const entry = asRecord(pdp[index]);
        if (!entry) {
          continue;
        }
        const meanValues = Array.isArray(entry.mean_probabilities) ? entry.mean_probabilities : [];
        if (meanValues.length === 0) {
          continue;
        }
        const subtitle = document.createElement("p");
        subtitle.className = "analysis-viz-subtitle";
        subtitle.textContent = "PDP: " + String(entry.feature || "feature");
        whyCard.appendChild(subtitle);
        const line = createAnalysisCanvas(760, 180);
        drawPcaLinePlot(line, meanValues, { color: "#f97316" });
        whyCard.appendChild(line);
      }
      rfResults.appendChild(whyCard);
    }

    const misclassified = examples && Array.isArray(examples.misclassified) ? examples.misclassified : [];
    const borderline = examples && Array.isArray(examples.borderline) ? examples.borderline : [];
    if (misclassified.length > 0 || borderline.length > 0) {
      const examplesCard = createAnalysisVizCard(
        "Examples",
        "Misclassified and borderline frame-level examples"
      );
      const rows = [];
      for (let index = 0; index < Math.min(8, misclassified.length); index += 1) {
        const item = asRecord(misclassified[index]);
        if (!item) {
          continue;
        }
        rows.push([
          "misclassified",
          sanitizeInt(item.rowIndex, 0, 0, 1000000000),
          formatMetricNumber(Number(item.timeSec), 3),
          String(item.actual || ""),
          String(item.predicted || ""),
          formatMetricNumber(Number(item.probability), 4)
        ]);
      }
      for (let index = 0; index < Math.min(8, borderline.length); index += 1) {
        const item = asRecord(borderline[index]);
        if (!item) {
          continue;
        }
        rows.push([
          "borderline",
          sanitizeInt(item.rowIndex, 0, 0, 1000000000),
          formatMetricNumber(Number(item.timeSec), 3),
          String(item.actual || ""),
          String(item.predicted || ""),
          formatMetricNumber(Number(item.probability), 4)
        ]);
      }
      if (rows.length > 0) {
        examplesCard.appendChild(
          createAnalysisExamplesTable(
            ["type", "row", "time(s)", "true", "pred", "p(active)"],
            rows
          )
        );
        rfResults.appendChild(examplesCard);
      }
    }
  }

  function updateRandomForestControls() {
    const hasAudio = Boolean(primaryAudio && primaryAudio.samples && primaryAudio.samples.length > 0);
    const hasOverlay = Boolean(state.overlay.enabled && overlayParsed && overlayParsed.intervals.length > 0);

    rfFeatureHint.textContent =
      "Feature source: " +
      (randomForestSourceMode === "stft"
        ? "short-time STFT log-magnitude spectrogram frames"
        : "short-time mel feature frames") +
      ". Backend: in-browser JavaScript.";
    rfLabelHint.textContent = hasOverlay
      ? "Activation overlay loaded: " +
        overlayParsed.intervals.length +
        " intervals, mode=" +
        overlayParsed.mode +
        "."
      : "Activation overlay required to derive active/inactive labels.";

    rfRun.disabled = randomForestRunning || !hasAudio || !hasOverlay;
    rfSource.disabled = randomForestRunning;
    rfTreeCount.disabled = randomForestRunning;
    rfMaxDepth.disabled = randomForestRunning;
    rfMinLeaf.disabled = randomForestRunning;
    rfFeatureRatio.disabled = randomForestRunning;
    rfMaxFrames.disabled = randomForestRunning;
    rfTopFeatures.disabled = randomForestRunning;
  }

  function sanitizeCastorPreset(value) {
    return value === "fast" || value === "deep" ? value : "balanced";
  }

  function applyCastorPreset(preset, options) {
    const normalizedPreset = sanitizeCastorPreset(preset);
    const shouldPostState = !(options && options.skipPostState);
    const shouldRender = !(options && options.skipRender);
    castorPresetMode = normalizedPreset;
    castorPreset.value = normalizedPreset;

    if (normalizedPreset === "fast") {
      castorMaxFrames.value = "1200";
      castorPadLength.value = "0";
      castorTopDims.value = "12";
      castorNormalize.checked = true;
    } else if (normalizedPreset === "deep") {
      castorMaxFrames.value = "3600";
      castorPadLength.value = "0";
      castorTopDims.value = "28";
      castorNormalize.checked = true;
    } else {
      castorMaxFrames.value = "2200";
      castorPadLength.value = "0";
      castorTopDims.value = "16";
      castorNormalize.checked = true;
    }

    syncCastorParamsFromInputs();
    if (shouldRender) {
      updateAnalysisPanelsAndControls();
    }
    if (shouldPostState) {
      postState();
    }
  }

  function getCastorParamsFromInputs() {
    return {
      source:
        typeof castorSource.value === "string" &&
        (castorSource.value === "mel" || castorSource.value === "stft")
          ? castorSource.value
          : "mel",
      preset: sanitizeCastorPreset(castorPreset.value),
      maxFrames: sanitizeInt(castorMaxFrames.value, 2200, 128, CASTOR_MAX_ROWS),
      padLength: sanitizeInt(castorPadLength.value, 0, 0, 4096),
      topDims: sanitizeInt(castorTopDims.value, 16, 4, 128),
      normalize: Boolean(castorNormalize.checked)
    };
  }

  function syncCastorParamsFromInputs() {
    const params = getCastorParamsFromInputs();
    castorSourceMode = params.source;
    castorPresetMode = params.preset;
    castorSource.value = params.source;
    castorPreset.value = params.preset;
    castorMaxFrames.value = String(params.maxFrames);
    castorPadLength.value = String(params.padLength);
    castorTopDims.value = String(params.topDims);
    castorNormalize.checked = params.normalize;
    return params;
  }

  function setCastorStatus(message) {
    castorStatus.textContent = message;
  }

  function setCastorProgress(value) {
    const numeric = Number(value);
    const clampedValue = Number.isFinite(numeric) ? clamp(numeric, 0, 100) : 0;
    castorProgress.value = clampedValue;
    castorProgress.classList.toggle("is-active", clampedValue > 0 && clampedValue < 100);
  }

  function buildCastorDataset(params) {
    const analysisAudio = getSingleChannelAnalysisAudio();
    if (!analysisAudio || !analysisAudio.samples || analysisAudio.samples.length === 0) {
      throw new Error("Load a primary audio clip first.");
    }
    if (!state.overlay.enabled || !overlayParsed || !Array.isArray(overlayParsed.intervals)) {
      throw new Error("Enable Activation Overlay and load overlay CSV labels first.");
    }

    const featureSource = buildShortTimeFeatureRowsForMode(analysisAudio, params.source);
    const featureRows = featureSource.featureRows;
    const frameTimesSeconds = featureSource.frameTimesSeconds;
    const frameCount = Math.min(featureRows.length, frameTimesSeconds.length);
    if (frameCount < 8) {
      throw new Error("Not enough short-time frames for CASTOR diagnostics.");
    }

    const classSummary = buildRClusterClassLabels(
      frameTimesSeconds.slice(0, frameCount),
      overlayParsed.intervals
    );
    if (!classSummary) {
      throw new Error("Unable to derive active/inactive frame labels from overlay.");
    }
    if (classSummary.activeCount < 2 || classSummary.inactiveCount < 2) {
      throw new Error(
        "Need at least 2 active and 2 inactive frames. active=" +
          classSummary.activeCount +
          ", inactive=" +
          classSummary.inactiveCount +
          "."
      );
    }

    const rowStride = Math.max(1, Math.ceil(frameCount / params.maxFrames));
    const sampledRows = [];
    const labels = [];
    const rowTimesSeconds = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += rowStride) {
      sampledRows.push(featureRows[frameIndex]);
      labels.push(classSummary.labels[frameIndex] === "active" ? "active" : "inactive");
      rowTimesSeconds.push(Number(frameTimesSeconds[frameIndex] || 0));
    }
    if (sampledRows.length < 8) {
      throw new Error("Not enough frames after sampling for CASTOR.");
    }

    let activeFrames = 0;
    for (let index = 0; index < labels.length; index += 1) {
      activeFrames += labels[index] === "active" ? 1 : 0;
    }
    const inactiveFrames = labels.length - activeFrames;
    if (activeFrames < 2 || inactiveFrames < 2) {
      throw new Error(
        "Insufficient class balance after sampling. active=" +
          activeFrames +
          ", inactive=" +
          inactiveFrames +
          "."
      );
    }

    const sourceFeatureCount = sampledRows[0] ? sampledRows[0].length : 0;
    const outputFeatureCount = Math.min(
      CASTOR_MAX_SEQUENCE_LENGTH,
      Math.max(1, sourceFeatureCount)
    );
    const rows = new Array(sampledRows.length);
    for (let rowIndex = 0; rowIndex < sampledRows.length; rowIndex += 1) {
      const sourceRow = sampledRows[rowIndex];
      const values =
        sourceRow.length > outputFeatureCount
          ? resampleVectorToLength(sourceRow, outputFeatureCount)
          : sourceRow;
      const row = new Float32Array(outputFeatureCount);
      for (let featureIndex = 0; featureIndex < outputFeatureCount; featureIndex += 1) {
        const numeric = Number(values[featureIndex] || 0);
        row[featureIndex] = Number.isFinite(numeric) ? numeric : 0;
      }
      rows[rowIndex] = row;
    }

    const featureColumns = new Array(outputFeatureCount);
    for (let featureIndex = 0; featureIndex < outputFeatureCount; featureIndex += 1) {
      featureColumns[featureIndex] = params.source + "_f" + featureIndex;
    }

    return {
      rows,
      labels,
      rowTimesSeconds,
      featureColumns,
      runContext: {
        source: params.source,
        sourceDescription: featureSource.sourceDescription,
        frameCountOriginal: frameCount,
        frameCountUsed: rows.length,
        featureCountOriginal: sourceFeatureCount,
        featureCountUsed: outputFeatureCount,
        rowStride,
        activeFrames,
        inactiveFrames,
        overlayMode: overlayParsed.mode,
        analysisSource: getSingleChannelAnalysisLabel(),
        backend: "javascript"
      }
    };
  }

  function prepareCastorSequence(values, targetLength, normalize) {
    const output = new Float32Array(targetLength);
    const copyLength = Math.min(targetLength, values.length);
    for (let index = 0; index < copyLength; index += 1) {
      output[index] = Number(values[index] || 0);
    }

    if (!normalize) {
      return output;
    }

    let mean = 0;
    for (let index = 0; index < targetLength; index += 1) {
      mean += output[index];
    }
    mean /= Math.max(1, targetLength);

    let variance = 0;
    for (let index = 0; index < targetLength; index += 1) {
      const delta = output[index] - mean;
      variance += delta * delta;
    }
    variance /= Math.max(1, targetLength);
    if (variance <= 1e-12) {
      output.fill(0);
      return output;
    }

    const std = Math.sqrt(variance);
    for (let index = 0; index < targetLength; index += 1) {
      output[index] = (output[index] - mean) / std;
    }
    return output;
  }

  function computeCastorClassCounts(labels) {
    let active = 0;
    for (let index = 0; index < labels.length; index += 1) {
      active += labels[index] === "active" ? 1 : 0;
    }
    return {
      active,
      inactive: labels.length - active
    };
  }

  function computeCastorPrototype(vectors) {
    if (!Array.isArray(vectors) || vectors.length === 0) {
      throw new Error("Cannot build prototype from empty vectors.");
    }
    const length = vectors[0].length;
    const prototype = new Float64Array(length);
    for (let rowIndex = 0; rowIndex < vectors.length; rowIndex += 1) {
      const row = vectors[rowIndex];
      if (!row || row.length !== length) {
        throw new Error("CASTOR prototype vectors must have equal length.");
      }
      for (let index = 0; index < length; index += 1) {
        prototype[index] += row[index];
      }
    }
    const scale = 1 / vectors.length;
    for (let index = 0; index < length; index += 1) {
      prototype[index] *= scale;
    }
    return prototype;
  }

  function buildCastorConfusion(truthLabels, predictedLabels) {
    const confusion = {
      active: { active: 0, inactive: 0 },
      inactive: { active: 0, inactive: 0 }
    };
    for (let index = 0; index < truthLabels.length; index += 1) {
      const truth = truthLabels[index] === "active" ? "active" : "inactive";
      const predicted = predictedLabels[index] === "active" ? "active" : "inactive";
      confusion[truth][predicted] += 1;
    }
    return confusion;
  }

  function computeCastorExamples(preparedRows, labels, times, distancesByClass, predictions) {
    const byClass = {
      active: [],
      inactive: []
    };
    const borderlines = [];
    const misclassified = [];

    for (let rowIndex = 0; rowIndex < preparedRows.length; rowIndex += 1) {
      const truth = labels[rowIndex] === "active" ? "active" : "inactive";
      const predicted = predictions[rowIndex] === "active" ? "active" : "inactive";
      const dActive = distancesByClass.active[rowIndex];
      const dInactive = distancesByClass.inactive[rowIndex];
      const ownDistance = truth === "active" ? dActive : dInactive;
      const margin = Math.abs(dInactive - dActive);
      const entry = {
        rowIndex,
        timeSec: Array.isArray(times) ? Number(times[rowIndex] || 0) : Number.NaN,
        truth,
        predicted,
        dActive,
        dInactive,
        ownDistance,
        margin
      };
      byClass[truth].push(entry);
      borderlines.push(entry);
      if (truth !== predicted) {
        misclassified.push(entry);
      }
    }

    byClass.active.sort(function (left, right) {
      return left.ownDistance - right.ownDistance;
    });
    byClass.inactive.sort(function (left, right) {
      return left.ownDistance - right.ownDistance;
    });
    borderlines.sort(function (left, right) {
      return left.margin - right.margin;
    });
    misclassified.sort(function (left, right) {
      return right.margin - left.margin;
    });

    return {
      medoids: byClass.active.slice(0, 3).concat(byClass.inactive.slice(0, 3)),
      borderlines: borderlines.slice(0, 10),
      misclassified: misclassified.slice(0, 10)
    };
  }

  async function runCastorInBrowserLocal(dataset, params) {
    if (!dataset || !Array.isArray(dataset.rows) || dataset.rows.length < 4) {
      throw new Error("Not enough rows for CASTOR prototype.");
    }

    setCastorProgress(14);
    await waitForUiFrame();

    const inferredPadLength = dataset.rows.reduce(function (acc, row) {
      return Math.max(acc, row ? row.length : 0);
    }, 0);
    const padLength = params.padLength > 0 ? params.padLength : inferredPadLength;
    if (!Number.isFinite(padLength) || padLength <= 0) {
      throw new Error("CASTOR pad length inference failed.");
    }

    const preparedRows = dataset.rows.map(function (row) {
      return prepareCastorSequence(row, padLength, params.normalize);
    });

    setCastorProgress(36);
    await waitForUiFrame();

    const grouped = {
      active: [],
      inactive: []
    };
    for (let index = 0; index < preparedRows.length; index += 1) {
      const label = dataset.labels[index] === "active" ? "active" : "inactive";
      grouped[label].push(preparedRows[index]);
    }
    if (grouped.active.length < 2 || grouped.inactive.length < 2) {
      throw new Error("CASTOR requires at least 2 prepared rows per class.");
    }

    const prototypes = {
      active: computeCastorPrototype(grouped.active),
      inactive: computeCastorPrototype(grouped.inactive)
    };

    setCastorProgress(58);
    await waitForUiFrame();

    const predictions = new Array(preparedRows.length);
    const distancesByClass = {
      active: new Float64Array(preparedRows.length),
      inactive: new Float64Array(preparedRows.length)
    };
    let correct = 0;
    for (let rowIndex = 0; rowIndex < preparedRows.length; rowIndex += 1) {
      const row = preparedRows[rowIndex];
      const dActive = Math.sqrt(squaredDistanceForFeatureSet(row, prototypes.active, null));
      const dInactive = Math.sqrt(squaredDistanceForFeatureSet(row, prototypes.inactive, null));
      distancesByClass.active[rowIndex] = dActive;
      distancesByClass.inactive[rowIndex] = dInactive;
      const predicted = dActive <= dInactive ? "active" : "inactive";
      predictions[rowIndex] = predicted;
      if (predicted === dataset.labels[rowIndex]) {
        correct += 1;
      }
    }

    const confusion = buildCastorConfusion(dataset.labels, predictions);
    const trainingAccuracy = correct / Math.max(1, preparedRows.length);
    const counts = computeCastorClassCounts(dataset.labels);

    setCastorProgress(78);
    await waitForUiFrame();

    const projection = buildProjectionForVisualization(preparedRows, 900, 31289 + padLength);
    const mapPoints = projection
      ? projection.points.map(function (point, index) {
          const sourceIndex = projection.indices[index];
          const truth = dataset.labels[sourceIndex] === "active" ? "active" : "inactive";
          const predicted = predictions[sourceIndex] === "active" ? "active" : "inactive";
          return {
            x: point.x,
            y: point.y,
            category: predicted,
            categoryIndex: predicted === "active" ? 0 : 1,
            highlighted: truth !== predicted,
            truth,
            predicted,
            rowIndex: sourceIndex,
            timeSec: Array.isArray(dataset.rowTimesSeconds)
              ? Number(dataset.rowTimesSeconds[sourceIndex] || 0)
              : Number.NaN
          };
        })
      : [];

    const prototypeDelta = new Float64Array(padLength);
    for (let index = 0; index < padLength; index += 1) {
      prototypeDelta[index] = Math.abs(prototypes.active[index] - prototypes.inactive[index]);
    }
    const rankedDims = Array.from({ length: padLength }, function (_, index) {
      return {
        index,
        delta: prototypeDelta[index]
      };
    }).sort(function (left, right) {
      return right.delta - left.delta;
    });
    const topDims = rankedDims.slice(0, Math.min(params.topDims, rankedDims.length));
    const topDimLabels = topDims.map(function (entry) {
      return dataset.featureColumns[entry.index] || "seq_" + entry.index;
    });
    const topDimValues = topDims.map(function (entry) {
      return entry.delta;
    });
    const prototypePlotLimit = 1024;
    const prototypeStride = Math.max(1, Math.ceil(padLength / prototypePlotLimit));
    const prototypeDomainLabels = [];
    const prototypeActive = [];
    const prototypeInactive = [];
    for (let index = 0; index < padLength; index += prototypeStride) {
      prototypeDomainLabels.push(dataset.featureColumns[index] || "seq_" + index);
      prototypeActive.push(Number(prototypes.active[index]));
      prototypeInactive.push(Number(prototypes.inactive[index]));
    }

    const examples = computeCastorExamples(
      preparedRows,
      dataset.labels,
      dataset.rowTimesSeconds,
      distancesByClass,
      predictions
    );

    setCastorProgress(96);
    await waitForUiFrame();

    return {
      command: "castor-prototype-js",
      schema_version: "0.1.0-js",
      status: "ok",
      class_labels: ["active", "inactive"],
      instance_count: preparedRows.length,
      class_counts: counts,
      pad_length: padLength,
      normalize: params.normalize,
      training_accuracy: trainingAccuracy,
      confusion_matrix: confusion,
      prototype_preview: {
        active: Array.from(prototypes.active.slice(0, 8)).map(function (value) {
          return Number(value);
        }),
        inactive: Array.from(prototypes.inactive.slice(0, 8)).map(function (value) {
          return Number(value);
        })
      },
      params: {
        source: params.source,
        preset: params.preset,
        max_frames: params.maxFrames,
        top_dims: params.topDims,
        backend: "javascript"
      },
      visualization: {
        map: {
          points: mapPoints,
          explained_ratios:
            projection && Array.isArray(projection.explainedRatios)
              ? projection.explainedRatios.slice(0, 2)
              : []
        },
        summary: {
          confusion,
          class_counts: counts
        },
        why: {
          top_dim_labels: topDimLabels,
          top_dim_values: topDimValues,
          prototype_domain_labels: prototypeDomainLabels,
          prototype_active: prototypeActive,
          prototype_inactive: prototypeInactive,
          prototype_stride: prototypeStride
        },
        examples: {
          medoids: examples.medoids,
          borderlines: examples.borderlines,
          misclassified: examples.misclassified
        }
      }
    };
  }

  function renderCastorResults() {
    if (!castorResults) {
      return;
    }
    castorResults.innerHTML = "";
    if (!castorResult || typeof castorResult !== "object") {
      castorResults.appendChild(
        createMetricsGroup("CASTOR Prototype", [["Status", "Run CASTOR prototype to view diagnostics."]])
      );
      return;
    }

    const result = asRecord(castorResult);
    if (!result) {
      castorResults.appendChild(
        createMetricsGroup("CASTOR Prototype", [["Status", "Invalid CASTOR result payload."]])
      );
      return;
    }

    const params = asRecord(result.params);
    const classCounts = asRecord(result.class_counts);
    const confusion = asRecord(result.confusion_matrix);
    const confusionActive = confusion ? asRecord(confusion.active) : null;
    const confusionInactive = confusion ? asRecord(confusion.inactive) : null;

    castorResults.appendChild(
      createMetricsGroup("CASTOR Input", [
        [
          "Feature source",
          castorLastRunContext && castorLastRunContext.sourceDescription
            ? castorLastRunContext.sourceDescription
            : castorSourceMode === "stft"
              ? "short-time STFT spectrogram features"
              : "short-time mel features"
        ],
        [
          "Frames / features (used)",
          String(
            castorLastRunContext && Number.isFinite(castorLastRunContext.frameCountUsed)
              ? castorLastRunContext.frameCountUsed
              : sanitizeInt(result.instance_count, 0, 0, 1000000000)
          ) +
            " / " +
            String(
              castorLastRunContext && Number.isFinite(castorLastRunContext.featureCountUsed)
                ? castorLastRunContext.featureCountUsed
                : 0
            )
        ],
        [
          "Derived classes (active/inactive)",
          String(sanitizeInt(classCounts && classCounts.active, 0, 0, 1000000000)) +
            " / " +
            String(sanitizeInt(classCounts && classCounts.inactive, 0, 0, 1000000000))
        ],
        [
          "Analysis channel",
          castorLastRunContext && castorLastRunContext.analysisSource
            ? castorLastRunContext.analysisSource
            : getSingleChannelAnalysisLabel()
        ],
        [
          "Pad length / normalize",
          String(sanitizeInt(result.pad_length, 0, 0, 1000000000)) +
            " / " +
            String(Boolean(result.normalize))
        ],
        [
          "Source / max frames",
          String(params && params.source ? params.source : castorSourceMode) +
            " / " +
            String(sanitizeInt(params && params.max_frames, 0, 0, 1000000000))
        ],
        [
          "Run preset",
          String(params && params.preset ? params.preset : castorPresetMode)
        ]
      ])
    );

    castorResults.appendChild(
      createMetricsGroup("CASTOR Diagnostics", [
        ["Training accuracy", formatMetricPercent(Number(result.training_accuracy))],
        ["Active->Active", String(sanitizeInt(confusionActive && confusionActive.active, 0, 0, 1000000000))],
        ["Active->Inactive", String(sanitizeInt(confusionActive && confusionActive.inactive, 0, 0, 1000000000))],
        ["Inactive->Active", String(sanitizeInt(confusionInactive && confusionInactive.active, 0, 0, 1000000000))],
        ["Inactive->Inactive", String(sanitizeInt(confusionInactive && confusionInactive.inactive, 0, 0, 1000000000))]
      ])
    );

    renderCastorVisualizations(result);
  }

  function renderCastorVisualizations(result) {
    const visualization = result ? asRecord(result.visualization) : null;
    if (!visualization) {
      return;
    }

    const map = asRecord(visualization.map);
    const summary = asRecord(visualization.summary);
    const why = asRecord(visualization.why);
    const examples = asRecord(visualization.examples);

    const mapPoints = map && Array.isArray(map.points) ? map.points : [];
    if (mapPoints.length > 0) {
      const explained = Array.isArray(map.explained_ratios) ? map.explained_ratios : [];
      const mapCard = createAnalysisVizCard(
        "Map",
        "PCA(2D) of CASTOR prepared vectors, colored by predicted class" +
          (explained.length > 0
            ? " | explained=" +
              formatMetricPercent(Number(explained[0] || 0)) +
              ", " +
              formatMetricPercent(Number(explained[1] || 0))
            : "") +
          " | white-ring points are misclassified."
      );
      const mapCanvas = createAnalysisCanvas(760, 280);
      drawAnalysisScatter(
        mapCanvas,
        mapPoints.map(function (entry) {
          const point = asRecord(entry);
          const category = point ? String(point.category || "inactive") : "inactive";
          return {
            x: point ? Number(point.x || 0) : 0,
            y: point ? Number(point.y || 0) : 0,
            category,
            categoryIndex: category === "active" ? 0 : 1,
            highlighted: Boolean(point && point.highlighted)
          };
        }),
        [
          { key: "active", label: "pred active", index: 0 },
          { key: "inactive", label: "pred inactive", index: 1 }
        ]
      );
      mapCard.appendChild(mapCanvas);
      castorResults.appendChild(mapCard);
    }

    const summaryConfusion = summary ? asRecord(summary.confusion) : null;
    const summaryActive = summaryConfusion ? asRecord(summaryConfusion.active) : null;
    const summaryInactive = summaryConfusion ? asRecord(summaryConfusion.inactive) : null;
    if (summaryActive && summaryInactive) {
      const summaryCard = createAnalysisVizCard(
        "Summary",
        "Confusion matrix (rows=true active/inactive, cols=pred active/inactive)"
      );
      const heatmap = createAnalysisCanvas(760, 220);
      drawAnalysisHeatmap(
        heatmap,
        [
          [Number(summaryActive.active || 0), Number(summaryActive.inactive || 0)],
          [Number(summaryInactive.active || 0), Number(summaryInactive.inactive || 0)]
        ],
        ["true active", "true inactive"],
        ["pred active", "pred inactive"]
      );
      summaryCard.appendChild(heatmap);
      castorResults.appendChild(summaryCard);
    }

    const topDimLabels = why && Array.isArray(why.top_dim_labels) ? why.top_dim_labels : [];
    const topDimValues = why && Array.isArray(why.top_dim_values) ? why.top_dim_values : [];
    if (topDimLabels.length > 0 && topDimValues.length > 0) {
      const whyCard = createAnalysisVizCard(
        "Why",
        "Top prototype-separating dimensions (|active_prototype - inactive_prototype|)"
      );
      const bar = createAnalysisCanvas(760, Math.max(220, topDimLabels.length * 24 + 40));
      drawAnalysisBarChart(bar, topDimLabels, topDimValues, "#22d3ee");
      whyCard.appendChild(bar);

      const prototypeActive = why && Array.isArray(why.prototype_active) ? why.prototype_active : [];
      const prototypeInactive =
        why && Array.isArray(why.prototype_inactive) ? why.prototype_inactive : [];
      const prototypeStride = sanitizeInt(why && why.prototype_stride, 1, 1, 1000000);
      if (prototypeActive.length > 0 && prototypeInactive.length > 0) {
        const protoSubtitle = document.createElement("p");
        protoSubtitle.className = "analysis-viz-subtitle";
        protoSubtitle.textContent =
          "Prototype vectors (downsampled every " +
          prototypeStride +
          " dimensions) for active/inactive classes.";
        whyCard.appendChild(protoSubtitle);

        const activeTitle = document.createElement("p");
        activeTitle.className = "analysis-viz-subtitle";
        activeTitle.textContent = "Active prototype";
        whyCard.appendChild(activeTitle);
        const activeLine = createAnalysisCanvas(760, 180);
        drawPcaLinePlot(activeLine, prototypeActive, { color: "#22d3ee" });
        whyCard.appendChild(activeLine);

        const inactiveTitle = document.createElement("p");
        inactiveTitle.className = "analysis-viz-subtitle";
        inactiveTitle.textContent = "Inactive prototype";
        whyCard.appendChild(inactiveTitle);
        const inactiveLine = createAnalysisCanvas(760, 180);
        drawPcaLinePlot(inactiveLine, prototypeInactive, { color: "#f472b6" });
        whyCard.appendChild(inactiveLine);
      }
      castorResults.appendChild(whyCard);
    }

    const medoids = examples && Array.isArray(examples.medoids) ? examples.medoids : [];
    const borderlines = examples && Array.isArray(examples.borderlines) ? examples.borderlines : [];
    const misclassified =
      examples && Array.isArray(examples.misclassified) ? examples.misclassified : [];
    if (medoids.length > 0 || borderlines.length > 0 || misclassified.length > 0) {
      const examplesCard = createAnalysisVizCard(
        "Examples",
        "Prototype-nearest, borderline, and misclassified instances"
      );
      const rows = [];
      for (let index = 0; index < Math.min(6, medoids.length); index += 1) {
        const item = asRecord(medoids[index]);
        if (!item) {
          continue;
        }
        rows.push([
          "prototype-nearest",
          sanitizeInt(item.rowIndex, 0, 0, 1000000000),
          formatMetricNumber(Number(item.timeSec), 3),
          String(item.truth || ""),
          String(item.predicted || ""),
          formatMetricNumber(Number(item.margin), 4)
        ]);
      }
      for (let index = 0; index < Math.min(6, borderlines.length); index += 1) {
        const item = asRecord(borderlines[index]);
        if (!item) {
          continue;
        }
        rows.push([
          "borderline",
          sanitizeInt(item.rowIndex, 0, 0, 1000000000),
          formatMetricNumber(Number(item.timeSec), 3),
          String(item.truth || ""),
          String(item.predicted || ""),
          formatMetricNumber(Number(item.margin), 4)
        ]);
      }
      for (let index = 0; index < Math.min(6, misclassified.length); index += 1) {
        const item = asRecord(misclassified[index]);
        if (!item) {
          continue;
        }
        rows.push([
          "misclassified",
          sanitizeInt(item.rowIndex, 0, 0, 1000000000),
          formatMetricNumber(Number(item.timeSec), 3),
          String(item.truth || ""),
          String(item.predicted || ""),
          formatMetricNumber(Number(item.margin), 4)
        ]);
      }
      if (rows.length > 0) {
        examplesCard.appendChild(
          createAnalysisExamplesTable(
            ["type", "row", "time(s)", "true", "pred", "margin"],
            rows
          )
        );
        castorResults.appendChild(examplesCard);
      }
    }
  }

  function updateCastorControls() {
    const hasAudio = Boolean(primaryAudio && primaryAudio.samples && primaryAudio.samples.length > 0);
    const hasOverlay = Boolean(state.overlay.enabled && overlayParsed && overlayParsed.intervals.length > 0);

    castorFeatureHint.textContent =
      "Feature source: " +
      (castorSourceMode === "stft"
        ? "short-time STFT log-magnitude spectrogram frames"
        : "short-time mel feature frames") +
      ". Backend: in-browser JavaScript. Preset=" +
      castorPresetMode +
      ".";
    castorLabelHint.textContent = hasOverlay
      ? "Activation overlay loaded: " +
        overlayParsed.intervals.length +
        " intervals, mode=" +
        overlayParsed.mode +
        "."
      : "Activation overlay required to derive active/inactive labels.";

    castorRun.disabled = castorRunning || !hasAudio || !hasOverlay;
    castorSource.disabled = castorRunning;
    castorPreset.disabled = castorRunning;
    castorMaxFrames.disabled = castorRunning;
    castorPadLength.disabled = castorRunning;
    castorTopDims.disabled = castorRunning;
    castorNormalize.disabled = castorRunning;
  }

  function getSpfParamsFromInputs() {
    return {
      source:
        typeof spfSource.value === "string" && (spfSource.value === "mel" || spfSource.value === "stft")
          ? spfSource.value
          : "mel",
      alphabetSize: sanitizeInt(spfAlphabetSize.value, 6, 3, 12),
      wordLength: sanitizeInt(spfWordLength.value, 12, 2, 64),
      maxFrames: sanitizeInt(spfMaxFrames.value, 2000, 128, 8000),
      topPatterns: sanitizeInt(spfTopPatterns.value, 20, 5, 200),
      forestTrees: sanitizeInt(spfForestTrees.value, 48, 8, 256)
    };
  }

  function syncSpfParamsFromInputs() {
    const params = getSpfParamsFromInputs();
    spfSourceMode = params.source;
    spfSource.value = params.source;
    spfAlphabetSize.value = String(params.alphabetSize);
    spfWordLength.value = String(params.wordLength);
    spfMaxFrames.value = String(params.maxFrames);
    spfTopPatterns.value = String(params.topPatterns);
    spfForestTrees.value = String(params.forestTrees);
    return params;
  }

  function setSpfStatus(message) {
    spfStatus.textContent = message;
  }

  function setSpfProgress(value) {
    const numeric = Number(value);
    const clampedValue = Number.isFinite(numeric) ? clamp(numeric, 0, 100) : 0;
    spfProgress.value = clampedValue;
    spfProgress.classList.toggle("is-active", clampedValue > 0 && clampedValue < 100);
  }

  function buildSpfDataset(params) {
    const analysisAudio = getSingleChannelAnalysisAudio();
    if (!analysisAudio || !analysisAudio.samples || analysisAudio.samples.length === 0) {
      throw new Error("Load a primary audio clip first.");
    }
    if (!state.overlay.enabled || !overlayParsed || !Array.isArray(overlayParsed.intervals)) {
      throw new Error("Enable Activation Overlay and load overlay CSV labels first.");
    }

    const featureSource = buildShortTimeFeatureRowsForMode(analysisAudio, params.source);
    const featureRows = featureSource.featureRows;
    const frameTimesSeconds = featureSource.frameTimesSeconds;
    const frameCount = Math.min(featureRows.length, frameTimesSeconds.length);
    if (frameCount < 8) {
      throw new Error("Not enough short-time frames for symbolic pattern analysis.");
    }

    const classSummary = buildRClusterClassLabels(
      frameTimesSeconds.slice(0, frameCount),
      overlayParsed.intervals
    );
    if (!classSummary) {
      throw new Error("Unable to derive active/inactive frame labels from overlay.");
    }
    if (classSummary.activeCount < 2 || classSummary.inactiveCount < 2) {
      throw new Error(
        "Need at least 2 active and 2 inactive frames. active=" +
          classSummary.activeCount +
          ", inactive=" +
          classSummary.inactiveCount +
          "."
      );
    }

    const rowStride = Math.max(1, Math.ceil(frameCount / params.maxFrames));
    const rows = [];
    const labels = [];
    const rowTimesSeconds = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += rowStride) {
      const sourceRow = featureRows[frameIndex];
      const row = new Float32Array(sourceRow.length);
      for (let col = 0; col < sourceRow.length; col += 1) {
        const numeric = Number(sourceRow[col] || 0);
        row[col] = Number.isFinite(numeric) ? numeric : 0;
      }
      rows.push(row);
      labels.push(classSummary.labels[frameIndex] === "active" ? 1 : 0);
      rowTimesSeconds.push(Number(frameTimesSeconds[frameIndex] || 0));
    }
    if (rows.length < 8) {
      throw new Error("Not enough frames after sampling for symbolic analysis.");
    }

    let activeFrames = 0;
    for (let index = 0; index < labels.length; index += 1) {
      activeFrames += labels[index] ? 1 : 0;
    }
    const inactiveFrames = labels.length - activeFrames;
    if (activeFrames < 2 || inactiveFrames < 2) {
      throw new Error(
        "Insufficient class balance after sampling. active=" +
          activeFrames +
          ", inactive=" +
          inactiveFrames +
          "."
      );
    }

    return {
      rows,
      labels,
      rowTimesSeconds,
      runContext: {
        source: params.source,
        sourceDescription: featureSource.sourceDescription,
        frameCountOriginal: frameCount,
        frameCountUsed: rows.length,
        featureCount: rows[0] ? rows[0].length : 0,
        rowStride,
        activeFrames,
        inactiveFrames,
        overlayMode: overlayParsed.mode,
        analysisSource: getSingleChannelAnalysisLabel(),
        backend: "javascript"
      }
    };
  }

  function entropyFromCounts(positive, negative) {
    const total = positive + negative;
    if (total <= 0) {
      return 0;
    }
    const pPos = positive / total;
    const pNeg = negative / total;
    let entropy = 0;
    if (pPos > 1e-12) {
      entropy -= pPos * Math.log2(pPos);
    }
    if (pNeg > 1e-12) {
      entropy -= pNeg * Math.log2(pNeg);
    }
    return entropy;
  }

  function getSaxBreakpoints(alphabetSize) {
    const table = {
      3: [-0.43, 0.43],
      4: [-0.67, 0, 0.67],
      5: [-0.84, -0.25, 0.25, 0.84],
      6: [-0.97, -0.43, 0, 0.43, 0.97],
      7: [-1.07, -0.57, -0.18, 0.18, 0.57, 1.07],
      8: [-1.15, -0.67, -0.32, 0, 0.32, 0.67, 1.15],
      9: [-1.22, -0.76, -0.43, -0.14, 0.14, 0.43, 0.76, 1.22],
      10: [-1.28, -0.84, -0.52, -0.25, 0, 0.25, 0.52, 0.84, 1.28],
      11: [-1.34, -0.91, -0.6, -0.35, -0.11, 0.11, 0.35, 0.6, 0.91, 1.34],
      12: [-1.39, -0.97, -0.67, -0.43, -0.21, 0, 0.21, 0.43, 0.67, 0.97, 1.39]
    };
    if (table[alphabetSize]) {
      return table[alphabetSize];
    }
    const breakpoints = [];
    const min = -1.5;
    const max = 1.5;
    for (let index = 1; index < alphabetSize; index += 1) {
      breakpoints.push(min + ((max - min) * index) / alphabetSize);
    }
    return breakpoints;
  }

  function normalizeVectorZScore(vector) {
    const length = vector.length;
    if (length <= 0) {
      return new Float32Array(0);
    }
    let mean = 0;
    for (let index = 0; index < length; index += 1) {
      mean += vector[index];
    }
    mean /= length;
    let variance = 0;
    for (let index = 0; index < length; index += 1) {
      const delta = vector[index] - mean;
      variance += delta * delta;
    }
    const std = variance > 1e-12 ? Math.sqrt(variance / length) : 1;
    const normalized = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      normalized[index] = (vector[index] - mean) / std;
    }
    return normalized;
  }

  function computePaaVector(vector, segments) {
    const safeSegments = Math.max(1, Math.min(segments, vector.length));
    const paa = new Float32Array(safeSegments);
    for (let segment = 0; segment < safeSegments; segment += 1) {
      const start = Math.floor((segment * vector.length) / safeSegments);
      const end = Math.floor(((segment + 1) * vector.length) / safeSegments);
      let sum = 0;
      let count = 0;
      for (let index = start; index < end; index += 1) {
        sum += vector[index];
        count += 1;
      }
      paa[segment] = count > 0 ? sum / count : 0;
    }
    return paa;
  }

  function quantizeToSymbol(value, breakpoints, alphabetSymbols) {
    let bin = 0;
    while (bin < breakpoints.length && value > breakpoints[bin]) {
      bin += 1;
    }
    return alphabetSymbols[bin] || alphabetSymbols[alphabetSymbols.length - 1];
  }

  function giniImpurity(positive, negative) {
    const total = positive + negative;
    if (total <= 0) {
      return 0;
    }
    const p = positive / total;
    const q = negative / total;
    return 1 - (p * p + q * q);
  }

  function buildSymbolicWords(rows, alphabetSize, wordLength) {
    const alphabetSymbols = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
      .slice(0, alphabetSize)
      .split("");
    const breakpoints = getSaxBreakpoints(alphabetSize);
    const words = new Array(rows.length);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const normalized = normalizeVectorZScore(rows[rowIndex]);
      const paa = computePaaVector(normalized, wordLength);
      let word = "";
      for (let index = 0; index < paa.length; index += 1) {
        word += quantizeToSymbol(paa[index], breakpoints, alphabetSymbols);
      }
      words[rowIndex] = word;
    }
    return words;
  }

  function buildPatternStats(words, labels) {
    const totalCount = words.length;
    let activeTotal = 0;
    for (let index = 0; index < labels.length; index += 1) {
      activeTotal += labels[index] ? 1 : 0;
    }
    const inactiveTotal = totalCount - activeTotal;
    const entropyY = entropyFromCounts(activeTotal, inactiveTotal);

    const statsByWord = new Map();
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index];
      if (!statsByWord.has(word)) {
        statsByWord.set(word, { total: 0, active: 0, inactive: 0 });
      }
      const entry = statsByWord.get(word);
      entry.total += 1;
      if (labels[index]) {
        entry.active += 1;
      } else {
        entry.inactive += 1;
      }
    }

    const patterns = [];
    statsByWord.forEach(function (entry, word) {
      const present = entry.total;
      const absent = totalCount - present;
      const activePresent = entry.active;
      const inactivePresent = entry.inactive;
      const activeAbsent = activeTotal - activePresent;
      const inactiveAbsent = inactiveTotal - inactivePresent;

      const conditionalEntropy =
        (present / totalCount) * entropyFromCounts(activePresent, inactivePresent) +
        (absent / totalCount) * entropyFromCounts(activeAbsent, inactiveAbsent);
      const infoGain = entropyY - conditionalEntropy;

      const expectedActivePresent = (present * activeTotal) / Math.max(1, totalCount);
      const expectedInactivePresent = (present * inactiveTotal) / Math.max(1, totalCount);
      const expectedActiveAbsent = (absent * activeTotal) / Math.max(1, totalCount);
      const expectedInactiveAbsent = (absent * inactiveTotal) / Math.max(1, totalCount);
      const chiSquare =
        ((activePresent - expectedActivePresent) ** 2) / Math.max(1e-12, expectedActivePresent) +
        ((inactivePresent - expectedInactivePresent) ** 2) / Math.max(1e-12, expectedInactivePresent) +
        ((activeAbsent - expectedActiveAbsent) ** 2) / Math.max(1e-12, expectedActiveAbsent) +
        ((inactiveAbsent - expectedInactiveAbsent) ** 2) / Math.max(1e-12, expectedInactiveAbsent);

      const activeOdds = (activePresent + 0.5) / (Math.max(0, activeTotal - activePresent) + 0.5);
      const inactiveOdds = (inactivePresent + 0.5) / (Math.max(0, inactiveTotal - inactivePresent) + 0.5);
      const logOdds = Math.log(activeOdds) - Math.log(inactiveOdds);

      patterns.push({
        word,
        total: entry.total,
        active: entry.active,
        inactive: entry.inactive,
        support: entry.total / Math.max(1, totalCount),
        activeSupport: entry.active / Math.max(1, activeTotal),
        inactiveSupport: entry.inactive / Math.max(1, inactiveTotal),
        infoGain,
        chiSquare,
        logOdds
      });
    });

    patterns.sort(function (left, right) {
      if (right.infoGain !== left.infoGain) {
        return right.infoGain - left.infoGain;
      }
      if (right.chiSquare !== left.chiSquare) {
        return right.chiSquare - left.chiSquare;
      }
      return right.total - left.total;
    });

    return {
      patterns,
      totalCount,
      activeTotal,
      inactiveTotal,
      entropyY,
      uniquePatterns: patterns.length
    };
  }

  function runPrototypeSymbolicForest(words, labels, rankedPatterns, treeCount, seed) {
    const maxVocab = Math.min(256, rankedPatterns.length);
    const vocabulary = rankedPatterns.slice(0, maxVocab).map(function (pattern) {
      return pattern.word;
    });
    const wordToFeatureIndex = new Map();
    vocabulary.forEach(function (word, index) {
      wordToFeatureIndex.set(word, index);
    });

    const encoded = new Int32Array(words.length);
    for (let index = 0; index < words.length; index += 1) {
      const mapped = wordToFeatureIndex.get(words[index]);
      encoded[index] = typeof mapped === "number" ? mapped : -1;
    }

    const featureImportance = new Float64Array(vocabulary.length);
    const featureSelectionCount = new Uint32Array(vocabulary.length);
    const votePositive = new Uint16Array(words.length);
    const voteNegative = new Uint16Array(words.length);
    const oobCounts = new Uint16Array(words.length);
    const random = createSeededRandom(seed);
    const treeSplits = [];

    let fittedTrees = 0;
    for (let tree = 0; tree < treeCount; tree += 1) {
      if (vocabulary.length === 0) {
        break;
      }

      const bootstrapIndices = new Int32Array(words.length);
      const inBag = new Uint8Array(words.length);
      for (let sample = 0; sample < words.length; sample += 1) {
        const picked = Math.floor(random() * words.length);
        bootstrapIndices[sample] = picked;
        inBag[picked] = 1;
      }

      let parentPos = 0;
      let parentNeg = 0;
      for (let sample = 0; sample < bootstrapIndices.length; sample += 1) {
        if (labels[bootstrapIndices[sample]]) {
          parentPos += 1;
        } else {
          parentNeg += 1;
        }
      }
      const parentGini = giniImpurity(parentPos, parentNeg);
      const mtry = Math.max(1, Math.floor(Math.sqrt(vocabulary.length)));
      const candidateFeatureIndices = sampleIndicesWithoutReplacement(vocabulary.length, mtry, random);

      let bestFeature = -1;
      let bestGain = 0;
      let bestLeftPos = 0;
      let bestLeftNeg = 0;
      let bestRightPos = 0;
      let bestRightNeg = 0;

      for (let candidateIndex = 0; candidateIndex < candidateFeatureIndices.length; candidateIndex += 1) {
        const featureIndex = candidateFeatureIndices[candidateIndex];
        let leftPos = 0;
        let leftNeg = 0;
        let rightPos = 0;
        let rightNeg = 0;
        for (let sample = 0; sample < bootstrapIndices.length; sample += 1) {
          const rowIndex = bootstrapIndices[sample];
          const present = encoded[rowIndex] === featureIndex;
          if (present) {
            if (labels[rowIndex]) {
              leftPos += 1;
            } else {
              leftNeg += 1;
            }
          } else if (labels[rowIndex]) {
            rightPos += 1;
          } else {
            rightNeg += 1;
          }
        }
        const leftCount = leftPos + leftNeg;
        const rightCount = rightPos + rightNeg;
        if (leftCount === 0 || rightCount === 0) {
          continue;
        }
        const weightedGini =
          (leftCount / words.length) * giniImpurity(leftPos, leftNeg) +
          (rightCount / words.length) * giniImpurity(rightPos, rightNeg);
        const gain = parentGini - weightedGini;
        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = featureIndex;
          bestLeftPos = leftPos;
          bestLeftNeg = leftNeg;
          bestRightPos = rightPos;
          bestRightNeg = rightNeg;
        }
      }

      if (bestFeature < 0) {
        continue;
      }

      fittedTrees += 1;
      featureImportance[bestFeature] += bestGain;
      featureSelectionCount[bestFeature] += 1;
      const leftPrediction = bestLeftPos >= bestLeftNeg ? 1 : 0;
      const rightPrediction = bestRightPos >= bestRightNeg ? 1 : 0;
      treeSplits.push({
        treeIndex: tree,
        splitWord: vocabulary[bestFeature],
        gain: bestGain,
        left: {
          count: bestLeftPos + bestLeftNeg,
          active: bestLeftPos,
          inactive: bestLeftNeg,
          prediction: leftPrediction ? "active" : "inactive"
        },
        right: {
          count: bestRightPos + bestRightNeg,
          active: bestRightPos,
          inactive: bestRightNeg,
          prediction: rightPrediction ? "active" : "inactive"
        }
      });

      for (let rowIndex = 0; rowIndex < words.length; rowIndex += 1) {
        if (inBag[rowIndex]) {
          continue;
        }
        oobCounts[rowIndex] += 1;
        const prediction = encoded[rowIndex] === bestFeature ? leftPrediction : rightPrediction;
        if (prediction) {
          votePositive[rowIndex] += 1;
        } else {
          voteNegative[rowIndex] += 1;
        }
      }
    }

    let evaluated = 0;
    let correct = 0;
    let tp = 0;
    let tn = 0;
    let fp = 0;
    let fn = 0;
    for (let index = 0; index < words.length; index += 1) {
      if (oobCounts[index] <= 0) {
        continue;
      }
      evaluated += 1;
      const prediction = votePositive[index] >= voteNegative[index] ? 1 : 0;
      const target = labels[index];
      if (prediction === target) {
        correct += 1;
      }
      if (prediction === 1 && target === 1) {
        tp += 1;
      } else if (prediction === 0 && target === 0) {
        tn += 1;
      } else if (prediction === 1 && target === 0) {
        fp += 1;
      } else if (prediction === 0 && target === 1) {
        fn += 1;
      }
    }

    const rankedImportance = [];
    for (let featureIndex = 0; featureIndex < vocabulary.length; featureIndex += 1) {
      if (featureImportance[featureIndex] <= 0) {
        continue;
      }
      rankedImportance.push({
        word: vocabulary[featureIndex],
        importance: featureImportance[featureIndex]
      });
    }
    rankedImportance.sort(function (left, right) {
      return right.importance - left.importance;
    });

    const selectionFrequency = [];
    for (let featureIndex = 0; featureIndex < vocabulary.length; featureIndex += 1) {
      const count = featureSelectionCount[featureIndex];
      if (count <= 0) {
        continue;
      }
      selectionFrequency.push({
        word: vocabulary[featureIndex],
        count,
        frequency: fittedTrees > 0 ? count / fittedTrees : 0
      });
    }
    selectionFrequency.sort(function (left, right) {
      return right.count - left.count;
    });

    return {
      vocabularySize: vocabulary.length,
      fittedTrees,
      requestedTrees: treeCount,
      evaluatedSamples: evaluated,
      oobAccuracy: evaluated > 0 ? correct / evaluated : 0,
      confusion: { tp, tn, fp, fn },
      patternImportances: rankedImportance,
      patternSelectionFrequency: selectionFrequency,
      treeSplits: treeSplits.slice(0, 160)
    };
  }

  async function runSpfInBrowserLocal(dataset, params) {
    setSpfProgress(18);
    await waitForUiFrame();
    const words = buildSymbolicWords(dataset.rows, params.alphabetSize, params.wordLength);

    setSpfProgress(48);
    await waitForUiFrame();
    const patternStats = buildPatternStats(words, dataset.labels);

    setSpfProgress(70);
    await waitForUiFrame();
    const forest = runPrototypeSymbolicForest(
      words,
      dataset.labels,
      patternStats.patterns,
      params.forestTrees,
      10007 + params.forestTrees + params.wordLength + params.alphabetSize
    );

    setSpfProgress(94);
    await waitForUiFrame();
    const topPatterns = patternStats.patterns.slice(0, params.topPatterns);
    const normalizedRows = zscoreRowsByColumn(dataset.rows);
    const projection = buildProjectionForVisualization(
      normalizedRows,
      900,
      16001 + params.forestTrees * 13
    );
    const mapPoints = projection
      ? projection.points.map(function (point, index) {
          const sourceIndex = projection.indices[index];
          const classLabel = dataset.labels[sourceIndex] ? "active" : "inactive";
          return {
            x: point.x,
            y: point.y,
            category: classLabel,
            categoryIndex: classLabel === "active" ? 0 : 1,
            rowIndex: sourceIndex,
            timeSec:
              Array.isArray(dataset.rowTimesSeconds) &&
              Number.isFinite(Number(dataset.rowTimesSeconds[sourceIndex]))
                ? Number(dataset.rowTimesSeconds[sourceIndex])
                : Number.NaN
          };
        })
      : [];

    const patternLabels = topPatterns.map(function (pattern) {
      const record = asRecord(pattern);
      return record ? String(record.word || "") : "";
    });
    const classPatternRates = [
      topPatterns.map(function (pattern) {
        const record = asRecord(pattern);
        return Number(record && record.activeSupport) || 0;
      }),
      topPatterns.map(function (pattern) {
        const record = asRecord(pattern);
        return Number(record && record.inactiveSupport) || 0;
      })
    ];

    const patternExamples = [];
    for (let patternIndex = 0; patternIndex < patternLabels.length; patternIndex += 1) {
      const word = patternLabels[patternIndex];
      if (!word) {
        continue;
      }
      const occurrences = [];
      for (let rowIndex = 0; rowIndex < words.length; rowIndex += 1) {
        if (words[rowIndex] !== word) {
          continue;
        }
        occurrences.push({
          rowIndex,
          timeSec:
            Array.isArray(dataset.rowTimesSeconds) &&
            Number.isFinite(Number(dataset.rowTimesSeconds[rowIndex]))
              ? Number(dataset.rowTimesSeconds[rowIndex])
              : Number.NaN,
          classLabel: dataset.labels[rowIndex] ? "active" : "inactive"
        });
        if (occurrences.length >= 3) {
          break;
        }
      }
      patternExamples.push({
        word,
        occurrences
      });
    }

    return {
      command: "symbolic-pattern-forest",
      schema_version: "0.1.0-js",
      status: "ok",
      input: {
        sample_count: dataset.rows.length,
        feature_count: dataset.rows[0] ? dataset.rows[0].length : 0,
        active_count: patternStats.activeTotal,
        inactive_count: patternStats.inactiveTotal
      },
      params: {
        source: params.source,
        alphabet_size: params.alphabetSize,
        word_length: params.wordLength,
        max_frames: params.maxFrames,
        top_patterns: params.topPatterns,
        forest_trees: params.forestTrees,
        backend: "javascript"
      },
      diagnostics: {
        unique_patterns: patternStats.uniquePatterns,
        class_entropy: patternStats.entropyY,
        forest
      },
      top_patterns: topPatterns,
      visualization: {
        map: {
          points: mapPoints,
          explained_ratios:
            projection && Array.isArray(projection.explainedRatios)
              ? projection.explainedRatios.slice(0, 2)
              : []
        },
        summary: {
          pattern_importances:
            forest && Array.isArray(forest.patternImportances)
              ? forest.patternImportances.slice(0, Math.min(20, forest.patternImportances.length))
              : [],
          pattern_selection_frequency:
            forest && Array.isArray(forest.patternSelectionFrequency)
              ? forest.patternSelectionFrequency.slice(
                  0,
                  Math.min(40, forest.patternSelectionFrequency.length)
                )
              : [],
          tree_summaries:
            forest && Array.isArray(forest.treeSplits)
              ? forest.treeSplits.slice(0, Math.min(120, forest.treeSplits.length))
              : []
        },
        why: {
          pattern_labels: patternLabels,
          class_pattern_rates: classPatternRates
        },
        examples: {
          pattern_examples: patternExamples
        }
      }
    };
  }

  function renderSpfResults() {
    if (!spfResults) {
      return;
    }
    spfResults.innerHTML = "";
    if (!spfResult || typeof spfResult !== "object") {
      spfResults.appendChild(
        createMetricsGroup("Symbolic Pattern Forest", [["Status", "Run symbolic pattern analysis to view diagnostics."]])
      );
      return;
    }

    const result = asRecord(spfResult);
    if (!result) {
      spfResults.appendChild(
        createMetricsGroup("Symbolic Pattern Forest", [["Status", "Invalid symbolic result payload."]])
      );
      return;
    }

    const input = asRecord(result.input);
    const params = asRecord(result.params);
    const diagnostics = asRecord(result.diagnostics);
    const forest = diagnostics ? asRecord(diagnostics.forest) : null;
    const topPatterns = Array.isArray(result.top_patterns) ? result.top_patterns : [];

    spfResults.appendChild(
      createMetricsGroup("SPF Input", [
        ["Source", spfLastRunContext && spfLastRunContext.sourceDescription ? spfLastRunContext.sourceDescription : "n/a"],
        [
          "Frames / features",
          String(sanitizeInt(input && input.sample_count, 0, 0, 1000000000)) +
            " / " +
            String(sanitizeInt(input && input.feature_count, 0, 0, 1000000000))
        ],
        [
          "Classes (active / inactive)",
          String(sanitizeInt(input && input.active_count, 0, 0, 1000000000)) +
            " / " +
            String(sanitizeInt(input && input.inactive_count, 0, 0, 1000000000))
        ],
        ["Analysis channel", spfLastRunContext && spfLastRunContext.analysisSource ? spfLastRunContext.analysisSource : getSingleChannelAnalysisLabel()],
        [
          "Alphabet / word length",
          String(sanitizeInt(params && params.alphabet_size, 0, 0, 1000)) +
            " / " +
            String(sanitizeInt(params && params.word_length, 0, 0, 1000))
        ]
      ])
    );

    spfResults.appendChild(
      createMetricsGroup("SPF Diagnostics", [
        ["Unique patterns", String(sanitizeInt(diagnostics && diagnostics.unique_patterns, 0, 0, 1000000000))],
        ["Class entropy", formatMetricNumber(Number(diagnostics && diagnostics.class_entropy), 5)],
        ["Forest trees (fit/requested)", String(sanitizeInt(forest && forest.fittedTrees, 0, 0, 1000000)) + " / " + String(sanitizeInt(forest && forest.requestedTrees, 0, 0, 1000000))],
        ["Prototype OOB accuracy", formatMetricPercent(Number(forest && forest.oobAccuracy))],
        ["OOB evaluated samples", String(sanitizeInt(forest && forest.evaluatedSamples, 0, 0, 1000000000))]
      ])
    );

    if (forest && asRecord(forest.confusion)) {
      const confusion = asRecord(forest.confusion);
      spfResults.appendChild(
        createMetricsGroup("Prototype Forest Confusion (OOB)", [
          ["TP", String(sanitizeInt(confusion && confusion.tp, 0, 0, 1000000000))],
          ["TN", String(sanitizeInt(confusion && confusion.tn, 0, 0, 1000000000))],
          ["FP", String(sanitizeInt(confusion && confusion.fp, 0, 0, 1000000000))],
          ["FN", String(sanitizeInt(confusion && confusion.fn, 0, 0, 1000000000))]
        ])
      );
    }

    for (let index = 0; index < topPatterns.length; index += 1) {
      const pattern = asRecord(topPatterns[index]);
      if (!pattern) {
        continue;
      }
      spfResults.appendChild(
        createMetricsGroup("Pattern " + (index + 1), [
          ["Word", String(pattern.word || "")],
          ["Support", formatMetricPercent(Number(pattern.support))],
          ["Active / inactive count", String(sanitizeInt(pattern.active, 0, 0, 1000000000)) + " / " + String(sanitizeInt(pattern.inactive, 0, 0, 1000000000))],
          ["Info gain", formatMetricNumber(Number(pattern.infoGain), 6)],
          ["Chi-square", formatMetricNumber(Number(pattern.chiSquare), 4)],
          ["Log-odds(active vs inactive)", formatMetricNumber(Number(pattern.logOdds), 4)]
        ])
      );
    }

    renderSpfVisualizations(result);
  }

  function renderSpfVisualizations(result) {
    const visualization = result ? asRecord(result.visualization) : null;
    if (!visualization) {
      return;
    }

    const map = asRecord(visualization.map);
    const summary = asRecord(visualization.summary);
    const why = asRecord(visualization.why);
    const examples = asRecord(visualization.examples);

    const mapPoints = map && Array.isArray(map.points) ? map.points : [];
    if (mapPoints.length > 0) {
      const explained = Array.isArray(map.explained_ratios) ? map.explained_ratios : [];
      const card = createAnalysisVizCard(
        "Map",
        "PCA(2D) over symbolic feature vectors, colored by class" +
          (explained.length > 0
            ? " | explained=" +
              formatMetricPercent(Number(explained[0] || 0)) +
              ", " +
              formatMetricPercent(Number(explained[1] || 0))
            : "")
      );
      const canvas = createAnalysisCanvas(760, 280);
      drawAnalysisScatter(
        canvas,
        mapPoints.map(function (entry) {
          const point = asRecord(entry);
          const category = point ? String(point.category || "inactive") : "inactive";
          return {
            x: point ? Number(point.x || 0) : 0,
            y: point ? Number(point.y || 0) : 0,
            category,
            categoryIndex: category === "active" ? 0 : 1
          };
        }),
        [
          { key: "active", label: "active", index: 0 },
          { key: "inactive", label: "inactive", index: 1 }
        ]
      );
      card.appendChild(canvas);
      spfResults.appendChild(card);
    }

    const patternImportances =
      summary && Array.isArray(summary.pattern_importances) ? summary.pattern_importances : [];
    const patternSelectionFrequency =
      summary && Array.isArray(summary.pattern_selection_frequency)
        ? summary.pattern_selection_frequency
        : [];
    const summaryItems =
      patternSelectionFrequency.length > 0 ? patternSelectionFrequency : patternImportances;
    if (summaryItems.length > 0) {
      const summaryCard = createAnalysisVizCard(
        "Summary",
        patternSelectionFrequency.length > 0
          ? "Pattern selection frequency across fitted prototype trees"
          : "Pattern importance from prototype forest"
      );
      const labels = [];
      const values = [];
      for (let index = 0; index < Math.min(18, summaryItems.length); index += 1) {
        const item = asRecord(summaryItems[index]);
        if (!item) {
          continue;
        }
        labels.push(String(item.word || "pattern-" + (index + 1)));
        values.push(
          Math.max(
            0,
            Number(patternSelectionFrequency.length > 0 ? item.frequency : item.importance) || 0
          )
        );
      }
      const bar = createAnalysisCanvas(760, Math.max(220, labels.length * 24 + 40));
      drawAnalysisBarChart(bar, labels, values, "#34d399");
      summaryCard.appendChild(bar);
      spfResults.appendChild(summaryCard);
    }

    const treeSummaries =
      summary && Array.isArray(summary.tree_summaries) ? summary.tree_summaries : [];
    if (treeSummaries.length > 0) {
      const treeCard = createAnalysisVizCard(
        "Tree Explorer",
        "Inspect prototype tree splits: selected symbolic word, gain, and left/right branch class mix."
      );
      const treeSelectLabel = document.createElement("label");
      treeSelectLabel.className = "stack-row-settings-label";
      treeSelectLabel.textContent = "Inspect tree";
      const treeSelect = document.createElement("select");
      treeSelect.className = "stack-row-settings-input";
      for (let index = 0; index < Math.min(80, treeSummaries.length); index += 1) {
        const split = asRecord(treeSummaries[index]);
        if (!split) {
          continue;
        }
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent =
          "Tree " + (sanitizeInt(split.treeIndex, index, 0, 1000000) + 1) + " | " + String(split.splitWord || "");
        treeSelect.appendChild(option);
      }
      treeSelectLabel.appendChild(treeSelect);
      treeCard.appendChild(treeSelectLabel);

      const branchHeatmap = createAnalysisCanvas(760, 220);
      treeCard.appendChild(branchHeatmap);
      const treeDetailHost = document.createElement("div");
      treeCard.appendChild(treeDetailHost);

      const renderTreeSummary = function (treeIdx) {
        const split = asRecord(treeSummaries[treeIdx]);
        const left = split ? asRecord(split.left) : null;
        const right = split ? asRecord(split.right) : null;
        if (!split || !left || !right) {
          drawAnalysisHeatmap(branchHeatmap, [[0, 0], [0, 0]], ["contains", "absent"], ["active", "inactive"]);
          treeDetailHost.innerHTML = "";
          treeDetailHost.appendChild(
            createAnalysisExamplesTable(
              ["field", "value"],
              [["status", "Tree payload missing or invalid."]]
            )
          );
          return;
        }

        drawAnalysisHeatmap(
          branchHeatmap,
          [
            [Number(left.active || 0), Number(left.inactive || 0)],
            [Number(right.active || 0), Number(right.inactive || 0)]
          ],
          ["contains pattern", "pattern absent"],
          ["active", "inactive"]
        );

        treeDetailHost.innerHTML = "";
        treeDetailHost.appendChild(
          createAnalysisExamplesTable(
            ["field", "value"],
            [
              ["split word", String(split.splitWord || "")],
              ["gain", formatMetricNumber(Number(split.gain), 6)],
              [
                "contains-pattern branch",
                "count=" +
                  String(sanitizeInt(left.count, 0, 0, 1000000000)) +
                  ", predict=" +
                  String(left.prediction || "")
              ],
              [
                "absent-pattern branch",
                "count=" +
                  String(sanitizeInt(right.count, 0, 0, 1000000000)) +
                  ", predict=" +
                  String(right.prediction || "")
              ]
            ]
          )
        );
      };

      treeSelect.addEventListener("change", function () {
        renderTreeSummary(sanitizeInt(treeSelect.value, 0, 0, Math.max(0, treeSummaries.length - 1)));
      });
      renderTreeSummary(0);
      spfResults.appendChild(treeCard);
    }

    const patternLabels = why && Array.isArray(why.pattern_labels) ? why.pattern_labels : [];
    const classPatternRates = why && Array.isArray(why.class_pattern_rates) ? why.class_pattern_rates : [];
    if (patternLabels.length > 0 && classPatternRates.length >= 2) {
      const whyCard = createAnalysisVizCard(
        "Why",
        "Pattern vocabulary by class (rows=active/inactive, cols=top patterns)"
      );
      const heatmap = createAnalysisCanvas(760, 220);
      drawAnalysisHeatmap(
        heatmap,
        classPatternRates.slice(0, 2),
        ["active", "inactive"],
        patternLabels
      );
      whyCard.appendChild(heatmap);
      spfResults.appendChild(whyCard);
    }

    const patternExamples =
      examples && Array.isArray(examples.pattern_examples) ? examples.pattern_examples : [];
    const topPatterns = Array.isArray(result.top_patterns) ? result.top_patterns : [];
    if (topPatterns.length > 0 || patternExamples.length > 0) {
      const explorerCard = createAnalysisVizCard(
        "Pattern Explorer",
        "Select a symbolic pattern to inspect support, discriminative stats, and example occurrences."
      );
      const selectLabel = document.createElement("label");
      selectLabel.className = "stack-row-settings-label";
      selectLabel.textContent = "Pattern";
      const patternSelect = document.createElement("select");
      patternSelect.className = "stack-row-settings-input";
      const words = [];
      const seenWords = new Set();
      for (let index = 0; index < topPatterns.length; index += 1) {
        const pattern = asRecord(topPatterns[index]);
        if (!pattern) {
          continue;
        }
        const word = String(pattern.word || "");
        if (!word || seenWords.has(word)) {
          continue;
        }
        seenWords.add(word);
        words.push(word);
      }
      for (let index = 0; index < patternExamples.length; index += 1) {
        const item = asRecord(patternExamples[index]);
        if (!item) {
          continue;
        }
        const word = String(item.word || "");
        if (!word || seenWords.has(word)) {
          continue;
        }
        seenWords.add(word);
        words.push(word);
      }
      words.slice(0, 60).forEach(function (word) {
        const option = document.createElement("option");
        option.value = word;
        option.textContent = word;
        patternSelect.appendChild(option);
      });
      selectLabel.appendChild(patternSelect);
      explorerCard.appendChild(selectLabel);
      const detailHost = document.createElement("div");
      explorerCard.appendChild(detailHost);

      const renderPatternDetail = function (word) {
        detailHost.innerHTML = "";
        if (!word) {
          detailHost.appendChild(
            createAnalysisExamplesTable(["field", "value"], [["status", "No pattern available."]])
          );
          return;
        }
        let patternRecord = null;
        for (let index = 0; index < topPatterns.length; index += 1) {
          const candidate = asRecord(topPatterns[index]);
          if (!candidate) {
            continue;
          }
          if (String(candidate.word || "") === word) {
            patternRecord = candidate;
            break;
          }
        }
        let exampleRecord = null;
        for (let index = 0; index < patternExamples.length; index += 1) {
          const candidate = asRecord(patternExamples[index]);
          if (!candidate) {
            continue;
          }
          if (String(candidate.word || "") === word) {
            exampleRecord = candidate;
            break;
          }
        }

        if (patternRecord) {
          detailHost.appendChild(
            createAnalysisExamplesTable(
              ["metric", "value"],
              [
                ["support", formatMetricPercent(Number(patternRecord.support))],
                [
                  "active / inactive",
                  String(sanitizeInt(patternRecord.active, 0, 0, 1000000000)) +
                    " / " +
                    String(sanitizeInt(patternRecord.inactive, 0, 0, 1000000000))
                ],
                ["info gain", formatMetricNumber(Number(patternRecord.infoGain), 6)],
                ["chi-square", formatMetricNumber(Number(patternRecord.chiSquare), 4)],
                ["log-odds(active)", formatMetricNumber(Number(patternRecord.logOdds), 4)]
              ]
            )
          );
        }

        const occurrences =
          exampleRecord && Array.isArray(exampleRecord.occurrences) ? exampleRecord.occurrences : [];
        if (occurrences.length > 0) {
          const rows = [];
          for (let index = 0; index < Math.min(10, occurrences.length); index += 1) {
            const occ = asRecord(occurrences[index]);
            if (!occ) {
              continue;
            }
            rows.push([
              sanitizeInt(occ.rowIndex, 0, 0, 1000000000),
              formatMetricNumber(Number(occ.timeSec), 3),
              String(occ.classLabel || "")
            ]);
          }
          if (rows.length > 0) {
            detailHost.appendChild(
              createAnalysisExamplesTable(["row", "time(s)", "class"], rows)
            );
          }
        }
      };

      patternSelect.addEventListener("change", function () {
        renderPatternDetail(patternSelect.value);
      });
      renderPatternDetail(patternSelect.value || (words.length > 0 ? words[0] : ""));
      spfResults.appendChild(explorerCard);
    }

    if (patternExamples.length > 0) {
      const examplesCard = createAnalysisVizCard(
        "Examples",
        "Example occurrences for top symbolic patterns"
      );
      const rows = [];
      for (let index = 0; index < Math.min(10, patternExamples.length); index += 1) {
        const item = asRecord(patternExamples[index]);
        if (!item) {
          continue;
        }
        const word = String(item.word || "");
        const occurrences = Array.isArray(item.occurrences) ? item.occurrences : [];
        if (occurrences.length === 0) {
          rows.push([word, "-", "-", "-"]);
          continue;
        }
        for (let occIndex = 0; occIndex < Math.min(3, occurrences.length); occIndex += 1) {
          const occ = asRecord(occurrences[occIndex]);
          if (!occ) {
            continue;
          }
          rows.push([
            word,
            sanitizeInt(occ.rowIndex, 0, 0, 1000000000),
            formatMetricNumber(Number(occ.timeSec), 3),
            String(occ.classLabel || "")
          ]);
        }
      }
      if (rows.length > 0) {
        examplesCard.appendChild(
          createAnalysisExamplesTable(["pattern", "row", "time(s)", "class"], rows)
        );
        spfResults.appendChild(examplesCard);
      }
    }
  }

  function updateSpfControls() {
    const hasAudio = Boolean(primaryAudio && primaryAudio.samples && primaryAudio.samples.length > 0);
    const hasOverlay = Boolean(state.overlay.enabled && overlayParsed && overlayParsed.intervals.length > 0);

    spfFeatureHint.textContent =
      "Symbol source: " +
      (spfSourceMode === "stft"
        ? "short-time STFT log-magnitude spectrogram frames"
        : "short-time mel feature frames") +
      ". Backend: in-browser JavaScript.";
    spfLabelHint.textContent = hasOverlay
      ? "Activation overlay loaded: " +
        overlayParsed.intervals.length +
        " intervals, mode=" +
        overlayParsed.mode +
        "."
      : "Activation overlay required to derive active/inactive labels.";

    spfRun.disabled = spfRunning || !hasAudio || !hasOverlay;
    spfSource.disabled = spfRunning;
    spfAlphabetSize.disabled = spfRunning;
    spfWordLength.disabled = spfRunning;
    spfMaxFrames.disabled = spfRunning;
    spfTopPatterns.disabled = spfRunning;
    spfForestTrees.disabled = spfRunning;
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
      output.sections.classwise = report.classwise || {
        available: false,
        reason: report.availability.classwise
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

  function postSaveTextRequestToHost(fileName, mimeType, content) {
    return new Promise(function (resolve, reject) {
      if (!vscode || typeof vscode.postMessage !== "function") {
        reject(new Error("VS Code host messaging unavailable."));
        return;
      }

      saveTextRequestCounter += 1;
      const requestId = "save-text-" + Date.now() + "-" + saveTextRequestCounter;
      const timeoutId = window.setTimeout(function () {
        if (!pendingSaveTextRequests.has(requestId)) {
          return;
        }
        pendingSaveTextRequests.delete(requestId);
        reject(new Error("Timed out waiting for save dialog response."));
      }, 120000);

      pendingSaveTextRequests.set(requestId, {
        resolve,
        reject,
        timeoutId
      });

      try {
        vscode.postMessage({
          type: "saveTextFile",
          payload: {
            requestId,
            fileName,
            mimeType,
            content
          }
        });
      } catch (error) {
        clearTimeout(timeoutId);
        pendingSaveTextRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  function isSaveCanceledError(error) {
    return error instanceof Error && error.name === "SaveCanceledError";
  }

  function resolveSaveTextRequestFromHost(rawPayload) {
    const payload = asRecord(rawPayload);
    if (!payload) {
      return;
    }
    const requestId = sanitizeStringValue(payload.requestId, 128);
    if (!requestId) {
      return;
    }

    const pending = pendingSaveTextRequests.get(requestId);
    if (!pending) {
      return;
    }
    pendingSaveTextRequests.delete(requestId);
    clearTimeout(pending.timeoutId);

    if (Boolean(payload.ok)) {
      pending.resolve(
        typeof payload.fileUri === "string" && payload.fileUri.trim().length > 0
          ? payload.fileUri
          : null
      );
      return;
    }

    const cancelled = Boolean(payload.cancelled);
    const message =
      sanitizeStringValue(payload.message, 1024) ||
      (cancelled ? "Save canceled." : "Failed to save file.");
    const error = new Error(message);
    error.name = cancelled ? "SaveCanceledError" : "SaveFileError";
    pending.reject(error);
  }

  async function triggerTextDownload(fileName, mimeType, content) {
    if (vscode && typeof vscode.postMessage === "function") {
      await postSaveTextRequestToHost(fileName, mimeType, content);
      return;
    }

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
    const analysisAudio = getSingleChannelAnalysisAudio();
    const histogramConfig = getMetricsHistogramConfig();
    const classwiseKey = getClasswiseMetricsCacheKeyPart();
    const widthSignature = Math.round(metricsHistogramCanvas.clientWidth || 0);
    const signature =
      (report ? metricsAudioKey(analysisAudio) : "none") +
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
      ].join(",") +
      "|" +
      histogramConfig.bins +
      "|" +
      histogramConfig.min.toFixed(6) +
      "|" +
      histogramConfig.max.toFixed(6) +
      "|" +
      classwiseKey;

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
      " s)." +
      (primaryAudio && getAudioChannelCount(primaryAudio) > 1
        ? " Source: " + getSingleChannelAnalysisLabel() + "."
        : "");

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
      const histogram = report.distributional.histogram;
      const rows = [
        ["Entropy", formatMetricNumber(report.distributional.entropyBits, 4) + " bits"],
        ["Moment m1", formatMetricNumber(report.distributional.moments.m1, 6)],
        ["Moment m2", formatMetricNumber(report.distributional.moments.m2, 6)],
        ["Moment m3", formatMetricNumber(report.distributional.moments.m3, 6)],
        ["Moment m4", formatMetricNumber(report.distributional.moments.m4, 6)],
        ["Histogram bins", String(histogram.counts.length)],
        [
          "Histogram range",
          formatMetricNumber(histogram.min, 3) + " .. " + formatMetricNumber(histogram.max, 3)
        ],
        ["Histogram bin width", formatMetricNumber(histogram.binWidth, 6)]
      ];
      metricsContent.appendChild(createMetricsGroup("Distributional Metrics", rows));
      drawMetricsHistogram(histogram);
    } else {
      clearMetricsHistogram("Enable Distributional info to show histogram.");
    }

    if (state.metrics.classwise) {
      if (report.classwise && report.classwise.available) {
        const sourceRows = [
          ["Source mode", report.classwise.source.mode],
          ["Intervals", String(report.classwise.source.intervals)],
          [
            "Active rows",
            String(report.classwise.source.activeRows) +
              " / " +
              String(report.classwise.source.totalRows)
          ],
          ["Active coverage", formatMetricPercent(report.classwise.active.coverageRatio)],
          ["Inactive coverage", formatMetricPercent(report.classwise.inactive.coverageRatio)],
          ["Note", report.classwise.note]
        ];
        metricsContent.appendChild(createMetricsGroup("Classwise Metrics", sourceRows));

        const activeRows = [
          ["Duration", formatMetricNumber(report.classwise.active.durationSeconds, 3) + " s"],
          ["Samples", String(report.classwise.active.sampleCount)],
          ["Mean", formatMetricNumber(report.classwise.active.mean, 6)],
          ["RMS", formatMetricNumber(report.classwise.active.rms, 6)],
          ["Std", formatMetricNumber(report.classwise.active.std, 6)],
          ["Peak |x|", formatMetricNumber(report.classwise.active.peakAbs, 6)],
          ["Mean power", formatMetricNumber(report.classwise.active.meanPower, 8)],
          ["Mean power (dB)", formatMetricNumber(report.classwise.active.meanPowerDb, 2) + " dB"],
          ["Clipping ratio", formatMetricPercent(report.classwise.active.clippingRatio)],
          ["ZCR", formatMetricNumber(report.classwise.active.zcr, 6)]
        ];
        metricsContent.appendChild(createMetricsGroup("Classwise: Active", activeRows));

        const inactiveRows = [
          ["Duration", formatMetricNumber(report.classwise.inactive.durationSeconds, 3) + " s"],
          ["Samples", String(report.classwise.inactive.sampleCount)],
          ["Mean", formatMetricNumber(report.classwise.inactive.mean, 6)],
          ["RMS", formatMetricNumber(report.classwise.inactive.rms, 6)],
          ["Std", formatMetricNumber(report.classwise.inactive.std, 6)],
          ["Peak |x|", formatMetricNumber(report.classwise.inactive.peakAbs, 6)],
          ["Mean power", formatMetricNumber(report.classwise.inactive.meanPower, 8)],
          [
            "Mean power (dB)",
            formatMetricNumber(report.classwise.inactive.meanPowerDb, 2) + " dB"
          ],
          ["Clipping ratio", formatMetricPercent(report.classwise.inactive.clippingRatio)],
          ["ZCR", formatMetricNumber(report.classwise.inactive.zcr, 6)]
        ];
        metricsContent.appendChild(createMetricsGroup("Classwise: Inactive", inactiveRows));

        const deltaRows = [
          ["RMS delta (active-inactive)", formatMetricNumber(report.classwise.deltas.rmsDb, 2) + " dB"],
          [
            "Mean power delta",
            formatMetricNumber(report.classwise.deltas.meanPowerDb, 2) + " dB"
          ],
          ["Peak |x| delta", formatMetricNumber(report.classwise.deltas.peakAbs, 6)],
          [
            "Clipping ratio delta",
            formatMetricPercent(report.classwise.deltas.clippingRatio)
          ],
          ["ZCR delta", formatMetricNumber(report.classwise.deltas.zcr, 6)]
        ];
        metricsContent.appendChild(createMetricsGroup("Classwise Contrast", deltaRows));
      } else {
        metricsContent.appendChild(
          createMetricsGroup("Classwise Metrics", [["Status", report.availability.classwise]])
        );
      }
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

  function buildIntervalSignature(intervals) {
    if (!Array.isArray(intervals) || intervals.length === 0) {
      return "0:0";
    }

    let hash = 2166136261 >>> 0;
    for (let index = 0; index < intervals.length; index += 1) {
      const interval = intervals[index];
      const start = Number.isFinite(interval.startSec) ? Math.round(interval.startSec * 1000) : 0;
      const end = Number.isFinite(interval.endSec) ? Math.round(interval.endSec * 1000) : 0;
      hash ^= start >>> 0;
      hash = Math.imul(hash, 16777619) >>> 0;
      hash ^= end >>> 0;
      hash = Math.imul(hash, 16777619) >>> 0;
    }

    return intervals.length + ":" + hash.toString(16);
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
        totalRows: table.rows.length,
        signature: buildIntervalSignature(intervals)
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

    const mergedIntervals = mergeIntervals(intervals);

    return {
      mode,
      intervals: mergedIntervals,
      activeRows,
      totalRows: table.rows.length,
      signature: buildIntervalSignature(mergedIntervals)
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

  function announceStackReorder(message) {
    if (!stackA11yStatus) {
      return;
    }
    stackA11yStatus.textContent = "";
    window.setTimeout(function () {
      stackA11yStatus.textContent = message;
    }, 0);
  }

  function focusStackHandleByItemId(itemId) {
    if (!itemId) {
      return;
    }
    window.requestAnimationFrame(function () {
      const handles = stackList.querySelectorAll(".drag-handle");
      for (let index = 0; index < handles.length; index += 1) {
        const handle = handles[index];
        if (handle && handle.dataset && handle.dataset.itemId === itemId) {
          handle.focus();
          break;
        }
      }
    });
  }

  function moveStackItemWithAnnouncement(item, fromIndex, toIndex) {
    const clampedTarget = clamp(toIndex, 0, Math.max(0, state.stack.length - 1));
    if (clampedTarget === fromIndex) {
      return false;
    }

    swapStackItems(fromIndex, clampedTarget);
    pendingStackHandleFocusId = item && item.id ? item.id : null;
    const movedLabel =
      item && typeof item === "object" ? getTransformDisplayLabel(item) : "view";
    announceStackReorder(
      "Moved " +
        movedLabel +
        " to position " +
        (clampedTarget + 1) +
        " of " +
        state.stack.length +
        "."
    );
    renderStackControls();
    renderTransformStack();
    postState();
    return true;
  }

  function cleanupViewStateCache() {
    const liveIds = new Set(state.stack.map(function (item) {
      return item.id;
    }));
    if (state.pca.enabled) {
      liveIds.add(getPcaVirtualViewId());
    }

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
      updateMultichannelControlsFromAudio();
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
    updateMultichannelControlsFromAudio();

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
    updateMultichannelControlsFromAudio();
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
      const channels = new Array(channelCount);

      for (let channel = 0; channel < channelCount; channel += 1) {
        const sourceChannel = decoded.getChannelData(channel);
        const channelData = new Float32Array(totalSamples);
        channelData.set(sourceChannel);
        channels[channel] = channelData;
        for (let index = 0; index < totalSamples; index += 1) {
          mono[index] += channelData[index];
        }
      }

      for (let index = 0; index < totalSamples; index += 1) {
        mono[index] /= channelCount;
      }

      const spatialSummary =
        channels.length >= 2
          ? summarizeStereoSpatial(channels[0], channels[1], decoded.sampleRate)
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
        channels,
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
      normalizeComparisonTrimForAudioData(comparisonAudioData);
      syncControlsFromState();
      const resolvedRegion = resolveComparisonRegion(comparisonAudioData, state.comparison);
      setComparisonStatus(
        "Loaded " +
          file.name +
          " | " +
          decoded.sampleRate +
          " Hz | " +
          decoded.channelCount +
          " ch | " +
          decoded.duration.toFixed(2) +
          " s | trim " +
          resolvedRegion.startSec.toFixed(2) +
          "-" +
          resolvedRegion.endSec.toFixed(2) +
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

  function getAudioChannelCount(audioData) {
    if (!audioData) {
      return 1;
    }

    if (Array.isArray(audioData.channels) && audioData.channels.length > 0) {
      return audioData.channels.length;
    }

    return sanitizeInt(audioData.channelCount, 1, 1, 64);
  }

  function getAudioDataForChannel(audioData, channelIndex) {
    if (!audioData || !Array.isArray(audioData.channels) || audioData.channels.length <= 1) {
      return audioData;
    }

    const boundedIndex = clamp(channelIndex, 0, audioData.channels.length - 1);
    const channelSamples = audioData.channels[boundedIndex];

    return {
      audioKey: (audioData.audioKey || audioData.fileName || "audio") + "::ch" + boundedIndex,
      fileName: audioData.fileName,
      sampleRate: audioData.sampleRate,
      channelCount: 1,
      duration: audioData.duration,
      samples: channelSamples,
      channels: [channelSamples],
      spatialSummary: null,
      sourceChannelIndex: boundedIndex,
      sourceChannelCount: getAudioChannelCount(audioData)
    };
  }

  function getSelectedAnalysisChannelIndex(channelCount) {
    const maxChannelIndex = Math.max(-1, channelCount - 1);
    return sanitizeInt(state.multichannel.analysisChannelIndex, 0, -1, maxChannelIndex);
  }

  function getSingleChannelAnalysisAudio() {
    if (!primaryAudio) {
      return null;
    }

    const channelCount = getAudioChannelCount(primaryAudio);
    if (channelCount <= 1) {
      state.multichannel.analysisChannelIndex = 0;
      return primaryAudio;
    }

    const channelIndex = getSelectedAnalysisChannelIndex(channelCount);
    state.multichannel.analysisChannelIndex = channelIndex;
    if (channelIndex < 0) {
      return primaryAudio;
    }

    return getAudioDataForChannel(primaryAudio, channelIndex);
  }

  function getSingleChannelAnalysisLabel() {
    if (!primaryAudio) {
      return "mixdown";
    }

    const channelCount = getAudioChannelCount(primaryAudio);
    if (channelCount <= 1) {
      return "channel 1";
    }

    const channelIndex = getSelectedAnalysisChannelIndex(channelCount);
    if (channelIndex < 0) {
      return "mixdown";
    }

    return "channel " + (channelIndex + 1);
  }

  function updateMultichannelControlsFromAudio() {
    function syncRowDisabledStyle() {
      multichannelEnabledRow.classList.toggle("is-disabled", multichannelEnabled.disabled);
      multichannelSplitRow.classList.toggle("is-disabled", multichannelSplit.disabled);
      multichannelAnalysisRow.classList.toggle("is-disabled", multichannelAnalysisChannel.disabled);
      multichannelNote.classList.toggle(
        "is-disabled",
        multichannelEnabled.disabled && multichannelSplit.disabled && multichannelAnalysisChannel.disabled
      );
    }

    const channelCount = primaryAudio ? getAudioChannelCount(primaryAudio) : 0;
    const hasMultichannel = channelCount > 1;
    const hasAudio = Boolean(primaryAudio);

    multichannelAnalysisChannel.innerHTML = "";

    if (!hasMultichannel) {
      state.multichannel.enabled = false;
      multichannelEnabled.checked = false;
      multichannelSplit.checked = state.multichannel.splitViewsByChannel;
      multichannelEnabled.disabled = hasAudio;
      multichannelSplit.disabled = true;

      const placeholderOption = document.createElement("option");
      placeholderOption.value = "0";
      placeholderOption.textContent = hasAudio ? "Channel 1" : "Load audio first";
      multichannelAnalysisChannel.appendChild(placeholderOption);
      multichannelAnalysisChannel.value = "0";
      multichannelAnalysisChannel.disabled = true;
      state.multichannel.analysisChannelIndex = 0;

      if (!hasAudio) {
        multichannelNote.textContent = "Load a multichannel clip to enable multichannel controls.";
      } else {
        multichannelNote.textContent =
          "Single-channel clip detected. Multichannel mode is unavailable for this file.";
      }
      syncRowDisabledStyle();
      return;
    }

    multichannelEnabled.disabled = false;
    multichannelEnabled.checked = state.multichannel.enabled;
    multichannelSplit.checked = state.multichannel.splitViewsByChannel;
    multichannelSplit.disabled = !state.multichannel.enabled;

    const selectedChannelIndex = getSelectedAnalysisChannelIndex(channelCount);
    state.multichannel.analysisChannelIndex = selectedChannelIndex;

    for (let channel = 0; channel < channelCount; channel += 1) {
      const option = document.createElement("option");
      option.value = String(channel);
      option.textContent = "Channel " + (channel + 1);
      multichannelAnalysisChannel.appendChild(option);
    }
    const mixdownOption = document.createElement("option");
    mixdownOption.value = "-1";
    mixdownOption.textContent = "Mixdown (all channels)";
    multichannelAnalysisChannel.appendChild(mixdownOption);

    multichannelAnalysisChannel.disabled = false;
    multichannelAnalysisChannel.value = String(selectedChannelIndex);

    const label = getSingleChannelAnalysisLabel();
    if (state.multichannel.enabled) {
      multichannelNote.textContent = state.multichannel.splitViewsByChannel
        ? "Note: metrics and PCA use " +
          label +
          " for single-channel analysis. Split transform views remain channel-wise."
        : "Note: feature cards, metrics, and PCA use " +
          label +
          " for single-channel analysis.";
    } else {
      multichannelNote.textContent = "Single-channel analysis source: " + label + ".";
    }

    syncRowDisabledStyle();
  }

  function shouldRenderSplitChannels(activeComparisonMode) {
    return Boolean(
      activeComparisonMode === "none" &&
        primaryAudio &&
        state.multichannel &&
        state.multichannel.enabled &&
        state.multichannel.splitViewsByChannel &&
        getAudioChannelCount(primaryAudio) > 1
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
    return ensureStftForAudio(item, getSingleChannelAnalysisAudio(), derivedCache);
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
    const frameSampleOffsets = [];
    const frameTimesSeconds = [];

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
      frameSampleOffsets.push(offset);
      frameTimesSeconds.push((offset + fftSize * 0.5) / Math.max(1, sampleRate));
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
      phaseFrames,
      frameStride,
      frameSampleOffsets,
      frameTimesSeconds
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
    return ensureMelForAudio(item, getSingleChannelAnalysisAudio(), derivedCache);
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
    return ensureMfccForAudio(item, getSingleChannelAnalysisAudio(), derivedCache);
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
    return ensureDctForAudio(item, getSingleChannelAnalysisAudio(), derivedCache);
  }

  function ensureOnsetEnvelopeForAudio(item, audioData, cache) {
    const stft = ensureStftForAudio(item, audioData, cache);
    const onsetKey = stft.cacheKey + "::onset";
    if (cache.onsetByKey[onsetKey]) {
      return cache.onsetByKey[onsetKey];
    }

    const frameCount = stft.logMagnitudeFrames.length;
    const onset = new Float32Array(frameCount);
    for (let frameIndex = 1; frameIndex < frameCount; frameIndex += 1) {
      const current = stft.logMagnitudeFrames[frameIndex];
      const previous = stft.logMagnitudeFrames[frameIndex - 1];
      let flux = 0;
      for (let bin = 1; bin < current.length; bin += 1) {
        const delta = current[bin] - previous[bin];
        if (delta > 0) {
          flux += delta;
        }
      }
      onset[frameIndex] = flux;
    }

    let maxValue = 0;
    for (let index = 0; index < onset.length; index += 1) {
      if (onset[index] > maxValue) {
        maxValue = onset[index];
      }
    }
    if (maxValue > 1e-12) {
      for (let index = 0; index < onset.length; index += 1) {
        onset[index] /= maxValue;
      }
    }

    const onsetResult = {
      cacheKey: onsetKey,
      values: onset,
      frameCount,
      frameRateHz: stft.sampleRate / Math.max(1, stft.hopSize),
      durationSeconds: stft.durationSeconds
    };
    cache.onsetByKey[onsetKey] = onsetResult;
    return onsetResult;
  }

  function computeTempogramMatrix(onsetValues, frameRateHz) {
    const frameCount = onsetValues.length;
    if (frameCount <= 0 || frameRateHz <= 0) {
      return {
        matrix: [new Float32Array(1)],
        lagCount: 1,
        tempoMinBpm: 0,
        tempoMaxBpm: 0
      };
    }

    const windowFrames = clamp(Math.round(frameRateHz * 8), 16, 256);
    const halfWindow = Math.floor(windowFrames / 2);
    let lagCount = clamp(Math.round(frameRateHz * 2), 8, 192);
    lagCount = Math.min(lagCount, Math.max(1, frameCount - 1));

    const centered = new Float32Array(frameCount);
    let mean = 0;
    for (let index = 0; index < frameCount; index += 1) {
      mean += onsetValues[index];
    }
    mean /= Math.max(1, frameCount);
    for (let index = 0; index < frameCount; index += 1) {
      centered[index] = onsetValues[index] - mean;
    }

    const matrix = new Array(frameCount);
    for (let center = 0; center < frameCount; center += 1) {
      const row = new Float32Array(lagCount);
      const windowStart = Math.max(0, center - halfWindow);
      const windowEnd = Math.min(frameCount, center + halfWindow + 1);
      for (let lag = 1; lag <= lagCount; lag += 1) {
        const start = windowStart + lag;
        if (start >= windowEnd) {
          row[lag - 1] = 0;
          continue;
        }
        let sum = 0;
        let count = 0;
        for (let index = start; index < windowEnd; index += 1) {
          sum += centered[index] * centered[index - lag];
          count += 1;
        }
        row[lag - 1] = count > 0 ? sum / count : 0;
      }
      matrix[center] = row;
    }

    return {
      matrix,
      lagCount,
      tempoMinBpm: (60 * frameRateHz) / Math.max(1, lagCount),
      tempoMaxBpm: 60 * frameRateHz
    };
  }

  function computeFourierTempogramMatrix(onsetValues, frameRateHz) {
    const frameCount = onsetValues.length;
    if (frameCount <= 0 || frameRateHz <= 0) {
      return {
        matrix: [new Float32Array(1)],
        binCount: 1,
        tempoMinBpm: 0,
        tempoMaxBpm: 0
      };
    }

    const windowFrames = clamp(Math.round(frameRateHz * 8), 32, 256);
    const halfWindow = Math.floor(windowFrames / 2);
    let nfft = 1;
    while (nfft < windowFrames) {
      nfft *= 2;
    }
    nfft = Math.max(32, nfft);

    const minTempoBpm = 20;
    const maxTempoBpm = 600;
    let minBin = Math.max(
      1,
      Math.floor(((minTempoBpm / 60) * nfft) / Math.max(1e-9, frameRateHz))
    );
    let maxBin = Math.min(
      Math.floor(nfft / 2),
      Math.ceil(((maxTempoBpm / 60) * nfft) / Math.max(1e-9, frameRateHz))
    );
    if (maxBin < minBin) {
      minBin = 1;
      maxBin = Math.max(1, Math.floor(nfft / 2));
    }

    const binCount = Math.max(1, maxBin - minBin + 1);
    const window = createWindow(windowFrames, "hann");
    const centered = new Float32Array(frameCount);
    let mean = 0;
    for (let index = 0; index < frameCount; index += 1) {
      mean += onsetValues[index];
    }
    mean /= Math.max(1, frameCount);
    for (let index = 0; index < frameCount; index += 1) {
      centered[index] = onsetValues[index] - mean;
    }

    const matrix = new Array(frameCount);
    for (let center = 0; center < frameCount; center += 1) {
      const re = new Float64Array(nfft);
      const im = new Float64Array(nfft);
      for (let index = 0; index < windowFrames; index += 1) {
        const sourceIndex = center - halfWindow + index;
        const value = sourceIndex >= 0 && sourceIndex < frameCount ? centered[sourceIndex] : 0;
        re[index] = value * window[index];
      }
      fftInPlace(re, im);

      const row = new Float32Array(binCount);
      for (let bin = minBin; bin <= maxBin; bin += 1) {
        row[bin - minBin] = Math.hypot(re[bin], im[bin]);
      }
      matrix[center] = row;
    }

    return {
      matrix,
      binCount,
      tempoMinBpm: (60 * minBin * frameRateHz) / nfft,
      tempoMaxBpm: (60 * maxBin * frameRateHz) / nfft
    };
  }

  function ensureTempogramForAudio(item, audioData, cache) {
    const onset = ensureOnsetEnvelopeForAudio(item, audioData, cache);
    const key = onset.cacheKey + "::tempogram";
    if (cache.tempogramByKey[key]) {
      return cache.tempogramByKey[key];
    }

    const computed = computeTempogramMatrix(onset.values, onset.frameRateHz);
    const result = {
      cacheKey: key,
      matrix: computed.matrix,
      lagCount: computed.lagCount,
      frameRateHz: onset.frameRateHz,
      tempoMinBpm: computed.tempoMinBpm,
      tempoMaxBpm: computed.tempoMaxBpm,
      durationSeconds: onset.durationSeconds
    };

    cache.tempogramByKey[key] = result;
    return result;
  }

  function ensureTempogram(item) {
    return ensureTempogramForAudio(item, getSingleChannelAnalysisAudio(), derivedCache);
  }

  function ensureFourierTempogramForAudio(item, audioData, cache) {
    const onset = ensureOnsetEnvelopeForAudio(item, audioData, cache);
    const key = onset.cacheKey + "::fourier_tempogram";
    if (cache.fourierTempogramByKey[key]) {
      return cache.fourierTempogramByKey[key];
    }

    const computed = computeFourierTempogramMatrix(onset.values, onset.frameRateHz);
    const result = {
      cacheKey: key,
      matrix: computed.matrix,
      binCount: computed.binCount,
      frameRateHz: onset.frameRateHz,
      tempoMinBpm: computed.tempoMinBpm,
      tempoMaxBpm: computed.tempoMaxBpm,
      durationSeconds: onset.durationSeconds
    };

    cache.fourierTempogramByKey[key] = result;
    return result;
  }

  function ensureFourierTempogram(item) {
    return ensureFourierTempogramForAudio(item, getSingleChannelAnalysisAudio(), derivedCache);
  }

  function createPcaReferenceItem(kind) {
    return {
      id: "__pca_source__" + kind,
      kind,
      params: createDefaultParamsForKind(kind, kind === "stft" ? "magnitude" : undefined)
    };
  }

  function buildSsaFeatureRows(samples, sampleRate) {
    const safeSampleRate = Math.max(1, sampleRate);
    const lag = clamp(Math.round(safeSampleRate * 0.03), 32, 192);
    const hop = Math.max(1, Math.round(lag / 4));
    const targetFeatures = Math.min(MAX_PCA_FEATURES, 96);
    const window = createWindow(lag, "hann");
    const totalFrames = Math.max(1, Math.floor((Math.max(samples.length, lag) - lag) / hop) + 1);
    const frameStride = Math.max(1, Math.floor(totalFrames / MAX_PCA_FRAMES));
    const rows = [];
    const rowTimesSeconds = [];

    for (let frame = 0; frame < totalFrames; frame += frameStride) {
      const offset = frame * hop;
      const row = new Float32Array(lag);
      let mean = 0;
      for (let index = 0; index < lag; index += 1) {
        const sampleIndex = offset + index;
        const value = sampleIndex < samples.length ? samples[sampleIndex] : 0;
        mean += value;
        row[index] = value;
      }
      mean /= lag;
      for (let index = 0; index < lag; index += 1) {
        row[index] = (row[index] - mean) * window[index];
      }
      rows.push(lag > targetFeatures ? resampleVectorToLength(row, targetFeatures) : row);
      rowTimesSeconds.push((offset + lag * 0.5) / safeSampleRate);
    }

    return {
      rows,
      rowTimesSeconds,
      sourceDescription: "SSA lag-embedded waveform windows (" + lag + " samples).",
      sourceNote: "Lag embedding approximates SSA-style PCA for denoising/structure analysis."
    };
  }

  function preparePcaInputRows(rawRows, rawRowTimesSeconds) {
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return {
        rows: [],
        rowTimesSeconds: [],
        rowStride: 1,
        originalRowCount: 0,
        originalColCount: 0,
        colCount: 0
      };
    }

    const first = rawRows[0];
    const sourceColCount = first && typeof first.length === "number" ? first.length : 0;
    if (!sourceColCount) {
      return {
        rows: [],
        rowTimesSeconds: [],
        rowStride: 1,
        originalRowCount: rawRows.length,
        originalColCount: 0,
        colCount: 0
      };
    }

    const rowStride = Math.max(1, Math.floor(rawRows.length / MAX_PCA_FRAMES));
    const targetColCount = Math.min(MAX_PCA_FEATURES, sourceColCount);
    const preparedRows = [];
    const preparedRowTimesSeconds = [];

    for (let rowIndex = 0; rowIndex < rawRows.length; rowIndex += rowStride) {
      const source = rawRows[rowIndex];
      if (!source || typeof source.length !== "number" || source.length < 2) {
        continue;
      }

      let row;
      if (source.length > targetColCount) {
        row = resampleVectorToLength(source, targetColCount);
      } else if (source.length < targetColCount) {
        row = new Float32Array(targetColCount);
        for (let index = 0; index < source.length; index += 1) {
          row[index] = source[index];
        }
      } else {
        row = new Float32Array(source.length);
        row.set(source);
      }
      preparedRows.push(row);

      if (Array.isArray(rawRowTimesSeconds) && rowIndex < rawRowTimesSeconds.length) {
        const rowTimeSeconds = Number(rawRowTimesSeconds[rowIndex]);
        if (Number.isFinite(rowTimeSeconds)) {
          preparedRowTimesSeconds.push(rowTimeSeconds);
          continue;
        }
      }
      preparedRowTimesSeconds.push(rowIndex);
    }

    return {
      rows: preparedRows,
      rowTimesSeconds: preparedRowTimesSeconds,
      rowStride,
      originalRowCount: rawRows.length,
      originalColCount: sourceColCount,
      colCount: preparedRows.length ? preparedRows[0].length : 0
    };
  }

  function summarizeExplainedRatios(explainedRatios) {
    if (!Array.isArray(explainedRatios) || explainedRatios.length === 0) {
      return "n/a";
    }

    return explainedRatios
      .map(function (value, index) {
        return "PC" + (index + 1) + "=" + formatMetricPercent(value);
      })
      .join(", ");
  }

  function buildClassLabelsFromRowTimes(rowTimesSeconds, intervals) {
    if (!Array.isArray(rowTimesSeconds) || rowTimesSeconds.length === 0) {
      return null;
    }
    if (!Array.isArray(intervals) || intervals.length === 0) {
      return null;
    }

    const labels = new Uint8Array(rowTimesSeconds.length);
    let activeCount = 0;
    let intervalIndex = 0;

    for (let rowIndex = 0; rowIndex < rowTimesSeconds.length; rowIndex += 1) {
      const timeSeconds = Number(rowTimesSeconds[rowIndex]);
      if (!Number.isFinite(timeSeconds)) {
        continue;
      }

      while (
        intervalIndex < intervals.length &&
        Number.isFinite(intervals[intervalIndex].endSec) &&
        intervals[intervalIndex].endSec < timeSeconds - 1e-9
      ) {
        intervalIndex += 1;
      }

      if (intervalIndex >= intervals.length) {
        continue;
      }

      const interval = intervals[intervalIndex];
      if (
        Number.isFinite(interval.startSec) &&
        Number.isFinite(interval.endSec) &&
        interval.startSec <= timeSeconds + 1e-9 &&
        interval.endSec >= timeSeconds - 1e-9
      ) {
        labels[rowIndex] = 1;
        activeCount += 1;
      }
    }

    return {
      labels,
      activeCount,
      inactiveCount: rowTimesSeconds.length - activeCount
    };
  }

  function splitRowsByClass(rows, labels) {
    const activeRows = [];
    const inactiveRows = [];
    const activeIndices = [];
    const inactiveIndices = [];

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      if (labels[rowIndex]) {
        activeRows.push(rows[rowIndex]);
        activeIndices.push(rowIndex);
      } else {
        inactiveRows.push(rows[rowIndex]);
        inactiveIndices.push(rowIndex);
      }
    }

    return { activeRows, inactiveRows, activeIndices, inactiveIndices };
  }

  function summarizeProjectionDistance(projectionMatrix, activeIndices, inactiveIndices, componentCount) {
    if (
      !Array.isArray(projectionMatrix) ||
      activeIndices.length === 0 ||
      inactiveIndices.length === 0 ||
      componentCount <= 0
    ) {
      return null;
    }

    const dims = Math.max(1, Math.min(componentCount, 3));
    const activeMean = new Float64Array(dims);
    const inactiveMean = new Float64Array(dims);

    for (let index = 0; index < activeIndices.length; index += 1) {
      const row = projectionMatrix[activeIndices[index]];
      if (!row) {
        continue;
      }
      for (let dim = 0; dim < dims; dim += 1) {
        activeMean[dim] += row[dim] || 0;
      }
    }
    for (let dim = 0; dim < dims; dim += 1) {
      activeMean[dim] /= Math.max(1, activeIndices.length);
    }

    for (let index = 0; index < inactiveIndices.length; index += 1) {
      const row = projectionMatrix[inactiveIndices[index]];
      if (!row) {
        continue;
      }
      for (let dim = 0; dim < dims; dim += 1) {
        inactiveMean[dim] += row[dim] || 0;
      }
    }
    for (let dim = 0; dim < dims; dim += 1) {
      inactiveMean[dim] /= Math.max(1, inactiveIndices.length);
    }

    let centroidDistanceSquared = 0;
    for (let dim = 0; dim < dims; dim += 1) {
      const delta = activeMean[dim] - inactiveMean[dim];
      centroidDistanceSquared += delta * delta;
    }

    const fisherByComponent = [];
    const fisherLimit = Math.min(componentCount, 3);
    for (let componentIndex = 0; componentIndex < fisherLimit; componentIndex += 1) {
      const meanActive = activeMean[Math.min(componentIndex, dims - 1)] || 0;
      const meanInactive = inactiveMean[Math.min(componentIndex, dims - 1)] || 0;

      let activeVar = 0;
      for (let index = 0; index < activeIndices.length; index += 1) {
        const row = projectionMatrix[activeIndices[index]];
        if (!row) {
          continue;
        }
        const delta = (row[componentIndex] || 0) - meanActive;
        activeVar += delta * delta;
      }
      activeVar /= Math.max(1, activeIndices.length - 1);

      let inactiveVar = 0;
      for (let index = 0; index < inactiveIndices.length; index += 1) {
        const row = projectionMatrix[inactiveIndices[index]];
        if (!row) {
          continue;
        }
        const delta = (row[componentIndex] || 0) - meanInactive;
        inactiveVar += delta * delta;
      }
      inactiveVar /= Math.max(1, inactiveIndices.length - 1);

      const meanDelta = meanActive - meanInactive;
      fisherByComponent.push((meanDelta * meanDelta) / (activeVar + inactiveVar + 1e-12));
    }

    return {
      dims,
      centroidDistance: Math.sqrt(Math.max(0, centroidDistanceSquared)),
      fisherByComponent
    };
  }

  function computeClasswisePcaSummary(rows, rowTimesSeconds, projectionMatrix, componentCount) {
    if (!state.pca.classwise) {
      return {
        available: false,
        reason: "Classwise PCA disabled."
      };
    }

    if (!state.overlay.enabled) {
      return {
        available: false,
        reason: "Enable Activation Overlay and load CSV labels to run classwise PCA."
      };
    }

    if (!overlayParsed || !Array.isArray(overlayParsed.intervals) || overlayParsed.intervals.length === 0) {
      return {
        available: false,
        reason: "Load a valid overlay CSV to derive active/inactive classes for PCA."
      };
    }

    const labelsSummary = buildClassLabelsFromRowTimes(rowTimesSeconds, overlayParsed.intervals);
    if (!labelsSummary) {
      return {
        available: false,
        reason: "Unable to map PCA rows to overlay intervals."
      };
    }

    const split = splitRowsByClass(rows, labelsSummary.labels);
    if (split.activeRows.length < 2 || split.inactiveRows.length < 2) {
      return {
        available: false,
        reason:
          "Need at least 2 PCA rows per class. Active=" +
          split.activeRows.length +
          ", inactive=" +
          split.inactiveRows.length +
          "."
      };
    }

    const maxClassComponents = Math.min(MAX_PCA_COMPONENTS, rows[0] ? rows[0].length : 2);
    const activePca = computePcaProjection(split.activeRows, maxClassComponents);
    const inactivePca = computePcaProjection(split.inactiveRows, maxClassComponents);
    const separation = summarizeProjectionDistance(
      projectionMatrix,
      split.activeIndices,
      split.inactiveIndices,
      componentCount
    );

    return {
      available: true,
      mode: overlayParsed.mode,
      activeRows: split.activeRows.length,
      inactiveRows: split.inactiveRows.length,
      totalRows: rows.length,
      activeRatio: split.activeRows.length / Math.max(1, rows.length),
      source: {
        intervals: overlayParsed.intervals.length,
        activeRows: overlayParsed.activeRows,
        totalRows: overlayParsed.totalRows
      },
      activeModel: {
        componentCount: activePca.componentCount,
        explainedRatios: activePca.explainedRatios,
        explainedSummary: summarizeExplainedRatios(activePca.explainedRatios),
        componentVectors: activePca.componentVectors,
        projectionMatrix: activePca.projectionMatrix
      },
      inactiveModel: {
        componentCount: inactivePca.componentCount,
        explainedRatios: inactivePca.explainedRatios,
        explainedSummary: summarizeExplainedRatios(inactivePca.explainedRatios),
        componentVectors: inactivePca.componentVectors,
        projectionMatrix: inactivePca.projectionMatrix
      },
      separation,
      status:
        "Computed classwise PCA with " +
        split.activeRows.length +
        " active and " +
        split.inactiveRows.length +
        " inactive rows."
    };
  }

  function buildMagnitudeLoadingsFromMelLoadings(melLoadings, filterbank) {
    if (!filterbank || !filterbank.length) {
      return new Float32Array(1);
    }
    const binCount = filterbank[0].length;
    const out = new Float32Array(binCount);
    const count = Math.min(melLoadings.length, filterbank.length);
    for (let melIndex = 0; melIndex < count; melIndex += 1) {
      const coefficient = melLoadings[melIndex];
      const weights = filterbank[melIndex];
      for (let bin = 0; bin < binCount; bin += 1) {
        out[bin] += coefficient * weights[bin];
      }
    }
    return out;
  }

  function buildMelLoadingsFromMagnitudeLoadings(magnitudeLoadings, filterbank) {
    if (!filterbank || !filterbank.length) {
      return new Float32Array(1);
    }
    const out = new Float32Array(filterbank.length);
    for (let melIndex = 0; melIndex < filterbank.length; melIndex += 1) {
      const weights = filterbank[melIndex];
      let sum = 0;
      for (let bin = 0; bin < weights.length && bin < magnitudeLoadings.length; bin += 1) {
        sum += magnitudeLoadings[bin] * weights[bin];
      }
      out[melIndex] = sum;
    }
    return out;
  }

  function nextPowerOfTwo(value) {
    let n = 1;
    while (n < value) {
      n *= 2;
    }
    return n;
  }

  function buildMagnitudeSpectrumFromTimeVector(timeVector, preferredFftSize) {
    const sourceLength = Math.max(1, timeVector.length);
    const nfft = Math.max(
      32,
      nextPowerOfTwo(Math.max(sourceLength, preferredFftSize || sourceLength))
    );
    const re = new Float64Array(nfft);
    const im = new Float64Array(nfft);
    let mean = 0;
    for (let index = 0; index < sourceLength; index += 1) {
      mean += timeVector[index];
    }
    mean /= sourceLength;
    for (let index = 0; index < sourceLength; index += 1) {
      re[index] = timeVector[index] - mean;
    }

    fftInPlace(re, im);
    const binCount = nfft / 2 + 1;
    const magnitude = new Float32Array(binCount);
    for (let bin = 0; bin < binCount; bin += 1) {
      magnitude[bin] = Math.hypot(re[bin], im[bin]);
    }

    return {
      magnitude,
      fftSize: nfft
    };
  }

  function buildTimeVectorFromSpectrumLoadings(magnitudeLoadings, fftSize) {
    const nfft = Math.max(32, nextPowerOfTwo(Math.max(2, fftSize || (magnitudeLoadings.length - 1) * 2)));
    const binCount = Math.min(magnitudeLoadings.length, nfft / 2 + 1);
    const re = new Float64Array(nfft);
    const im = new Float64Array(nfft);

    for (let bin = 0; bin < binCount; bin += 1) {
      const value = magnitudeLoadings[bin];
      re[bin] = value;
      im[bin] = 0;
      if (bin > 0 && bin < nfft / 2) {
        re[nfft - bin] = value;
        im[nfft - bin] = 0;
      }
    }

    for (let index = 0; index < nfft; index += 1) {
      im[index] = -im[index];
    }
    fftInPlace(re, im);

    const out = new Float32Array(nfft);
    for (let index = 0; index < nfft; index += 1) {
      out[index] = re[index] / nfft;
    }
    return out;
  }

  function buildPcaComponentRepresentations(
    componentVectors,
    sourceType,
    melDefaults,
    melFilterbank,
    stftFftSize,
    stftBinCount,
    sampleRate
  ) {
    const componentMelLoadings = [];
    const componentMagnitudeLoadings = [];
    const componentTimeVectors = [];

    if (!Array.isArray(componentVectors) || componentVectors.length === 0) {
      return {
        componentMelLoadings,
        componentMagnitudeLoadings,
        componentTimeVectors
      };
    }

    if (sourceType === "mel") {
      for (let compIndex = 0; compIndex < componentVectors.length; compIndex += 1) {
        const sourceVector = componentVectors[compIndex];
        const melVector =
          sourceVector.length === melDefaults.bands
            ? sourceVector
            : resampleVectorToLength(sourceVector, melDefaults.bands);
        const magnitudeVector = melFilterbank
          ? buildMagnitudeLoadingsFromMelLoadings(melVector, melFilterbank)
          : new Float32Array(stftBinCount || 1);
        const timeVector = buildTimeVectorFromSpectrumLoadings(
          magnitudeVector,
          stftFftSize || 256
        );

        componentMelLoadings.push(melVector);
        componentMagnitudeLoadings.push(magnitudeVector);
        componentTimeVectors.push(timeVector);
      }

      return {
        componentMelLoadings,
        componentMagnitudeLoadings,
        componentTimeVectors
      };
    }

    const denoiseFftSize = nextPowerOfTwo(
      Math.max(64, (componentVectors[0] ? componentVectors[0].length : 64) * 2)
    );
    const denoiseFilterbank = createMelFilterbank(
      sampleRate || 16000,
      denoiseFftSize,
      melDefaults.bands,
      melDefaults.minHz,
      melDefaults.maxHz
    );

    for (let compIndex = 0; compIndex < componentVectors.length; compIndex += 1) {
      const sourceVector = componentVectors[compIndex];
      const timeVector = new Float32Array(sourceVector.length);
      timeVector.set(sourceVector);
      const magnitudeSpectrum = buildMagnitudeSpectrumFromTimeVector(sourceVector, denoiseFftSize);
      const melVector = buildMelLoadingsFromMagnitudeLoadings(
        magnitudeSpectrum.magnitude,
        denoiseFilterbank
      );

      componentMelLoadings.push(melVector);
      componentMagnitudeLoadings.push(magnitudeSpectrum.magnitude);
      componentTimeVectors.push(timeVector);
    }

    return {
      componentMelLoadings,
      componentMagnitudeLoadings,
      componentTimeVectors
    };
  }

  function dotProductDense(a, b) {
    let sum = 0;
    for (let index = 0; index < a.length; index += 1) {
      sum += a[index] * b[index];
    }
    return sum;
  }

  function normalizeDense(vector) {
    const norm = Math.sqrt(Math.max(0, dotProductDense(vector, vector)));
    if (norm <= 1e-12) {
      return false;
    }
    for (let index = 0; index < vector.length; index += 1) {
      vector[index] /= norm;
    }
    return true;
  }

  function covarianceTimesVector(centeredRows, vector) {
    const rowCount = centeredRows.length;
    const colCount = vector.length;
    const projection = new Float64Array(rowCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      projection[rowIndex] = dotProductDense(centeredRows[rowIndex], vector);
    }

    const output = new Float64Array(colCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row = centeredRows[rowIndex];
      const weight = projection[rowIndex];
      for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
        output[colIndex] += row[colIndex] * weight;
      }
    }

    const scale = 1 / Math.max(1, rowCount - 1);
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      output[colIndex] *= scale;
    }

    return output;
  }

  function computePcaProjection(rows, maxComponents) {
    const rowCount = rows.length;
    const colCount = rows[0] ? rows[0].length : 0;
    if (rowCount < 2 || colCount < 2) {
      throw new Error("Not enough data for PCA.");
    }

    const means = new Float64Array(colCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row = rows[rowIndex];
      for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
        means[colIndex] += row[colIndex];
      }
    }
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      means[colIndex] /= rowCount;
    }

    const centeredRows = new Array(rowCount);
    let totalVariance = 0;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const centered = new Float64Array(colCount);
      const source = rows[rowIndex];
      for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
        const value = source[colIndex] - means[colIndex];
        centered[colIndex] = value;
      }
      centeredRows[rowIndex] = centered;
    }

    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      let varianceAccum = 0;
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const value = centeredRows[rowIndex][colIndex];
        varianceAccum += value * value;
      }
      totalVariance += varianceAccum / Math.max(1, rowCount - 1);
    }

    const componentVectors = [];
    const eigenvalues = [];
    const componentLimit = Math.max(1, Math.min(maxComponents, colCount, rowCount - 1));

    for (let componentIndex = 0; componentIndex < componentLimit; componentIndex += 1) {
      const vector = new Float64Array(colCount);
      for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
        vector[colIndex] =
          Math.sin((colIndex + 1) * (componentIndex + 1) * 1.61803) +
          Math.cos((colIndex + 1) * (componentIndex + 1) * 0.61803);
      }
      if (!normalizeDense(vector)) {
        break;
      }

      for (let iter = 0; iter < PCA_POWER_ITERATIONS; iter += 1) {
        const nextVector = covarianceTimesVector(centeredRows, vector);
        for (let prev = 0; prev < componentVectors.length; prev += 1) {
          const basis = componentVectors[prev];
          const projection = dotProductDense(nextVector, basis);
          for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
            nextVector[colIndex] -= projection * basis[colIndex];
          }
        }

        if (!normalizeDense(nextVector)) {
          break;
        }

        for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
          vector[colIndex] = nextVector[colIndex];
        }
      }

      const covarianceVector = covarianceTimesVector(centeredRows, vector);
      const eigenvalue = Math.max(0, dotProductDense(vector, covarianceVector));
      if (!Number.isFinite(eigenvalue) || eigenvalue <= 1e-10) {
        break;
      }

      componentVectors.push(vector);
      eigenvalues.push(eigenvalue);
    }

    if (componentVectors.length === 0) {
      throw new Error("PCA failed to find stable components.");
    }

    const projectionMatrix = new Array(rowCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const rowProjection = new Float32Array(componentVectors.length);
      for (let componentIndex = 0; componentIndex < componentVectors.length; componentIndex += 1) {
        rowProjection[componentIndex] = dotProductDense(
          centeredRows[rowIndex],
          componentVectors[componentIndex]
        );
      }
      projectionMatrix[rowIndex] = rowProjection;
    }

    const explainedRatios = eigenvalues.map(function (value) {
      return totalVariance > 1e-12 ? value / totalVariance : 0;
    });

    return {
      projectionMatrix,
      componentCount: componentVectors.length,
      componentVectors: componentVectors.map(function (vector) {
        const out = new Float32Array(vector.length);
        for (let index = 0; index < vector.length; index += 1) {
          out[index] = vector[index];
        }
        return out;
      }),
      explainedRatios,
      totalVariance
    };
  }

  function ensurePcaViewForAudio(audioData, cache) {
    if (!audioData) {
      throw new Error("Load the primary clip to compute PCA.");
    }

    const goal = state.pca.goal;
    const stftDefaults = getDefaultStftParams();
    const melDefaults = getDefaultMelParams(audioData.sampleRate || 16000);
    const classwiseCacheKey = state.pca.classwise ? getClasswiseMetricsCacheKeyPart() : "off";
    const cacheKey =
      getAudioCachePrefix(audioData) +
      "::pca::" +
      goal +
      "::" +
      state.pca.classwise +
      "::" +
      classwiseCacheKey +
      "::" +
      stftParamsToKey(stftDefaults) +
      "::" +
      melParamsToKey(melDefaults);

    if (cache.pcaByKey[cacheKey]) {
      return cache.pcaByKey[cacheKey];
    }

    let sourceRows = [];
    let sourceRowTimesSeconds = [];
    let sourceDescription = "";
    let sourceNote = "";
    let spectrumAxisLabel = "Feature bin";
    let sourceType = "mel";
    let melFilterbank = null;
    let stftFftSize = 0;
    let stftBinCount = 0;
    let durationSeconds = audioData.duration;

    if (goal === "denoising") {
      const ssa = buildSsaFeatureRows(audioData.samples, audioData.sampleRate);
      sourceRows = ssa.rows;
      sourceRowTimesSeconds = ssa.rowTimesSeconds;
      sourceDescription = ssa.sourceDescription;
      sourceNote = ssa.sourceNote;
      spectrumAxisLabel = "Lag bin";
      sourceType = "lag";
    } else {
      const melItem = createPcaReferenceItem("mel");
      melItem.params.stft = cloneParams(stftDefaults);
      melItem.params.mel = cloneParams(melDefaults);
      const mel = ensureMelForAudio(melItem, audioData, cache);
      const stft = ensureStftForAudio(melItem, audioData, cache);
      sourceRows = mel.matrix;
      sourceRowTimesSeconds = Array.isArray(stft.frameTimesSeconds)
        ? stft.frameTimesSeconds
        : [];
      durationSeconds = mel.durationSeconds;
      sourceDescription =
        "Log-mel spectra (" +
        mel.bands +
        " bands, " +
        Math.round(mel.minHz) +
        "-" +
        Math.round(mel.maxHz) +
        " Hz).";
      spectrumAxisLabel = "Mel bin";
      melFilterbank = createMelFilterbank(
        stft.sampleRate,
        stft.fftSize,
        melDefaults.bands,
        melDefaults.minHz,
        melDefaults.maxHz
      );
      stftFftSize = stft.fftSize;
      stftBinCount = stft.binCount;
      if (goal === "doa_beamforming" || goal === "enhancement") {
        sourceNote =
          "Array covariance PCA requires channel-wise STFT; showing mono log-mel PCA fallback.";
      }
    }

    const prepared = preparePcaInputRows(sourceRows, sourceRowTimesSeconds);
    if (prepared.rows.length < 2 || prepared.colCount < 2) {
      throw new Error("Not enough frames/features for PCA. Increase analysis window or load longer audio.");
    }

    const pca = computePcaProjection(prepared.rows, MAX_PCA_COMPONENTS);
    const explainedSummary = summarizeExplainedRatios(pca.explainedRatios);
    const classwise = computeClasswisePcaSummary(
      prepared.rows,
      prepared.rowTimesSeconds,
      pca.projectionMatrix,
      pca.componentCount
    );
    const classwiseNote = state.pca.classwise
      ? classwise.available
        ? classwise.status
        : classwise.reason
      : "";
    const notes = [sourceNote, classwiseNote].filter(Boolean).join(" ");

    const globalRepresentations = buildPcaComponentRepresentations(
      pca.componentVectors,
      sourceType,
      melDefaults,
      melFilterbank,
      stftFftSize,
      stftBinCount,
      audioData.sampleRate || 16000
    );
    const componentMelLoadings = globalRepresentations.componentMelLoadings;
    const componentMagnitudeLoadings = globalRepresentations.componentMagnitudeLoadings;
    const componentTimeVectors = globalRepresentations.componentTimeVectors;

    if (classwise.available) {
      const activeRepresentations = buildPcaComponentRepresentations(
        classwise.activeModel.componentVectors,
        sourceType,
        melDefaults,
        melFilterbank,
        stftFftSize,
        stftBinCount,
        audioData.sampleRate || 16000
      );
      classwise.activeModel.componentMelLoadings = activeRepresentations.componentMelLoadings;
      classwise.activeModel.componentMagnitudeLoadings =
        activeRepresentations.componentMagnitudeLoadings;
      classwise.activeModel.componentTimeVectors = activeRepresentations.componentTimeVectors;

      const inactiveRepresentations = buildPcaComponentRepresentations(
        classwise.inactiveModel.componentVectors,
        sourceType,
        melDefaults,
        melFilterbank,
        stftFftSize,
        stftBinCount,
        audioData.sampleRate || 16000
      );
      classwise.inactiveModel.componentMelLoadings = inactiveRepresentations.componentMelLoadings;
      classwise.inactiveModel.componentMagnitudeLoadings =
        inactiveRepresentations.componentMagnitudeLoadings;
      classwise.inactiveModel.componentTimeVectors = inactiveRepresentations.componentTimeVectors;
    }

    const result = {
      cacheKey,
      matrix: pca.projectionMatrix,
      componentCount: pca.componentCount,
      explainedRatios: pca.explainedRatios,
      explainedSummary,
      rowStride: prepared.rowStride,
      originalRows: prepared.originalRowCount,
      originalCols: prepared.originalColCount,
      usedRows: prepared.rows.length,
      usedCols: prepared.colCount,
      sourceDescription,
      spectrumAxisLabel,
      melAxisLabel: "Mel bin",
      magnitudeAxisLabel: "Magnitude spectrum bin",
      timeAxisLabel: sourceType === "lag" ? "Lag sample" : "Time sample",
      note: notes,
      durationSeconds,
      componentVectors: pca.componentVectors,
      componentMelLoadings,
      componentMagnitudeLoadings,
      componentTimeVectors,
      classwise
    };

    cache.pcaByKey[cacheKey] = result;
    return result;
  }

  function ensurePcaView() {
    return ensurePcaViewForAudio(getSingleChannelAnalysisAudio(), derivedCache);
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
    return ensureCustomFilterbankForAudio(item, getSingleChannelAnalysisAudio(), derivedCache);
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
      case "tempogram": {
        const tempogram = ensureTempogram(item);
        return (
          tempogram.matrix.length +
          " frames x " +
          tempogram.lagCount +
          " lag bins | " +
          tempogram.tempoMinBpm.toFixed(1) +
          "-" +
          tempogram.tempoMaxBpm.toFixed(1) +
          " BPM"
        );
      }
      case "fourier_tempogram": {
        const fourierTempogram = ensureFourierTempogram(item);
        return (
          fourierTempogram.matrix.length +
          " frames x " +
          fourierTempogram.binCount +
          " tempo bins | " +
          fourierTempogram.tempoMinBpm.toFixed(1) +
          "-" +
          fourierTempogram.tempoMaxBpm.toFixed(1) +
          " BPM"
        );
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

    const channelSuffix =
      Number.isInteger(audioData.sourceChannelIndex) && audioData.sourceChannelIndex >= 0
        ? " (channel " + (audioData.sourceChannelIndex + 1) + ")"
        : "";

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
          channelSuffix +
          " decoded waveform (" +
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

    if (kind === "tempogram") {
      const tempogram = ensureTempogramForAudio(item, audioData, cache);
      return {
        type: "matrix",
        domainLength: tempogram.matrix.length,
        durationSeconds: tempogram.durationSeconds,
        matrix: tempogram.matrix,
        caption:
          "Tempogram (lag-domain onset autocorrelation) over " +
          tempogram.tempoMinBpm.toFixed(1) +
          "-" +
          tempogram.tempoMaxBpm.toFixed(1) +
          " BPM."
      };
    }

    if (kind === "fourier_tempogram") {
      const fourierTempogram = ensureFourierTempogramForAudio(item, audioData, cache);
      return {
        type: "matrix",
        domainLength: fourierTempogram.matrix.length,
        durationSeconds: fourierTempogram.durationSeconds,
        matrix: fourierTempogram.matrix,
        caption:
          "Fourier tempogram (local FFT of onset strength) over " +
          fourierTempogram.tempoMinBpm.toFixed(1) +
          "-" +
          fourierTempogram.tempoMaxBpm.toFixed(1) +
          " BPM."
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
    return buildTransformRenderSpecForAudio(
      item,
      getSingleChannelAnalysisAudio(),
      derivedCache,
      "primary clip"
    );
  }

  function buildPcaRenderSpec() {
    const pcaView = ensurePcaView();
    const goalLabel = state.pca.goal.replace(/_/g, " ");
    const captionParts = [
      "PCA projection (" + goalLabel + ") from " + pcaView.sourceDescription,
      "Explained variance: " + pcaView.explainedSummary + ".",
      "Rows used: " +
        pcaView.usedRows +
        " / " +
        pcaView.originalRows +
        ", features used: " +
        pcaView.usedCols +
        " / " +
        pcaView.originalCols +
        "."
    ];
    if (state.pca.classwise) {
      const classwiseSummary =
        pcaView.classwise && pcaView.classwise.available
          ? pcaView.classwise.status
          : pcaView.classwise && pcaView.classwise.reason
            ? pcaView.classwise.reason
            : "Classwise PCA unavailable.";
      captionParts.push("Classwise PCA: " + classwiseSummary);
    }
    if (pcaView.note) {
      captionParts.push(pcaView.note);
    }

    const classwiseMeta =
      state.pca.classwise && pcaView.classwise
        ? pcaView.classwise.available
          ? "classwise=on(active=" +
            pcaView.classwise.activeRows +
            ",inactive=" +
            pcaView.classwise.inactiveRows +
            ")"
          : "classwise=on(unavailable)"
        : "classwise=off";

    return {
      type: "matrix",
      domainLength: pcaView.matrix.length,
      durationSeconds: pcaView.durationSeconds,
      matrix: pcaView.matrix,
      caption: captionParts.join(" "),
      pcaView,
      meta:
        "goal=" +
        goalLabel +
        " | comps=" +
        pcaView.componentCount +
        " | " +
        pcaView.explainedSummary +
        " | " +
        classwiseMeta
      };
  }

  function parsePcaComponentSelection(rawSelection, maxComponents) {
    const max = Math.max(1, maxComponents);
    const all = [];
    for (let index = 0; index < max; index += 1) {
      all.push(index);
    }

    const text = typeof rawSelection === "string" ? rawSelection.trim() : "";
    if (!text) {
      return {
        indices: all,
        invalidTokens: [],
        usedAll: true
      };
    }

    const picked = new Set();
    const invalid = [];
    const tokens = text.split(",");

    tokens.forEach(function (rawToken) {
      const token = rawToken.trim();
      if (!token) {
        return;
      }

      const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) {
        let start = Number(rangeMatch[1]);
        let end = Number(rangeMatch[2]);
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          invalid.push(token);
          return;
        }
        if (start > end) {
          const swap = start;
          start = end;
          end = swap;
        }
        for (let comp = start; comp <= end; comp += 1) {
          if (comp >= 1 && comp <= max) {
            picked.add(comp - 1);
          }
        }
        if (end < 1 || start > max) {
          invalid.push(token);
        }
        return;
      }

      const singleMatch = token.match(/^(\d+)$/);
      if (singleMatch) {
        const comp = Number(singleMatch[1]);
        if (comp >= 1 && comp <= max) {
          picked.add(comp - 1);
        } else {
          invalid.push(token);
        }
        return;
      }

      invalid.push(token);
    });

    const indices = Array.from(picked).sort(function (a, b) {
      return a - b;
    });

    if (indices.length === 0) {
      return {
        indices: all,
        invalidTokens: invalid.length ? invalid : [text],
        usedAll: true
      };
    }

    return {
      indices,
      invalidTokens: invalid,
      usedAll: false
    };
  }

  function pcaComponentColor(componentIndex) {
    const colors = ["#38bdf8", "#f59e0b", "#34d399", "#f472b6", "#a78bfa", "#f87171"];
    return colors[componentIndex % colors.length];
  }

  function drawPcaLinePlot(canvas, values, options) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    const paddingLeft = 34;
    const paddingRight = 12;
    const paddingTop = 10;
    const paddingBottom = 18;
    const plotWidth = Math.max(1, width - paddingLeft - paddingRight);
    const plotHeight = Math.max(1, height - paddingTop - paddingBottom);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(90,140,170,0.15)";
    ctx.fillRect(paddingLeft, paddingTop, plotWidth, plotHeight);

    if (!values || values.length === 0) {
      ctx.fillStyle = "rgba(200,200,200,0.85)";
      ctx.font = "11px sans-serif";
      ctx.fillText("No data.", paddingLeft + 6, paddingTop + 16);
      return;
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = -1;
      max = 1;
    }

    min = Math.min(min, 0);
    max = Math.max(max, 0);
    if (Math.abs(max - min) < 1e-9) {
      min -= 1;
      max += 1;
    }

    const range = max - min;
    const toY = function (value) {
      const ratio = (value - min) / range;
      return paddingTop + (1 - ratio) * plotHeight;
    };

    const zeroY = toY(0);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, zeroY);
    ctx.lineTo(paddingLeft + plotWidth, zeroY);
    ctx.stroke();

    ctx.strokeStyle = options && options.color ? options.color : "#38bdf8";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let index = 0; index < values.length; index += 1) {
      const xRatio = values.length > 1 ? index / (values.length - 1) : 0;
      const x = paddingLeft + xRatio * plotWidth;
      const y = toY(values[index]);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(170,210,235,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, paddingTop);
    ctx.lineTo(paddingLeft, paddingTop + plotHeight);
    ctx.lineTo(paddingLeft + plotWidth, paddingTop + plotHeight);
    ctx.stroke();

    ctx.fillStyle = "rgba(220,220,220,0.9)";
    ctx.font = "10px sans-serif";
    ctx.fillText(formatMetricNumber(max, 3), 6, paddingTop + 9);
    ctx.fillText(formatMetricNumber(min, 3), 6, paddingTop + plotHeight);
  }

  function buildPcaClassModelSection(titleText, model, parsed, pcaView, colorOffset) {
    const section = document.createElement("section");
    section.className = "pca-classwise-section";

    const title = document.createElement("h4");
    title.className = "pca-classwise-title";
    title.textContent =
      titleText +
      " | k=" +
      model.componentCount +
      " | " +
      (model.explainedSummary || "n/a");
    section.appendChild(title);

    const selectedIndices = parsed.indices.filter(function (index) {
      return index < (model.componentVectors ? model.componentVectors.length : 0);
    });

    if (selectedIndices.length === 0) {
      const empty = document.createElement("p");
      empty.className = "transform-caption";
      empty.textContent = "No selected components are available for this class.";
      section.appendChild(empty);
      return section;
    }

    const grid = document.createElement("div");
    grid.className = "pca-component-grid";

    selectedIndices.forEach(function (componentIndex) {
      const card = document.createElement("article");
      card.className = "pca-component-card";

      const cardTitle = document.createElement("h4");
      cardTitle.className = "pca-component-title";
      cardTitle.textContent =
        "PC" +
        (componentIndex + 1) +
        " | explained " +
        formatMetricPercent(model.explainedRatios[componentIndex] || 0);
      card.appendChild(cardTitle);

      const scoreLabel = document.createElement("div");
      scoreLabel.className = "pca-component-label";
      scoreLabel.textContent = "PC score across class rows";
      card.appendChild(scoreLabel);

      const projectionRows = Array.isArray(model.projectionMatrix) ? model.projectionMatrix : [];
      const scoreValues = new Float32Array(Math.max(1, projectionRows.length));
      for (let rowIndex = 0; rowIndex < projectionRows.length; rowIndex += 1) {
        const row = projectionRows[rowIndex];
        scoreValues[rowIndex] = row && componentIndex < row.length ? row[componentIndex] : 0;
      }
      const scoreCanvas = document.createElement("canvas");
      scoreCanvas.className = "pca-component-plot";
      scoreCanvas.width = pickCanvasWidth(1);
      scoreCanvas.height = 120;
      drawPcaLinePlot(scoreCanvas, scoreValues, {
        color: pcaComponentColor(componentIndex + colorOffset)
      });
      card.appendChild(scoreCanvas);

      const melLabel = document.createElement("div");
      melLabel.className = "pca-component-label";
      melLabel.textContent = "Loading across " + (pcaView.melAxisLabel || "mel bins");
      card.appendChild(melLabel);

      const melValues =
        model.componentMelLoadings && model.componentMelLoadings[componentIndex]
          ? model.componentMelLoadings[componentIndex]
          : model.componentVectors[componentIndex];
      const melCanvas = document.createElement("canvas");
      melCanvas.className = "pca-component-plot";
      melCanvas.width = pickCanvasWidth(1);
      melCanvas.height = 120;
      drawPcaLinePlot(melCanvas, melValues, {
        color: pcaComponentColor(componentIndex + colorOffset)
      });
      card.appendChild(melCanvas);

      const magnitudeLabel = document.createElement("div");
      magnitudeLabel.className = "pca-component-label";
      magnitudeLabel.textContent =
        "Loading across " + (pcaView.magnitudeAxisLabel || "magnitude spectrum bins");
      card.appendChild(magnitudeLabel);

      const magnitudeValues =
        model.componentMagnitudeLoadings && model.componentMagnitudeLoadings[componentIndex]
          ? model.componentMagnitudeLoadings[componentIndex]
          : model.componentVectors[componentIndex];
      const magnitudeCanvas = document.createElement("canvas");
      magnitudeCanvas.className = "pca-component-plot";
      magnitudeCanvas.width = pickCanvasWidth(1);
      magnitudeCanvas.height = 120;
      drawPcaLinePlot(magnitudeCanvas, magnitudeValues, {
        color: pcaComponentColor(componentIndex + colorOffset)
      });
      card.appendChild(magnitudeCanvas);

      const timeVectorLabel = document.createElement("div");
      timeVectorLabel.className = "pca-component-label";
      timeVectorLabel.textContent =
        "PC vector in time domain (" + (pcaView.timeAxisLabel || "sample") + ")";
      card.appendChild(timeVectorLabel);

      const timeVectorValues =
        model.componentTimeVectors && model.componentTimeVectors[componentIndex]
          ? model.componentTimeVectors[componentIndex]
          : model.componentVectors[componentIndex];
      const timeVectorCanvas = document.createElement("canvas");
      timeVectorCanvas.className = "pca-component-plot";
      timeVectorCanvas.width = pickCanvasWidth(1);
      timeVectorCanvas.height = 120;
      drawPcaLinePlot(timeVectorCanvas, timeVectorValues, {
        color: pcaComponentColor(componentIndex + colorOffset)
      });
      card.appendChild(timeVectorCanvas);

      grid.appendChild(card);
    });

    section.appendChild(grid);
    return section;
  }

  function buildPcaComponentPanel(renderSpec, windowInfo) {
    const pcaView = renderSpec.pcaView;
    if (!pcaView || !Array.isArray(pcaView.componentVectors) || pcaView.componentVectors.length === 0) {
      return null;
    }

    const panel = document.createElement("section");
    panel.className = "pca-component-panel";

    if (state.pca.classwise) {
      const maxClassComponents = pcaView.classwise && pcaView.classwise.available
        ? Math.max(
            pcaView.classwise.activeModel && pcaView.classwise.activeModel.componentVectors
              ? pcaView.classwise.activeModel.componentVectors.length
              : 0,
            pcaView.classwise.inactiveModel && pcaView.classwise.inactiveModel.componentVectors
              ? pcaView.classwise.inactiveModel.componentVectors.length
              : 0,
            1
          )
        : pcaView.componentVectors.length;
      const parsedClasswise = parsePcaComponentSelection(
        state.pca.componentSelection,
        maxClassComponents
      );

      const summary = document.createElement("p");
      summary.className = "transform-caption";
      summary.textContent =
        "Component selection: " +
        (parsedClasswise.usedAll
          ? "all (" + maxClassComponents + ")"
          : parsedClasswise.indices
              .map(function (index) {
                return String(index + 1);
              })
              .join(", ")) +
        " | classwise PCA mode.";
      panel.appendChild(summary);

      if (parsedClasswise.invalidTokens.length > 0) {
        const warning = document.createElement("p");
        warning.className = "transform-caption";
        warning.textContent =
          "Ignored invalid component tokens: " + parsedClasswise.invalidTokens.join(", ") + ".";
        panel.appendChild(warning);
      }

      if (pcaView.classwise && pcaView.classwise.available) {
        const classwiseRows = [
          ["Mode", pcaView.classwise.mode],
          [
            "Rows (active/inactive)",
            String(pcaView.classwise.activeRows) + " / " + String(pcaView.classwise.inactiveRows)
          ],
          ["Active ratio", formatMetricPercent(pcaView.classwise.activeRatio)],
          [
            "Overlay rows",
            String(pcaView.classwise.source.activeRows) +
              " / " +
              String(pcaView.classwise.source.totalRows)
          ],
          ["Overlay intervals", String(pcaView.classwise.source.intervals)],
          ["Status", pcaView.classwise.status]
        ];
        panel.appendChild(createMetricsGroup("Classwise PCA", classwiseRows));

        panel.appendChild(
          createMetricsGroup("Classwise PCA Models", [
            [
              "Active model",
              "k=" +
                pcaView.classwise.activeModel.componentCount +
                " | " +
                pcaView.classwise.activeModel.explainedSummary
            ],
            [
              "Inactive model",
              "k=" +
                pcaView.classwise.inactiveModel.componentCount +
                " | " +
                pcaView.classwise.inactiveModel.explainedSummary
            ]
          ])
        );

        if (pcaView.classwise.separation) {
          panel.appendChild(
            createMetricsGroup("Class Separation", [
              [
                "Centroid distance (PC1-PC" + pcaView.classwise.separation.dims + ")",
                formatMetricNumber(pcaView.classwise.separation.centroidDistance, 4)
              ],
              [
                "Fisher score PC1",
                formatMetricNumber(pcaView.classwise.separation.fisherByComponent[0] || 0, 4)
              ],
              [
                "Fisher score PC2",
                formatMetricNumber(pcaView.classwise.separation.fisherByComponent[1] || 0, 4)
              ],
              [
                "Fisher score PC3",
                formatMetricNumber(pcaView.classwise.separation.fisherByComponent[2] || 0, 4)
              ]
            ])
          );
        }

        panel.appendChild(
          buildPcaClassModelSection(
            "Active class PCA",
            pcaView.classwise.activeModel,
            parsedClasswise,
            pcaView,
            0
          )
        );
        panel.appendChild(
          buildPcaClassModelSection(
            "Inactive class PCA",
            pcaView.classwise.inactiveModel,
            parsedClasswise,
            pcaView,
            3
          )
        );
      } else {
        panel.appendChild(
          createMetricsGroup("Classwise PCA", [
            [
              "Status",
              pcaView.classwise && pcaView.classwise.reason
                ? pcaView.classwise.reason
                : "Unavailable."
            ]
          ])
        );
      }

      return panel;
    }

    const parsed = parsePcaComponentSelection(
      state.pca.componentSelection,
      pcaView.componentVectors.length
    );

    const summary = document.createElement("p");
    summary.className = "transform-caption";
    const safeWindowInfo = windowInfo || { startIndex: 0, endIndex: pcaView.matrix.length };
    const visibleStart = Math.floor(safeWindowInfo.startIndex) + 1;
    const visibleEnd = Math.max(visibleStart, Math.floor(safeWindowInfo.endIndex));
    summary.textContent =
      "Component selection: " +
      (parsed.usedAll
        ? "all (" + pcaView.componentVectors.length + ")"
        : parsed.indices
            .map(function (index) {
              return String(index + 1);
            })
            .join(", ")) +
      " | visible frames " +
      visibleStart +
      "-" +
      visibleEnd +
      " of " +
      pcaView.matrix.length +
      ".";
    panel.appendChild(summary);

    if (parsed.invalidTokens.length > 0) {
      const warning = document.createElement("p");
      warning.className = "transform-caption";
      warning.textContent =
        "Ignored invalid component tokens: " + parsed.invalidTokens.join(", ") + ".";
      panel.appendChild(warning);
    }

    const grid = document.createElement("div");
    grid.className = "pca-component-grid";

    const startIndex = clamp(Math.floor(safeWindowInfo.startIndex), 0, Math.max(0, pcaView.matrix.length - 1));
    const endIndex = clamp(Math.ceil(safeWindowInfo.endIndex), startIndex + 1, pcaView.matrix.length);

    parsed.indices.forEach(function (componentIndex) {
      const card = document.createElement("article");
      card.className = "pca-component-card";

      const title = document.createElement("h4");
      title.className = "pca-component-title";
      title.textContent =
        "PC" +
        (componentIndex + 1) +
        " | explained " +
        formatMetricPercent(pcaView.explainedRatios[componentIndex] || 0);
      card.appendChild(title);

      const scoreLabel = document.createElement("div");
      scoreLabel.className = "pca-component-label";
      scoreLabel.textContent = "PC score in visible zoom area";
      card.appendChild(scoreLabel);

      const scoreValues = new Float32Array(Math.max(1, endIndex - startIndex));
      for (let rowIndex = startIndex; rowIndex < endIndex; rowIndex += 1) {
        const projectedRow = pcaView.matrix[rowIndex];
        scoreValues[rowIndex - startIndex] =
          projectedRow && componentIndex < projectedRow.length ? projectedRow[componentIndex] : 0;
      }
      const scoreCanvas = document.createElement("canvas");
      scoreCanvas.className = "pca-component-plot";
      scoreCanvas.width = pickCanvasWidth(1);
      scoreCanvas.height = 120;
      drawPcaLinePlot(scoreCanvas, scoreValues, { color: pcaComponentColor(componentIndex) });
      card.appendChild(scoreCanvas);

      const melLabel = document.createElement("div");
      melLabel.className = "pca-component-label";
      melLabel.textContent = "Loading across " + (pcaView.melAxisLabel || "mel bins");
      card.appendChild(melLabel);

      const melValues =
        pcaView.componentMelLoadings && pcaView.componentMelLoadings[componentIndex]
          ? pcaView.componentMelLoadings[componentIndex]
          : pcaView.componentVectors[componentIndex];
      const melCanvas = document.createElement("canvas");
      melCanvas.className = "pca-component-plot";
      melCanvas.width = pickCanvasWidth(1);
      melCanvas.height = 120;
      drawPcaLinePlot(melCanvas, melValues, { color: pcaComponentColor(componentIndex) });
      card.appendChild(melCanvas);

      const magnitudeLabel = document.createElement("div");
      magnitudeLabel.className = "pca-component-label";
      magnitudeLabel.textContent =
        "Loading across " + (pcaView.magnitudeAxisLabel || "magnitude spectrum bins");
      card.appendChild(magnitudeLabel);

      const magnitudeValues =
        pcaView.componentMagnitudeLoadings && pcaView.componentMagnitudeLoadings[componentIndex]
          ? pcaView.componentMagnitudeLoadings[componentIndex]
          : pcaView.componentVectors[componentIndex];
      const magnitudeCanvas = document.createElement("canvas");
      magnitudeCanvas.className = "pca-component-plot";
      magnitudeCanvas.width = pickCanvasWidth(1);
      magnitudeCanvas.height = 120;
      drawPcaLinePlot(magnitudeCanvas, magnitudeValues, { color: pcaComponentColor(componentIndex) });
      card.appendChild(magnitudeCanvas);

      const timeVectorLabel = document.createElement("div");
      timeVectorLabel.className = "pca-component-label";
      timeVectorLabel.textContent =
        "PC vector in time domain (" + (pcaView.timeAxisLabel || "sample") + ")";
      card.appendChild(timeVectorLabel);

      const timeVectorValues =
        pcaView.componentTimeVectors && pcaView.componentTimeVectors[componentIndex]
          ? pcaView.componentTimeVectors[componentIndex]
          : pcaView.componentVectors[componentIndex];
      const timeVectorCanvas = document.createElement("canvas");
      timeVectorCanvas.className = "pca-component-plot";
      timeVectorCanvas.width = pickCanvasWidth(1);
      timeVectorCanvas.height = 120;
      drawPcaLinePlot(timeVectorCanvas, timeVectorValues, { color: pcaComponentColor(componentIndex) });
      card.appendChild(timeVectorCanvas);

      grid.appendChild(card);
    });

    panel.appendChild(grid);
    return panel;
  }

  function renderPcaFeatureCard() {
    if (!state.pca.enabled) {
      return;
    }

    const item = { id: getPcaVirtualViewId(), kind: "pca_feature" };
    const card = document.createElement("article");
    card.className = "transform-card" + (selectedViewId === item.id ? " is-selected" : "");

    const header = document.createElement("header");
    header.className = "transform-card-header";

    const title = document.createElement("div");
    title.className = "transform-card-title";
    title.textContent = "PCA Feature View";

    const meta = document.createElement("div");
    meta.className = "transform-card-meta";
    meta.textContent = "Awaiting PCA data";

    header.appendChild(title);
    header.appendChild(meta);

    const body = document.createElement("div");
    body.className = "transform-card-body";

    try {
      const renderSpec = buildPcaRenderSpec();
      meta.textContent = renderSpec.meta;

      const toolbar = buildTransformToolbar(item, renderSpec);
      body.appendChild(toolbar);

      let windowInfo = null;
      if (!state.pca.classwise) {
        const grid = document.createElement("div");
        grid.className = "transform-comparison-grid mode-none";

        const panelWrap = document.createElement("section");
        panelWrap.className = "comparison-panel";

        const viewport = document.createElement("div");
        viewport.className = "transform-viewport";

        const canvas = document.createElement("canvas");
        canvas.className = "transform-canvas";
        canvas.width = pickCanvasWidth(1);
        canvas.height = MATRIX_CANVAS_HEIGHT;

        windowInfo = computeViewWindow(renderSpec.domainLength, item.id);
        drawHeatmap(canvas, renderSpec.matrix, windowInfo.startIndex, windowInfo.endIndex);
        drawActivationOverlay(canvas, renderSpec, windowInfo);
        attachCanvasInteractions(canvas, item, renderSpec);

        const viewportPlayhead = document.createElement("div");
        viewportPlayhead.className = "transform-playhead";

        viewport.appendChild(canvas);
        viewport.appendChild(viewportPlayhead);
        panelWrap.appendChild(viewport);
        grid.appendChild(panelWrap);
        body.appendChild(grid);

        const scrollbar = buildTransformScrollbar(item, renderSpec);
        body.appendChild(scrollbar.element);

        if (shouldShowSpectralBar(item.id)) {
          const spectralBar = buildSpectralBar(renderSpec, windowInfo);
          body.appendChild(spectralBar);
        }

        playheadElementsByViewId.set(item.id, {
          viewportPlayheads: [viewportPlayhead],
          scrollbarPlayhead: scrollbar.playhead,
          domainLength: renderSpec.domainLength,
          durationSeconds: renderSpec.durationSeconds
        });
      } else {
        const classwiseNote = document.createElement("p");
        classwiseNote.className = "transform-caption";
        classwiseNote.textContent =
          "Classwise PCA selected: showing per-class component vectors instead of global projection heatmap.";
        body.appendChild(classwiseNote);
      }

      const pcaComponentPanel = buildPcaComponentPanel(renderSpec, windowInfo);
      if (pcaComponentPanel) {
        body.appendChild(pcaComponentPanel);
      }

      const caption = document.createElement("p");
      caption.className = "transform-caption";
      caption.textContent = renderSpec.caption;
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

  function resolveComparisonRegion(secondarySpec, comparisonState) {
    const totalDuration = Number.isFinite(Number(secondarySpec && secondarySpec.durationSeconds))
      ? Math.max(0, Number(secondarySpec.durationSeconds))
      : 0;
    const startSec = sanitizeFloat(
      comparisonState && comparisonState.trimStartSeconds,
      0,
      0,
      Math.max(0, totalDuration)
    );
    const maxDuration = Math.max(0, totalDuration - startSec);
    const requestedDuration = sanitizeFloat(
      comparisonState && comparisonState.trimDurationSeconds,
      0,
      0,
      MAX_COMPARISON_TRIM_SECONDS
    );
    const durationSec = requestedDuration > 0 ? Math.min(requestedDuration, maxDuration) : maxDuration;
    const endSec = startSec + durationSec;

    return {
      startSec,
      endSec,
      durationSec,
      totalDuration,
      hasContent: durationSec > 1e-9 && totalDuration > 0
    };
  }

  function mapPrimaryTimeToSecondaryTime(primaryTimeSec, offsetSeconds, comparisonRegion) {
    return primaryTimeSec + offsetSeconds + comparisonRegion.startSec;
  }

  function isSecondaryTimeInRegion(timeSec, comparisonRegion) {
    return timeSec >= comparisonRegion.startSec && timeSec <= comparisonRegion.endSec;
  }

  function mapPrimaryWindowToSecondaryWindow(
    primarySpec,
    secondarySpec,
    primaryWindow,
    offsetSeconds,
    comparisonRegion
  ) {
    const region = comparisonRegion || resolveComparisonRegion(secondarySpec, state.comparison);
    if (!secondarySpec || secondarySpec.domainLength <= 1 || !region.hasContent) {
      return {
        hasOverlap: false,
        startIndex: 0,
        endIndex: 1,
        visibleCount: 1
      };
    }

    const rawStartTime = mapPrimaryTimeToSecondaryTime(
      domainIndexToTimeSec(primarySpec, primaryWindow.startIndex),
      offsetSeconds,
      region
    );
    const rawEndTime = mapPrimaryTimeToSecondaryTime(
      domainIndexToTimeSec(primarySpec, primaryWindow.endIndex - 1),
      offsetSeconds,
      region
    );
    const overlapStart = clamp(Math.min(rawStartTime, rawEndTime), region.startSec, region.endSec);
    const overlapEnd = clamp(Math.max(rawStartTime, rawEndTime), region.startSec, region.endSec);
    const hasOverlap = overlapEnd >= overlapStart;

    const startIndex = Math.floor(timeSecToDomainIndex(secondarySpec, overlapStart));
    const endIndex = Math.ceil(timeSecToDomainIndex(secondarySpec, overlapEnd)) + 1;

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

  function estimateMatrixDifferenceMaxAbs(
    primarySpec,
    secondarySpec,
    primaryWindow,
    offsetSeconds,
    comparisonRegion
  ) {
    const frameCount = Math.max(1, primaryWindow.visibleCount);
    const frameStep = Math.max(1, Math.floor(frameCount / 240));
    const bins = primarySpec.matrix && primarySpec.matrix[0] ? primarySpec.matrix[0].length : 0;
    const binStep = Math.max(1, Math.floor(Math.max(1, bins) / 96));
    let maxAbs = 0;

    for (let frame = primaryWindow.startIndex; frame < primaryWindow.endIndex; frame += frameStep) {
      const timeSec = domainIndexToTimeSec(primarySpec, frame);
      const secondaryTimeSec = mapPrimaryTimeToSecondaryTime(
        timeSec,
        offsetSeconds,
        comparisonRegion
      );
      if (!isSecondaryTimeInRegion(secondaryTimeSec, comparisonRegion)) {
        continue;
      }
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

  function drawWaveformOverlayComparison(
    canvas,
    primarySpec,
    secondarySpec,
    primaryWindow,
    offsetSeconds,
    comparisonRegion
  ) {
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
      offsetSeconds,
      comparisonRegion
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

  function drawWaveformDifferenceComparison(
    canvas,
    primarySpec,
    secondarySpec,
    primaryWindow,
    offsetSeconds,
    comparisonRegion
  ) {
    const secondaryWindow = mapPrimaryWindowToSecondaryWindow(
      primarySpec,
      secondarySpec,
      primaryWindow,
      offsetSeconds,
      comparisonRegion
    );
    if (!secondaryWindow.hasOverlap) {
      drawNoOverlapPlaceholder(canvas, "No overlap at current offset/trim");
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
      const secondaryTimeSec = mapPrimaryTimeToSecondaryTime(
        timeSec,
        offsetSeconds,
        comparisonRegion
      );
      const primaryValue = sampleAtIndex(primarySpec.samples, primaryIndex);
      const secondaryValue = isSecondaryTimeInRegion(secondaryTimeSec, comparisonRegion)
        ? sampleAtIndex(secondarySpec.samples, timeSecToDomainIndex(secondarySpec, secondaryTimeSec))
        : 0;
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
    offsetSeconds,
    comparisonRegion
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
      offsetSeconds,
      comparisonRegion
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
        const secondaryTimeSec = mapPrimaryTimeToSecondaryTime(
          timeSec,
          offsetSeconds,
          comparisonRegion
        );

        const primaryValue = getMatrixValueAtTime(primarySpec, timeSec, bin);
        const secondaryValue = isSecondaryTimeInRegion(secondaryTimeSec, comparisonRegion)
          ? getMatrixValueAtTime(secondarySpec, secondaryTimeSec, bin)
          : Number.NaN;
        const primaryColor = heatColor((primaryValue - primaryRange.min) / primarySpan);
        const secondaryColor = Number.isFinite(secondaryValue)
          ? secondaryHeatColor((secondaryValue - secondaryRange.min) / secondarySpan)
          : null;

        const mixed = secondaryColor
          ? [
              Math.round(primaryColor[0] * 0.58 + secondaryColor[0] * 0.42),
              Math.round(primaryColor[1] * 0.58 + secondaryColor[1] * 0.42),
              Math.round(primaryColor[2] * 0.58 + secondaryColor[2] * 0.42)
            ]
          : primaryColor;

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
    offsetSeconds,
    comparisonRegion
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
      offsetSeconds,
      comparisonRegion
    );
    if (!overlapWindow.hasOverlap) {
      drawNoOverlapPlaceholder(canvas, "No overlap at current offset/trim");
      return;
    }
    const maxAbs = estimateMatrixDifferenceMaxAbs(
      primarySpec,
      secondarySpec,
      primaryWindow,
      offsetSeconds,
      comparisonRegion
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
        const secondaryTimeSec = mapPrimaryTimeToSecondaryTime(
          timeSec,
          offsetSeconds,
          comparisonRegion
        );

        const primaryValue = getMatrixValueAtTime(primarySpec, timeSec, bin);
        const secondaryValue = isSecondaryTimeInRegion(secondaryTimeSec, comparisonRegion)
          ? getMatrixValueAtTime(secondarySpec, secondaryTimeSec, bin)
          : primaryValue;
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

  function createTimeseriesFeatureCard(title) {
    const card = document.createElement("section");
    card.className = "timeseries-feature-card";

    const heading = document.createElement("h4");
    heading.className = "timeseries-feature-title";
    heading.textContent = title;
    card.appendChild(heading);

    return card;
  }

  function appendTimeseriesFeatureRow(card, label, value) {
    const row = document.createElement("div");
    row.className = "timeseries-feature-row";

    const key = document.createElement("span");
    key.className = "timeseries-feature-label";
    key.textContent = label;

    const val = document.createElement("span");
    val.className = "timeseries-feature-value";
    val.textContent = value;

    row.appendChild(key);
    row.appendChild(val);
    card.appendChild(row);
  }

  function buildTimeseriesFeaturePanel(renderSpec, windowInfo) {
    if (
      !state.features.power &&
      !state.features.autocorrelation &&
      !state.features.shortTimePower &&
      !state.features.shortTimeAutocorrelation
    ) {
      return null;
    }

    const samples = renderSpec.samples;
    const sampleRate = renderSpec.sampleRate || 0;
    if (!samples || !samples.length || sampleRate <= 0) {
      return null;
    }

    const boundedStart = clamp(Math.floor(windowInfo.startIndex), 0, Math.max(0, samples.length - 1));
    const boundedEnd = clamp(Math.ceil(windowInfo.endIndex), boundedStart + 1, samples.length);
    const windowSamples =
      typeof samples.subarray === "function"
        ? samples.subarray(boundedStart, boundedEnd)
        : samples.slice(boundedStart, boundedEnd);

    const panel = document.createElement("div");
    panel.className = "timeseries-features";

    if (
      state.multichannel.enabled &&
      !state.multichannel.splitViewsByChannel &&
      primaryAudio &&
      getAudioChannelCount(primaryAudio) > 1
    ) {
      const note = document.createElement("div");
      note.className = "timeseries-feature-note";
      note.textContent =
        "Single-channel feature cards are computed on " +
        getSingleChannelAnalysisLabel() +
        ".";
      panel.appendChild(note);
    }

    if (state.features.power) {
      let sumSquares = 0;
      let peakAbs = 0;
      for (let index = 0; index < windowSamples.length; index += 1) {
        const value = windowSamples[index];
        sumSquares += value * value;
        const absolute = Math.abs(value);
        if (absolute > peakAbs) {
          peakAbs = absolute;
        }
      }

      const meanPower = sumSquares / Math.max(1, windowSamples.length);
      const rms = Math.sqrt(meanPower);
      const crest = rms > 1e-12 ? peakAbs / rms : 0;
      const card = createTimeseriesFeatureCard("Power");
      appendTimeseriesFeatureRow(card, "Mean power", formatMetricNumber(meanPower, 8));
      appendTimeseriesFeatureRow(card, "Mean power (dB)", formatMetricNumber(10 * Math.log10(meanPower + 1e-12), 3));
      appendTimeseriesFeatureRow(card, "RMS", formatMetricNumber(rms, 6));
      appendTimeseriesFeatureRow(card, "Crest factor", formatMetricNumber(crest, 4));
      panel.appendChild(card);
    }

    if (state.features.autocorrelation) {
      const autocorr = summarizeAutocorrelation(windowSamples, sampleRate);
      const lagMs = autocorr.bestLag > 0 ? (1000 * autocorr.bestLag) / sampleRate : 0;
      const card = createTimeseriesFeatureCard("Autocorrelation");
      appendTimeseriesFeatureRow(card, "Best lag", String(autocorr.bestLag) + " samples");
      appendTimeseriesFeatureRow(card, "Best lag (ms)", formatMetricNumber(lagMs, 3));
      appendTimeseriesFeatureRow(
        card,
        "Best correlation",
        formatMetricNumber(autocorr.bestCorrelation, 5)
      );
      appendTimeseriesFeatureRow(
        card,
        "Freq proxy",
        autocorr.estimatedF0Hz > 0 ? formatMetricNumber(autocorr.estimatedF0Hz, 3) + " Hz" : "n/a"
      );
      panel.appendChild(card);
    }

    let frameSummary = null;
    if (state.features.shortTimePower || state.features.shortTimeAutocorrelation) {
      frameSummary = summarizeFrames(windowSamples, sampleRate);
    }

    if (state.features.shortTimePower) {
      const frameEnergies = frameSummary ? frameSummary.energyByFrame : [];
      const sortedEnergies = frameEnergies.slice().sort(function (a, b) {
        return a - b;
      });
      const meanPower = meanOfNumbers(frameEnergies);
      const card = createTimeseriesFeatureCard("Short-Time Power");
      appendTimeseriesFeatureRow(card, "Frames", String(frameEnergies.length));
      appendTimeseriesFeatureRow(card, "Frame mean", formatMetricNumber(meanPower, 8));
      appendTimeseriesFeatureRow(
        card,
        "Frame mean (dB)",
        formatMetricNumber(10 * Math.log10(meanPower + 1e-12), 3)
      );
      appendTimeseriesFeatureRow(card, "Frame std", formatMetricNumber(stdOfNumbers(frameEnergies, meanPower), 8));
      appendTimeseriesFeatureRow(
        card,
        "Frame P05/P95",
        formatMetricNumber(quantileSorted(sortedEnergies, 0.05), 8) +
          " / " +
          formatMetricNumber(quantileSorted(sortedEnergies, 0.95), 8)
      );
      panel.appendChild(card);
    }

    if (state.features.shortTimeAutocorrelation) {
      const frameEnergies = frameSummary ? frameSummary.energyByFrame : [];
      const frameRateHz = frameSummary && frameSummary.hopSize > 0 ? sampleRate / frameSummary.hopSize : 0;
      const shortAuto =
        frameEnergies.length > 0
          ? summarizeAutocorrelation(Float32Array.from(frameEnergies), frameRateHz)
          : { bestLag: 0, bestCorrelation: 0, estimatedF0Hz: 0 };
      const card = createTimeseriesFeatureCard("Short-Time Autocorr");
      appendTimeseriesFeatureRow(card, "Frames", String(frameEnergies.length));
      appendTimeseriesFeatureRow(card, "Best lag", String(shortAuto.bestLag) + " frames");
      appendTimeseriesFeatureRow(
        card,
        "Best correlation",
        formatMetricNumber(shortAuto.bestCorrelation, 5)
      );
      appendTimeseriesFeatureRow(
        card,
        "Modulation proxy",
        shortAuto.estimatedF0Hz > 0 ? formatMetricNumber(shortAuto.estimatedF0Hz, 3) + " Hz" : "n/a"
      );
      panel.appendChild(card);
    }

    return panel.childElementCount > 0 ? panel : null;
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
      kind === "tempogram" ||
      kind === "fourier_tempogram" ||
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
    stackList.setAttribute("role", "list");
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
      row.setAttribute("role", "listitem");
      row.setAttribute("aria-label", "View " + (index + 1) + ": " + getTransformDisplayLabel(item));

      row.addEventListener("dragstart", function (event) {
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

        const fromIndex = dragIndex;
        dragIndex = null;
        const movedItem = state.stack[fromIndex];
        moveStackItemWithAnnouncement(movedItem, fromIndex, index);
      });

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "drag-handle";
      handle.textContent = "|||";
      handle.dataset.itemId = item.id;
      handle.title = "Drag to reorder. Keyboard: Arrow Up/Down, Home, End.";
      handle.setAttribute(
        "aria-label",
        "Reorder view " +
          (index + 1) +
          ". Drag with mouse, or press Arrow Up or Arrow Down. Home/End jumps."
      );
      handle.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown Home End");
      if (stackReorderHint) {
        handle.setAttribute("aria-describedby", stackReorderHint.id);
      }
      handle.addEventListener("keydown", function (event) {
        if (event.altKey || event.ctrlKey || event.metaKey) {
          return;
        }

        let targetIndex = null;
        if (event.key === "ArrowUp") {
          targetIndex = index - 1;
        } else if (event.key === "ArrowDown") {
          targetIndex = index + 1;
        } else if (event.key === "Home") {
          targetIndex = 0;
        } else if (event.key === "End") {
          targetIndex = state.stack.length - 1;
        }

        if (targetIndex === null) {
          return;
        }

        event.preventDefault();
        moveStackItemWithAnnouncement(item, index, targetIndex);
      });

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

      transformSelect.addEventListener("change", function () {
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
      });

      const settingsButton = document.createElement("button");
      settingsButton.type = "button";
      settingsButton.className = "row-settings-button";
      settingsButton.textContent = expandedRowSettingsIds.has(item.id) ? "Hide Settings" : "Settings";
      settingsButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
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

    if (pendingStackHandleFocusId) {
      focusStackHandleByItemId(pendingStackHandleFocusId);
      pendingStackHandleFocusId = null;
    }
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
    offsetSeconds,
    comparisonRegion
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
        offsetSeconds,
        comparisonRegion
      );

      if (!secondaryWindow.hasOverlap) {
        drawNoOverlapPlaceholder(canvas, "No overlap at current offset/trim");
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
          offsetSeconds,
          comparisonRegion
        );
      } else {
        drawHeatmapOverlayComparison(
          canvas,
          primaryRenderSpec,
          secondaryRenderSpec,
          windowInfo,
          offsetSeconds,
          comparisonRegion
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
          offsetSeconds,
          comparisonRegion
        );
      } else {
        drawHeatmapDifferenceComparison(
          canvas,
          primaryRenderSpec,
          secondaryRenderSpec,
          windowInfo,
          offsetSeconds,
          comparisonRegion
        );
      }
    }
  }

  function renderTransformStack() {
    cleanupViewStateCache();
    playheadElementsByViewId.clear();
    renderStackContainer.innerHTML = "";

    if (state.stack.length === 0 && !state.pca.enabled) {
      const empty = document.createElement("div");
      empty.className = "transform-empty";
      empty.textContent = "No transform views selected. Add one with \"Add View\".";
      renderStackContainer.appendChild(empty);
      renderMetricsReport();
      updateAnalysisPanelsAndControls();
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
        const activeComparisonMode =
          state.comparison.mode !== "none" && comparisonAudioData ? state.comparison.mode : "none";
        const splitByChannel = shouldRenderSplitChannels(activeComparisonMode);
        const splitChannelCount = splitByChannel ? getAudioChannelCount(primaryAudio) : 1;
        const primaryRenderSpec = splitByChannel
          ? buildTransformRenderSpecForAudio(
              item,
              getAudioDataForChannel(primaryAudio, 0),
              derivedCache,
              "primary clip"
            )
          : buildTransformRenderSpec(item);
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
        const comparisonRegion = secondaryRenderSpec
          ? resolveComparisonRegion(secondaryRenderSpec, state.comparison)
          : null;

        const panelDescriptors = splitByChannel
          ? Array.from({ length: splitChannelCount }, function (_, channelIndex) {
              const channelAudio = getAudioDataForChannel(primaryAudio, channelIndex);
              return {
                role: "primary",
                label: "Channel " + (channelIndex + 1),
                primaryRenderSpec: buildTransformRenderSpecForAudio(
                  item,
                  channelAudio,
                  derivedCache,
                  "primary clip"
                ),
                secondaryRenderSpec: null
              };
            })
          : activeComparisonMode === "none"
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
        const gridMode = splitByChannel ? "stacked" : activeComparisonMode;
        grid.className = "transform-comparison-grid mode-" + gridMode;
        const panelWidthDivisor = getCanvasWidthPanelDivisor(gridMode, panelDescriptors.length);

        let firstWindowInfo = null;
        const viewportPlayheads = [];

        panelDescriptors.forEach(function (panel) {
          const panelWrap = document.createElement("section");
          panelWrap.className = "comparison-panel";

          if (panelDescriptors.length > 1 || splitByChannel) {
            const panelLabel = document.createElement("p");
            panelLabel.className = "comparison-panel-label";
            panelLabel.textContent = panel.label;
            panelWrap.appendChild(panelLabel);
          }

          const panelPrimaryRenderSpec = panel.primaryRenderSpec || primaryRenderSpec;
          const panelSecondaryRenderSpec = panel.secondaryRenderSpec || secondaryRenderSpec;
          const panelWindowInfo = computeViewWindow(panelPrimaryRenderSpec.domainLength, item.id);
          if (!firstWindowInfo) {
            firstWindowInfo = panelWindowInfo;
          }

          const viewport = document.createElement("div");
          viewport.className = "transform-viewport";

          const canvas = document.createElement("canvas");
          canvas.className = "transform-canvas";
          canvas.width = pickCanvasWidth(panelWidthDivisor);
          canvas.height =
            panelPrimaryRenderSpec.type === "waveform"
              ? WAVEFORM_CANVAS_HEIGHT
              : MATRIX_CANVAS_HEIGHT;

          drawPanelCanvasForComparisonRole(
            panel.role,
            canvas,
            panelPrimaryRenderSpec,
            panelSecondaryRenderSpec,
            panelWindowInfo,
            offsetSeconds,
            comparisonRegion
          );

          if (panel.role !== "secondary") {
            drawActivationOverlay(canvas, panelPrimaryRenderSpec, panelWindowInfo);
          }

          attachCanvasInteractions(canvas, item, panelPrimaryRenderSpec);

          const viewportPlayhead = document.createElement("div");
          viewportPlayhead.className = "transform-playhead";
          viewportPlayheads.push(viewportPlayhead);

          viewport.appendChild(canvas);
          viewport.appendChild(viewportPlayhead);
          panelWrap.appendChild(viewport);

          if (splitByChannel && panelPrimaryRenderSpec.type === "waveform") {
            const waveformBar = buildTimeseriesBar(panelPrimaryRenderSpec, panelWindowInfo);
            panelWrap.appendChild(waveformBar);

            const timeseriesStats = buildTimeseriesStatsPanel(panelPrimaryRenderSpec, panelWindowInfo);
            panelWrap.appendChild(timeseriesStats);

            const featurePanel = buildTimeseriesFeaturePanel(panelPrimaryRenderSpec, panelWindowInfo);
            if (featurePanel) {
              panelWrap.appendChild(featurePanel);
            }
          }

          if (
            splitByChannel &&
            panelPrimaryRenderSpec.type === "matrix" &&
            shouldShowSpectralBar(item.id)
          ) {
            const spectralBar = buildSpectralBar(panelPrimaryRenderSpec, panelWindowInfo);
            panelWrap.appendChild(spectralBar);
          }

          grid.appendChild(panelWrap);
        });

        body.appendChild(grid);

        const windowInfo = firstWindowInfo || computeViewWindow(primaryRenderSpec.domainLength, item.id);
        const scrollbar = buildTransformScrollbar(item, primaryRenderSpec);
        body.appendChild(scrollbar.element);

        if (!splitByChannel && primaryRenderSpec.type === "waveform") {
          const waveformBar = buildTimeseriesBar(primaryRenderSpec, windowInfo);
          body.appendChild(waveformBar);

          const timeseriesStats = buildTimeseriesStatsPanel(primaryRenderSpec, windowInfo);
          body.appendChild(timeseriesStats);

          const featurePanel = buildTimeseriesFeaturePanel(primaryRenderSpec, windowInfo);
          if (featurePanel) {
            body.appendChild(featurePanel);
          }
        }

        if (!splitByChannel && primaryRenderSpec.type === "matrix" && shouldShowSpectralBar(item.id)) {
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
        if (splitByChannel) {
          caption.textContent =
            "Multichannel split view (" +
            splitChannelCount +
            " channels). " +
            primaryRenderSpec.caption;
        } else if (activeComparisonMode === "none") {
          caption.textContent = primaryRenderSpec.caption;
        } else {
          const trimSummary =
            comparisonRegion && comparisonRegion.durationSec > 0
              ? ", trim=" +
                comparisonRegion.startSec.toFixed(2) +
                "-" +
                comparisonRegion.endSec.toFixed(2) +
                " s"
              : "";
          caption.textContent =
            primaryRenderSpec.caption +
            " | comparison=" +
            activeComparisonMode +
            ", offset=" +
            offsetSeconds.toFixed(2) +
            " s" +
            trimSummary;
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

    renderPcaFeatureCard();

    updateAnimatedPlayheads();
    renderMetricsReport();
    updateAnalysisPanelsAndControls();
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

    if (message.type === "saveTextFileResult") {
      resolveSaveTextRequestFromHost(message.payload);
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
      return;
    }

    if (message.type === "rClusterRunStarted") {
      rClusterRunning = true;
      updateAnalysisPanelsAndControls();
      startRClusterProgress(Math.max(30, Number(rclusterProgress.value) || 0));
      setRClusterStatus("Running r-clustering...");
      return;
    }

    if (message.type === "rClusterResult") {
      const payload = asRecord(message.payload);
      rClusterRunning = false;
      const resultPayload = payload ? asRecord(payload.result) : null;
      const runContext = payload ? asRecord(payload.runContext) : null;
      rClusterResult = resultPayload || null;
      rClusterLastRunContext = runContext || rClusterLastRunContext;
      updateAnalysisPanelsAndControls();
      completeRClusterProgress();

      const diagnostics = resultPayload ? asRecord(resultPayload.diagnostics) : null;
      const silhouette = diagnostics ? Number(diagnostics.silhouette) : Number.NaN;
      const stability = diagnostics ? asRecord(diagnostics.stability) : null;
      const stabilityMean = stability ? Number(stability.mean) : Number.NaN;
      setRClusterStatus(
        "r-clustering complete. silhouette=" +
          formatMetricNumber(silhouette, 4) +
          ", stability=" +
          formatMetricNumber(stabilityMean, 4) +
          "."
      );
      renderRClusterResults();
      return;
    }

    if (message.type === "rClusterError") {
      const payload = asRecord(message.payload);
      rClusterRunning = false;
      updateAnalysisPanelsAndControls();
      failRClusterProgress();
      const errorMessage = sanitizeStringValue(payload && payload.message, 2048);
      setRClusterStatus("r-clustering failed: " + (errorMessage || "Unknown toolbox error."));
      return;
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
    setComparisonControlsDisabled(state.comparison.mode === "none");
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

  comparisonTrimStartSeconds.addEventListener("change", function () {
    state.comparison.trimStartSeconds = sanitizeFloat(
      comparisonTrimStartSeconds.value,
      0,
      0,
      MAX_COMPARISON_TRIM_SECONDS
    );
    normalizeComparisonTrimForAudioData(comparisonAudioData);
    comparisonTrimStartSeconds.value = Number(state.comparison.trimStartSeconds).toFixed(2);
    comparisonTrimDurationSeconds.value = Number(state.comparison.trimDurationSeconds).toFixed(2);
    renderTransformStack();
    postState();
  });

  comparisonTrimDurationSeconds.addEventListener("change", function () {
    state.comparison.trimDurationSeconds = sanitizeFloat(
      comparisonTrimDurationSeconds.value,
      0,
      0,
      MAX_COMPARISON_TRIM_SECONDS
    );
    normalizeComparisonTrimForAudioData(comparisonAudioData);
    comparisonTrimDurationSeconds.value = Number(state.comparison.trimDurationSeconds).toFixed(2);
    comparisonTrimStartSeconds.value = Number(state.comparison.trimStartSeconds).toFixed(2);
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

  function onMetricsHistogramControlsChanged() {
    state.metrics.histogramBins = metricsHistogramBinsInput.value;
    state.metrics.histogramRangeMin = metricsHistogramRangeMinInput.value;
    state.metrics.histogramRangeMax = metricsHistogramRangeMaxInput.value;
    const histogramConfig = getMetricsHistogramConfig();
    metricsHistogramBinsInput.value = String(histogramConfig.bins);
    metricsHistogramRangeMinInput.value = formatMetricNumber(histogramConfig.min, 3);
    metricsHistogramRangeMaxInput.value = formatMetricNumber(histogramConfig.max, 3);
    metricsRenderSignature = "";
    renderMetricsReport();
    postState();
  }

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

  metricsHistogramBinsInput.addEventListener("change", onMetricsHistogramControlsChanged);
  metricsHistogramRangeMinInput.addEventListener("change", onMetricsHistogramControlsChanged);
  metricsHistogramRangeMaxInput.addEventListener("change", onMetricsHistogramControlsChanged);

  featurePower.addEventListener("change", function () {
    state.features.power = featurePower.checked;
    renderTransformStack();
    renderMetricsReport();
    postState();
  });

  featureAutocorrelation.addEventListener("change", function () {
    state.features.autocorrelation = featureAutocorrelation.checked;
    renderTransformStack();
    renderMetricsReport();
    postState();
  });

  featureShorttimePower.addEventListener("change", function () {
    state.features.shortTimePower = featureShorttimePower.checked;
    renderTransformStack();
    renderMetricsReport();
    postState();
  });

  featureShorttimeAutocorrelation.addEventListener("change", function () {
    state.features.shortTimeAutocorrelation = featureShorttimeAutocorrelation.checked;
    renderTransformStack();
    renderMetricsReport();
    postState();
  });

  metricsExportJson.addEventListener("click", async function () {
    const report = getPrimaryMetricsReport();
    if (!report) {
      setAudioStatus("No decoded primary audio loaded for metrics export.");
      return;
    }

    try {
      const payload = buildMetricsExportModel(report);
      const json = JSON.stringify(payload, null, 2);
      await triggerTextDownload(metricsExportBaseName() + "-metrics.json", "application/json", json);
      metricsStatus.textContent = "Exported metrics JSON.";
    } catch (error) {
      if (isSaveCanceledError(error)) {
        metricsStatus.textContent = "JSON export canceled.";
      } else {
        metricsStatus.textContent = "Failed to export JSON: " + toErrorText(error);
      }
    }
  });

  metricsExportCsv.addEventListener("click", async function () {
    const report = getPrimaryMetricsReport();
    if (!report) {
      setAudioStatus("No decoded primary audio loaded for metrics export.");
      return;
    }

    try {
      const payload = buildMetricsExportModel(report);
      const csv = buildMetricsCsv(payload);
      await triggerTextDownload(metricsExportBaseName() + "-metrics.csv", "text/csv", csv);
      metricsStatus.textContent = "Exported metrics CSV.";
    } catch (error) {
      if (isSaveCanceledError(error)) {
        metricsStatus.textContent = "CSV export canceled.";
      } else {
        metricsStatus.textContent = "Failed to export CSV: " + toErrorText(error);
      }
    }
  });

  pcaEnabled.addEventListener("change", function () {
    state.pca.enabled = pcaEnabled.checked;
    renderTransformStack();
    postState();
  });

  pcaGoal.addEventListener("change", function () {
    state.pca.goal = pcaGoal.value;
    updatePcaGuidance();
    renderTransformStack();
    postState();
  });

  pcaClasswise.addEventListener("change", function () {
    state.pca.classwise = pcaClasswise.checked;
    renderTransformStack();
    postState();
  });

  pcaComponents.addEventListener("change", function () {
    state.pca.componentSelection = sanitizeStringValue(pcaComponents.value, 128);
    pcaComponents.value = state.pca.componentSelection || "";
    renderTransformStack();
    postState();
  });

  multichannelEnabled.addEventListener("change", function () {
    state.multichannel.enabled = multichannelEnabled.checked;
    updateMultichannelControlsFromAudio();
    renderTransformStack();
    postState();
  });

  multichannelSplit.addEventListener("change", function () {
    state.multichannel.splitViewsByChannel = multichannelSplit.checked;
    updateMultichannelControlsFromAudio();
    renderTransformStack();
    postState();
  });

  multichannelAnalysisChannel.addEventListener("change", function () {
    const channelCount = primaryAudio ? getAudioChannelCount(primaryAudio) : 1;
    state.multichannel.analysisChannelIndex = sanitizeInt(
      multichannelAnalysisChannel.value,
      0,
      -1,
      Math.max(-1, channelCount - 1)
    );
    updateMultichannelControlsFromAudio();
    renderTransformStack();
    postState();
  });

  analysisToolSelect.addEventListener("change", function () {
    updateAnalysisPanelsAndControls();
    postState();
  });

  function syncRClusterParamsAndControls() {
    syncRClusterParamInputs();
    updateAnalysisPanelsAndControls();
  }

  rclusterRepresentation.addEventListener("change", function () {
    syncRClusterParamsAndControls();
  });

  [
    rclusterK,
    rclusterSeed,
    rclusterMaxIter,
    rclusterStabilityRuns,
    rclusterRowRatio,
    rclusterFeatureRatio
  ].forEach(function (input) {
    input.addEventListener("change", syncRClusterParamsAndControls);
  });

  rclusterRun.addEventListener("click", function () {
    if (rClusterRunning) {
      return;
    }

    const params = getRClusterParamsFromInputs();
    syncRClusterParamInputs();
    let dataset;
    try {
      dataset = buildRClusterDataset();
    } catch (error) {
      failRClusterProgress();
      setRClusterStatus("r-clustering prerequisites failed: " + toErrorText(error));
      return;
    }

    rClusterLastRunContext = dataset.runContext;
    rClusterRunning = true;
    updateAnalysisPanelsAndControls();
    setRClusterStatus("Running in-browser r-clustering (JavaScript backend)...");
    startRClusterProgress(12);

    void runRClusterInBrowserLocal(dataset, params)
      .then(function (result) {
        rClusterRunning = false;
        rClusterResult = result;
        updateAnalysisPanelsAndControls();
        completeRClusterProgress();

        const diagnostics = asRecord(result.diagnostics);
        const silhouette = diagnostics ? Number(diagnostics.silhouette) : Number.NaN;
        const stability = diagnostics ? asRecord(diagnostics.stability) : null;
        const stabilityMean = stability ? Number(stability.mean) : Number.NaN;
        setRClusterStatus(
          "r-clustering complete (JS). silhouette=" +
            formatMetricNumber(silhouette, 4) +
            ", stability=" +
            formatMetricNumber(stabilityMean, 4) +
            "."
        );
        renderRClusterResults();
      })
      .catch(function (error) {
        rClusterRunning = false;
        updateAnalysisPanelsAndControls();
        failRClusterProgress();
        setRClusterStatus("r-clustering failed: " + toErrorText(error));
      });
  });

  if (rclusterStatus.textContent.trim().length === 0) {
    setRClusterStatus("Ready to run r-clustering from generated short-time features.");
  } else {
    setRClusterStatus(
      "Ready to run r-clustering from generated short-time features (JavaScript backend)."
    );
  }

  function syncRandomForestParamsAndControls() {
    syncRandomForestParamsFromInputs();
    updateAnalysisPanelsAndControls();
  }

  [rfSource, rfTreeCount, rfMaxDepth, rfMinLeaf, rfFeatureRatio, rfMaxFrames, rfTopFeatures].forEach(
    function (input) {
      input.addEventListener("change", syncRandomForestParamsAndControls);
    }
  );

  rfRun.addEventListener("click", function () {
    if (randomForestRunning) {
      return;
    }

    const params = syncRandomForestParamsFromInputs();
    let dataset;
    try {
      dataset = buildRandomForestDataset(params);
    } catch (error) {
      setRandomForestProgress(0);
      setRandomForestStatus("Random forest prerequisites failed: " + toErrorText(error));
      return;
    }

    randomForestLastRunContext = dataset.runContext;
    randomForestRunning = true;
    updateAnalysisPanelsAndControls();
    setRandomForestStatus("Running random forest (JavaScript backend)...");
    setRandomForestProgress(8);

    void runRandomForestInBrowserLocal(dataset, params)
      .then(function (result) {
        randomForestRunning = false;
        randomForestResult = result;
        updateAnalysisPanelsAndControls();
        setRandomForestProgress(100);
        window.setTimeout(function () {
          if (!randomForestRunning) {
            setRandomForestProgress(0);
          }
        }, 700);

        const diagnostics = asRecord(result.diagnostics);
        const oob = diagnostics ? asRecord(diagnostics.oob) : null;
        setRandomForestStatus(
          "Random forest complete (JS). oob_accuracy=" +
            formatMetricPercent(Number(oob && oob.accuracy)) +
            ", oob_f1=" +
            formatMetricPercent(Number(oob && oob.f1)) +
            "."
        );
        renderRandomForestResults();
      })
      .catch(function (error) {
        randomForestRunning = false;
        updateAnalysisPanelsAndControls();
        setRandomForestProgress(0);
        setRandomForestStatus("Random forest failed: " + toErrorText(error));
      });
  });

  if (rfStatus.textContent.trim().length === 0) {
    setRandomForestStatus("Ready to run random forest diagnostics.");
  } else {
    setRandomForestStatus("Ready to run random forest diagnostics (JavaScript backend).");
  }

  function syncCastorParamsAndControls() {
    syncCastorParamsFromInputs();
    updateAnalysisPanelsAndControls();
  }

  castorPreset.addEventListener("change", function () {
    applyCastorPreset(castorPreset.value);
  });

  [castorSource, castorMaxFrames, castorPadLength, castorTopDims, castorNormalize].forEach(function (
    input
  ) {
    const eventName = input === castorNormalize ? "change" : "change";
    input.addEventListener(eventName, syncCastorParamsAndControls);
  });

  castorRun.addEventListener("click", function () {
    if (castorRunning) {
      return;
    }

    const params = syncCastorParamsFromInputs();
    let dataset;
    try {
      dataset = buildCastorDataset(params);
    } catch (error) {
      setCastorProgress(0);
      setCastorStatus("CASTOR prerequisites failed: " + toErrorText(error));
      return;
    }

    castorLastRunContext = dataset.runContext;
    castorRunning = true;
    updateAnalysisPanelsAndControls();
    setCastorStatus("Running CASTOR prototype (JavaScript backend)...");
    setCastorProgress(8);

    void runCastorInBrowserLocal(dataset, params)
      .then(function (result) {
        castorRunning = false;
        castorResult = result;
        updateAnalysisPanelsAndControls();
        setCastorProgress(100);
        window.setTimeout(function () {
          if (!castorRunning) {
            setCastorProgress(0);
          }
        }, 700);

        setCastorStatus(
          "CASTOR complete (JS). training_accuracy=" +
            formatMetricPercent(Number(result.training_accuracy)) +
            ", instances=" +
            String(sanitizeInt(result.instance_count, 0, 0, 1000000000)) +
            ", preset=" +
            String(params.preset) +
            "."
        );
        renderCastorResults();
      })
      .catch(function (error) {
        castorRunning = false;
        updateAnalysisPanelsAndControls();
        setCastorProgress(0);
        setCastorStatus("CASTOR failed: " + toErrorText(error));
      });
  });

  if (castorStatus.textContent.trim().length === 0) {
    setCastorStatus("Ready to run CASTOR prototype diagnostics.");
  } else {
    setCastorStatus("Ready to run CASTOR prototype diagnostics (JavaScript backend).");
  }

  function syncSpfParamsAndControls() {
    syncSpfParamsFromInputs();
    updateAnalysisPanelsAndControls();
  }

  [
    spfSource,
    spfAlphabetSize,
    spfWordLength,
    spfMaxFrames,
    spfTopPatterns,
    spfForestTrees
  ].forEach(function (input) {
    input.addEventListener("change", syncSpfParamsAndControls);
  });

  spfRun.addEventListener("click", function () {
    if (spfRunning) {
      return;
    }

    const params = syncSpfParamsFromInputs();
    let dataset;
    try {
      dataset = buildSpfDataset(params);
    } catch (error) {
      setSpfProgress(0);
      setSpfStatus("SPF prerequisites failed: " + toErrorText(error));
      return;
    }

    spfLastRunContext = dataset.runContext;
    spfRunning = true;
    updateAnalysisPanelsAndControls();
    setSpfStatus("Running symbolic pattern forest (JavaScript backend)...");
    setSpfProgress(8);

    void runSpfInBrowserLocal(dataset, params)
      .then(function (result) {
        spfRunning = false;
        spfResult = result;
        updateAnalysisPanelsAndControls();
        setSpfProgress(100);
        window.setTimeout(function () {
          if (!spfRunning) {
            setSpfProgress(0);
          }
        }, 700);

        const diagnostics = asRecord(result.diagnostics);
        const forest = diagnostics ? asRecord(diagnostics.forest) : null;
        setSpfStatus(
          "SPF complete (JS). unique_patterns=" +
            String(sanitizeInt(diagnostics && diagnostics.unique_patterns, 0, 0, 1000000000)) +
            ", oob_accuracy=" +
            formatMetricPercent(Number(forest && forest.oobAccuracy)) +
            "."
        );
        renderSpfResults();
      })
      .catch(function (error) {
        spfRunning = false;
        updateAnalysisPanelsAndControls();
        setSpfProgress(0);
        setSpfStatus("SPF failed: " + toErrorText(error));
      });
  });

  if (spfStatus.textContent.trim().length === 0) {
    setSpfStatus("Ready to run symbolic pattern diagnostics.");
  } else {
    setSpfStatus("Ready to run symbolic pattern diagnostics (JavaScript backend).");
  }

  window.addEventListener("resize", scheduleRenderTransformStack);

  syncControlsFromState();
  syncRClusterParamInputs();
  syncRandomForestParamsFromInputs();
  syncCastorParamsFromInputs();
  syncSpfParamsFromInputs();
  updateAnalysisPanelsAndControls();
  setRClusterProgress(0);
  setRandomForestProgress(0);
  setCastorProgress(0);
  setSpfProgress(0);
  renderRClusterResults();
  renderRandomForestResults();
  renderCastorResults();
  renderSpfResults();
  if (state.comparison.secondAudioName) {
    setComparisonStatus(
      "Second clip remembered as " +
        state.comparison.secondAudioName +
        ". Re-select it to decode for this session. Saved trim start=" +
        Number(state.comparison.trimStartSeconds || 0).toFixed(2) +
        " s, duration=" +
        Number(state.comparison.trimDurationSeconds || 0).toFixed(2) +
        " s (0=full)."
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

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
    { value: "magnitude_spectrogram", label: "spectrogram (magnitude)" },
    { value: "phase_spectrogram", label: "spectrogram (phase)" },
    { value: "mel", label: "mel" },
    { value: "mfcc", label: "mfcc" },
    { value: "dct", label: "dct" },
    { value: "custom_filterbank", label: "custom_filterbank" }
  ];

  const STFT_WINDOW_SIZE_OPTIONS = [128, 256, 512, 1024, 2048, 4096];
  const STFT_WINDOW_TYPES = ["hann", "hamming", "blackman", "rectangular"];
  const DEFAULT_TRANSFORM_PARAMS = {
    stft: {
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

  const bootstrapBase = window.__AUDIO_EDA_BOOTSTRAP__ || {
    stack: [],
    overlay: { enabled: false, mode: "flag", csvName: null },
    comparison: { mode: "none", secondAudioName: null },
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

  const persistedState =
    typeof vscode.getState === "function" ? vscode.getState() : undefined;
  const bootstrap = mergeBootstrapState(bootstrapBase, persistedState);
  const state = JSON.parse(JSON.stringify(bootstrap));
  ensureTransformParamState();
  normalizeLegacyTransformKinds();
  normalizeStackItems();

  const stackList = byId("stack-list");
  const addTransformButton = byId("add-transform");
  const renderStackContainer = byId("transform-render-stack");

  const primaryAudioFileInput = byId("primary-audio-file");
  const primaryAudioPlayer = byId("primary-audio-player");
  const audioStatus = byId("audio-status");
  const audioLockStatus = byId("audio-lock-status");

  const customFilterbankInput = byId("custom-filterbank-csv");
  const filterbankStatus = byId("filterbank-status");

  const overlayEnabled = byId("overlay-enabled");
  const overlayMode = byId("overlay-mode");
  const overlayCsv = byId("overlay-csv");
  const overlayCsvHint = byId("overlay-csv-hint");

  const comparisonMode = byId("comparison-mode");
  const comparisonAudio = byId("comparison-audio");

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
  let customFilterbank = null;
  let derivedCache = createEmptyDerivedCache();
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

  function mergeBootstrapState(baseState, restoredState) {
    const merged = JSON.parse(JSON.stringify(baseState));
    if (!restoredState || typeof restoredState !== "object") {
      return merged;
    }

    if (Array.isArray(restoredState.stack)) {
      merged.stack = restoredState.stack;
    }

    if (restoredState.overlay && typeof restoredState.overlay === "object") {
      merged.overlay = Object.assign({}, merged.overlay, restoredState.overlay);
    }

    if (restoredState.comparison && typeof restoredState.comparison === "object") {
      merged.comparison = Object.assign({}, merged.comparison, restoredState.comparison);
    }

    if (restoredState.metrics && typeof restoredState.metrics === "object") {
      merged.metrics = Object.assign({}, merged.metrics, restoredState.metrics);
    }

    if (restoredState.features && typeof restoredState.features === "object") {
      merged.features = Object.assign({}, merged.features, restoredState.features);
    }

    if (restoredState.pca && typeof restoredState.pca === "object") {
      merged.pca = Object.assign({}, merged.pca, restoredState.pca);
    }

    if (restoredState.multichannel && typeof restoredState.multichannel === "object") {
      merged.multichannel = Object.assign({}, merged.multichannel, restoredState.multichannel);
    }

    if (restoredState.transformParams && typeof restoredState.transformParams === "object") {
      merged.transformParams = Object.assign({}, merged.transformParams, restoredState.transformParams);
      if (restoredState.transformParams.stft && typeof restoredState.transformParams.stft === "object") {
        merged.transformParams.stft = Object.assign(
          {},
          merged.transformParams.stft,
          restoredState.transformParams.stft
        );
      }
      if (restoredState.transformParams.mel && typeof restoredState.transformParams.mel === "object") {
        merged.transformParams.mel = Object.assign(
          {},
          merged.transformParams.mel,
          restoredState.transformParams.mel
        );
      }
      if (restoredState.transformParams.mfcc && typeof restoredState.transformParams.mfcc === "object") {
        merged.transformParams.mfcc = Object.assign(
          {},
          merged.transformParams.mfcc,
          restoredState.transformParams.mfcc
        );
      }
      if (restoredState.transformParams.dct && typeof restoredState.transformParams.dct === "object") {
        merged.transformParams.dct = Object.assign(
          {},
          merged.transformParams.dct,
          restoredState.transformParams.dct
        );
      }
    }

    return merged;
  }

  function normalizeLegacyTransformKinds() {
    if (!Array.isArray(state.stack)) {
      return;
    }

    state.stack.forEach(function (item) {
      if (item && item.kind === "stft") {
        item.kind = "magnitude_spectrogram";
      }
    });
  }

  function normalizeStackItems() {
    if (!Array.isArray(state.stack)) {
      state.stack = [];
      return;
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

      if (!item.id) {
        item.id = "view-" + Date.now() + "-" + index;
      }

      if (!item.kind) {
        item.kind = "timeseries";
      }

      ensureStackItemParams(item);
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
    const windowSize = sanitizeWindowSize(stft.windowSize);
    const overlapPercent = sanitizeInt(stft.overlapPercent, DEFAULT_TRANSFORM_PARAMS.stft.overlapPercent, 0, 95);
    const windowType = STFT_WINDOW_TYPES.indexOf(stft.windowType) !== -1 ? stft.windowType : "hann";
    const maxAnalysisSeconds = sanitizeInt(
      stft.maxAnalysisSeconds,
      DEFAULT_TRANSFORM_PARAMS.stft.maxAnalysisSeconds,
      1,
      600
    );
    const maxFrames = sanitizeInt(stft.maxFrames, DEFAULT_TRANSFORM_PARAMS.stft.maxFrames, 32, 5000);
    const hopSize = Math.max(1, Math.round(windowSize * (1 - overlapPercent / 100)));

    return {
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

  function createDefaultParamsForKind(kind) {
    ensureTransformParamState();
    const defaults = state.transformParams || DEFAULT_TRANSFORM_PARAMS;

    if (kind === "magnitude_spectrogram" || kind === "phase_spectrogram" || kind === "stft") {
      return {
        stft: cloneParams(defaults.stft)
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
    if (state.overlay.mode === "flag") {
      overlayCsvHint.textContent = "Expected columns: t,flag";
      return;
    }

    overlayCsvHint.textContent = "Expected columns: flag,t_start,t_end";
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

  function createPresetStack(kinds) {
    const seed = Date.now();
    return kinds.map(function (kind, index) {
      return {
        id: "preset-" + seed + "-" + index,
        kind,
        params: createDefaultParamsForKind(kind)
      };
    });
  }

  function applyWorkspacePreset(presetId) {
    if (presetId === "transforms") {
      state.stack = createPresetStack([
        "timeseries",
        "magnitude_spectrogram",
        "phase_spectrogram",
        "mel",
        "mfcc",
        "dct",
        "custom_filterbank"
      ]);
      state.pca.enabled = false;
    } else if (presetId === "metrics") {
      state.stack = createPresetStack(["timeseries", "magnitude_spectrogram", "mel"]);
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
      state.stack = createPresetStack(["timeseries", "magnitude_spectrogram", "mel"]);
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
    comparisonMode.value = state.comparison.mode;

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

  function postState() {
    if (typeof vscode.setState === "function") {
      vscode.setState(state);
    }

    vscode.postMessage({
      type: "stateChanged",
      payload: state
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

    setAudioStatus("Decoding audio file ...");

    const objectUrl = URL.createObjectURL(file);

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

    renderTransformStack();
    postState();
  }

  async function decodeAudioToMono(file) {
    const arrayBuffer = await file.arrayBuffer();
    return decodeAudioArrayBufferToMono(arrayBuffer, file.name);
  }

  async function decodeAudioArrayBufferToMono(arrayBuffer, fileName) {
    const audioContext = new AudioContext();

    try {
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const totalSamples = decoded.length;
      const channelCount = decoded.numberOfChannels;
      const mono = new Float32Array(totalSamples);

      for (let channel = 0; channel < channelCount; channel += 1) {
        const channelData = decoded.getChannelData(channel);
        for (let index = 0; index < totalSamples; index += 1) {
          mono[index] += channelData[index];
        }
      }

      for (let index = 0; index < totalSamples; index += 1) {
        mono[index] /= channelCount;
      }

      return {
        fileName,
        sampleRate: decoded.sampleRate,
        channelCount,
        duration: decoded.duration,
        samples: mono
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
      const numericValues = [];

      for (const value of values) {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) {
          numericValues.push(parsed);
        }
      }

      if (numericValues.length >= 2) {
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

  function ensureStft(item) {
    if (!primaryAudio) {
      throw new Error("Select an audio file first.");
    }

    const stftParams = getItemStftParams(item);
    const stftKey = stftParamsToKey(stftParams);
    if (derivedCache.stftByKey[stftKey]) {
      return derivedCache.stftByKey[stftKey];
    }

    const maxSamples = Math.floor(primaryAudio.sampleRate * stftParams.maxAnalysisSeconds);
    const analysisSamples =
      primaryAudio.samples.length <= maxSamples
        ? primaryAudio.samples
        : primaryAudio.samples.slice(0, maxSamples);

    const stft = computeStft(
      analysisSamples,
      primaryAudio.sampleRate,
      stftParams.windowSize,
      stftParams.hopSize,
      stftParams.maxFrames,
      stftParams.windowType
    );
    stft.cacheKey = stftKey;
    stft.overlapPercent = stftParams.overlapPercent;
    stft.windowType = stftParams.windowType;
    derivedCache.stftByKey[stftKey] = stft;
    return stft;
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

  function ensureMel(item) {
    const stft = ensureStft(item);
    const melParams = getItemMelParams(item, stft.sampleRate);
    const melKey = stft.cacheKey + "::" + melParamsToKey(melParams);
    if (derivedCache.melByKey[melKey]) {
      return derivedCache.melByKey[melKey];
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

    derivedCache.melByKey[melKey] = melResult;
    return melResult;
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

  function ensureMfcc(item) {
    const mel = ensureMel(item);
    const mfccParams = getItemMfccParams(item, mel.bands);
    const mfccKey = mel.cacheKey + "::" + mfccParams.coeffs;
    if (derivedCache.mfccByKey[mfccKey]) {
      return derivedCache.mfccByKey[mfccKey];
    }

    const mfccMatrix = dctRows(mel.matrix, mfccParams.coeffs);

    const mfccResult = {
      matrix: mfccMatrix,
      coeffs: mfccParams.coeffs,
      durationSeconds: mel.durationSeconds
    };

    derivedCache.mfccByKey[mfccKey] = mfccResult;
    return mfccResult;
  }

  function ensureDct(item) {
    const stft = ensureStft(item);
    const dctParams = getItemDctParams(item, stft.binCount);
    const dctKey = stft.cacheKey + "::" + dctParams.coeffs;
    if (derivedCache.dctByKey[dctKey]) {
      return derivedCache.dctByKey[dctKey];
    }

    const dctMatrix = dctRows(stft.logMagnitudeFrames, dctParams.coeffs);

    const dctResult = {
      matrix: dctMatrix,
      coeffs: dctParams.coeffs,
      durationSeconds: stft.durationSeconds
    };

    derivedCache.dctByKey[dctKey] = dctResult;
    return dctResult;
  }

  function ensureCustomFilterbank(item) {
    if (!customFilterbank) {
      throw new Error("Upload a custom filterbank CSV first.");
    }

    const stft = ensureStft(item);
    const key = customFilterbank.fileName + "::" + stft.cacheKey + "::" + stft.binCount;

    if (derivedCache.customFilterbankByKey[key]) {
      return derivedCache.customFilterbankByKey[key];
    }

    const normalized = buildNormalizedFilterbank(customFilterbank.rows, stft.binCount);
    const matrix = applyFilterbank(stft.powerFrames, normalized);

    const customResult = {
      matrix,
      filters: normalized.length,
      sourceName: customFilterbank.fileName,
      durationSeconds: stft.durationSeconds
    };

    derivedCache.customFilterbankByKey[key] = customResult;

    return customResult;
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
      case "stft":
      case "magnitude_spectrogram": {
        const stft = ensureStft(item);
        return (
          stft.frameCount +
          " frames x " +
          stft.binCount +
          " bins | win=" +
          stft.fftSize +
          ", overlap=" +
          stft.overlapPercent +
          "%"
        );
      }
      case "phase_spectrogram": {
        const stft = ensureStft(item);
        return (
          stft.frameCount +
          " frames x " +
          stft.binCount +
          " bins | phase(rad), win=" +
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

  function buildTransformRenderSpec(item) {
    const kind = item.kind;
    if (!primaryAudio) {
      throw new Error("Load a primary audio clip to render this view.");
    }

    if (kind === "timeseries") {
      return {
        type: "waveform",
        domainLength: primaryAudio.samples.length,
        durationSeconds: primaryAudio.duration,
        sampleRate: primaryAudio.sampleRate,
        samples: primaryAudio.samples,
        caption:
          "Raw samples from decoded mono mixdown (" +
          primaryAudio.sampleRate +
          " Hz, " +
          primaryAudio.duration.toFixed(2) +
          " s)."
      };
    }

    if (kind === "stft" || kind === "magnitude_spectrogram") {
      const stft = ensureStft(item);
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

    if (kind === "phase_spectrogram") {
      const stft = ensureStft(item);
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

    if (kind === "mel") {
      const mel = ensureMel(item);
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
      const mfcc = ensureMfcc(item);
      return {
        type: "matrix",
        domainLength: mfcc.matrix.length,
        durationSeconds: mfcc.durationSeconds,
        matrix: mfcc.matrix,
        caption: "MFCC from DCT(log-mel), showing first " + mfcc.coeffs + " coefficients."
      };
    }

    if (kind === "dct") {
      const dct = ensureDct(item);
      return {
        type: "matrix",
        domainLength: dct.matrix.length,
        durationSeconds: dct.durationSeconds,
        matrix: dct.matrix,
        caption: "DCT-II on log STFT magnitudes, first " + dct.coeffs + " coefficients."
      };
    }

    if (kind === "custom_filterbank") {
      const custom = ensureCustomFilterbank(item);
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

  function pickCanvasWidth() {
    const containerWidth = Math.floor(renderStackContainer.clientWidth || 700);
    return clamp(containerWidth - 24, 360, 1800);
  }

  function drawWaveform(canvas, samples, startIndex, endIndex, zoomLevel) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, width, height);

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

      ctx.strokeStyle = "#7dd3fc";
      ctx.lineWidth = 1.2;
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
      ctx.fillStyle = "#38bdf8";

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
    } else {
      ctx.strokeStyle = "#7dd3fc";
      ctx.lineWidth = 1;
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
    }

    ctx.strokeStyle = "rgba(255,255,255,0.24)";
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(width, mid + 0.5);
    ctx.stroke();
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

    const image = ctx.createImageData(width, height);

    for (let y = 0; y < height; y += 1) {
      const normalizedY = 1 - y / Math.max(1, height - 1);
      const binIndex = Math.floor(normalizedY * (bins - 1));

      for (let x = 0; x < width; x += 1) {
        const normalizedX = x / Math.max(1, width - 1);
        const frameIndex = startFrame + Math.floor(normalizedX * Math.max(0, visibleFrameCount - 1));
        const frame = matrix[clamp(frameIndex, 0, matrix.length - 1)];
        const value = frame[binIndex];
        const normalized = clamp((value - minValue) / span, 0, 1);
        const color = heatColor(normalized);

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
      kind === "magnitude_spectrogram" ||
      kind === "phase_spectrogram" ||
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

    if (!rowUsesStft(item.kind) && item.kind !== "mfcc" && item.kind !== "dct") {
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
      addRowSettingNumber(panel, "Max frames", stftParams.maxFrames, 32, 5000, 1, function (nextValue) {
        item.params.stft.maxFrames = nextValue;
        onRowParamsChanged();
      });
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

    state.stack.forEach(function (item, index) {
      ensureStackItemParams(item);

      const row = document.createElement("li");
      row.className = "stack-item";
      row.draggable = true;
      row.dataset.index = String(index);

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
        if (kindOption.value === item.kind) {
          option.selected = true;
        }
        transformSelect.appendChild(option);
      });

      transformSelect.addEventListener("change", function () {
        item.kind = transformSelect.value;
        item.params = createDefaultParamsForKind(item.kind);
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
      title.textContent = (index + 1).toString() + ". " + item.kind;

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
        const renderSpec = buildTransformRenderSpec(item);

        const toolbar = buildTransformToolbar(item, renderSpec);
        body.appendChild(toolbar);

        const viewport = document.createElement("div");
        viewport.className = "transform-viewport";

        const canvas = document.createElement("canvas");
        canvas.className = "transform-canvas";
        canvas.width = pickCanvasWidth();
        canvas.height = renderSpec.type === "waveform" ? WAVEFORM_CANVAS_HEIGHT : MATRIX_CANVAS_HEIGHT;

        const windowInfo = computeViewWindow(renderSpec.domainLength, item.id);

        if (renderSpec.type === "waveform") {
          drawWaveform(
            canvas,
            renderSpec.samples,
            windowInfo.startIndex,
            windowInfo.endIndex,
            windowInfo.zoom
          );
        } else {
          drawHeatmap(
            canvas,
            renderSpec.matrix,
            windowInfo.startIndex,
            windowInfo.endIndex,
            renderSpec.valueRange
          );
        }

        attachCanvasInteractions(canvas, item, renderSpec);

        const viewportPlayhead = document.createElement("div");
        viewportPlayhead.className = "transform-playhead";

        viewport.appendChild(canvas);
        viewport.appendChild(viewportPlayhead);
        body.appendChild(viewport);

        const scrollbar = buildTransformScrollbar(item, renderSpec);
        body.appendChild(scrollbar.element);

        if (renderSpec.type === "waveform") {
          const waveformBar = buildTimeseriesBar(renderSpec, windowInfo);
          body.appendChild(waveformBar);

          const timeseriesStats = buildTimeseriesStatsPanel(renderSpec, windowInfo);
          body.appendChild(timeseriesStats);
        }

        if (renderSpec.type === "matrix" && shouldShowSpectralBar(item.id)) {
          const spectralBar = buildSpectralBar(renderSpec, windowInfo);
          body.appendChild(spectralBar);
        }

        playheadElementsByViewId.set(item.id, {
          viewportPlayhead,
          scrollbarPlayhead: scrollbar.playhead,
          domainLength: renderSpec.domainLength,
          durationSeconds: renderSpec.durationSeconds
        });

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

    updateAnimatedPlayheads();
  }

  function updateAnimatedPlayheads() {
    if (!primaryAudio || primaryAudio.duration <= 0) {
      playheadElementsByViewId.forEach(function (entry) {
        entry.viewportPlayhead.style.opacity = "0";
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

      if (localRatio >= 0 && localRatio <= 1) {
        entry.viewportPlayhead.style.opacity = "1";
        entry.viewportPlayhead.style.left = (localRatio * 100).toFixed(4) + "%";
      } else {
        entry.viewportPlayhead.style.opacity = "0";
      }

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
    const message = event.data;
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "preloadAudio" && message.payload) {
      const payload = message.payload;
      if (!payload.uri || !payload.name) {
        return;
      }

      void preloadAudioFromWebviewUri(payload.uri, payload.name).catch(function (error) {
        setAudioStatus("Failed to preload workspace audio: " + toErrorText(error));
      });
      return;
    }

    if (message.type === "unlockAudioPicker") {
      setPrimaryAudioInputLocked(false, "");
      return;
    }

    if (message.type === "applyPreset" && message.payload && message.payload.presetId) {
      applyWorkspacePreset(message.payload.presetId);
    }
  });

  overlayEnabled.addEventListener("change", function () {
    state.overlay.enabled = overlayEnabled.checked;
    postState();
  });

  overlayMode.addEventListener("change", function () {
    state.overlay.mode = overlayMode.value;
    updateOverlayCsvHint();
    postState();
  });

  overlayCsv.addEventListener("change", function () {
    const file = overlayCsv.files && overlayCsv.files[0] ? overlayCsv.files[0] : null;
    state.overlay.csvName = file ? file.name : null;
    postState();
  });

  comparisonMode.value = state.comparison.mode;
  comparisonMode.addEventListener("change", function () {
    state.comparison.mode = comparisonMode.value;
    postState();
  });

  comparisonAudio.addEventListener("change", function () {
    const file = comparisonAudio.files && comparisonAudio.files[0] ? comparisonAudio.files[0] : null;
    state.comparison.secondAudioName = file ? file.name : null;
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
    postState();
  });

  metricSpeech.addEventListener("change", function () {
    state.metrics.speech = metricSpeech.checked;
    postState();
  });

  metricStatistical.addEventListener("change", function () {
    state.metrics.statistical = metricStatistical.checked;
    postState();
  });

  metricDistributional.addEventListener("change", function () {
    state.metrics.distributional = metricDistributional.checked;
    postState();
  });

  metricClasswise.addEventListener("change", function () {
    state.metrics.classwise = metricClasswise.checked;
    postState();
  });

  featurePower.addEventListener("change", function () {
    state.features.power = featurePower.checked;
    postState();
  });

  featureAutocorrelation.addEventListener("change", function () {
    state.features.autocorrelation = featureAutocorrelation.checked;
    postState();
  });

  featureShorttimePower.addEventListener("change", function () {
    state.features.shortTimePower = featureShorttimePower.checked;
    postState();
  });

  featureShorttimeAutocorrelation.addEventListener("change", function () {
    state.features.shortTimeAutocorrelation = featureShorttimeAutocorrelation.checked;
    postState();
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
  setPrimaryAudioInputLocked(false, "");
  renderStackControls();
  renderTransformStack();
  postState();
  vscode.postMessage({ type: "ready" });
})();

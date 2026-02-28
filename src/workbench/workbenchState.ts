export type TransformViewKind =
  | "timeseries"
  | "stft"
  | "mel"
  | "mfcc"
  | "dct"
  | "custom_filterbank"
  | "tempogram"
  | "fourier_tempogram";

export type ActivationOverlayMode = "flag" | "timestamped";

export type ComparisonMode =
  | "none"
  | "side_by_side"
  | "overlay"
  | "side_by_side_difference"
  | "stacked"
  | "stacked_difference";

export type PcaGoal = "eda" | "classification" | "denoising" | "doa_beamforming" | "enhancement";
export type StftWindowType = "hann" | "hamming" | "blackman" | "rectangular";
export type StftMode = "magnitude" | "phase";
export type AnalysisTool = "rcluster" | "random_forest" | "castor" | "spf";

export interface TransformViewItem {
  id: string;
  kind: TransformViewKind;
  params?: {
    stft?: {
      mode: StftMode;
      windowSize: number;
      overlapPercent: number;
      windowType: StftWindowType;
      maxAnalysisSeconds: number;
      maxFrames: number;
    };
    mel?: {
      bands: number;
      minHz: number;
      maxHz: number;
    };
    mfcc?: {
      coeffs: number;
    };
    dct?: {
      coeffs: number;
    };
  };
}

export interface WorkbenchState {
  stack: TransformViewItem[];
  overlay: {
    enabled: boolean;
    mode: ActivationOverlayMode;
    csvName: string | null;
    csvText: string | null;
    flagColor: string;
  };
  comparison: {
    mode: ComparisonMode;
    secondAudioName: string | null;
    offsetSeconds: number;
    trimStartSeconds: number;
    trimDurationSeconds: number;
  };
  metrics: {
    audio: boolean;
    speech: boolean;
    statistical: boolean;
    distributional: boolean;
    classwise: boolean;
    histogramBins: number;
    histogramRangeMin: number;
    histogramRangeMax: number;
  };
  features: {
    power: boolean;
    autocorrelation: boolean;
    shortTimePower: boolean;
    shortTimeAutocorrelation: boolean;
  };
  pca: {
    enabled: boolean;
    goal: PcaGoal;
    classwise: boolean;
    componentSelection: string | null;
  };
  analysis: {
    tool: AnalysisTool;
  };
  multichannel: {
    enabled: boolean;
    splitViewsByChannel: boolean;
    analysisChannelIndex: number;
  };
  transformParams: {
    stft: {
      mode: StftMode;
      windowSize: number;
      overlapPercent: number;
      windowType: StftWindowType;
      maxAnalysisSeconds: number;
      maxFrames: number;
    };
    mel: {
      bands: number;
      minHz: number;
      maxHz: number;
    };
    mfcc: {
      coeffs: number;
    };
    dct: {
      coeffs: number;
    };
  };
}

export function createDefaultWorkbenchState(): WorkbenchState {
  return {
    stack: [
      { id: "view-1", kind: "timeseries", params: {} },
      {
        id: "view-2",
        kind: "stft",
        params: {
          stft: {
            mode: "magnitude",
            windowSize: 512,
            overlapPercent: 75,
            windowType: "hann",
            maxAnalysisSeconds: 20,
            maxFrames: 420
          }
        }
      },
      {
        id: "view-3",
        kind: "mel",
        params: {
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
          }
        }
      }
    ],
    overlay: {
      enabled: false,
      mode: "flag",
      csvName: null,
      csvText: null,
      flagColor: "#ef4444"
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
      histogramBins: 128,
      histogramRangeMin: -1,
      histogramRangeMax: 1
    },
    features: {
      power: true,
      autocorrelation: true,
      shortTimePower: false,
      shortTimeAutocorrelation: false
    },
    pca: {
      enabled: false,
      goal: "eda",
      classwise: false,
      componentSelection: null
    },
    analysis: {
      tool: "random_forest"
    },
    multichannel: {
      enabled: false,
      splitViewsByChannel: true,
      analysisChannelIndex: 0
    },
    transformParams: {
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
    }
  };
}

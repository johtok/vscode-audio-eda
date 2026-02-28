# Roadmap: Audio EDA VS Code Plugin

This roadmap follows your requested priority order exactly.

## Phase 1: Stackable Transform Views (Priority 1)

Goal: build a draggable stacked view container where each row is a selectable transform/view.

Status: `in progress` (baseline implemented in current template; deeper UX polish and settings still pending).

Reference inspiration:

- https://github.com/sukumo28/vscode-audio-preview
- https://marketplace.visualstudio.com/items?itemName=sukumo28.audio-preview

Required transform options:

- `timeseries` (raw audio samples)
- `stft` view
- `mel` transform
- `mfcc`
- `dct`
- `custom_filterbank` (requires CSV weights input)

Delivery slices:

1. Drag-and-drop row ordering (`|||` handle)
2. Transform selector per row
3. Per-row settings panel
4. Persistent layout state

## Phase 2: Activation Overlay CSV (Priority 2)

Goal: add activation overlays on top of stacked views.

Status: `implemented` (CSV parsing/validation + mode-aware rendering + diagnostics in panel).

Modes:

- `flag overlay` CSV columns: `t,flag`
- `timestamped overlay` CSV columns: `flag,t_start,t_end`

Delivery slices:

1. CSV schema validation + parser
2. Mode-aware rendering layer
3. Error diagnostics in panel/output

## Phase 3: Comparison Modes (Priority 3)

Goal: compare primary vs secondary audio in the stack UI.

Status: `in progress` (second clip loading, side-by-side/overlay/difference rendering, and time-offset alignment implemented).

Modes:

- side-by-side
- overlay
- side-by-side with original + difference signal

Delivery slices:

1. second-audio loading/resampling policy
2. alignment controls (time offset, trim)
3. difference-view computation and rendering

## Phase 4: Metrics (Priority 4)

Goal: add metrics tabs/panels:

- audio metrics
- speech metrics
- statistical metrics
- distributional metrics (histograms + moments)

Delivery slices:

1. Python toolbox contract for metrics payloads
2. metric cards + histogram widgets
3. exportable JSON/CSV metrics report

## Phase 5: Feature Set Expansion (Priority 5)

Goal: add classic time-domain and short-time features:

- power
- autocorrelation
- short-time power
- short-time autocorrelation

Delivery slices:

1. feature computations in toolbox
2. feature overlays / panels in extension
3. windowing parameter controls

## Phase 6: PCA Feature View (Priority 6)

Goal: interactive PCA view for audio features with selectable PCA strategy.

From Appendix A, implementation priority:

1. single-channel EDA/classification:
   - PCA on frame x frequency log-mel / log-power matrix
2. denoising mode:
   - lag-embedded PCA/SVD (SSA)
3. multichannel array mode:
   - spatial covariance eigendecomposition per frequency

Delivery slices:

1. PCA mode selector in workbench
2. scree plot + explained variance
3. PC projection scatter/time view

## Phase 7: Multichannel Support (Priority 7)

Goal: every selected view can split per channel while preserving channelwise processing.

Delivery slices:

1. multichannel ingestion contract
2. channel-split rendering layout
3. linked cursors across channels

## Phase 8: Classwise Metrics (Priority 8)

Goal: expose metrics grouped by class label.

Delivery slices:

1. label ingestion strategy
2. per-class aggregate tables
3. class imbalance diagnostics

## Phase 9: Classwise PCA Features (Priority 9)

Goal: PCA diagnostics stratified by class.

Status: `implemented` (overlay-derived active/inactive classwise PCA summaries, per-class explained variance, and separation indicators).

Delivery slices:

1. per-class PCA model option
2. cross-class projection comparison
3. class-separation indicators

## Phase 10: r-Clustering Analytics (Priority 10)

Goal: add representation-aware clustering diagnostics inspired by r-Clustering for robust structure discovery.

Status: `implemented` (toolbox `r-cluster` command + workbench UI runner, diagnostics cards, stability summaries, and cluster browser cards).

Reference:

- https://arxiv.org/html/2305.10457

Delivery slices:

1. r-Clustering backend contract (inputs: feature matrix/embeddings, optional class labels)
2. cluster stability + quality summaries (silhouette-like and representation-aware diagnostics)
3. cluster browser panel (cluster prototypes, intra/inter-cluster distance summaries)

## Phase 11: Symbolic Pattern Forest (Priority 11)

Goal: add symbolic sequence mining/classification diagnostics using Symbolic Pattern Forest concepts.

Status: `in progress` (JS symbolic transform + pattern importance explorer + prototype forest OOB diagnostics added in workbench).

Reference:

- https://www.ijcai.org/proceedings/2019/0406.pdf

Delivery slices:

1. symbolic transform pipeline (windowing, discretization, pattern extraction)
2. pattern-forest training/evaluation hooks for labeled time series
3. pattern importance explorer (top symbolic patterns + per-class support)

## Phase 12: CASTOR Prototype Workflow (Priority 12)

Goal: expose a practical two-class CASTOR prototype workflow from VS Code commands and sidebar actions.

Status: `in progress` (command flow + toolbox integration added; UI embedding/report visuals pending).

Delivery slices:

1. extension command flow to select class A/B folders and optional segment CSVs
2. toolbox execution + JSON logging + run summary notification
3. optional in-workbench visualization/report panel for CASTOR outputs

## Implementation Backbone (Cross-cutting)

- Stable CLI contract with Python toolbox (`inspect`, `summarize`, `metrics`, `features`, `pca`)
- JSON schema versioning and validation in extension
- Cancellable background jobs with progress reporting
- Reproducible export artifacts (JSON + PNG/HTML)

# TODO - audio_eda Repo Roadmap

## Goal

Build a developer-friendly audio ML workspace centered on:

- `Python toolbox` for reproducible audio EDA, preprocessing, and feature extraction
- `VS Code extension` for interactive visualization, dataset browsing, and ML workflow orchestration

## Proposed Repository Shape

- `src/audio_eda/`
  - Current minimal package (can remain as legacy root package or become shared utilities later)
- `subrepos/python-toolbox/`
  - Standalone Python package/repo for audio EDA + ML tasks
- `subrepos/vscode-extension/`
  - Standalone VS Code extension/repo for UX and editor integration

## Architecture Decisions To Finalize

- Python environment strategy: `pixi` vs `uv` vs `poetry` (or dual support)
- Extension-to-Python integration:
  - local subprocess CLI
  - long-running Python service (local HTTP/WebSocket)
  - Jupyter kernel integration
- Visualization stack in extension webviews:
  - pure canvas/SVG
  - `wavesurfer.js`
  - Plotly/ECharts for feature plots
- Audio backend in Python:
  - `librosa` + `soundfile`
  - `torchaudio`
  - optional `ffmpeg` integration

## Cross-Repo MVP (v0.1)

- Open an audio file or folder in VS Code
- Show waveform + spectrogram preview
- Compute basic metadata and stats via Python toolbox
- Run batch dataset summary (duration, sample rate, label distribution)
- Export EDA report (`.json` + `.html` or notebook)
- Support common formats: `wav`, `flac`, `mp3` (best-effort)

## Root Repo TODO

- [ ] Decide if root remains an umbrella repo only, or also ships a shared Python package
- [ ] Add a top-level `CONTRIBUTING.md` with local dev setup for both sub-repos
- [ ] Add workspace tasks (`Makefile` or `justfile`) to run/test both sub-repos
- [ ] Add CI matrix for Python toolbox + extension (lint/test/package checks)
- [ ] Add example datasets (tiny fixtures only) and LFS policy if needed
- [ ] Add docs for reproducible audio feature baselines

## Integration Contracts (Important Early)

- [ ] Define JSON schema for toolbox outputs:
  - file metadata
  - clip-level stats
  - feature summary tables
  - spectrogram/image artifacts
- [ ] Define stable CLI commands used by the extension
- [ ] Define error contract (machine-readable exit codes + JSON errors)
- [ ] Version the contract independently from implementation

## Data/EDA Capabilities Backlog

- [ ] File ingestion and metadata indexing
- [ ] Batch duration/sample-rate/channel statistics
- [ ] Silence ratio / clipping / RMS / peak analysis
- [ ] Spectrogram, mel-spectrogram, MFCC summaries
- [ ] Embeddings (optional, pluggable backends)
- [ ] Class balance and split diagnostics
- [ ] Duplicate / near-duplicate detection
- [ ] Outlier detection on features/embeddings
- [ ] Annotation QA checks (missing labels, bad timestamps, overlap issues)
- [ ] r-Clustering pipeline for representation-aware clustering and stability diagnostics
- [ ] Symbolic Pattern Forest pipeline for labeled time-series pattern mining/classification

## UX / Product Backlog (Extension)

- [ ] Dataset explorer tree view
- [ ] Audio preview player
- [ ] Waveform + spectrogram synchronized cursor
- [ ] Feature panel (stats, tags, warnings)
- [ ] Batch EDA command with progress and cancellation
- [ ] Interactive filtering/sorting of dataset rows
- [ ] "Open in notebook/script" quick actions

## Quality / Ops

- [ ] Unit tests for feature/stat calculations
- [ ] Snapshot tests for report schemas
- [ ] Extension integration tests (command activation + UI smoke)
- [ ] Performance benchmarks for large datasets
- [ ] Graceful handling of missing codecs and corrupted files

## Suggested Milestones

1. `M0`: finalize repo layout + contracts + scaffolding
2. `M1`: Python toolbox CLI for metadata/stats on a folder
3. `M2`: VS Code extension commands calling toolbox CLI
4. `M3`: Waveform/spectrogram webview + file inspector
5. `M4`: Batch EDA report generation + export
6. `M5`: ML-oriented diagnostics (class balance/outliers/embeddings)
7. `M6`: r-Clustering integration (feature export, clustering diagnostics, UI hooks)
8. `M7`: Symbolic Pattern Forest integration (symbolic transform + pattern dashboards)

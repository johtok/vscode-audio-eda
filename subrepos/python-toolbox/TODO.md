# TODO - Python Audio EDA Toolbox

## MVP Scope

- [ ] CLI command to inspect a single audio file
- [ ] CLI command to summarize a dataset folder
- [ ] JSON output schema for metadata + stats
- [ ] Optional CSV export for tabular summaries
- [ ] Basic plots export (PNG/HTML): waveform + spectrogram

## Package Structure

- [ ] `src/audio_eda_toolbox/io.py` (audio loading, format handling)
- [ ] `src/audio_eda_toolbox/metadata.py` (sample rate, duration, channels, codec)
- [ ] `src/audio_eda_toolbox/stats.py` (RMS, peak, clipping, silence ratio)
- [ ] `src/audio_eda_toolbox/features.py` (mel, MFCC, spectral centroid, etc.)
- [ ] `src/audio_eda_toolbox/reporting.py` (JSON/CSV/HTML outputs)
- [ ] `src/audio_eda_toolbox/cli.py` (entrypoints for extension + terminal usage)

## CLI Contract (Draft)

- [ ] `audio-eda inspect <path> --json`
- [ ] `audio-eda summarize <dir> --json`
- [x] `audio-eda r-cluster <features.csv> --k <int> --json`
- [ ] `audio-eda plot <path> --out-dir <dir>`
- [ ] `audio-eda schema` (print JSON schema version)

## Dependency Decisions

- [ ] Choose audio backend (`librosa`/`soundfile` vs `torchaudio`)
- [ ] Decide plotting stack (`matplotlib` vs `plotly`)
- [ ] Decide tabular stack (`pandas` optional?)
- [ ] Keep core dependencies light; push heavy deps behind extras

## ML-Focused EDA Backlog

- [ ] Label distribution + imbalance metrics
- [ ] Train/val/test split diagnostics
- [ ] Embedding extraction plugin interface
- [ ] Outlier scoring on features/embeddings
- [ ] Duplicate clip detection (hash + fuzzy)
- [ ] Annotation timestamp consistency checks

## Reliability / DevEx

- [ ] Tests with small fixture audio files
- [ ] Benchmark on larger folders
- [ ] Typed public APIs
- [ ] Structured logging and machine-readable errors
- [ ] Stable semver contract for extension integration

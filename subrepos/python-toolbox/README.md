# Python Toolbox (Sub-Repo)

Standalone Python toolbox for audio EDA and ML-oriented preprocessing/diagnostics.

Primary responsibilities:

- Audio loading and metadata extraction
- Dataset indexing and summaries
- Feature extraction for EDA (spectral + temporal)
- CLI/API used by the VS Code extension
- Report generation for reproducible analysis

Current CLI additions:

- `audio-eda r-cluster <features.csv> --k 2 --json`
  - Runs representation-aware clustering diagnostics on tabular features.
  - Outputs cluster sizes, silhouette, centroid separation, and resampling stability.
  - Optional `--labels-csv <labels.csv>` adds classwise purity summaries.

See `TODO.md` for the implementation plan.

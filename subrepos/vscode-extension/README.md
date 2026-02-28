# Audio EDA VS Code Extension

Template VS Code extension for audio EDA and ML workflows, aligned with the official "Your First Extension" and "Extension Anatomy" model:

- `package.json` manifest with commands and configuration
- `src/extension.ts` activation + command registration
- `.vscode/launch.json` + `.vscode/tasks.json` for Extension Development Host flow
- webview workbench with draggable stacked transform views and live transform rendering

## Quick Start

1. Install prerequisites listed in `INSTALL.md`.
2. Install dependencies:
   - `npm install`
3. Compile:
   - `npm run compile`
4. Open this folder (`subrepos/vscode-extension`) in VS Code.
5. Press `F5` to launch the Extension Development Host.
6. In the dev host, run:
   - `Audio EDA: Open Workbench`
   - `Audio EDA: Open Transform Lab Preset`
   - `Audio EDA: Open Metrics Preset`
   - `Audio EDA: Open PCA Preset`
   - `Audio EDA: Inspect File`
   - `Audio EDA: Summarize Folder`
   - `Audio EDA: Run CASTOR Prototype (2 Classes)`
7. In the workbench, load a primary audio clip and add/reorder transform rows.
8. In the `Audio EDA` Activity Bar icon, use `Workspace Presets` to launch a preconfigured workspace.
9. When a workspace is opened from an audio file (Explorer context or `Reopen Editor With...`), the audio is preloaded and the primary selector is locked.
10. You can also run `Reopen Editor With...` and choose `Audio EDA Workspace`.
11. For custom filterbank testing, load `examples/custom_filterbank/simple_triangular_6x16.csv` in the `Custom filterbank weights (CSV)` input.

## Template Structure

- `.vscode/launch.json`: debug launch config
- `.vscode/tasks.json`: TypeScript build/watch tasks
- `src/extension.ts`: extension entrypoint
- `src/toolbox/toolboxCli.ts`: Python toolbox process bridge
- `src/workbench/audioWorkbenchPanel.ts`: standalone workbench panel host
- `src/editor/audioEdaCustomEditorProvider.ts`: custom editor (`Reopen Editor With...`)
- `src/sidebar/audioEdaSidebarProvider.ts`: Activity Bar preset workspace list
- `src/workbench/workbenchHtml.ts`: shared workbench HTML for panel + custom editor
- `media/workbench.js`: drag stack interactions + transform compute/render pipeline
- `media/workbench.css`: workbench styling

## Notes

- Target engine is `^1.90.0`, so command contributions auto-activate the extension when invoked.
- Phase-1 roadmap status: implemented baseline for `timeseries`, `stft`, `mel`, `mfcc`, `dct`, and `custom_filterbank` (CSV weights).
- Current transform compute path mixes channels to mono and limits STFT-based analysis to ~20 seconds for responsiveness.
- Per-view interactions now include animated playhead scrollbar, click-to-seek, drag-to-pan, wheel zoom, and zoom reset.
- Spectral views now support a per-view toggleable spectral value bar (color scale).
- STFT view includes both magnitude and phase variants as selectable transform rows (`stft (magnitude)` / `stft (phase)`).
- Metrics formula references and implementation notes are documented in `docs/METRICS_FORMULAE.md`.
- Transform hyperparameters are configurable in-panel: STFT window/overlap/window-type/analysis span/frame cap, mel bands/min-max Hz, MFCC coeffs, and DCT coeffs.
- Comparison modes now render with a decoded second clip: `side_by_side`, `stacked`, `overlay`, `side_by_side_difference`, and `stacked_difference`, plus a configurable second-clip time offset.
- Focusing/opening an audio file can auto-open Audio EDA custom editor (`audioEda.openWorkbenchWhenAudioFileFocused`, default `true`).
- Supported editor selector formats include `wav`, `flac`, `mp3`, `mpga`, `mpeg`, `ogg`, `m4a`, `aac`, `opus`, `sph`.
- Activity bar view menu now includes quick preset launch commands plus auto-open toggle/settings.
- Custom-editor workspace state is persisted per audio file URI, so closing/reopening the editor restores that file's prior layout/settings.
- Activity sidebar now includes a `Recent Workspaces` section (last 5 audio workspaces).

## Inspiration / Reference

- Inspired by `sukumo28/vscode-audio-preview` for in-editor audio preview UX patterns:
  - https://github.com/sukumo28/vscode-audio-preview
  - https://marketplace.visualstudio.com/items?itemName=sukumo28.audio-preview

See `ROADMAP.md` for prioritized feature delivery and `TODO.md` for immediate implementation tasks.

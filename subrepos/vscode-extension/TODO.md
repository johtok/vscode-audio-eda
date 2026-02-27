# TODO - VS Code Audio EDA Extension

Immediate tasks after template generation:

- [x] Base extension manifest and command scaffolding
- [x] Extension Development Host launch/task setup
- [x] Activity Bar sidebar view listing workspace audio files
- [x] Workbench webview with draggable stacked transform rows
- [x] Toolbox CLI bridge (`inspect` / `summarize`)
- [x] `Reopen Editor With...` custom editor integration for audio files
- [x] Activity Bar view menu commands (refresh, toggle auto-open, settings, reopen)
- [x] Wire baseline waveform/STFT/mel/MFCC/DCT/custom-filterbank rendering into stack rows
- [x] Add per-view click/zoom/pan with animated scrollbars and playhead
- [ ] Add CSV parser + schema validation for activation overlay modes
- [ ] Add second-audio comparison mode processing (overlay/side-by-side/difference)
- [ ] Integrate toolbox metrics payloads with metrics panel cards/charts
- [ ] Integrate feature computations (power/autocorrelation + short-time variants)
- [ ] Add PCA backend API and PCA visualization widgets
- [ ] Add channelwise split rendering for multichannel files
- [ ] Add classwise metrics and classwise PCA tabs
- [ ] Add tests for command handlers + state serialization

See `ROADMAP.md` for the full prioritized feature plan.

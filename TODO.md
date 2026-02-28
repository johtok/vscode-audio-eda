# TODO - VS Code Audio EDA Preview Extension

Focus: extension + webview implementation only.
Toolbox/backend tasks are tracked separately in `../python-toolbox/TODO.md`.

## Current Extension Priorities

- [x] Phase 1 polish: keyboard/focus accessibility for stacked rows and drag handle UX
- [x] Phase 3 completion: add explicit second-audio trim/region controls (in addition to offset)
- [x] Phase 11 polish: richer SPF UI for symbolic tree/pattern exploration
- [x] Phase 12 polish: CASTOR panel UX (prototype vector plot + run presets)
- [x] Add unit/integration/behavioral tests for metrics math, export model/CSV serialization, and save-request sanitization
- [ ] Add extension-host tests for command handlers/state persistence using VS Code extension test host
- [ ] Add webview-level smoke tests for critical interactions (open, select audio, run analyses)

## Maintenance

- [x] Keep `ROADMAP.md` status labels aligned with real implementation status
- [x] Keep `README.md` "Quick Start" command list aligned with actual contributed commands

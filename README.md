# Audio EDA Preview

In-editor audio exploration and ML-oriented EDA workspace for VS Code.

This project follows the practical in-editor workflow style of `sukumo28/vscode-audio-preview`, while extending into transform stacks, overlays, metrics, PCA, and analysis tooling.

<p align="center">
  <img src="./media/v1-showcase.gif" alt="Audio EDA Preview workspace demo" width="960" />
</p>

## Features

- Open audio directly in a custom editor: `Reopen Editor With...` -> `Audio EDA Preview Workspace`
- Draggable and keyboard-reorderable stacked views (`Arrow Up/Down`, `Home`, `End`)
- Transform views:
  - `timeseries`
  - `stft (magnitude)`
  - `stft (phase)`
  - `mel`
  - `mfcc`
  - `dct`
  - `tempogram`
  - `fourier_tempogram`
  - `custom_filterbank` (CSV weights)
- Activation overlay CSV support:
  - flag mode: `t,flag`
  - timestamped mode: `flag,t_start,t_end`
- Comparison modes with second clip:
  - `side_by_side`
  - `stacked`
  - `overlay`
  - `side_by_side_difference`
  - `stacked_difference`
  - with offset + trim start/duration
- Metrics panel with JSON/CSV export
- Activity bar preset workspaces + recent workspaces list
- Persistence of custom-editor workspace state per audio file

## Quick Start

1. See prerequisites in `INSTALL.md`.
2. Install dependencies:
   - `npm install`
3. Compile:
   - `npm run compile`
4. Open this repository root in VS Code.
5. Press `F5` to launch Extension Development Host.
6. In the dev host:
   - open an audio file and run `Reopen Editor With...` -> `Audio EDA Preview Workspace`
   - or run `Audio EDA Preview: Open Workbench`

## Commands

- `Audio EDA Preview: Open Workbench`
- `Audio EDA Preview: Open General Workspace Preset`
- `Audio EDA Preview: Open Transform Lab Preset`
- `Audio EDA Preview: Open Metrics Preset`
- `Audio EDA Preview: Open PCA Preset`
- `Audio EDA Preview: Open Workspace For Audio File`
- `Audio EDA Preview: Reopen Active Editor With Audio EDA Preview`
- `Audio EDA Preview: Toggle Auto-Open On Audio Focus`
- `Audio EDA Preview: Open Extension Settings`
- `Audio EDA Preview: Open Workspace From Active File`
- `Audio EDA Preview: Summarize Folder`
- `Audio EDA Preview: Run CASTOR Prototype (2 Classes)`

## Settings

- `audioEda.toolboxPath`
- `audioEda.openWorkbenchOnStart`
- `audioEda.openWorkbenchWhenAudioFileFocused`

## Supported Audio File Patterns

- `wav`, `flac`, `mp3`, `mpga`, `mpeg`, `ogg`, `m4a`, `aac`, `opus`, `sph`

## Testing

- Run all tests:
  - `npm run test`
- Test layers:
  - `tests/unit`
  - `tests/integration`
  - `tests/behavioral`
- Behavioral tests include synthetic signals with known theoretical properties (silence, sine, square, impulse, clipping).

## Project Structure

- `src/extension.ts`: activation and command wiring
- `src/editor/audioEdaCustomEditorProvider.ts`: custom editor provider
- `src/workbench/audioWorkbenchPanel.ts`: standalone workbench panel host
- `src/workbench/workbenchHtml.ts`: shared panel/editor HTML
- `media/workbench.js`: UI logic, transforms, metrics, analysis interactions
- `media/workbench.css`: workbench styles
- `src/analysis/*`: reusable analysis/export core modules
- `tests/*`: test suites

## Inspiration

- https://github.com/sukumo28/vscode-audio-preview
- https://marketplace.visualstudio.com/items?itemName=sukumo28.audio-preview

## AI-Assisted Development Note

This extension was developed with significant AI assistance for implementation, refactoring, and test generation.

See `ROADMAP.md` for prioritized feature delivery and `TODO.md` for current backlog.

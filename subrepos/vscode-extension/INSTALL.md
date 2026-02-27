# Install Guide: Missing Prereqs + Local Setup

This guide converts your summary into a practical setup flow for this repo.

## Current Tool Check (in this workspace)

- Installed:
  - `node` (`v25.2.1`)
  - `npm` (`11.6.2`)
  - `git` (`2.53.0`)
- Missing:
  - `code` CLI
  - `yo` (Yeoman)
  - `generator-code`

## 1) Install/enable missing prerequisites

### VS Code + `code` CLI

1. Install VS Code if needed.
2. Ensure `code` is on PATH.
   - macOS: run `Shell Command: Install 'code' command in PATH` from VS Code Command Palette.
   - Linux/Windows: use the official installer option that adds `code` to PATH.

Verify:

```bash
code --version
```

### Yeoman + VS Code extension generator

```bash
npm install -g yo generator-code
```

Verify:

```bash
yo --version
```

Optional packaging tool:

```bash
npm install -g @vscode/vsce
```

## 2) Install extension dependencies

From this folder (`subrepos/vscode-extension`):

```bash
npm install
```

## 3) Build + run in Extension Development Host

```bash
npm run compile
```

Then in VS Code:

1. Open `subrepos/vscode-extension`.
2. Press `F5` (or run `Debug: Start Debugging`).
3. In the Extension Development Host, run commands from Command Palette:
   - `Audio EDA: Open Workbench`
   - `Audio EDA: Open Workspace From Active File`
   - `Audio EDA: Summarize Folder`
4. Click the `Audio EDA` icon in Activity Bar, then open `Audio EDA Toolkit`.
5. Click an audio file there to open the Audio EDA custom editor preloaded; primary-audio picker is locked.
6. For an already-open audio file tab, use `Reopen Editor With...` and select `Audio EDA Workspace`.

If you do not see the view:

1. Right-click Activity Bar and ensure `Audio EDA` is enabled.
2. Run `View: Open View...` and select `Audio EDA Toolkit`.
3. Ensure a workspace folder is open.
4. Run `Developer: Reload Window` in the Extension Development Host.
5. Fully restart the Extension Development Host after `package.json` contribution changes.

## 4) Fast iteration loop

- Edit TypeScript under `src/`.
- Keep watch mode running:

```bash
npm run watch
```

- In dev host window, run `Developer: Reload Window`.

## 5) Generator path (optional)

If you want a fresh vanilla scaffold in another folder:

```bash
npx --package yo --package generator-code -- yo code
```

Then copy in this repo's audio-specific pieces (`workbench` + toolbox bridge).

## 6) Try Phase-1 Stackable Transforms

Phase-1 implemented transforms:

- `timeseries`
- `stft`
- `mel`
- `mfcc`
- `dct`
- `custom_filterbank` (CSV weights)

### Quick test flow

1. Launch Extension Development Host (`F5`) and run `Audio EDA: Open Workbench`.
2. In the workbench:
   - Choose a primary audio file (`Primary audio clip`).
   - Add rows with `Add View`.
   - Reorder with `|||` drag handle.
   - Change each row transform via dropdown.
   - Click inside a view to seek playback.
   - Mouse wheel on a view to zoom in/out.
   - Drag inside a view to pan horizontally.
   - Drag/click the per-view scrollbar for timeline navigation.
3. For `custom_filterbank`:
   - Load `examples/custom_filterbank_demo.csv`.

### If you need a test WAV file

From `subrepos/vscode-extension`:

```bash
python3 examples/generate_test_tone.py
```

Then load `examples/test_tone.wav` in the workbench.

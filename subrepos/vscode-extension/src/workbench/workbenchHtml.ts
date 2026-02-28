import * as vscode from "vscode";
import * as path from "path";
import { createDefaultWorkbenchState } from "./workbenchState";

export function getWorkbenchLocalResourceRoots(
  extensionUri: vscode.Uri,
  additionalFileUris: readonly vscode.Uri[] = []
): vscode.Uri[] {
  const roots = [vscode.Uri.joinPath(extensionUri, "media")];
  for (const uri of additionalFileUris) {
    if (uri.scheme === "file") {
      roots.push(vscode.Uri.file(path.dirname(uri.fsPath)));
    }
  }

  const seen = new Set<string>();
  return roots.filter((uri) => {
    const key = uri.toString();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function resolveBootstrapState(initialState?: unknown): unknown {
  if (!initialState || typeof initialState !== "object") {
    return createDefaultWorkbenchState();
  }

  return initialState;
}

function serializeBootstrapForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function buildWorkbenchHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  initialState?: unknown
): string {
  const nonce = createNonce();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "workbench.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "workbench.css"));
  const bootstrap = serializeBootstrapForInlineScript(resolveBootstrapState(initialState));

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; media-src ${webview.cspSource} blob:; connect-src ${webview.cspSource};"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Audio EDA Workbench</title>
  </head>
  <body>
    <header class="hero">
      <h1>Audio EDA Workbench</h1>
      <p>Drag to reorder transform/view stack and configure overlays, comparison, and analysis options.</p>
    </header>
    <main class="layout">
      <section class="panel stack-panel">
        <div class="panel-header">
          <h2>Stacked Views</h2>
          <button id="add-transform" type="button">Add View</button>
        </div>
        <div class="media-inputs">
          <label class="row" for="primary-audio-file">Primary audio clip</label>
          <input id="primary-audio-file" type="file" accept=".wav,.flac,.mp3,.mpga,.mpeg,.ogg,.m4a,.aac,.opus,.sph" />
          <input id="primary-audio-file-locked" type="text" readonly disabled hidden />
          <audio id="primary-audio-player" controls preload="metadata"></audio>
          <p id="audio-status" class="hint">Select an audio file to render transforms.</p>
          <p id="audio-lock-status" class="hint"></p>

          <label class="row" for="custom-filterbank-csv">Custom filterbank weights (CSV)</label>
          <input id="custom-filterbank-csv" type="file" accept=".csv" />
          <p id="filterbank-status" class="hint">
            Required for <code>custom_filterbank</code> transform. Rows are filters; columns are weights.
          </p>
        </div>
        <ul id="stack-list" class="stack-list"></ul>
        <p class="hint">Reorder by dragging rows with the <strong>|||</strong> handle.</p>
        <p class="hint">Each row has its own <strong>Settings</strong> panel for transform-specific hyperparameters.</p>
        <div id="transform-render-stack" class="render-stack"></div>

        <section class="metrics-report-panel">
          <div class="panel-header">
            <h2>Metrics Report</h2>
            <div class="metrics-report-actions">
              <button id="metrics-export-json" type="button">Export JSON</button>
              <button id="metrics-export-csv" type="button">Export CSV</button>
            </div>
          </div>
          <p id="metrics-status" class="hint">Load a primary audio clip to compute metrics.</p>
          <div class="metrics-histogram-controls">
            <label class="metrics-histogram-control" for="metrics-histogram-bins">
              Histogram bins
              <input id="metrics-histogram-bins" type="number" min="4" max="512" step="1" />
            </label>
            <label class="metrics-histogram-control" for="metrics-histogram-range-min">
              Histogram min
              <input id="metrics-histogram-range-min" type="number" min="-10" max="10" step="0.001" />
            </label>
            <label class="metrics-histogram-control" for="metrics-histogram-range-max">
              Histogram max
              <input id="metrics-histogram-range-max" type="number" min="-10" max="10" step="0.001" />
            </label>
          </div>
          <div id="metrics-content" class="metrics-content"></div>
          <canvas id="metrics-histogram" class="metrics-histogram" width="720" height="220"></canvas>
        </section>
      </section>

      <section class="panel controls-panel">
        <h2>Overlay Activations (CSV)</h2>
        <label class="row">
          <input id="overlay-enabled" type="checkbox" />
          Enable activation overlay
        </label>
        <label class="row" for="overlay-mode">Mode</label>
        <select id="overlay-mode">
          <option value="flag">Flag overlay</option>
          <option value="timestamped">Timestamped overlay</option>
        </select>
        <label class="row" for="overlay-csv">Activation CSV</label>
        <input id="overlay-csv" type="file" accept=".csv" />
        <label class="row" for="overlay-flag-color">Flag highlight color</label>
        <input id="overlay-flag-color" type="color" value="#ef4444" />
        <p id="overlay-csv-hint" class="hint"></p>

        <h2>Comparison</h2>
        <label class="row" for="comparison-mode">Mode</label>
        <select id="comparison-mode">
          <option value="none">None</option>
          <option value="side_by_side">Side-by-side</option>
          <option value="stacked">Stacked</option>
          <option value="overlay">Overlay</option>
          <option value="side_by_side_difference">Side-by-side + difference</option>
          <option value="stacked_difference">Stacked + difference</option>
        </select>
        <label class="row" for="comparison-audio">Second audio clip</label>
        <input id="comparison-audio" type="file" accept=".wav,.flac,.mp3,.mpga,.mpeg,.ogg,.m4a,.aac,.opus,.sph" />
        <label class="row" for="comparison-offset-seconds">Second clip time offset (s)</label>
        <input id="comparison-offset-seconds" type="number" min="-30" max="30" step="0.01" />
        <p id="comparison-status" class="hint">Load a second clip to enable comparison rendering.</p>

        <h2>Default Transform Hyperparameters</h2>
        <label class="row" for="stft-window-size">STFT window size</label>
        <select id="stft-window-size">
          <option value="128">128</option>
          <option value="256">256</option>
          <option value="512">512</option>
          <option value="1024">1024</option>
          <option value="2048">2048</option>
          <option value="4096">4096</option>
        </select>
        <label class="row" for="stft-overlap-percent">STFT overlap (%)</label>
        <input id="stft-overlap-percent" type="number" min="0" max="95" step="1" />
        <label class="row" for="stft-window-type">STFT window type</label>
        <select id="stft-window-type">
          <option value="hann">Hann</option>
          <option value="hamming">Hamming</option>
          <option value="blackman">Blackman</option>
          <option value="rectangular">Rectangular</option>
        </select>
        <label class="row" for="stft-max-analysis-seconds">STFT max analysis seconds</label>
        <input id="stft-max-analysis-seconds" type="number" min="1" max="600" step="1" />
        <label class="row" for="stft-max-frames">STFT max frames</label>
        <input id="stft-max-frames" type="number" min="32" max="2000" step="1" />

        <label class="row" for="mel-bands">Mel bands</label>
        <input id="mel-bands" type="number" min="8" max="256" step="1" />
        <label class="row" for="mel-min-hz">Mel min frequency (Hz)</label>
        <input id="mel-min-hz" type="number" min="0" max="20000" step="1" />
        <label class="row" for="mel-max-hz">Mel max frequency (Hz)</label>
        <input id="mel-max-hz" type="number" min="1" max="24000" step="1" />

        <label class="row" for="mfcc-coeffs">MFCC coefficients</label>
        <input id="mfcc-coeffs" type="number" min="2" max="128" step="1" />
        <label class="row" for="dct-coeffs">DCT coefficients</label>
        <input id="dct-coeffs" type="number" min="2" max="256" step="1" />

        <h2>Metrics</h2>
        <label class="row"><input id="metric-audio" type="checkbox" /> Audio metrics</label>
        <label class="row"><input id="metric-speech" type="checkbox" /> Speech metrics</label>
        <label class="row"><input id="metric-statistical" type="checkbox" /> Statistical metrics</label>
        <label class="row"><input id="metric-distributional" type="checkbox" /> Distributional info</label>
        <label class="row"><input id="metric-classwise" type="checkbox" /> Classwise metrics</label>

        <h2>Feature Toggles</h2>
        <label class="row"><input id="feature-power" type="checkbox" /> Power</label>
        <label class="row"><input id="feature-autocorrelation" type="checkbox" /> Autocorrelation</label>
        <label class="row"><input id="feature-shorttime-power" type="checkbox" /> Short-time power</label>
        <label class="row">
          <input id="feature-shorttime-autocorrelation" type="checkbox" />
          Short-time autocorrelation
        </label>

        <h2>PCA</h2>
        <label class="row"><input id="pca-enabled" type="checkbox" /> Enable PCA feature view</label>
        <label class="row" for="pca-goal">Goal</label>
        <select id="pca-goal">
          <option value="eda">EDA</option>
          <option value="classification">Classification</option>
          <option value="denoising">Denoising</option>
          <option value="doa_beamforming">DOA / beamforming</option>
          <option value="enhancement">Enhancement</option>
        </select>
        <label class="row"><input id="pca-classwise" type="checkbox" /> Classwise PCA</label>
        <label class="row" for="pca-components">Components (1-based)</label>
        <input
          id="pca-components"
          type="text"
          placeholder="e.g. 1,2,3 or 1-3 (empty = all)"
        />
        <p id="pca-guidance" class="hint"></p>

        <h2>r-Clustering</h2>
        <label class="row" for="rcluster-representation">Feature source</label>
        <select id="rcluster-representation">
          <option value="mel">Short-time mel features</option>
          <option value="stft">Short-time STFT spectrogram features</option>
        </select>
        <p id="rcluster-feature-path" class="hint">
          Features are generated from the current primary audio clip.
        </p>
        <p id="rcluster-labels-path" class="hint">
          Labels are generated from activation overlay intervals (active/inactive classes).
        </p>
        <label class="row" for="rcluster-k">k (clusters)</label>
        <input id="rcluster-k" type="number" min="2" max="64" step="1" value="2" />
        <label class="row" for="rcluster-seed">Random seed</label>
        <input id="rcluster-seed" type="number" min="-2147483648" max="2147483647" step="1" value="0" />
        <label class="row" for="rcluster-max-iter">Max iterations</label>
        <input id="rcluster-max-iter" type="number" min="4" max="512" step="1" value="32" />
        <label class="row" for="rcluster-stability-runs">Stability runs</label>
        <input id="rcluster-stability-runs" type="number" min="1" max="48" step="1" value="6" />
        <label class="row" for="rcluster-row-ratio">Row sampling ratio</label>
        <input id="rcluster-row-ratio" type="number" min="0.1" max="1" step="0.05" value="0.8" />
        <label class="row" for="rcluster-feature-ratio">Feature sampling ratio</label>
        <input id="rcluster-feature-ratio" type="number" min="0.1" max="1" step="0.05" value="0.8" />
        <button id="rcluster-run" type="button">Run r-clustering</button>
        <progress id="rcluster-progress" class="rcluster-progress" max="100" value="0"></progress>
        <p id="rcluster-status" class="hint">Ready to run r-clustering from generated short-time features.</p>
        <div id="rcluster-results" class="rcluster-results"></div>

        <h2>Multichannel</h2>
        <label id="multichannel-enabled-row" class="row"><input id="multichannel-enabled" type="checkbox" /> Enable multichannel mode</label>
        <label id="multichannel-split-row" class="row">
          <input id="multichannel-split" type="checkbox" />
          Split each view by channel
        </label>
        <label id="multichannel-analysis-row" class="row" for="multichannel-analysis-channel">Single-channel analysis source</label>
        <select id="multichannel-analysis-channel"></select>
        <p id="multichannel-note" class="hint"></p>
      </section>
    </main>
    <script nonce="${nonce}">
      window.__AUDIO_EDA_BOOTSTRAP__ = ${bootstrap};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

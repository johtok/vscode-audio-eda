import * as vscode from "vscode";
import { createDefaultWorkbenchState } from "./workbenchState";

export function getWorkbenchLocalResourceRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  return [
    vscode.Uri.joinPath(extensionUri, "media"),
    ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [])
  ];
}

export function buildWorkbenchHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = createNonce();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "workbench.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "workbench.css"));
  const bootstrap = JSON.stringify(createDefaultWorkbenchState());

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
        <p id="overlay-csv-hint" class="hint"></p>

        <h2>Comparison</h2>
        <label class="row" for="comparison-mode">Mode</label>
        <select id="comparison-mode">
          <option value="none">None</option>
          <option value="side_by_side">Side-by-side</option>
          <option value="overlay">Overlay</option>
          <option value="side_by_side_difference">Side-by-side + difference</option>
        </select>
        <label class="row" for="comparison-audio">Second audio clip</label>
        <input id="comparison-audio" type="file" accept=".wav,.flac,.mp3,.mpga,.mpeg,.ogg,.m4a" />

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
        <input id="stft-max-frames" type="number" min="32" max="5000" step="1" />

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
        <p id="pca-guidance" class="hint"></p>

        <h2>Multichannel</h2>
        <label class="row"><input id="multichannel-enabled" type="checkbox" /> Enable multichannel mode</label>
        <label class="row">
          <input id="multichannel-split" type="checkbox" />
          Split each view by channel
        </label>
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

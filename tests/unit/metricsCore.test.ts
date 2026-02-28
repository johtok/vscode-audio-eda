import test from "node:test";
import assert from "node:assert/strict";

import {
  computeAutocorrelation,
  computeBasicWaveformMetrics,
  computePowerSpectrumNaive,
  computeShortTimePower,
  computeSpectralCentroidFromPower
} from "../../src/analysis/metricsCore";
import { assertApproximatelyEqual, assertInRange } from "../helpers/assert";
import { generateSineWave } from "../helpers/audioSignals";

test("computeBasicWaveformMetrics handles empty input", () => {
  const metrics = computeBasicWaveformMetrics([]);
  assert.equal(metrics.rms, 0);
  assert.equal(metrics.peak, 0);
  assert.equal(metrics.silenceRatio, 1);
});

test("computeBasicWaveformMetrics for sine matches theoretical RMS and crest factor", () => {
  const sampleRate = 8000;
  const frequency = 250;
  const amplitude = 0.6;
  const sine = generateSineWave(sampleRate, frequency, 1, amplitude);
  const metrics = computeBasicWaveformMetrics(Array.from(sine), {
    clippingThreshold: 0.99,
    silenceThreshold: 1e-6
  });

  assertApproximatelyEqual(metrics.mean, 0, 5e-3, "sine mean");
  assertApproximatelyEqual(metrics.rms, amplitude / Math.sqrt(2), 1.5e-3, "sine RMS");
  assertApproximatelyEqual(metrics.peak, amplitude, 1e-3, "sine peak");
  assertApproximatelyEqual(metrics.crestFactor, Math.sqrt(2), 1e-2, "sine crest factor");
  assertInRange(metrics.zeroCrossingRate, 0.05, 0.07, "sine zero-crossing rate");
});

test("computeAutocorrelation is normalized with lag 0 at 1", () => {
  const signal = [1, -1, 1, -1, 1, -1, 1, -1];
  const autocorr = computeAutocorrelation(signal, 4);
  assert.equal(autocorr.length, 5);
  assertApproximatelyEqual(autocorr[0], 1, 1e-12, "autocorrelation lag0");
  assert.ok(autocorr[1] < 0, "alternating signal should have negative lag1");
});

test("computeShortTimePower for constant amplitude is constant", () => {
  const signal = new Array(256).fill(0.25);
  const powers = computeShortTimePower(signal, 64, 32);
  assert.ok(powers.length > 0);
  for (let index = 0; index < powers.length; index += 1) {
    assertApproximatelyEqual(powers[index], 0.25 * 0.25, 1e-12, "short-time power");
  }
});

test("computeSpectralCentroidFromPower matches weighted mean frequency", () => {
  const sampleRate = 16000;
  const fftSize = 1024;
  const bins = new Array(32).fill(0);
  bins[3] = 1;
  bins[7] = 3;
  const centroid = computeSpectralCentroidFromPower(bins, sampleRate, fftSize);
  const expectedFreq = ((3 * sampleRate) / fftSize + 3 * ((7 * sampleRate) / fftSize)) / 4;
  assertApproximatelyEqual(centroid, expectedFreq, 1e-8, "weighted centroid");
});

test("computePowerSpectrumNaive detects dominant bin for bin-aligned sine", () => {
  const sampleRate = 1024;
  const n = 256;
  const binIndex = 8;
  const frequency = (binIndex * sampleRate) / n;
  const sine = generateSineWave(sampleRate, frequency, n / sampleRate, 1);
  const spectrum = computePowerSpectrumNaive(Array.from(sine));
  let maxIndex = 0;
  for (let index = 1; index < spectrum.length; index += 1) {
    if (spectrum[index] > spectrum[maxIndex]) {
      maxIndex = index;
    }
  }
  assert.equal(maxIndex, binIndex);
});

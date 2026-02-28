import test from "node:test";
import assert from "node:assert/strict";

import {
  computeBasicWaveformMetrics,
  computePowerSpectrumNaive,
  computeSpectralCentroidFromPower
} from "../../src/analysis/metricsCore";
import { assertApproximatelyEqual, assertInRange } from "../helpers/assert";
import {
  clampSignal,
  generateImpulse,
  generateSilence,
  generateSineWave,
  generateSquareWave
} from "../helpers/audioSignals";

test("behavioral: silence has zero energy and full silence ratio", () => {
  const silence = generateSilence(4096);
  const metrics = computeBasicWaveformMetrics(Array.from(silence));
  assert.equal(metrics.rms, 0);
  assert.equal(metrics.peak, 0);
  assert.equal(metrics.dynamicRangeP95P5, 0);
  assert.equal(metrics.silenceRatio, 1);
  assert.equal(metrics.zeroCrossingRate, 0);
});

test("behavioral: square wave has crest factor near 1 and RMS close to amplitude", () => {
  const square = generateSquareWave(8000, 125, 1, 0.8);
  const metrics = computeBasicWaveformMetrics(Array.from(square));
  assertApproximatelyEqual(metrics.rms, 0.8, 1e-6, "square RMS");
  assertApproximatelyEqual(metrics.peak, 0.8, 1e-6, "square peak");
  assertApproximatelyEqual(metrics.crestFactor, 1, 1e-6, "square crest");
});

test("behavioral: impulse has very high crest factor", () => {
  const impulse = generateImpulse(2048, 50, 1);
  const metrics = computeBasicWaveformMetrics(Array.from(impulse));
  assertApproximatelyEqual(metrics.rms, 1 / Math.sqrt(2048), 1e-12, "impulse RMS");
  assertApproximatelyEqual(metrics.peak, 1, 1e-12, "impulse peak");
  assertApproximatelyEqual(metrics.crestFactor, Math.sqrt(2048), 1e-9, "impulse crest");
});

test("behavioral: clipping rate increases after hard clipping", () => {
  const sine = generateSineWave(16000, 440, 1, 1);
  const unclipped = computeBasicWaveformMetrics(Array.from(sine), { clippingThreshold: 0.95 });
  const clippedSignal = clampSignal(Array.from(sine), 0.6);
  const clipped = computeBasicWaveformMetrics(Array.from(clippedSignal), {
    clippingThreshold: 0.59
  });
  assert.ok(clipped.clippingRate > unclipped.clippingRate);
  assertInRange(clipped.clippingRate, 0.25, 0.75, "clipped ratio expected range");
});

test("behavioral: spectral centroid of pure sine is near tone frequency", () => {
  const sampleRate = 4096;
  const n = 512;
  const toneBin = 24;
  const frequency = (toneBin * sampleRate) / n;
  const sine = generateSineWave(sampleRate, frequency, n / sampleRate, 1);
  const spectrum = computePowerSpectrumNaive(Array.from(sine));
  const centroid = computeSpectralCentroidFromPower(Array.from(spectrum), sampleRate, n);
  assertApproximatelyEqual(centroid, frequency, sampleRate / n, "sine centroid");
});

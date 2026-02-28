import test from "node:test";
import assert from "node:assert/strict";

import { computeBasicWaveformMetrics } from "../../src/analysis/metricsCore";
import { buildMetricsCsv, buildMetricsExportModel } from "../../src/analysis/metricsExport";
import { generateSineWave } from "../helpers/audioSignals";

function parseCsvRows(csv: string): string[][] {
  return csv
    .trim()
    .split("\n")
    .map((line) => line.split(","));
}

test("integration: synthetic audio metrics -> export model -> CSV", () => {
  const sampleRate = 8000;
  const sine = generateSineWave(sampleRate, 440, 1, 0.5);
  const metrics = computeBasicWaveformMetrics(Array.from(sine));

  const report: Record<string, unknown> = {
    generatedAt: "2026-02-28T00:00:00.000Z",
    fileName: "synthetic-sine.wav",
    sampleCount: sine.length,
    audio: {
      durationSeconds: sine.length / sampleRate,
      rms: metrics.rms,
      peak: metrics.peak,
      crestFactor: metrics.crestFactor
    },
    temporal: {
      zeroCrossingRate: metrics.zeroCrossingRate
    },
    spectral: {
      centroidHz: 440
    },
    spectrogramFeatures: {
      nBands: 40
    },
    modulation: {
      dominantHz: 4
    },
    spatial: {
      channelCount: 1
    },
    standards: {
      lufsApprox: -17
    },
    speech: {
      voicedRatio: 1
    },
    statistical: {
      variance: metrics.variance
    },
    distributional: {
      p95MinusP5: metrics.dynamicRangeP95P5
    },
    classwise: {
      available: false
    },
    availability: {
      classwise: "no labels"
    },
    features: {
      power: { mean: metrics.rms * metrics.rms },
      autocorrelation: { lag1: 0.9 },
      shortTimePower: { mean: metrics.rms * metrics.rms },
      shortTimeAutocorrelation: { lag1: 0.8 }
    }
  };

  const exportModel = buildMetricsExportModel(report, {
    audio: true,
    speech: true,
    statistical: true,
    distributional: true,
    classwise: true,
    power: true,
    autocorrelation: true,
    shortTimePower: true,
    shortTimeAutocorrelation: true
  });

  const csv = buildMetricsCsv(exportModel);
  const rows = parseCsvRows(csv);
  assert.ok(rows.length > 10, "expected multiple CSV rows");
  assert.equal(rows[0][0], "section");
  assert.equal(rows[0][1], "metric");
  assert.equal(rows[0][2], "value");
  assert.ok(csv.includes("audio,rms"));
  assert.ok(csv.includes("features,power.mean"));
  assert.ok(csv.includes("statistical,variance"));
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMetricsCsv,
  buildMetricsExportModel,
  escapeCsvField,
  flattenExportSection
} from "../../src/analysis/metricsExport";

function createMockReport(): Record<string, unknown> {
  return {
    generatedAt: "2026-02-28T00:00:00.000Z",
    fileName: "sine.wav",
    sampleCount: 8000,
    audio: { durationSeconds: 1, rms: 0.7071 },
    temporal: { zeroCrossingRate: 0.1 },
    spectral: { centroidHz: 440 },
    spectrogramFeatures: { bands: 40 },
    modulation: { peakHz: 4 },
    spatial: { channelCount: 1 },
    standards: { lufs: -16 },
    speech: { voicedRatio: 0.8 },
    statistical: { skewness: 0.0 },
    distributional: { histogram: { bins: 128 } },
    classwise: { available: true, classes: 2 },
    availability: { classwise: "missing labels" },
    features: {
      power: { mean: 0.5 },
      autocorrelation: { lag1: 0.3 },
      shortTimePower: { mean: 0.2 },
      shortTimeAutocorrelation: { lag1: 0.1 }
    }
  };
}

test("escapeCsvField quotes commas, quotes, and newlines", () => {
  assert.equal(escapeCsvField("plain"), "plain");
  assert.equal(escapeCsvField("a,b"), "\"a,b\"");
  assert.equal(escapeCsvField("a\"b"), "\"a\"\"b\"");
  assert.equal(escapeCsvField("a\nb"), "\"a\nb\"");
});

test("flattenExportSection flattens nested values", () => {
  const rows: string[][] = [];
  flattenExportSection(rows, "root", { a: 1, b: { c: 2 }, d: [3, 4] }, "", 100);
  const metrics = rows.map((row) => row[1]);
  assert.ok(metrics.includes("a"));
  assert.ok(metrics.includes("b.c"));
  assert.ok(metrics.includes("d.0"));
  assert.ok(metrics.includes("d.1"));
});

test("buildMetricsExportModel respects selection toggles", () => {
  const report = createMockReport();
  const model = buildMetricsExportModel(report, {
    audio: true,
    speech: false,
    statistical: true,
    distributional: false,
    classwise: false,
    power: true,
    autocorrelation: false,
    shortTimePower: false,
    shortTimeAutocorrelation: true
  });

  assert.ok("audio" in model.sections);
  assert.ok("statistical" in model.sections);
  assert.ok(!("speech" in model.sections));
  assert.ok(!("distributional" in model.sections));
  const features = model.sections.features as Record<string, unknown>;
  assert.ok("power" in features);
  assert.ok("shortTimeAutocorrelation" in features);
  assert.ok(!("autocorrelation" in features));
});

test("buildMetricsCsv emits section/metric/value rows", () => {
  const report = createMockReport();
  const model = buildMetricsExportModel(report, {
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
  const csv = buildMetricsCsv(model, 10000);
  assert.ok(csv.startsWith("section,metric,value\n"));
  assert.ok(csv.includes("audio,durationSeconds,1"));
  assert.ok(csv.includes("spectral,centroidHz,440"));
  assert.ok(csv.includes("features,power.mean,0.5"));
});

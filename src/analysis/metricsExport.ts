export interface MetricsFeatureSelection {
  power: boolean;
  autocorrelation: boolean;
  shortTimePower: boolean;
  shortTimeAutocorrelation: boolean;
}

export interface MetricsSectionSelection {
  audio: boolean;
  speech: boolean;
  statistical: boolean;
  distributional: boolean;
  classwise: boolean;
}

export interface MetricsExportSelection extends MetricsFeatureSelection, MetricsSectionSelection {}

export interface MetricsExportModel {
  generatedAt: unknown;
  fileName: unknown;
  sampleCount: unknown;
  sections: Record<string, unknown>;
}

export function escapeCsvField(value: unknown): string {
  const text = String(value ?? "");
  if (text.indexOf(",") === -1 && text.indexOf("\"") === -1 && text.indexOf("\n") === -1) {
    return text;
  }
  return `"${text.replace(/"/g, "\"\"")}"`;
}

export function buildMetricsExportModel(
  report: Record<string, unknown>,
  selection: MetricsExportSelection
): MetricsExportModel {
  const output: MetricsExportModel = {
    generatedAt: report.generatedAt,
    fileName: report.fileName,
    sampleCount: report.sampleCount,
    sections: {}
  };

  if (selection.audio) {
    output.sections.audio = report.audio;
    output.sections.temporal = report.temporal;
    output.sections.spectral = report.spectral;
    output.sections.spectrogramFeatures = report.spectrogramFeatures;
    output.sections.modulation = report.modulation;
    output.sections.spatial = report.spatial;
    output.sections.standards = report.standards;
  }
  if (selection.speech) {
    output.sections.speech = report.speech;
  }
  if (selection.statistical) {
    output.sections.statistical = report.statistical;
  }
  if (selection.distributional) {
    output.sections.distributional = report.distributional;
  }
  if (selection.classwise) {
    output.sections.classwise = report.classwise ?? {
      available: false,
      reason: asRecord(report.availability)?.classwise
    };
  }

  const selectedFeatures: Record<string, unknown> = {};
  if (selection.power) {
    selectedFeatures.power = asRecord(report.features)?.power;
  }
  if (selection.autocorrelation) {
    selectedFeatures.autocorrelation = asRecord(report.features)?.autocorrelation;
  }
  if (selection.shortTimePower) {
    selectedFeatures.shortTimePower = asRecord(report.features)?.shortTimePower;
  }
  if (selection.shortTimeAutocorrelation) {
    selectedFeatures.shortTimeAutocorrelation = asRecord(report.features)?.shortTimeAutocorrelation;
  }
  if (Object.keys(selectedFeatures).length > 0) {
    output.sections.features = selectedFeatures;
  }

  return output;
}

export function buildMetricsCsv(
  exportModel: MetricsExportModel,
  maxRows = 200_000
): string {
  const rows: string[][] = [["section", "metric", "value"]];
  const sections = exportModel.sections ?? {};
  const sectionNames = Object.keys(sections);
  for (let index = 0; index < sectionNames.length && rows.length < maxRows; index += 1) {
    const sectionName = sectionNames[index];
    flattenExportSection(rows, sectionName, sections[sectionName], "", maxRows);
  }

  return rows
    .map((row) => row.map(escapeCsvField).join(","))
    .join("\n");
}

export function flattenExportSection(
  rows: string[][],
  sectionName: string,
  value: unknown,
  prefix: string,
  maxRows: number
): void {
  const labelPrefix = prefix ? `${prefix}.` : "";
  if (rows.length >= maxRows) {
    return;
  }

  if (value === null || value === undefined) {
    rows.push([sectionName, labelPrefix.replace(/\.$/, ""), ""]);
    return;
  }

  if (typeof value !== "object") {
    rows.push([sectionName, labelPrefix.replace(/\.$/, ""), String(value)]);
    return;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length && rows.length < maxRows; index += 1) {
      flattenExportSection(rows, sectionName, value[index], `${labelPrefix}${index}`, maxRows);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    rows.push([sectionName, labelPrefix.replace(/\.$/, ""), String(value)]);
    return;
  }

  const keys = Object.keys(record);
  for (let index = 0; index < keys.length && rows.length < maxRows; index += 1) {
    const key = keys[index];
    flattenExportSection(rows, sectionName, record[key], `${labelPrefix}${key}`, maxRows);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

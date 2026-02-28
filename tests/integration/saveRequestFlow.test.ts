import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExportFilters,
  parseSaveTextFileRequest
} from "../../src/workbench/saveTextFile";

test("integration: save request parsing + filter resolution for JSON export", () => {
  const parsed = parseSaveTextFileRequest({
    requestId: "save-1",
    fileName: "metrics-results.json",
    mimeType: "application/json",
    content: "{\"ok\":true}"
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const filters = buildExportFilters(parsed.value.fileName, parsed.value.mimeType);
  assert.deepEqual(filters, { JSON: ["json"] });
});

test("integration: save request parsing + filter resolution for CSV export", () => {
  const parsed = parseSaveTextFileRequest({
    requestId: "save-2",
    fileName: "metrics-results.csv",
    mimeType: "text/csv",
    content: "section,metric,value\naudio,rms,0.1"
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const filters = buildExportFilters(parsed.value.fileName, parsed.value.mimeType);
  assert.deepEqual(filters, { CSV: ["csv"] });
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_EXPORT_TEXT_BYTES,
  buildExportFilters,
  parseSaveTextFileRequest,
  sanitizeExportFileName
} from "../../src/workbench/saveTextFile";

test("sanitizeExportFileName strips path and invalid characters", () => {
  const sanitized = sanitizeExportFileName("../metrics:report?.json");
  assert.equal(sanitized, "metrics_report_.json");
});

test("buildExportFilters resolves JSON and CSV", () => {
  assert.deepEqual(buildExportFilters("file.json", "application/json"), { JSON: ["json"] });
  assert.deepEqual(buildExportFilters("file.csv", "text/csv"), { CSV: ["csv"] });
  assert.equal(buildExportFilters("file.txt", "text/plain"), undefined);
});

test("parseSaveTextFileRequest accepts valid payload", () => {
  const result = parseSaveTextFileRequest({
    requestId: "req-1",
    fileName: "metrics.json",
    mimeType: "application/json",
    content: "{\"a\":1}"
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.requestId, "req-1");
  assert.equal(result.value.fileName, "metrics.json");
  assert.equal(result.value.mimeType, "application/json");
  assert.equal(result.value.content, "{\"a\":1}");
  assert.ok(result.value.byteSize > 0);
});

test("parseSaveTextFileRequest rejects missing request id and oversize content", () => {
  const missing = parseSaveTextFileRequest({
    fileName: "metrics.csv",
    mimeType: "text/csv",
    content: "a,b\n1,2"
  });
  assert.equal(missing.ok, false);

  const tooLarge = parseSaveTextFileRequest({
    requestId: "req-2",
    fileName: "x.csv",
    mimeType: "text/csv",
    content: "x".repeat(MAX_EXPORT_TEXT_BYTES + 1)
  });
  assert.equal(tooLarge.ok, false);
});

export const MAX_EXPORT_TEXT_BYTES = 16 * 1024 * 1024;
export const MAX_EXPORT_FILE_NAME_CHARS = 180;
export const MAX_EXPORT_MIME_CHARS = 128;
export const MAX_EXPORT_REQUEST_ID_CHARS = 128;

export interface ParsedSaveTextFileRequest {
  requestId: string;
  fileName: string;
  mimeType: string;
  content: string;
  byteSize: number;
}

interface ParseResultOk {
  ok: true;
  value: ParsedSaveTextFileRequest;
}

interface ParseResultErr {
  ok: false;
  error: string;
}

export type SaveTextFileParseResult = ParseResultOk | ParseResultErr;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function sanitizeNullableText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxChars) {
    return trimmed.slice(0, maxChars);
  }
  return trimmed;
}

export function sanitizeExportFileName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  const basename = trimmed.split(/[\\/]/).pop() ?? "";
  const cleaned = basename
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "");

  return cleaned.slice(0, MAX_EXPORT_FILE_NAME_CHARS);
}

export function buildExportFilters(
  fileName: string,
  mimeType: string
): Record<string, string[]> | undefined {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (lowerName.endsWith(".json") || lowerMime.includes("json")) {
    return { JSON: ["json"] };
  }
  if (lowerName.endsWith(".csv") || lowerMime.includes("csv")) {
    return { CSV: ["csv"] };
  }
  return undefined;
}

export function parseSaveTextFileRequest(rawPayload: unknown): SaveTextFileParseResult {
  const payload = asRecord(rawPayload);
  if (!payload) {
    return { ok: false, error: "Invalid export payload." };
  }

  const requestId = sanitizeNullableText(payload.requestId, MAX_EXPORT_REQUEST_ID_CHARS);
  if (!requestId) {
    return { ok: false, error: "Missing request id." };
  }

  const fileNameRaw = sanitizeNullableText(payload.fileName, MAX_EXPORT_FILE_NAME_CHARS);
  const content = typeof payload.content === "string" ? payload.content : null;
  const mimeType =
    sanitizeNullableText(payload.mimeType, MAX_EXPORT_MIME_CHARS) ?? "text/plain";

  if (!fileNameRaw || !content) {
    return { ok: false, error: "Invalid export payload." };
  }

  const fileName = sanitizeExportFileName(fileNameRaw);
  if (!fileName) {
    return { ok: false, error: "Invalid export file name." };
  }

  const byteSize = Buffer.byteLength(content, "utf8");
  if (byteSize > MAX_EXPORT_TEXT_BYTES) {
    return {
      ok: false,
      error: `Export content too large (${byteSize} bytes).`
    };
  }

  return {
    ok: true,
    value: {
      requestId,
      fileName,
      mimeType,
      content,
      byteSize
    }
  };
}

export const FILE_PREVIEW_MAX_BYTES = 1_048_576;
export const FILE_PREVIEW_MAX_WORKSPACE_ROOT_BYTES = 4_096;
export const FILE_PREVIEW_MAX_RELATIVE_PATH_BYTES = 4_096;

export type FilePreview =
  | {
      readonly kind: "text";
      readonly relativePath: string;
      readonly contents: string;
      readonly byteLength: number;
      readonly truncated: boolean;
    }
  | { readonly kind: "binary"; readonly relativePath: string; readonly byteLength: number }
  | { readonly kind: "image"; readonly relativePath: string; readonly byteLength: number };

export interface FilePreviewRequest {
  readonly workspaceRoot: string;
  readonly relativePath: string;
}

export class FilePreviewContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilePreviewContractError";
  }
}

const utf8Encoder = new TextEncoder();

export function parseFilePreviewRequest(
  workspaceRoot: unknown,
  relativePath: unknown,
): FilePreviewRequest {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.startsWith("/")) {
    return invalid("workspaceRoot", "an absolute path");
  }
  if (workspaceRoot.includes("\0")) return invalid("workspaceRoot", "a path without NUL");
  boundedUtf8(workspaceRoot, "workspaceRoot", FILE_PREVIEW_MAX_WORKSPACE_ROOT_BYTES);
  if (typeof relativePath !== "string" || !isWorkspaceRelativePath(relativePath)) {
    return invalid("relativePath", "a normalized workspace-relative file path");
  }
  boundedUtf8(relativePath, "relativePath", FILE_PREVIEW_MAX_RELATIVE_PATH_BYTES);
  return { workspaceRoot, relativePath };
}

export function parseFilePreviewPayload(value: unknown, expectedRelativePath: string): FilePreview {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("result", "an object");
  }
  const payload = value as Readonly<Record<string, unknown>>;
  if (payload.relativePath !== expectedRelativePath) {
    return invalid("result.relativePath", "the requested relative path");
  }
  const kind = payload.kind;
  switch (kind) {
    case "text":
      return parseTextPreview(payload, expectedRelativePath);
    case "binary":
      exactKeys(payload, ["kind", "relativePath", "byteLength"]);
      return {
        kind: "binary",
        relativePath: expectedRelativePath,
        byteLength: byteLength(payload.byteLength),
      };
    default:
      return invalid("result.kind", '"text" or "binary"');
  }
}

function parseTextPreview(
  payload: Readonly<Record<string, unknown>>,
  relativePath: string,
): FilePreview {
  exactKeys(payload, ["kind", "relativePath", "contents", "byteLength", "truncated"]);
  const length = byteLength(payload.byteLength);
  const { contents, truncated } = payload;
  if (typeof contents !== "string") return invalid("result.contents", "a string");
  if (typeof truncated !== "boolean") return invalid("result.truncated", "a boolean");
  if (contents.length > FILE_PREVIEW_MAX_BYTES) {
    return invalid("result.contents", `at most ${FILE_PREVIEW_MAX_BYTES} bytes`);
  }
  const contentBytes = utf8Encoder.encode(contents).byteLength;
  if (truncated && (length <= FILE_PREVIEW_MAX_BYTES || !isTruncatedSize(contentBytes))) {
    return invalid("result.truncated", "set only for a preview cut at the size limit");
  }
  if (!truncated && contentBytes !== length) {
    return invalid("result.contents", "exactly byteLength UTF-8 bytes");
  }
  return { kind: "text", relativePath, contents, byteLength: length, truncated };
}

function isTruncatedSize(contentBytes: number): boolean {
  return contentBytes <= FILE_PREVIEW_MAX_BYTES && contentBytes > FILE_PREVIEW_MAX_BYTES - 4;
}

function byteLength(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalid("result.byteLength", "a non-negative safe integer");
  }
  return value;
}

function exactKeys(payload: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const actual = Object.keys(payload);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    invalid("result", `exactly the fields ${keys.join(", ")}`);
  }
}

function isWorkspaceRelativePath(value: string): boolean {
  if (value.length === 0 || value.includes("\0")) return false;
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function boundedUtf8(value: string, label: string, maxBytes: number): void {
  if (utf8Encoder.encode(value).byteLength > maxBytes) {
    invalid(label, `at most ${maxBytes} UTF-8 bytes`);
  }
}

function invalid(label: string, expected: string): never {
  throw new FilePreviewContractError(`workspace_read_file_preview ${label} must be ${expected}.`);
}

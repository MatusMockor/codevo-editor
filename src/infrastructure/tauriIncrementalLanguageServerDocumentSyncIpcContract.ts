import {
  boundedUtf8Length,
  MAX_LANGUAGE_SERVER_DOCUMENT_VERSION,
  type LanguageServerDocumentChangeEnvelope,
} from "../domain/incrementalDocumentSync";
import type {
  BoundedLanguageServerDidChangeRequest,
  BoundedLanguageServerDidCloseRequest,
  BoundedLanguageServerDidOpenReceipt,
  BoundedLanguageServerDidOpenRequest,
  BoundedLanguageServerDocumentAuthority,
  BoundedLanguageServerDocumentIdentityAuthority,
  BoundedLanguageServerDocumentSyncReceipt,
  JavaScriptTypeScriptDocumentLanguageId,
} from "../domain/incrementalLanguageServerDocumentSync";
import { isWellFormedUnicode } from "../domain/unicodeText";
import { createWorkspaceRootFromPath, parseWorkspacePath } from "../domain/workspacePath";

export const MAX_BOUNDED_DOCUMENT_SYNC_CHANGE_COUNT = 256;
export const MAX_BOUNDED_DOCUMENT_SYNC_CHANGE_TEXT_BYTES = 256 * 1024;
export const MAX_BOUNDED_DOCUMENT_SYNC_BATCH_BYTES = 512 * 1024;
export const MAX_BOUNDED_DOCUMENT_SYNC_FULL_UTF16_UNITS = 2 * 1024 * 1024;
export const MAX_BOUNDED_DOCUMENT_SYNC_FULL_UTF8_BYTES = 6 * 1024 * 1024;
export const MAX_BOUNDED_DOCUMENT_SYNC_PATH_BYTES = 4_096;
export const MAX_BOUNDED_DOCUMENT_SYNC_TOKEN_BYTES = 4_096;

const DOCUMENT_LANGUAGE_IDS = Object.freeze([
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
] as const);

const RECEIPT_KINDS = Object.freeze([
  "admitted",
  "busy",
  "notOpen",
  "staleAuthority",
  "staleSession",
  "staleVersion",
] as const);

const DID_OPEN_FAILURE_RECEIPT_KINDS = Object.freeze([
  "busy",
  "staleAuthority",
  "staleSession",
  "staleVersion",
] as const);

export function encodeBoundedLanguageServerDidOpenRequest(
  value: BoundedLanguageServerDidOpenRequest,
): BoundedLanguageServerDidOpenRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "authority",
      "expectedSessionId",
      "languageId",
      "path",
      "predecessorLifecycleToken",
      "rootPath",
      "text",
      "version",
    ])
  ) {
    throw invalidRequest("didOpen", "request fields are malformed");
  }
  const rootPath = boundedRootPath(value.rootPath, "didOpen");
  const path = boundedWorkspacePath(rootPath, value.path, "didOpen");
  const text = boundedFullText(value.text, "didOpen");
  const languageId = documentLanguageId(value.languageId, "didOpen");
  return Object.freeze({
    authority: encodeIdentityAuthority(value.authority, "didOpen"),
    expectedSessionId: positiveSafeInteger(value.expectedSessionId, "expectedSessionId", "didOpen"),
    languageId,
    path,
    predecessorLifecycleToken: nullableBoundedToken(
      value.predecessorLifecycleToken,
      "predecessorLifecycleToken",
      "didOpen",
    ),
    rootPath,
    text,
    version: lspVersion(value.version, "version", "didOpen"),
  });
}

export function encodeBoundedLanguageServerDidChangeRequest(
  value: BoundedLanguageServerDidChangeRequest,
): BoundedLanguageServerDidChangeRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["authority", "change", "expectedSessionId", "rootPath"])
  ) {
    throw invalidRequest("didChange", "request fields are malformed");
  }
  const rootPath = boundedRootPath(value.rootPath, "didChange");
  return Object.freeze({
    authority: encodeAuthority(value.authority, "didChange"),
    change: encodeChange(value.change, rootPath),
    expectedSessionId: positiveSafeInteger(
      value.expectedSessionId,
      "expectedSessionId",
      "didChange",
    ),
    rootPath,
  });
}

export function encodeBoundedLanguageServerDidCloseRequest(
  value: BoundedLanguageServerDidCloseRequest,
): BoundedLanguageServerDidCloseRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["authority", "expectedSessionId", "path", "rootPath", "version"])
  ) {
    throw invalidRequest("didClose", "request fields are malformed");
  }
  const rootPath = boundedRootPath(value.rootPath, "didClose");
  return Object.freeze({
    authority: encodeAuthority(value.authority, "didClose"),
    expectedSessionId: positiveSafeInteger(
      value.expectedSessionId,
      "expectedSessionId",
      "didClose",
    ),
    path: boundedWorkspacePath(rootPath, value.path, "didClose"),
    rootPath,
    version: lspVersion(value.version, "version", "didClose"),
  });
}

export function decodeBoundedDocumentSyncReceipt(
  value: unknown,
): BoundedLanguageServerDocumentSyncReceipt {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["kind"]) ||
    !RECEIPT_KINDS.includes(value.kind as (typeof RECEIPT_KINDS)[number])
  ) {
    throw new TypeError(
      "Invalid bounded language-server document-sync IPC response: malformed receipt.",
    );
  }
  return Object.freeze({
    kind: value.kind as BoundedLanguageServerDocumentSyncReceipt["kind"],
  }) as BoundedLanguageServerDocumentSyncReceipt;
}

export function decodeBoundedDidOpenReceipt(value: unknown): BoundedLanguageServerDidOpenReceipt {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw malformedReceipt();
  }
  if (value.kind === "admitted") {
    if (!exactKeys(value, ["kind", "lifecycleToken"])) {
      throw malformedReceipt();
    }
    return Object.freeze({
      kind: "admitted",
      lifecycleToken: boundedResponseToken(value.lifecycleToken),
    });
  }
  if (
    !exactKeys(value, ["kind"]) ||
    !DID_OPEN_FAILURE_RECEIPT_KINDS.includes(
      value.kind as (typeof DID_OPEN_FAILURE_RECEIPT_KINDS)[number],
    )
  ) {
    throw malformedReceipt();
  }
  return Object.freeze({
    kind: value.kind as Exclude<
      BoundedLanguageServerDidOpenReceipt,
      { readonly kind: "admitted" }
    >["kind"],
  });
}

function encodeAuthority(
  value: unknown,
  operation: DocumentSyncOperation,
): BoundedLanguageServerDocumentAuthority {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "documentIncarnation",
      "lifecycleToken",
      "modelIncarnation",
      "ownerGeneration",
      "ownerIncarnation",
      "ownerKey",
      "syncGeneration",
    ])
  ) {
    throw invalidRequest(operation, "authority fields are malformed");
  }
  return Object.freeze({
    documentIncarnation: boundedToken(value.documentIncarnation, "documentIncarnation", operation),
    lifecycleToken: boundedToken(value.lifecycleToken, "lifecycleToken", operation),
    modelIncarnation: boundedToken(value.modelIncarnation, "modelIncarnation", operation),
    ownerGeneration: positiveSafeInteger(value.ownerGeneration, "ownerGeneration", operation),
    ownerIncarnation: boundedToken(value.ownerIncarnation, "ownerIncarnation", operation),
    ownerKey: boundedToken(value.ownerKey, "ownerKey", operation),
    syncGeneration: positiveSafeInteger(value.syncGeneration, "syncGeneration", operation),
  });
}

function encodeIdentityAuthority(
  value: unknown,
  operation: DocumentSyncOperation,
): BoundedLanguageServerDocumentIdentityAuthority {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "documentIncarnation",
      "modelIncarnation",
      "ownerGeneration",
      "ownerIncarnation",
      "ownerKey",
      "syncGeneration",
    ])
  ) {
    throw invalidRequest(operation, "authority fields are malformed");
  }
  return Object.freeze({
    documentIncarnation: boundedToken(value.documentIncarnation, "documentIncarnation", operation),
    modelIncarnation: boundedToken(value.modelIncarnation, "modelIncarnation", operation),
    ownerGeneration: positiveSafeInteger(value.ownerGeneration, "ownerGeneration", operation),
    ownerIncarnation: boundedToken(value.ownerIncarnation, "ownerIncarnation", operation),
    ownerKey: boundedToken(value.ownerKey, "ownerKey", operation),
    syncGeneration: positiveSafeInteger(value.syncGeneration, "syncGeneration", operation),
  });
}

function encodeChange(value: unknown, rootPath: string): LanguageServerDocumentChangeEnvelope {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw invalidRequest("didChange", "change must be a tagged object");
  }
  const path = boundedWorkspacePath(rootPath, value.path, "didChange");
  const version = lspVersion(value.version, "change.version", "didChange");

  if (value.kind === "full") {
    if (!exactKeys(value, ["kind", "path", "text", "version"])) {
      throw invalidRequest("didChange", "full change fields are malformed");
    }
    return Object.freeze({
      kind: "full",
      path,
      text: boundedFullText(value.text, "didChange"),
      version,
    });
  }

  if (
    value.kind !== "incremental" ||
    !exactKeys(value, ["changes", "kind", "path", "version"]) ||
    !Array.isArray(value.changes) ||
    value.changes.length === 0 ||
    value.changes.length > MAX_BOUNDED_DOCUMENT_SYNC_CHANGE_COUNT
  ) {
    throw invalidRequest("didChange", "incremental change fields or count are malformed");
  }
  let aggregateBytes = 0;
  const changes = value.changes.map((change, index) => {
    const encoded = encodeRangedChange(change, index);
    const measured = boundedUtf8Length(
      encoded.text,
      MAX_BOUNDED_DOCUMENT_SYNC_BATCH_BYTES - aggregateBytes,
    );
    if (measured.status === "limit-exceeded") {
      throw invalidRequest("didChange", "incremental changes exceed their aggregate byte limit");
    }
    aggregateBytes += measured.bytes;
    return encoded;
  });
  return Object.freeze({
    changes: Object.freeze(changes),
    kind: "incremental",
    path,
    version,
  });
}

function encodeRangedChange(value: unknown, index: number) {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["kind", "range", "rangeLength", "text"]) ||
    value.kind !== "incremental" ||
    typeof value.text !== "string" ||
    !isWellFormedUnicode(value.text) ||
    boundedUtf8Length(value.text, MAX_BOUNDED_DOCUMENT_SYNC_CHANGE_TEXT_BYTES).status ===
      "limit-exceeded"
  ) {
    throw invalidRequest("didChange", `change.changes[${index}] is malformed or oversized`);
  }
  const rangeLength = lspInteger(
    value.rangeLength,
    `change.changes[${index}].rangeLength`,
    "didChange",
  );
  if (!isRecord(value.range) || !exactKeys(value.range, ["end", "start"])) {
    throw invalidRequest("didChange", `change.changes[${index}].range is malformed`);
  }
  const start = encodePosition(value.range.start, `change.changes[${index}].range.start`);
  const end = encodePosition(value.range.end, `change.changes[${index}].range.end`);
  if (end.line < start.line || (end.line === start.line && end.character < start.character)) {
    throw invalidRequest("didChange", `change.changes[${index}].range is reversed`);
  }
  return Object.freeze({
    kind: "incremental" as const,
    range: Object.freeze({ end, start }),
    rangeLength,
    text: value.text,
  });
}

function encodePosition(value: unknown, field: string) {
  if (!isRecord(value) || !exactKeys(value, ["character", "line"])) {
    throw invalidRequest("didChange", `${field} is malformed`);
  }
  return Object.freeze({
    character: lspInteger(value.character, `${field}.character`, "didChange"),
    line: lspInteger(value.line, `${field}.line`, "didChange"),
  });
}

function boundedRootPath(value: unknown, operation: DocumentSyncOperation): string {
  const rootPath = boundedPath(value, "rootPath", operation);
  if (!createWorkspaceRootFromPath(rootPath).ok) {
    throw invalidRequest(operation, "rootPath is not an absolute workspace root");
  }
  return rootPath;
}

function boundedWorkspacePath(
  rootPath: string,
  value: unknown,
  operation: DocumentSyncOperation,
): string {
  const path = boundedPath(value, "path", operation);
  const root = createWorkspaceRootFromPath(rootPath);
  if (!root.ok || !parseWorkspacePath(root.value, path).ok) {
    throw invalidRequest(operation, "path is outside rootPath");
  }
  return path;
}

function boundedFullText(value: unknown, operation: DocumentSyncOperation): string {
  if (
    typeof value !== "string" ||
    !isWellFormedUnicode(value) ||
    value.length > MAX_BOUNDED_DOCUMENT_SYNC_FULL_UTF16_UNITS ||
    boundedUtf8Length(value, MAX_BOUNDED_DOCUMENT_SYNC_FULL_UTF8_BYTES).status === "limit-exceeded"
  ) {
    throw invalidRequest(operation, "full text exceeds its bounded size");
  }
  return value;
}

function boundedPath(value: unknown, field: string, operation: DocumentSyncOperation): string {
  if (
    typeof value !== "string" ||
    !isWellFormedUnicode(value) ||
    value.length === 0 ||
    value.includes("\0") ||
    boundedUtf8Length(value, MAX_BOUNDED_DOCUMENT_SYNC_PATH_BYTES).status === "limit-exceeded"
  ) {
    throw invalidRequest(operation, `${field} is not a valid bounded path`);
  }
  return value;
}

function boundedToken(value: unknown, field: string, operation: DocumentSyncOperation): string {
  if (
    typeof value !== "string" ||
    !isWellFormedUnicode(value) ||
    value.length === 0 ||
    value.includes("\0") ||
    boundedUtf8Length(value, MAX_BOUNDED_DOCUMENT_SYNC_TOKEN_BYTES).status === "limit-exceeded"
  ) {
    throw invalidRequest(operation, `${field} is not a valid bounded token`);
  }
  return value;
}

function nullableBoundedToken(
  value: unknown,
  field: string,
  operation: DocumentSyncOperation,
): string | null {
  return value === null ? null : boundedToken(value, field, operation);
}

function boundedResponseToken(value: unknown): string {
  if (
    typeof value !== "string" ||
    !isWellFormedUnicode(value) ||
    value.length === 0 ||
    value.includes("\0") ||
    boundedUtf8Length(value, MAX_BOUNDED_DOCUMENT_SYNC_TOKEN_BYTES).status === "limit-exceeded"
  ) {
    throw malformedReceipt();
  }
  return value;
}

function documentLanguageId(
  value: unknown,
  operation: DocumentSyncOperation,
): JavaScriptTypeScriptDocumentLanguageId {
  if (
    typeof value !== "string" ||
    !DOCUMENT_LANGUAGE_IDS.includes(value as JavaScriptTypeScriptDocumentLanguageId)
  ) {
    throw invalidRequest(operation, "languageId is unsupported");
  }
  return value as JavaScriptTypeScriptDocumentLanguageId;
}

function positiveSafeInteger(
  value: unknown,
  field: string,
  operation: DocumentSyncOperation,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw invalidRequest(operation, `${field} must be a positive safe integer`);
  }
  return value;
}

function lspVersion(value: unknown, field: string, operation: DocumentSyncOperation): number {
  const encoded = positiveSafeInteger(value, field, operation);
  if (encoded > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION) {
    throw invalidRequest(operation, `${field} exceeds the supported LSP integer range`);
  }
  return encoded;
}

function lspInteger(value: unknown, field: string, operation: DocumentSyncOperation): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION
  ) {
    throw invalidRequest(operation, `${field} is outside the supported LSP integer range`);
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type DocumentSyncOperation = "didChange" | "didClose" | "didOpen";

function invalidRequest(operation: DocumentSyncOperation, reason: string): TypeError {
  return new TypeError(`Invalid bounded language-server ${operation} request: ${reason}.`);
}

function malformedReceipt(): TypeError {
  return new TypeError(
    "Invalid bounded language-server document-sync IPC response: malformed receipt.",
  );
}

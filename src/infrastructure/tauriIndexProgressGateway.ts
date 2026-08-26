import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  IndexProgressEvent,
  IndexProgressGateway,
  InitialMetadataScanStart,
  MetadataScanReport,
  MetadataScanCompletionEvent,
  UnsubscribeFn,
  WorkspaceIndexMutationRequest,
  WorkspaceIndexOperationRequest,
  WorkspaceIndexClearResult,
  WorkspaceReindexMode,
} from "../domain/indexProgress";

const METADATA_SCAN_COMPLETED_EVENT = "index://metadata-scan-completed";
const INDEX_PROGRESS_EVENT = "index://progress";
const DESKTOP_RUNTIME_REQUIRED = "Indexing requires the Tauri desktop runtime.";
const MAX_OPERATION_GENERATION = 4_294_967_295;

type InvokeIndexCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type InvokeClearIndexCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type ListenToIndexEvent = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<UnsubscribeFn>;
type ListenToProgressEvent = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<UnsubscribeFn>;
type RuntimeDetector = () => boolean;

const invokeIndexCommand: InvokeIndexCommand = (command, args) => invoke<unknown>(command, args);
const invokeClearIndexCommand: InvokeClearIndexCommand = (command, args) =>
  invoke<unknown>(command, args);
const listenToIndexEvent: ListenToIndexEvent = (event, handler) => listen<unknown>(event, handler);
const listenToProgressEvent: ListenToProgressEvent = (event, handler) =>
  listen<unknown>(event, handler);

export class TauriIndexProgressGateway implements IndexProgressGateway {
  constructor(
    private readonly invokeCommand: InvokeIndexCommand = invokeIndexCommand,
    private readonly listenToEvent: ListenToIndexEvent = listenToIndexEvent,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    private readonly invokeClearCommand: InvokeClearIndexCommand = invokeClearIndexCommand,
    private readonly listenToProgress: ListenToProgressEvent = listenToProgressEvent,
  ) {}

  async clearWorkspaceIndex(
    request: WorkspaceIndexMutationRequest,
  ): Promise<WorkspaceIndexClearResult> {
    if (!this.isRuntimeAvailable()) {
      throw new Error(DESKTOP_RUNTIME_REQUIRED);
    }

    assertMutationRequest(request);
    const response = await this.invokeClearCommand("clear_workspace_index", {
      request,
    });
    return parseWorkspaceIndexClearResult(response);
  }

  async startInitialMetadataScan(
    request: WorkspaceIndexOperationRequest,
  ): Promise<InitialMetadataScanStart> {
    if (!this.isRuntimeAvailable()) {
      throw new Error(DESKTOP_RUNTIME_REQUIRED);
    }

    assertOperationRequest(request);
    const response = await this.invokeCommand("start_initial_metadata_scan", {
      request,
    });
    return matchingInitialMetadataScanStart(response, request.operationGeneration);
  }

  async startReindex(
    operation: WorkspaceIndexOperationRequest,
    mode: WorkspaceReindexMode,
    language?: string,
  ): Promise<InitialMetadataScanStart> {
    if (!this.isRuntimeAvailable()) {
      throw new Error(DESKTOP_RUNTIME_REQUIRED);
    }

    assertOperationRequest(operation);
    if (mode !== "hard" && mode !== "language" && mode !== "soft") {
      throw invalidPayload();
    }
    if (mode === "language" && !isIndexLanguage(language)) {
      throw invalidPayload();
    }
    if (mode !== "language" && language !== undefined) {
      throw invalidPayload();
    }

    const request: Record<string, unknown> = {
      admissionToken: operation.admissionToken,
      mode,
      operationGeneration: operation.operationGeneration,
      rootPath: operation.rootPath,
      workspaceId: operation.workspaceId,
    };
    if (language !== undefined) {
      request.language = boundedString(language, 64);
    }

    const response = await this.invokeCommand("start_workspace_reindex", {
      request,
    });
    return matchingInitialMetadataScanStart(response, operation.operationGeneration);
  }

  subscribeIndexProgress(listener: (event: IndexProgressEvent) => void): Promise<UnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(() => undefined);
    }

    return this.listenToProgress(INDEX_PROGRESS_EVENT, (event) => {
      const decoded = decodeOrNull(parseIndexProgressEvent, event.payload);
      if (decoded === null) {
        return;
      }

      listener(decoded);
    });
  }

  subscribeMetadataScanCompletion(
    listener: (event: MetadataScanCompletionEvent) => void,
  ): Promise<UnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(() => undefined);
    }

    return this.listenToEvent(METADATA_SCAN_COMPLETED_EVENT, (event) => {
      const decoded = decodeOrNull(parseMetadataScanCompletionEvent, event.payload);
      if (decoded === null) {
        return;
      }

      listener(decoded);
    });
  }
}

function isIndexLanguage(value: string | undefined): value is "javascript" | "php" | "typescript" {
  return value === "javascript" || value === "php" || value === "typescript";
}

function parseWorkspaceIndexClearResult(value: unknown): WorkspaceIndexClearResult {
  const record = exactRecord(value, ["databasePath", "rootPath", "status"]);
  if (record.status !== "cleared") {
    throw invalidPayload();
  }

  return {
    databasePath: requiredString(record.databasePath),
    rootPath: boundedString(record.rootPath, 32_768),
    status: record.status,
  };
}

function parseInitialMetadataScanStart(value: unknown): InitialMetadataScanStart {
  const record = exactRecord(value, ["databasePath", "operationGeneration", "rootPath", "status"]);
  if (record.status !== "started") {
    throw invalidPayload();
  }

  return {
    databasePath: requiredString(record.databasePath),
    operationGeneration: operationGeneration(record.operationGeneration),
    rootPath: boundedString(record.rootPath, 32_768),
    status: record.status,
  };
}

function matchingInitialMetadataScanStart(
  value: unknown,
  operationGeneration: number,
): InitialMetadataScanStart {
  const start = parseInitialMetadataScanStart(value);
  if (start.operationGeneration !== operationGeneration) {
    throw invalidPayload();
  }

  return start;
}

function parseIndexProgressEvent(value: unknown): IndexProgressEvent {
  const record = exactRecord(value, [
    "operationGeneration",
    "phase",
    "processedFiles",
    "rootPath",
    "totalFiles",
  ]);
  return {
    operationGeneration: operationGeneration(record.operationGeneration),
    phase: indexProgressPhase(record.phase),
    processedFiles: nonnegativeInteger(record.processedFiles),
    rootPath: boundedString(record.rootPath, 32_768),
    totalFiles: record.totalFiles === null ? null : nonnegativeInteger(record.totalFiles),
  };
}

function parseMetadataScanCompletionEvent(value: unknown): MetadataScanCompletionEvent {
  const record = exactRecord(value, [
    "databasePath",
    "message",
    "operationGeneration",
    "report",
    "rootPath",
    "status",
  ]);
  if (record.status !== "completed" && record.status !== "failed") {
    throw invalidPayload();
  }

  const message = nullableString(record.message);
  const report = record.report === null ? null : parseMetadataScanReport(record.report);
  if (record.status === "completed" && (message !== null || report === null)) {
    throw invalidPayload();
  }
  if (record.status === "failed" && (message === null || report !== null)) {
    throw invalidPayload();
  }

  const base = {
    databasePath: requiredString(record.databasePath),
    operationGeneration: operationGeneration(record.operationGeneration),
    rootPath: boundedString(record.rootPath, 32_768),
  };
  if (record.status === "completed" && report !== null) {
    return { ...base, message: null, report, status: "completed" };
  }
  if (record.status === "failed" && message !== null) {
    return { ...base, message, report: null, status: "failed" };
  }
  throw invalidPayload();
}

function parseMetadataScanReport(value: unknown): MetadataScanReport {
  const record = exactRecord(value, [
    "changedFiles",
    "errorDetails",
    "erroredEntries",
    "indexedFiles",
    "parsedFiles",
    "removedFiles",
    "skippedDetails",
    "skippedEntries",
    "symbolsIndexed",
  ]);
  return {
    changedFiles: nonnegativeInteger(record.changedFiles),
    errorDetails: healthDetails(record.errorDetails),
    erroredEntries: nonnegativeInteger(record.erroredEntries),
    indexedFiles: nonnegativeInteger(record.indexedFiles),
    parsedFiles: nonnegativeInteger(record.parsedFiles),
    removedFiles: nonnegativeInteger(record.removedFiles),
    skippedDetails: healthDetails(record.skippedDetails),
    skippedEntries: nonnegativeInteger(record.skippedEntries),
    symbolsIndexed: nonnegativeInteger(record.symbolsIndexed),
  };
}

function healthDetails(value: unknown): Array<{ path: string; reason: string }> {
  if (!Array.isArray(value) || value.length > 100) {
    throw invalidPayload();
  }

  return value.map((detail) => {
    const record = exactRecord(detail, ["path", "reason"]);
    return {
      path: requiredString(record.path),
      reason: requiredString(record.reason),
    };
  });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidPayload();
  }

  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = [...keys].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw invalidPayload();
  }

  return record;
}

function operationGeneration(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_OPERATION_GENERATION
  ) {
    throw invalidPayload();
  }

  return value;
}

function indexProgressPhase(value: unknown): "parsing" | "scanning" {
  if (value !== "parsing" && value !== "scanning") {
    throw invalidPayload();
  }

  return value;
}

function assertOperationGeneration(value: number): void {
  operationGeneration(value);
}

function assertOperationRequest(request: WorkspaceIndexOperationRequest): void {
  const record = exactRecord(request, [
    "admissionToken",
    "operationGeneration",
    "rootPath",
    "workspaceId",
  ]);
  assertMutationFields(record);
  assertOperationGeneration(request.operationGeneration);
}

function assertMutationRequest(request: WorkspaceIndexMutationRequest): void {
  const record = exactRecord(request, ["admissionToken", "rootPath", "workspaceId"]);
  assertMutationFields(record);
}

function assertMutationFields(record: Record<string, unknown>): void {
  if (!Number.isSafeInteger(record.admissionToken) || (record.admissionToken as number) < 1) {
    throw invalidPayload();
  }

  boundedString(record.rootPath, 32_768);
  boundedString(record.workspaceId, 1_024);
}

function nonnegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidPayload();
  }

  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  return requiredString(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    throw invalidPayload();
  }

  return value;
}

function boundedString(value: unknown, maxUtf8Bytes: number): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidPayload();
  }
  const text = value;
  if (text.includes("\0") || new TextEncoder().encode(text).byteLength > maxUtf8Bytes) {
    throw invalidPayload();
  }

  return text;
}

function invalidPayload(): Error {
  return new Error("Invalid index progress payload.");
}

function decodeOrNull<T>(decode: (value: unknown) => T, value: unknown): T | null {
  try {
    return decode(value);
  } catch {
    return null;
  }
}

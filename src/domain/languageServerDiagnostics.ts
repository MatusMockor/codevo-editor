import { normalizedWorkspaceRootKey } from "./workspaceRootKey";

export type LanguageServerDiagnosticSeverity = "error" | "warning" | "information" | "hint";
export type LanguageServerDiagnosticNoticeSeverity = "info" | "warning" | "error";

export interface LanguageServerDiagnostic {
  code?: string | number | null;
  codeDescriptionHref?: string | null;
  data?: unknown;
  message: string;
  severity: LanguageServerDiagnosticSeverity;
  source: string | null;
  tags?: number[];
  relatedInformation?: LanguageServerDiagnosticRelatedInformation[];
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
}

export interface LanguageServerDiagnosticRelatedInformation {
  uri: string;
  message: string;
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
}

export interface LanguageServerDiagnosticEvent {
  rootPath: string;
  sessionId: number;
  uri: string;
  version: number | null;
  diagnostics: LanguageServerDiagnostic[];
  /**
   * Present on every event decoded from the native gateway. Optional only for
   * trusted in-process diagnostic producers that do not cross the IPC boundary.
   */
  projection?: LanguageServerDiagnosticsProjectionReceipt;
}

export interface LanguageServerDiagnosticWireEvent extends LanguageServerDiagnosticEvent {
  projection: LanguageServerDiagnosticsProjectionReceipt;
}

const boundedLanguageServerDiagnosticEvent = Symbol("boundedLanguageServerDiagnosticEvent");

export interface BoundedLanguageServerDiagnosticEvent extends LanguageServerDiagnosticWireEvent {
  readonly [boundedLanguageServerDiagnosticEvent]: true;
  projection: BoundedLanguageServerDiagnosticsProjectionReceipt;
}

export function isBoundedLanguageServerDiagnosticEvent(
  event: LanguageServerDiagnosticEvent,
): event is BoundedLanguageServerDiagnosticEvent {
  return (
    (event as Partial<BoundedLanguageServerDiagnosticEvent>)[
      boundedLanguageServerDiagnosticEvent
    ] === true
  );
}

export const MAX_LANGUAGE_SERVER_DIAGNOSTICS = 2_000;
export const MAX_LANGUAGE_SERVER_DIAGNOSTICS_UTF8_BYTES = 2 * 1_024 * 1_024;
export const MAX_LANGUAGE_SERVER_DIAGNOSTIC_MESSAGE_UTF8_BYTES = 8 * 1_024;
export const MAX_LANGUAGE_SERVER_DIAGNOSTIC_SHORT_FIELD_UTF8_BYTES = 512;
export const MAX_LANGUAGE_SERVER_DIAGNOSTIC_URI_UTF8_BYTES = 16 * 1_024;
export const MAX_LANGUAGE_SERVER_DIAGNOSTIC_DATA_UTF8_BYTES = 16 * 1_024;
export const MAX_LANGUAGE_SERVER_DIAGNOSTIC_DATA_DEPTH = 16;
export const MAX_LANGUAGE_SERVER_DIAGNOSTIC_DATA_NODES = 1_024;
export const MAX_LANGUAGE_SERVER_DIAGNOSTIC_DATA_CONTAINER_ITEMS = 256;
export const MAX_LANGUAGE_SERVER_DIAGNOSTIC_RELATED_INFORMATION = 16;
export const MAX_LANGUAGE_SERVER_DIAGNOSTIC_TAGS = 2;
export const MAX_LANGUAGE_SERVER_DIAGNOSTIC_POSITION = 2_147_483_647;
export const MAX_LANGUAGE_SERVER_JAVASCRIPT_SAFE_INTEGER = 9_007_199_254_740_991;
export const LANGUAGE_SERVER_DIAGNOSTIC_TAG_VALUES = [1, 2] as const;

export type LanguageServerDiagnosticsProjectionReason =
  | "itemLimit"
  | "byteLimit"
  | "fieldLimit"
  | "dataDepthLimit"
  | "relatedInformationLimit"
  | "authorityNodeLimit"
  | "pathProbeLimit";

export interface LanguageServerDiagnosticsSeverityCounts {
  error: number;
  warning: number;
  information: number;
  hint: number;
}

interface LanguageServerDiagnosticsProjectionReceiptBase {
  /**
   * Native serde_json byte count reported by Rust. It is bounded metadata, not
   * a JavaScript memory-admission metric because numeric spellings differ.
   */
  publishedCount: number;
  retainedCount: number;
  severityCounts: LanguageServerDiagnosticsSeverityCounts;
  retainedUtf8Bytes: number;
}

export interface CompleteLanguageServerDiagnosticsProjectionReceipt extends LanguageServerDiagnosticsProjectionReceiptBase {
  kind: "complete";
}

export interface TruncatedLanguageServerDiagnosticsProjectionReceipt extends LanguageServerDiagnosticsProjectionReceiptBase {
  kind: "truncated";
  omittedCount: number;
  reasons: LanguageServerDiagnosticsProjectionReason[];
  sanitizedFieldCount: number;
}

export type LanguageServerDiagnosticsProjectionReceipt =
  | CompleteLanguageServerDiagnosticsProjectionReceipt
  | TruncatedLanguageServerDiagnosticsProjectionReceipt;

export type BoundedLanguageServerDiagnosticsProjectionReceipt =
  LanguageServerDiagnosticsProjectionReceipt & {
    decodedUtf8Bytes: number;
  };

export type DiagnosticsUnsubscribeFn = () => void;

export interface LanguageServerDiagnosticsGateway {
  subscribeDiagnostics(
    listener: (event: LanguageServerDiagnosticEvent) => void,
  ): Promise<DiagnosticsUnsubscribeFn>;
}

const EVENT_KEYS = [
  "rootPath",
  "sessionId",
  "uri",
  "version",
  "diagnostics",
  "projection",
] as const;
const DIAGNOSTIC_REQUIRED_KEYS = [
  "code",
  "codeDescriptionHref",
  "message",
  "severity",
  "source",
  "tags",
  "relatedInformation",
  "line",
  "character",
  "endLine",
  "endCharacter",
] as const;
const DIAGNOSTIC_OPTIONAL_KEYS = ["data"] as const;
const RELATED_INFORMATION_REQUIRED_KEYS = [
  "uri",
  "message",
  "line",
  "character",
  "endLine",
  "endCharacter",
] as const;
const RELATED_INFORMATION_OPTIONAL_KEYS = [] as const;
const PROJECTION_BASE_KEYS = [
  "kind",
  "publishedCount",
  "retainedCount",
  "severityCounts",
  "retainedUtf8Bytes",
] as const;
const PROJECTION_TRUNCATED_KEYS = [
  ...PROJECTION_BASE_KEYS,
  "omittedCount",
  "reasons",
  "sanitizedFieldCount",
] as const;
const SEVERITY_KEYS = ["error", "warning", "information", "hint"] as const;
export const LANGUAGE_SERVER_DIAGNOSTICS_PROJECTION_REASONS = [
  "itemLimit",
  "byteLimit",
  "fieldLimit",
  "dataDepthLimit",
  "relatedInformationLimit",
  "authorityNodeLimit",
  "pathProbeLimit",
] as const satisfies readonly LanguageServerDiagnosticsProjectionReason[];

export const LANGUAGE_SERVER_DIAGNOSTICS_CONTRACT_MANIFEST = {
  schemaVersion: 1,
  javascriptSafeInteger: MAX_LANGUAGE_SERVER_JAVASCRIPT_SAFE_INTEGER,
  maxDiagnostics: MAX_LANGUAGE_SERVER_DIAGNOSTICS,
  maxDiagnosticsUtf8Bytes: MAX_LANGUAGE_SERVER_DIAGNOSTICS_UTF8_BYTES,
  authority: {
    dataNodes: 32_768,
    filesystemProbes: 256,
    pathCacheEntries: 2_048,
    pathCacheUtf8Bytes: 1_024 * 1_024,
  },
  diagnostic: {
    messageUtf8Bytes: MAX_LANGUAGE_SERVER_DIAGNOSTIC_MESSAGE_UTF8_BYTES,
    shortFieldUtf8Bytes: MAX_LANGUAGE_SERVER_DIAGNOSTIC_SHORT_FIELD_UTF8_BYTES,
    uriHrefUtf8Bytes: MAX_LANGUAGE_SERVER_DIAGNOSTIC_URI_UTF8_BYTES,
    dataUtf8Bytes: MAX_LANGUAGE_SERVER_DIAGNOSTIC_DATA_UTF8_BYTES,
    dataDepth: MAX_LANGUAGE_SERVER_DIAGNOSTIC_DATA_DEPTH,
    dataNodes: MAX_LANGUAGE_SERVER_DIAGNOSTIC_DATA_NODES,
    dataContainerItems: MAX_LANGUAGE_SERVER_DIAGNOSTIC_DATA_CONTAINER_ITEMS,
    relatedInformation: MAX_LANGUAGE_SERVER_DIAGNOSTIC_RELATED_INFORMATION,
    tags: MAX_LANGUAGE_SERVER_DIAGNOSTIC_TAGS,
    tagValues: LANGUAGE_SERVER_DIAGNOSTIC_TAG_VALUES,
    position: MAX_LANGUAGE_SERVER_DIAGNOSTIC_POSITION,
  },
  reasons: LANGUAGE_SERVER_DIAGNOSTICS_PROJECTION_REASONS,
  wire: {
    eventKeys: EVENT_KEYS,
    diagnosticRequiredKeys: DIAGNOSTIC_REQUIRED_KEYS,
    diagnosticOptionalKeys: DIAGNOSTIC_OPTIONAL_KEYS,
    relatedInformationRequiredKeys: RELATED_INFORMATION_REQUIRED_KEYS,
    relatedInformationOptionalKeys: RELATED_INFORMATION_OPTIONAL_KEYS,
    completeProjectionKeys: PROJECTION_BASE_KEYS,
    truncatedProjectionKeys: PROJECTION_TRUNCATED_KEYS,
    severityKeys: SEVERITY_KEYS,
    projectionKinds: ["complete", "truncated"],
    severityCountsAuthority: "published",
    retainedUtf8BytesAuthority: "nativeSerde",
    decodedUtf8BytesAuthority: "typescriptDecoder",
    publishedEqualsRetainedPlusOmitted: true,
    rangesAreNonNegative: true,
    rangeEndNotBeforeStart: true,
    javascriptSafeIntegerFields: ["sessionId", "version", "diagnostic.code"],
    sessionIdPositive: true,
  },
} as const;
const UTF8_ENCODER = new TextEncoder();

/**
 * Closes the untrusted Tauri event boundary. Invalid publications return `null`
 * so callers retain the last authoritative diagnostics instead of mistaking a
 * malformed payload for an empty publication.
 */
export function decodeLanguageServerDiagnosticEvent(
  value: unknown,
): BoundedLanguageServerDiagnosticEvent | null {
  if (!isRecord(value) || !hasExactKeys(value, EVENT_KEYS)) return null;
  if (!isBoundedNonEmptyString(value.rootPath, MAX_LANGUAGE_SERVER_DIAGNOSTIC_URI_UTF8_BYTES)) {
    return null;
  }
  if (!isPositiveSafeInteger(value.sessionId)) return null;
  if (!isBoundedAbsoluteUri(value.uri, MAX_LANGUAGE_SERVER_DIAGNOSTIC_URI_UTF8_BYTES)) {
    return null;
  }
  if (value.version !== null && !isSafeNumber(value.version)) return null;
  if (
    !Array.isArray(value.diagnostics) ||
    value.diagnostics.length > MAX_LANGUAGE_SERVER_DIAGNOSTICS
  ) {
    return null;
  }
  const inboundDiagnosticsUtf8Bytes = jsonUtf8Bytes(value.diagnostics);
  if (
    inboundDiagnosticsUtf8Bytes === null ||
    inboundDiagnosticsUtf8Bytes > MAX_LANGUAGE_SERVER_DIAGNOSTICS_UTF8_BYTES
  ) {
    return null;
  }

  const diagnostics: LanguageServerDiagnostic[] = [];
  for (const candidate of value.diagnostics) {
    const diagnostic = decodeDiagnostic(candidate);
    if (!diagnostic) return null;
    diagnostics.push(diagnostic);
  }

  // Every accepted diagnostic has an exact closed key set and decoding only
  // clones its validated JSON values. Reordering object keys cannot change the
  // serialized byte length, so the bounded inbound measurement also covers the
  // returned closed projection without a second whole-array serialization.
  const projection = decodeProjectionReceipt(
    value.projection,
    diagnostics,
    inboundDiagnosticsUtf8Bytes,
  );
  if (!projection) return null;

  const decodedEvent = {
    rootPath: value.rootPath,
    sessionId: value.sessionId,
    uri: value.uri,
    version: value.version,
    diagnostics,
    projection,
  } as BoundedLanguageServerDiagnosticEvent;
  Object.defineProperty(decodedEvent, boundedLanguageServerDiagnosticEvent, {
    value: true,
  });
  return decodedEvent;
}

function decodeDiagnostic(value: unknown): LanguageServerDiagnostic | null {
  if (
    !isRecord(value) ||
    !hasRequiredAndOptionalKeys(value, DIAGNOSTIC_REQUIRED_KEYS, DIAGNOSTIC_OPTIONAL_KEYS) ||
    !isBoundedString(value.message, MAX_LANGUAGE_SERVER_DIAGNOSTIC_MESSAGE_UTF8_BYTES) ||
    !isDiagnosticSeverity(value.severity) ||
    !(
      value.source === null ||
      isBoundedString(value.source, MAX_LANGUAGE_SERVER_DIAGNOSTIC_SHORT_FIELD_UTF8_BYTES)
    ) ||
    !isDiagnosticPosition(value.line) ||
    !isDiagnosticPosition(value.character) ||
    !isOptionalDiagnosticPosition(value.endLine) ||
    !isOptionalDiagnosticPosition(value.endCharacter) ||
    !isOrderedRange(value.line, value.character, value.endLine, value.endCharacter)
  ) {
    return null;
  }

  if (
    hasOwn(value, "code") &&
    !(
      value.code === null ||
      isSafeNumber(value.code) ||
      isBoundedString(value.code, MAX_LANGUAGE_SERVER_DIAGNOSTIC_SHORT_FIELD_UTF8_BYTES)
    )
  ) {
    return null;
  }
  if (
    hasOwn(value, "codeDescriptionHref") &&
    !(
      value.codeDescriptionHref === null ||
      isBoundedAbsoluteUri(value.codeDescriptionHref, MAX_LANGUAGE_SERVER_DIAGNOSTIC_URI_UTF8_BYTES)
    )
  ) {
    return null;
  }
  const decodedData = hasOwn(value, "data")
    ? decodeBoundedJsonValue(
        value.data,
        MAX_LANGUAGE_SERVER_DIAGNOSTIC_DATA_DEPTH,
        MAX_LANGUAGE_SERVER_DIAGNOSTIC_DATA_UTF8_BYTES,
      )
    : undefined;
  if (hasOwn(value, "data") && !decodedData) return null;
  if (hasOwn(value, "tags") && !isDiagnosticTags(value.tags)) return null;

  let relatedInformation: LanguageServerDiagnosticRelatedInformation[] | undefined;
  if (hasOwn(value, "relatedInformation")) {
    if (
      !Array.isArray(value.relatedInformation) ||
      value.relatedInformation.length > MAX_LANGUAGE_SERVER_DIAGNOSTIC_RELATED_INFORMATION
    ) {
      return null;
    }
    relatedInformation = [];
    for (const candidate of value.relatedInformation) {
      const related = decodeRelatedInformation(candidate);
      if (!related) return null;
      relatedInformation.push(related);
    }
  }

  return {
    ...(hasOwn(value, "code") ? { code: value.code as string | number | null } : {}),
    ...(hasOwn(value, "codeDescriptionHref")
      ? { codeDescriptionHref: value.codeDescriptionHref as string | null }
      : {}),
    ...(decodedData ? { data: decodedData.value } : {}),
    message: value.message,
    severity: value.severity,
    source: value.source,
    ...(hasOwn(value, "tags") ? { tags: [...(value.tags as number[])] } : {}),
    ...(relatedInformation ? { relatedInformation } : {}),
    line: value.line,
    character: value.character,
    ...(hasOwn(value, "endLine") ? { endLine: value.endLine as number } : {}),
    ...(hasOwn(value, "endCharacter") ? { endCharacter: value.endCharacter as number } : {}),
  };
}

function decodeRelatedInformation(
  value: unknown,
): LanguageServerDiagnosticRelatedInformation | null {
  if (
    !isRecord(value) ||
    !hasRequiredAndOptionalKeys(
      value,
      RELATED_INFORMATION_REQUIRED_KEYS,
      RELATED_INFORMATION_OPTIONAL_KEYS,
    ) ||
    !isBoundedAbsoluteUri(value.uri, MAX_LANGUAGE_SERVER_DIAGNOSTIC_URI_UTF8_BYTES) ||
    !isBoundedString(value.message, MAX_LANGUAGE_SERVER_DIAGNOSTIC_MESSAGE_UTF8_BYTES) ||
    !isDiagnosticPosition(value.line) ||
    !isDiagnosticPosition(value.character) ||
    !isOptionalDiagnosticPosition(value.endLine) ||
    !isOptionalDiagnosticPosition(value.endCharacter) ||
    !isOrderedRange(value.line, value.character, value.endLine, value.endCharacter)
  ) {
    return null;
  }

  return {
    uri: value.uri,
    message: value.message,
    line: value.line,
    character: value.character,
    ...(hasOwn(value, "endLine") ? { endLine: value.endLine as number } : {}),
    ...(hasOwn(value, "endCharacter") ? { endCharacter: value.endCharacter as number } : {}),
  };
}

function decodeProjectionReceipt(
  value: unknown,
  diagnostics: readonly LanguageServerDiagnostic[],
  actualRetainedUtf8Bytes: number,
): BoundedLanguageServerDiagnosticsProjectionReceipt | null {
  if (!isRecord(value) || (value.kind !== "complete" && value.kind !== "truncated")) {
    return null;
  }
  const expectedKeys = value.kind === "complete" ? PROJECTION_BASE_KEYS : PROJECTION_TRUNCATED_KEYS;
  if (!hasExactKeys(value, expectedKeys)) return null;

  if (
    !isNonNegativeSafeInteger(value.publishedCount) ||
    !isNonNegativeSafeInteger(value.retainedCount) ||
    value.retainedCount !== diagnostics.length ||
    !isNonNegativeSafeInteger(value.retainedUtf8Bytes) ||
    value.retainedUtf8Bytes < 2 ||
    value.retainedUtf8Bytes > MAX_LANGUAGE_SERVER_DIAGNOSTICS_UTF8_BYTES ||
    (diagnostics.length === 0 && value.retainedUtf8Bytes !== actualRetainedUtf8Bytes)
  ) {
    return null;
  }

  const severityCounts = decodeSeverityCounts(value.severityCounts);
  if (!severityCounts || severityCountTotal(severityCounts) !== value.publishedCount) {
    return null;
  }
  const retainedSeverityCounts = diagnosticSeverityCounts(diagnostics);
  if (
    SEVERITY_KEYS.some((severity) => retainedSeverityCounts[severity] > severityCounts[severity])
  ) {
    return null;
  }

  if (value.kind === "complete") {
    if (
      value.publishedCount !== value.retainedCount ||
      !severityCountsEqual(severityCounts, retainedSeverityCounts)
    ) {
      return null;
    }
    return {
      kind: "complete",
      publishedCount: value.publishedCount,
      retainedCount: value.retainedCount,
      severityCounts,
      retainedUtf8Bytes: value.retainedUtf8Bytes,
      decodedUtf8Bytes: actualRetainedUtf8Bytes,
    };
  }

  if (
    !isNonNegativeSafeInteger(value.omittedCount) ||
    value.publishedCount !== value.retainedCount + value.omittedCount ||
    !isProjectionReasons(value.reasons) ||
    !isNonNegativeSafeInteger(value.sanitizedFieldCount) ||
    (value.omittedCount === 0 && value.sanitizedFieldCount === 0) ||
    value.publishedCount === 0 ||
    !projectionReasonsMatchLoss(value.reasons, value.omittedCount, value.sanitizedFieldCount)
  ) {
    return null;
  }

  return {
    kind: "truncated",
    publishedCount: value.publishedCount,
    retainedCount: value.retainedCount,
    severityCounts,
    retainedUtf8Bytes: value.retainedUtf8Bytes,
    decodedUtf8Bytes: actualRetainedUtf8Bytes,
    omittedCount: value.omittedCount,
    reasons: [...value.reasons],
    sanitizedFieldCount: value.sanitizedFieldCount,
  };
}

function decodeSeverityCounts(value: unknown): LanguageServerDiagnosticsSeverityCounts | null {
  if (!isRecord(value) || !hasExactKeys(value, SEVERITY_KEYS)) return null;
  if (!SEVERITY_KEYS.every((key) => isNonNegativeSafeInteger(value[key]))) return null;
  return {
    error: value.error as number,
    warning: value.warning as number,
    information: value.information as number,
    hint: value.hint as number,
  };
}

function severityCountTotal(counts: LanguageServerDiagnosticsSeverityCounts): number {
  return counts.error + counts.warning + counts.information + counts.hint;
}

function diagnosticSeverityCounts(
  diagnostics: readonly LanguageServerDiagnostic[],
): LanguageServerDiagnosticsSeverityCounts {
  const actual: LanguageServerDiagnosticsSeverityCounts = {
    error: 0,
    warning: 0,
    information: 0,
    hint: 0,
  };
  for (const diagnostic of diagnostics) actual[diagnostic.severity] += 1;
  return actual;
}

function severityCountsEqual(
  left: LanguageServerDiagnosticsSeverityCounts,
  right: LanguageServerDiagnosticsSeverityCounts,
): boolean {
  return SEVERITY_KEYS.every((key) => left[key] === right[key]);
}

function projectionReasonsMatchLoss(
  reasons: readonly LanguageServerDiagnosticsProjectionReason[],
  omittedCount: number,
  sanitizedFieldCount: number,
): boolean {
  const hasOmissionReason = reasons.includes("itemLimit") || reasons.includes("byteLimit");
  const hasSanitizationReason =
    reasons.includes("fieldLimit") ||
    reasons.includes("dataDepthLimit") ||
    reasons.includes("relatedInformationLimit") ||
    reasons.includes("authorityNodeLimit") ||
    reasons.includes("pathProbeLimit");
  return (
    hasOmissionReason === omittedCount > 0 && hasSanitizationReason === sanitizedFieldCount > 0
  );
}

function isProjectionReasons(value: unknown): value is LanguageServerDiagnosticsProjectionReason[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > LANGUAGE_SERVER_DIAGNOSTICS_PROJECTION_REASONS.length
  ) {
    return false;
  }
  let previousIndex = -1;
  for (const reason of value) {
    const index = LANGUAGE_SERVER_DIAGNOSTICS_PROJECTION_REASONS.indexOf(
      reason as LanguageServerDiagnosticsProjectionReason,
    );
    if (index <= previousIndex) return false;
    previousIndex = index;
  }
  return true;
}

function isDiagnosticTags(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_LANGUAGE_SERVER_DIAGNOSTIC_TAGS &&
    value.every(
      (tag, index) =>
        LANGUAGE_SERVER_DIAGNOSTIC_TAG_VALUES.some((allowed) => allowed === tag) &&
        value.indexOf(tag) === index,
    )
  );
}

interface DecodedBoundedJsonValue {
  value: unknown;
  utf8Bytes: number;
}

function decodeBoundedJsonValue(
  value: unknown,
  maxDepth: number,
  maxBytes: number,
): DecodedBoundedJsonValue | null {
  return decodeJsonValueWithinBounds(
    value,
    0,
    maxDepth,
    maxBytes,
    { remainingNodes: MAX_LANGUAGE_SERVER_DIAGNOSTIC_DATA_NODES },
    new Set(),
  );
}

function decodeJsonValueWithinBounds(
  value: unknown,
  depth: number,
  maxDepth: number,
  maxBytes: number,
  budget: { remainingNodes: number },
  ancestors: Set<object>,
): DecodedBoundedJsonValue | null {
  if (depth > maxDepth || budget.remainingNodes === 0) return null;
  budget.remainingNodes -= 1;

  if (value === null) return { value: null, utf8Bytes: 4 };
  if (typeof value === "boolean") {
    return { value, utf8Bytes: value ? 4 : 5 };
  }
  if (isFiniteJsonNumber(value)) {
    return { value, utf8Bytes: String(Object.is(value, -0) ? 0 : value).length };
  }
  if (typeof value === "string") {
    const rawBytes = validUtf8StringBytes(value);
    if (rawBytes === null || rawBytes > MAX_LANGUAGE_SERVER_DIAGNOSTIC_SHORT_FIELD_UTF8_BYTES) {
      return null;
    }
    const utf8Bytes = jsonStringUtf8Bytes(value);
    return utf8Bytes <= maxBytes ? { value, utf8Bytes } : null;
  }
  if (!isPlainJsonContainer(value) || ancestors.has(value)) return null;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_LANGUAGE_SERVER_DIAGNOSTIC_DATA_CONTAINER_ITEMS) {
        return null;
      }
      const clone: unknown[] = [];
      let utf8Bytes = 2;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          return null;
        }
        const decoded = decodeJsonValueWithinBounds(
          descriptor.value,
          depth + 1,
          maxDepth,
          maxBytes,
          budget,
          ancestors,
        );
        if (!decoded) return null;
        utf8Bytes += decoded.utf8Bytes + (index === 0 ? 0 : 1);
        if (utf8Bytes > maxBytes) return null;
        clone.push(decoded.value);
      }
      if (
        Reflect.ownKeys(value).some(
          (key) =>
            key !== "length" &&
            (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length),
        )
      ) {
        return null;
      }
      return { value: clone, utf8Bytes };
    }

    const keys = Reflect.ownKeys(value);
    if (
      keys.length > MAX_LANGUAGE_SERVER_DIAGNOSTIC_DATA_CONTAINER_ITEMS ||
      keys.some((key) => typeof key !== "string")
    ) {
      return null;
    }
    const cloneEntries: [string, unknown][] = [];
    let utf8Bytes = 2;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return null;
      }
      const rawKeyBytes = validUtf8StringBytes(key);
      if (
        rawKeyBytes === null ||
        rawKeyBytes > MAX_LANGUAGE_SERVER_DIAGNOSTIC_SHORT_FIELD_UTF8_BYTES
      ) {
        return null;
      }
      const decoded = decodeJsonValueWithinBounds(
        descriptor.value,
        depth + 1,
        maxDepth,
        maxBytes,
        budget,
        ancestors,
      );
      if (!decoded) return null;
      utf8Bytes +=
        jsonStringUtf8Bytes(key) + 1 + decoded.utf8Bytes + (cloneEntries.length === 0 ? 0 : 1);
      if (utf8Bytes > maxBytes) return null;
      cloneEntries.push([key, decoded.value]);
    }
    return { value: Object.fromEntries(cloneEntries), utf8Bytes };
  } finally {
    ancestors.delete(value);
  }
}

function isPlainJsonContainer(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validUtf8StringBytes(value: string): number | null {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) return null;
      bytes += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return null;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function jsonStringUtf8Bytes(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) {
      bytes += 2;
    } else if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2;
    } else if (code < 0x20) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function jsonUtf8Bytes(value: unknown): number | null {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? UTF8_ENCODER.encode(json).byteLength : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => hasOwn(value, key));
}

function hasRequiredAndOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    required.every((key) => hasOwn(value, key)) &&
    actual.every((key) => required.includes(key) || optional.includes(key))
  );
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isDiagnosticSeverity(value: unknown): value is LanguageServerDiagnosticSeverity {
  return value === "error" || value === "warning" || value === "information" || value === "hint";
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isSafeNumber(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return isSafeNumber(value) && value >= 0;
}

function isDiagnosticPosition(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value <= MAX_LANGUAGE_SERVER_DIAGNOSTIC_POSITION;
}

function isOptionalDiagnosticPosition(value: unknown): boolean {
  return value === undefined || isDiagnosticPosition(value);
}

function isOrderedRange(
  line: number,
  character: number,
  endLine: unknown,
  endCharacter: unknown,
): boolean {
  if (endLine === undefined && endCharacter === undefined) return true;
  if (typeof endLine !== "number" || typeof endCharacter !== "number") {
    return false;
  }
  return endLine > line || (endLine === line && endCharacter >= character);
}

function isSafeNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Math.abs(value) <= MAX_LANGUAGE_SERVER_JAVASCRIPT_SAFE_INTEGER
  );
}

function isFiniteJsonNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function utf8Bytes(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function isBoundedNonEmptyString(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && value.length > 0 && utf8Bytes(value) <= maxBytes;
}

function isBoundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && utf8Bytes(value) <= maxBytes;
}

function isBoundedAbsoluteUri(value: unknown, maxBytes: number): value is string {
  if (!isBoundedNonEmptyString(value, maxBytes)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol.length > 1;
  } catch {
    return false;
  }
}

export function languageServerDiagnosticNoticeGroup(uri: string): string {
  return `language-server-diagnostics:${uri}`;
}

export function languageServerDiagnosticNoticeSeverity(
  severity: LanguageServerDiagnosticSeverity,
): LanguageServerDiagnosticNoticeSeverity {
  if (severity === "error") {
    return "error";
  }

  if (severity === "warning") {
    return "warning";
  }

  return "info";
}

export function languageServerDiagnosticNoticeMessage(
  diagnostic: LanguageServerDiagnostic,
  uri: string,
): string {
  return `${uri} ${diagnostic.line + 1}:${diagnostic.character + 1} ${diagnostic.message}`;
}

/**
 * Decides whether a `publishDiagnostics` event should be applied.
 *
 * phpactor (and the JS/TS server) publish diagnostics asynchronously, keyed by
 * the version of the document snapshot they *analysed* — NOT the live document
 * version. After a `didChange` advances the live document version, the server
 * can still publish results (including a clear, `count=0`) for the analysis it
 * had already started at an older version. Comparing against the live document
 * version therefore discards valid, in-order publications and leaves stale
 * markers on screen.
 *
 * We instead compare against the version of the LAST diagnostic we actually
 * APPLIED for this document (`lastAppliedDiagnosticVersion`). Because the server
 * publishes monotonically, this lets every fresh publication through (including
 * the clear) while still dropping a genuinely out-of-order publication whose
 * analysis version is older than one we have already applied.
 */
export function shouldApplyLanguageServerDiagnostics(
  event: LanguageServerDiagnosticEvent,
  currentSessionId: number | null,
  lastAppliedDiagnosticVersion: number | undefined,
  currentWorkspaceRoot?: string | null,
): boolean {
  if (
    currentWorkspaceRoot &&
    normalizedWorkspaceRootKey(event.rootPath) !== normalizedWorkspaceRootKey(currentWorkspaceRoot)
  ) {
    return false;
  }

  if (event.sessionId !== currentSessionId) {
    return false;
  }

  if (typeof event.version !== "number") {
    return true;
  }

  if (typeof lastAppliedDiagnosticVersion !== "number") {
    return true;
  }

  return event.version >= lastAppliedDiagnosticVersion;
}

import {
  boundedUtf8Length,
  DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS,
} from "./incrementalDocumentSync";
import {
  defaultLargeSmartDocumentPolicy,
  isLargeSmartDocumentContent,
  largeSmartDocumentStatusFromMetrics,
  normalizeLargeSmartDocumentPolicy,
  type LargeSmartDocumentMetrics,
  type LargeSmartDocumentPolicy,
} from "./largeDocumentPolicy";
import { isWellFormedUnicode } from "./unicodeText";

export const MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF16_UNITS =
  DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS.maxFullSnapshotUtf16Units;

export const MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF8_BYTES = 6 * 1024 * 1024;

export type JavaScriptTypeScriptLargeDocumentCapability =
  | {
      readonly kind: "full";
    }
  | {
      readonly kind: "editing-degraded-interactive-lsp";
      readonly reason: "character-limit" | "line-limit";
    }
  | {
      readonly kind: "editing-only";
      readonly reason:
        "full-sync-utf16-limit" | "full-sync-utf8-limit" | "invalid-content" | "invalid-metrics";
    };

const FULL_CAPABILITY: JavaScriptTypeScriptLargeDocumentCapability = Object.freeze({
  kind: "full",
});

const INVALID_CONTENT_CAPABILITY: JavaScriptTypeScriptLargeDocumentCapability = Object.freeze({
  kind: "editing-only",
  reason: "invalid-content",
});

const INVALID_METRICS_CAPABILITY: JavaScriptTypeScriptLargeDocumentCapability = Object.freeze({
  kind: "editing-only",
  reason: "invalid-metrics",
});

const UTF16_LIMIT_CAPABILITY: JavaScriptTypeScriptLargeDocumentCapability = Object.freeze({
  kind: "editing-only",
  reason: "full-sync-utf16-limit",
});

const UTF8_LIMIT_CAPABILITY: JavaScriptTypeScriptLargeDocumentCapability = Object.freeze({
  kind: "editing-only",
  reason: "full-sync-utf8-limit",
});

const CHARACTER_LIMIT_CAPABILITY: JavaScriptTypeScriptLargeDocumentCapability = Object.freeze({
  kind: "editing-degraded-interactive-lsp",
  reason: "character-limit",
});

const LINE_LIMIT_CAPABILITY: JavaScriptTypeScriptLargeDocumentCapability = Object.freeze({
  kind: "editing-degraded-interactive-lsp",
  reason: "line-limit",
});

/**
 * Classifies the exact live JS/TS content against both the user-facing smart
 * feature policy and the hard bounded full-snapshot admission contract.
 */
export function classifyJavaScriptTypeScriptLargeDocumentCapability(
  content: unknown,
  policy: LargeSmartDocumentPolicy = defaultLargeSmartDocumentPolicy,
): JavaScriptTypeScriptLargeDocumentCapability {
  if (typeof content !== "string") {
    return INVALID_CONTENT_CAPABILITY;
  }
  if (content.length > MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF16_UNITS) {
    return UTF16_LIMIT_CAPABILITY;
  }
  if (!isWellFormedUnicode(content)) {
    return INVALID_CONTENT_CAPABILITY;
  }
  if (
    boundedUtf8Length(content, MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF8_BYTES).status ===
    "limit-exceeded"
  ) {
    return UTF8_LIMIT_CAPABILITY;
  }

  const normalizedPolicy = normalizeLargeSmartDocumentPolicy(policy);
  if (!isLargeSmartDocumentContent(content, normalizedPolicy)) {
    return FULL_CAPABILITY;
  }
  return content.length > normalizedPolicy.characterLimit
    ? CHARACTER_LIMIT_CAPABILITY
    : LINE_LIMIT_CAPABILITY;
}

/**
 * O(1) classification for presentation paths that already own exact Monaco
 * metrics but must not read or encode the full document content.
 *
 * UTF-8 admission remains the responsibility of the raw-content boundary.
 */
export function classifyJavaScriptTypeScriptLargeDocumentCapabilityFromMetrics(
  metrics: LargeSmartDocumentMetrics | null | undefined,
  policy: LargeSmartDocumentPolicy = defaultLargeSmartDocumentPolicy,
): JavaScriptTypeScriptLargeDocumentCapability {
  if (!metrics) {
    return INVALID_METRICS_CAPABILITY;
  }

  let snapshot: LargeSmartDocumentMetrics;
  try {
    snapshot = {
      lineCount: metrics.lineCount,
      utf16Length: metrics.utf16Length,
    };
  } catch {
    return INVALID_METRICS_CAPABILITY;
  }
  const smartDocumentStatus = largeSmartDocumentStatusFromMetrics(snapshot, policy);
  if (smartDocumentStatus.kind === "degraded") {
    return INVALID_METRICS_CAPABILITY;
  }
  if (snapshot.utf16Length > MAX_JAVA_SCRIPT_TYPE_SCRIPT_FULL_SYNC_UTF16_UNITS) {
    return UTF16_LIMIT_CAPABILITY;
  }
  if (smartDocumentStatus.kind === "eligible") {
    return FULL_CAPABILITY;
  }
  return smartDocumentStatus.reason === "character-limit"
    ? CHARACTER_LIMIT_CAPABILITY
    : LINE_LIMIT_CAPABILITY;
}

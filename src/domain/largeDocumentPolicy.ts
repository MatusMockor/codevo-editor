export const LARGE_SMART_DOCUMENT_CHARACTER_LIMIT = 256 * 1024;
export const LARGE_SMART_DOCUMENT_LINE_LIMIT = 5_000;
export const MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT = 16 * 1024;
export const MAX_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT = 10 * 1024 * 1024;
export const MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT = 500;
export const MAX_LARGE_SMART_DOCUMENT_LINE_LIMIT = 200_000;
export const LARGE_SMART_DOCUMENT_STATUS_LABEL = "Large file mode";

export interface LargeDocumentCandidate {
  content: string;
}

export interface LargeSmartDocumentPolicy {
  characterLimit: number;
  lineLimit: number;
}

export interface LargeSmartDocumentStatus {
  readonly label: string;
  readonly title: string;
}

export interface LargeSmartDocumentMetrics {
  readonly lineCount: number;
  readonly utf16Length: number;
}

export type LargeSmartDocumentMetricsResult =
  | {
      readonly kind: "degraded";
      readonly reason: "invalid-metrics";
      readonly status: LargeSmartDocumentStatus;
    }
  | {
      readonly kind: "eligible";
      readonly status: null;
    }
  | {
      readonly kind: "large";
      readonly reason: "character-limit" | "line-limit";
      readonly status: LargeSmartDocumentStatus;
    };

export const defaultLargeSmartDocumentPolicy: LargeSmartDocumentPolicy = {
  characterLimit: LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  lineLimit: LARGE_SMART_DOCUMENT_LINE_LIMIT,
};

export const LARGE_SMART_DOCUMENT_STATUS_TITLE = largeSmartDocumentStatusTitle(
  defaultLargeSmartDocumentPolicy,
);

const LARGE_SMART_DOCUMENT_STATUS: LargeSmartDocumentStatus = Object.freeze({
  label: LARGE_SMART_DOCUMENT_STATUS_LABEL,
  title: LARGE_SMART_DOCUMENT_STATUS_TITLE,
});

const INVALID_LARGE_SMART_DOCUMENT_METRICS_STATUS: LargeSmartDocumentStatus = Object.freeze({
  label: LARGE_SMART_DOCUMENT_STATUS_LABEL,
  title: "Large file mode: smart analysis is limited because exact file metrics are unavailable.",
});

const DEGRADED_LARGE_SMART_DOCUMENT_METRICS_RESULT: LargeSmartDocumentMetricsResult = Object.freeze(
  {
    kind: "degraded",
    reason: "invalid-metrics",
    status: INVALID_LARGE_SMART_DOCUMENT_METRICS_STATUS,
  },
);

const ELIGIBLE_LARGE_SMART_DOCUMENT_METRICS_RESULT: LargeSmartDocumentMetricsResult = Object.freeze(
  {
    kind: "eligible",
    status: null,
  },
);

export function largeSmartDocumentStatus(
  document: LargeDocumentCandidate | null | undefined,
  policy = defaultLargeSmartDocumentPolicy,
): LargeSmartDocumentStatus | null {
  if (!document) {
    return null;
  }

  if (!isLargeSmartDocument(document, policy)) {
    return null;
  }

  if (policy === defaultLargeSmartDocumentPolicy) {
    return LARGE_SMART_DOCUMENT_STATUS;
  }

  return {
    label: LARGE_SMART_DOCUMENT_STATUS_LABEL,
    title: largeSmartDocumentStatusTitle(policy),
  };
}

export function isLargeSmartDocument(
  document: LargeDocumentCandidate,
  policy = defaultLargeSmartDocumentPolicy,
): boolean {
  return isLargeSmartDocumentContent(document.content, policy);
}

export function isLargeSmartDocumentContent(
  content: string,
  policy = defaultLargeSmartDocumentPolicy,
): boolean {
  const normalizedPolicy = normalizeLargeSmartDocumentPolicy(policy);

  if (content.length > normalizedPolicy.characterLimit) {
    return true;
  }

  return exceedsLineLimit(content, normalizedPolicy.lineLimit);
}

export function largeSmartDocumentStatusFromMetrics(
  metrics: LargeSmartDocumentMetrics | null | undefined,
  policy = defaultLargeSmartDocumentPolicy,
): LargeSmartDocumentMetricsResult {
  if (!metrics) {
    return degradedMetricsResult();
  }

  const { lineCount, utf16Length } = metrics;
  if (
    !validMetric(utf16Length, true) ||
    !validMetric(lineCount, false) ||
    lineCount - 1 > utf16Length
  ) {
    return degradedMetricsResult();
  }

  const normalizedPolicy = normalizeLargeSmartDocumentPolicy(policy);
  if (utf16Length > normalizedPolicy.characterLimit) {
    return Object.freeze({
      kind: "large",
      reason: "character-limit",
      status: largeSmartDocumentStatusForPolicy(policy, normalizedPolicy),
    });
  }
  if (lineCount > normalizedPolicy.lineLimit) {
    return Object.freeze({
      kind: "large",
      reason: "line-limit",
      status: largeSmartDocumentStatusForPolicy(policy, normalizedPolicy),
    });
  }
  return ELIGIBLE_LARGE_SMART_DOCUMENT_METRICS_RESULT;
}

export function normalizeLargeSmartDocumentPolicy(
  value: unknown,
  fallback: LargeSmartDocumentPolicy = defaultLargeSmartDocumentPolicy,
): LargeSmartDocumentPolicy {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    characterLimit: normalizeLimit(
      value.characterLimit,
      fallback.characterLimit,
      MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
      MAX_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
    ),
    lineLimit: normalizeLimit(
      value.lineLimit,
      fallback.lineLimit,
      MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT,
      MAX_LARGE_SMART_DOCUMENT_LINE_LIMIT,
    ),
  };
}

function exceedsLineLimit(content: string, limit: number): boolean {
  let lines = 1;

  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) !== 10) {
      continue;
    }

    lines += 1;

    if (lines > limit) {
      return true;
    }
  }

  return false;
}

function degradedMetricsResult(): LargeSmartDocumentMetricsResult {
  return DEGRADED_LARGE_SMART_DOCUMENT_METRICS_RESULT;
}

function largeSmartDocumentStatusForPolicy(
  policy: LargeSmartDocumentPolicy,
  normalizedPolicy: LargeSmartDocumentPolicy,
): LargeSmartDocumentStatus {
  if (
    policy === defaultLargeSmartDocumentPolicy ||
    (normalizedPolicy.characterLimit === defaultLargeSmartDocumentPolicy.characterLimit &&
      normalizedPolicy.lineLimit === defaultLargeSmartDocumentPolicy.lineLimit)
  ) {
    return LARGE_SMART_DOCUMENT_STATUS;
  }
  return Object.freeze({
    label: LARGE_SMART_DOCUMENT_STATUS_LABEL,
    title: largeSmartDocumentStatusTitle(normalizedPolicy),
  });
}

function validMetric(value: number, allowZero: boolean): boolean {
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatKilobytes(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

function largeSmartDocumentStatusTitle(policy: LargeSmartDocumentPolicy): string {
  const normalizedPolicy = normalizeLargeSmartDocumentPolicy(policy);

  return `Large file mode: smart analysis is limited for the active file over ${formatKilobytes(
    normalizedPolicy.characterLimit,
  )} or ${formatCount(normalizedPolicy.lineLimit)} lines.`;
}

function normalizeLimit(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.floor(value);

  return Math.min(Math.max(rounded, min), max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

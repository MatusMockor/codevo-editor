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
  label: string;
  title: string;
}

export const defaultLargeSmartDocumentPolicy: LargeSmartDocumentPolicy = {
  characterLimit: LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  lineLimit: LARGE_SMART_DOCUMENT_LINE_LIMIT,
};

export const LARGE_SMART_DOCUMENT_STATUS_TITLE =
  largeSmartDocumentStatusTitle(defaultLargeSmartDocumentPolicy);

const LARGE_SMART_DOCUMENT_STATUS: LargeSmartDocumentStatus = {
  label: LARGE_SMART_DOCUMENT_STATUS_LABEL,
  title: LARGE_SMART_DOCUMENT_STATUS_TITLE,
};

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

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatKilobytes(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

function largeSmartDocumentStatusTitle(
  policy: LargeSmartDocumentPolicy,
): string {
  const normalizedPolicy = normalizeLargeSmartDocumentPolicy(policy);

  return `Large file mode: smart analysis is limited for the active file over ${formatKilobytes(
    normalizedPolicy.characterLimit,
  )} or ${formatCount(normalizedPolicy.lineLimit)} lines.`;
}

function normalizeLimit(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.floor(value);

  return Math.min(Math.max(rounded, min), max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

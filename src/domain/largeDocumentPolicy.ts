export const LARGE_SMART_DOCUMENT_CHARACTER_LIMIT = 256 * 1024;
export const LARGE_SMART_DOCUMENT_LINE_LIMIT = 5_000;
export const LARGE_SMART_DOCUMENT_STATUS_LABEL = "Large file mode";
export const LARGE_SMART_DOCUMENT_STATUS_TITLE =
  `Large file mode: smart analysis is limited for the active file over ${formatKilobytes(
    LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  )} or ${formatCount(LARGE_SMART_DOCUMENT_LINE_LIMIT)} lines.`;

export interface LargeDocumentCandidate {
  content: string;
}

export interface LargeSmartDocumentStatus {
  label: string;
  title: string;
}

const LARGE_SMART_DOCUMENT_STATUS: LargeSmartDocumentStatus = {
  label: LARGE_SMART_DOCUMENT_STATUS_LABEL,
  title: LARGE_SMART_DOCUMENT_STATUS_TITLE,
};

export function largeSmartDocumentStatus(
  document: LargeDocumentCandidate | null | undefined,
): LargeSmartDocumentStatus | null {
  if (!document) {
    return null;
  }

  if (!isLargeSmartDocument(document)) {
    return null;
  }

  return LARGE_SMART_DOCUMENT_STATUS;
}

export function isLargeSmartDocument(
  document: LargeDocumentCandidate,
): boolean {
  return isLargeSmartDocumentContent(document.content);
}

export function isLargeSmartDocumentContent(content: string): boolean {
  if (content.length > LARGE_SMART_DOCUMENT_CHARACTER_LIMIT) {
    return true;
  }

  return exceedsLineLimit(content, LARGE_SMART_DOCUMENT_LINE_LIMIT);
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

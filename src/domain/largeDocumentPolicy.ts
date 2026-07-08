export const LARGE_SMART_DOCUMENT_CHARACTER_LIMIT = 256 * 1024;
export const LARGE_SMART_DOCUMENT_LINE_LIMIT = 5_000;

export interface LargeDocumentCandidate {
  content: string;
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

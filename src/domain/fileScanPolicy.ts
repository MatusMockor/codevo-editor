export const MAX_SCANNED_FILE_CONTENT_LENGTH = 1024 * 1024;

export function exceedsScannedFileContentLength(
  content: string,
  maxLength = MAX_SCANNED_FILE_CONTENT_LENGTH,
): boolean {
  return content.length > maxLength;
}

import { createContext } from "react";

export interface FileViewerFont {
  readonly family: string | null;
  readonly size: number | null;
}

export const MIN_FILE_VIEWER_FONT_SIZE = 8;
export const MAX_FILE_VIEWER_FONT_SIZE = 40;

export const FileViewerFontContext = createContext<FileViewerFont>({ family: null, size: null });

export function fileViewerLineHeight(font: FileViewerFont): number {
  const size = fileViewerFontSize(font);
  if (size === null) return 20;
  return Math.max(16, Math.round(size * 1.5));
}

export function fileViewerFontSize(font: FileViewerFont): number | null {
  const size = font.size;
  if (size === null || !Number.isFinite(size)) return null;
  return Math.min(MAX_FILE_VIEWER_FONT_SIZE, Math.max(MIN_FILE_VIEWER_FONT_SIZE, size));
}

export function fileViewerFontFamily(font: FileViewerFont): string | null {
  const family = font.family?.trim() ?? "";
  if (family === "" || family.length > 512) return null;
  return family;
}

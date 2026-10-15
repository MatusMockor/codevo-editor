import { createContext } from "react";
import { FILE_VIEWER_LINE_HEIGHT_PX, FILE_VIEWER_LINE_HEIGHT_RATIO } from "./fileViewerModel";

export interface FileViewerFont {
  readonly family: string | null;
  readonly size: number | null;
}

export const MIN_FILE_VIEWER_FONT_SIZE = 8;
export const MAX_FILE_VIEWER_FONT_SIZE = 40;

export const FileViewerFontContext = createContext<FileViewerFont>({ family: null, size: null });

export function fileViewerLineHeight(font: FileViewerFont): number {
  const size = fileViewerFontSize(font);
  if (size === null) return FILE_VIEWER_LINE_HEIGHT_PX;
  return Math.max(16, Math.round(size * FILE_VIEWER_LINE_HEIGHT_RATIO));
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

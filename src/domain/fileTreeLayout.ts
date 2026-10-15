import { defaultEditorFontSize, normalizeEditorFontSize } from "./settings";

export const normalizeTreeFontSize = normalizeEditorFontSize;

export function treeRowHeight(fontSize: number): number {
  return Math.round(normalizeTreeFontSize(fontSize) + 12);
}

export const TREE_ROW_HEIGHT = treeRowHeight(defaultEditorFontSize);

export function isJavaScriptTypeScriptLanguage(language: string | null): boolean {
  return language === "javascript" || language === "typescript";
}

export function toolSourceLabel(source: string): string {
  if (source === "managed") return "Managed IDE engine";
  if (source === "workspaceVendorBin") return "Project PHPactor";
  return "PATH PHPactor";
}

export function areFileStatusesByPathEqual(
  left: Record<string, GitChangeStatus>,
  right: Record<string, GitChangeStatus>,
): boolean {
  if (left === right) return true;
  const leftKeys = Object.keys(left);
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every((path) => left[path] === right[path])
  );
}
import type { GitChangeStatus } from "../domain/git";
import { indexProgressLabel, type IndexProgressState } from "../domain/indexProgress";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function maxBottomPanelHeight(viewportHeight: number): number {
  return Math.max(96, Math.min(viewportHeight * 0.7, 520));
}

export function indexToolbarLabel(progress: IndexProgressState): string {
  return indexProgressLabel(progress) ?? "Index: idle";
}

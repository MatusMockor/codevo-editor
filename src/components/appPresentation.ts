import type { JavaScriptTypeScriptVersionPreference } from "../domain/settings";
import {
  javaScriptTypeScriptWorkspaceLabel,
  type PhpToolAvailability,
  type WorkspaceDescriptor,
} from "../domain/workspace";

export function isJavaScriptTypeScriptLanguage(language: string | null): boolean {
  return language === "javascript" || language === "typescript";
}

export interface WorkspaceInfoLabelInput {
  readonly activeLanguage: string | null;
  readonly javaScriptTypeScriptVersion: JavaScriptTypeScriptVersionPreference;
  readonly phpTools: PhpToolAvailability | null;
  readonly phpVersionOverride: string | null;
  readonly workspaceDescriptor: WorkspaceDescriptor | null;
}

export function workspaceInfoLabel({
  activeLanguage,
  javaScriptTypeScriptVersion,
  phpTools,
  phpVersionOverride,
  workspaceDescriptor,
}: WorkspaceInfoLabelInput): string | null {
  const jsTs = workspaceDescriptor?.javaScriptTypeScript;
  const php = workspaceDescriptor?.php;

  if (jsTs && isJavaScriptTypeScriptLanguage(activeLanguage)) {
    return javaScriptTypeScriptWorkspaceLabel(jsTs, javaScriptTypeScriptVersion);
  }

  if (!php) {
    return jsTs ? javaScriptTypeScriptWorkspaceLabel(jsTs, javaScriptTypeScriptVersion) : null;
  }

  const packageName = php.packageName || "PHP Composer";
  const phpLevel = phpVersionOverride || php.phpPlatformVersion || php.phpVersionConstraint;
  const packageLabel = phpLevel ? `${packageName} · PHP ${phpLevel}` : packageName;

  if (phpTools?.phpactor) {
    return `${packageLabel} · ${toolSourceLabel(phpTools.phpactor.source)}`;
  }

  if (phpTools?.intelephense) {
    return `${packageLabel} · Intelephense`;
  }

  return `${packageLabel} · PHP tools missing`;
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

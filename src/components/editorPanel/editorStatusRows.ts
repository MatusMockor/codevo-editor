import type { LargeSmartDocumentStatus } from "../../domain/largeDocumentPolicy";
import type { IntelligenceMode } from "../../domain/workspace";
import type { EditorStatusRow, EditorStatusRowId } from "./EditorChromeContext";

export interface EditorStatusRowsInput {
  readonly activeLanguage: string | null;
  readonly workspaceLabel: string | null;
  readonly gitBranch: string | null;
  readonly branchRepositoryLabel: string | null;
  readonly workspaceTrustLabel: string | null;
  readonly intelligenceMode: IntelligenceMode;
  readonly largeDocumentStatus: LargeSmartDocumentStatus | null;
  readonly dirtyCount: number;
}

export function editorStatusRows(input: EditorStatusRowsInput): ReadonlyArray<EditorStatusRow> {
  const candidates: ReadonlyArray<readonly [EditorStatusRowId, string, string | null]> = [
    ["language", "Language", input.activeLanguage],
    ["project", "Project", input.workspaceLabel],
    ["branch", "Branch", branchLabel(input.gitBranch, input.branchRepositoryLabel)],
    ["trust", "Trust", input.workspaceTrustLabel],
    ["mode", "Mode", intelligenceModeLabel(input.intelligenceMode)],
    ["largeFile", "Large file", input.largeDocumentStatus?.label ?? null],
    ["unsaved", "Unsaved", unsavedLabel(input.dirtyCount)],
  ];
  return candidates.flatMap(([id, label, value]) =>
    value === null || value.length === 0 ? [] : [{ id, label, value }],
  );
}

export function intelligenceModeLabel(mode: IntelligenceMode): string {
  switch (mode) {
    case "basic":
      return "Editor Mode";
    case "lightSmart":
      return "Smart Index";
    case "fullSmart":
      return "IDE Mode";
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

function branchLabel(branch: string | null, repositoryLabel: string | null): string | null {
  if (branch === null || repositoryLabel === null) return branch;
  return `${branch} · ${repositoryLabel}`;
}

function unsavedLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 file" : `${count} files`;
}

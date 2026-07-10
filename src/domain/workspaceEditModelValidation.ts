import type { LanguageServerTextEdit } from "./languageServerFeatures";

export interface StagedWorkspaceEditModel<TModel extends object> {
  content: string;
  edits: LanguageServerTextEdit[];
  model: TModel;
  path: string;
  versionId: number;
}

export type WorkspaceEditModelValidation =
  | { kind: "valid" }
  | {
      kind: "invalid";
      path: string;
      reason:
        | "invalidRange"
        | "modelChanged"
        | "modelMissing"
        | "overlappingRanges";
    };

export function validateStagedWorkspaceEditModels<TModel extends object>(
  stagedModels: StagedWorkspaceEditModel<TModel>[],
  currentModels: readonly TModel[],
  readModel: (model: TModel) => { content: string; versionId: number },
): WorkspaceEditModelValidation {
  const currentModelSet = new Set(currentModels);

  for (const staged of stagedModels) {
    if (!currentModelSet.has(staged.model)) {
      return { kind: "invalid", path: staged.path, reason: "modelMissing" };
    }

    const current = readModel(staged.model);

    if (
      current.content !== staged.content ||
      current.versionId !== staged.versionId
    ) {
      return { kind: "invalid", path: staged.path, reason: "modelChanged" };
    }

    const rangeValidation = validateWorkspaceEditTextEditRanges(
      staged.content,
      staged.edits,
    );

    if (rangeValidation !== "valid") {
      return { kind: "invalid", path: staged.path, reason: rangeValidation };
    }
  }

  return { kind: "valid" };
}

export function validateWorkspaceEditTextEditRanges(
  content: string,
  edits: LanguageServerTextEdit[],
): "invalidRange" | "overlappingRanges" | "valid" {
  const lines = contentLines(content);
  const ranges: Array<{ end: number; start: number }> = [];

  for (const edit of edits) {
    const start = offsetForPosition(lines, edit.range.start.line, edit.range.start.character);
    const end = offsetForPosition(lines, edit.range.end.line, edit.range.end.character);

    if (start === null || end === null || start > end) {
      return "invalidRange";
    }

    ranges.push({ end, start });
  }

  ranges.sort((left, right) => left.start - right.start || left.end - right.end);

  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1];
    const current = ranges[index];

    if (current.start < previous.end) {
      return "overlappingRanges";
    }
  }

  return "valid";
}

function contentLines(content: string): Array<{ end: number; start: number }> {
  const lines: Array<{ end: number; start: number }> = [];
  let lineStart = 0;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character !== "\n" && character !== "\r") {
      continue;
    }

    lines.push({ end: index, start: lineStart });

    if (character === "\r" && content[index + 1] === "\n") {
      index += 1;
    }

    lineStart = index + 1;
  }

  lines.push({ end: content.length, start: lineStart });
  return lines;
}

function offsetForPosition(
  lines: Array<{ end: number; start: number }>,
  line: number,
  character: number,
): number | null {
  if (line < 0 || character < 0) {
    return null;
  }

  const targetLine = lines[line];

  if (!targetLine || character > targetLine.end - targetLine.start) {
    return null;
  }

  return targetLine.start + character;
}

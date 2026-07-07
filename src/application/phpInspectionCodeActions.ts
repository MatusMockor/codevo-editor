import {
  phpUnusedImportRemovalAt,
  phpUnusedPrivateMethodRemovalAt,
  phpUnusedVariableRemovalAt,
} from "../domain/phpInspections";
import { phpReplacementEdit } from "./phpCodeActionEdits";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
  PhpCodeActionTextEdit,
} from "./phpCodeActionTypes";

export function phpRemoveUnusedImportCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const removal = phpUnusedImportRemovalAt(source, range.start);

  if (!removal) {
    return null;
  }

  return {
    edits: [removalEdit(source, removal)],
    kind: "quickfix",
    title: `Remove unused import ${removal.label}`,
  };
}

export function phpRemoveUnusedMethodCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const removal = phpUnusedPrivateMethodRemovalAt(source, range.start);

  if (!removal) {
    return null;
  }

  return {
    edits: [removalEdit(source, removal)],
    kind: "quickfix",
    title: `Remove unused method '${removal.label}'`,
  };
}

export function phpRemoveUnusedVariableCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const removal = phpUnusedVariableRemovalAt(source, range.start);

  if (!removal) {
    return null;
  }

  return {
    edits: [removalEdit(source, removal)],
    kind: "quickfix",
    title: `Remove unused variable ${removal.label}`,
  };
}

function removalEdit(
  source: string,
  removal: { end: number; start: number },
): PhpCodeActionTextEdit {
  return phpReplacementEdit(source, removal.start, removal.end, "");
}

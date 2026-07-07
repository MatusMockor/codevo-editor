import { offsetToPosition } from "../domain/phpInsertionPoint";
import type {
  PhpCodeActionTextEdit,
  PhpCodeActionTextEditRange,
} from "./phpCodeActionTypes";

export function zeroLengthPhpEditRange(position: {
  column: number;
  line: number;
}): PhpCodeActionTextEditRange {
  return {
    endColumn: position.column + 1,
    endLineNumber: position.line + 1,
    startColumn: position.column + 1,
    startLineNumber: position.line + 1,
  };
}

export function phpReplacementEdit(
  source: string,
  start: number,
  end: number,
  text: string,
): PhpCodeActionTextEdit {
  const startPosition = offsetToPosition(source, start);
  const endPosition = offsetToPosition(source, end);

  return {
    range: {
      endColumn: endPosition.column + 1,
      endLineNumber: endPosition.line + 1,
      startColumn: startPosition.column + 1,
      startLineNumber: startPosition.line + 1,
    },
    text,
  };
}

export function phpInsertionEdit(
  source: string,
  offset: number,
  text: string,
): PhpCodeActionTextEdit {
  return {
    range: zeroLengthPhpEditRange(offsetToPosition(source, offset)),
    text,
  };
}

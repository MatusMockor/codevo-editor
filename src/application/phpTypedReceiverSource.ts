import type { EditorPosition } from "../domain/languageServerFeatures";

export interface PhpTypedReceiverSource {
  position: EditorPosition;
  source: string;
}

export function synthesizePhpTypedReceiverSource(
  variableName: string,
  typeName: string,
): PhpTypedReceiverSource {
  const source = `<?php\n/** @var \\${typeName.replace(/^\\+/, "")} $${variableName} */\n$${variableName}->`;

  return {
    position: editorPositionAtOffset(source, source.length),
    source,
  };
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const clampedOffset = Math.max(0, Math.min(offset, source.length));
  let lineNumber = 1;
  let lineStart = 0;

  for (let index = 0; index < clampedOffset; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      lineStart = index + 1;
    }
  }

  return {
    column: clampedOffset - lineStart + 1,
    lineNumber,
  };
}

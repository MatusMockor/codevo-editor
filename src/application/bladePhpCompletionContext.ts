import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { BladeCompletionItem } from "./bladeIntelligenceContracts";

export type BladePhpLikeCompletion =
  | { end: number; kind: "variable"; prefix: string; start: number }
  | { end: number; kind: "helper"; prefix: string; start: number };

export interface BladePhpMemberAccessCompletion {
  end: number;
  prefix: string;
  receiverExpression: string;
  start: number;
  variableName: string;
}

export function bladePhpLikeCompletionAt(
  source: string,
  offset: number,
): BladePhpLikeCompletion | null {
  const before = source.slice(0, offset);
  const variableMatch = /\$([A-Za-z_][A-Za-z0-9_]*)?$/.exec(before);

  if (variableMatch) {
    return {
      end: offset,
      kind: "variable",
      prefix: variableMatch[1] ?? "",
      start: offset - variableMatch[0].length,
    };
  }

  if (isInsideBladeStringLiteral(source, offset)) {
    return null;
  }

  const helperMatch = /([A-Za-z_][A-Za-z0-9_]*|__)$/.exec(before);

  if (!helperMatch?.[1]) {
    return null;
  }

  const beforeHelper = before.slice(0, before.length - helperMatch[1].length);
  const previousCharacter = beforeHelper[beforeHelper.length - 1] ?? "";

  if (/[$>:\w.-]/.test(previousCharacter)) {
    return null;
  }

  return {
    end: offset,
    kind: "helper",
    prefix: helperMatch[1],
    start: offset - helperMatch[1].length,
  };
}

export function bladePhpMemberAccessCompletionAt(
  source: string,
  offset: number,
): BladePhpMemberAccessCompletion | null {
  if (isInsideBladeStringLiteral(source, offset)) {
    return null;
  }

  const before = source.slice(0, offset);
  const match =
    /(\$([A-Za-z_][A-Za-z0-9_]*))\s*\??->\s*([A-Za-z_][A-Za-z0-9_]*)?$/.exec(
      before,
    );

  if (!match?.[1] || !match[2]) {
    return null;
  }

  const prefix = match[3] ?? "";

  return {
    end: offset,
    prefix,
    receiverExpression: match[1],
    start: offset - prefix.length,
    variableName: match[2],
  };
}

export function bladeShortTypeName(typeName: string | null): string | null {
  if (!typeName) {
    return null;
  }

  const baseType = typeName.split("<")[0] ?? typeName;
  const segments = baseType.replace(/^\\+/, "").split("\\");
  const shortName = segments[segments.length - 1]?.trim() ?? "";

  return shortName.length > 0 ? shortName : null;
}

export function bladeMemberCompletionItem(
  member: PhpMethodCompletion,
  range: { replaceEnd: number; replaceStart: number },
): BladeCompletionItem {
  return {
    detail: bladeMemberCompletionDetail(member),
    insertText: bladeMemberCompletionInsertText(member),
    kind: "member",
    label: member.name,
    replaceEnd: range.replaceEnd,
    replaceStart: range.replaceStart,
  };
}

export function bladeOffsetAtEditorPosition(
  source: string,
  position: EditorPosition,
): number {
  const lines = source.split("\n");
  const targetLine = Math.max(0, position.lineNumber - 1);

  if (targetLine >= lines.length) {
    return source.length;
  }

  let offset = 0;

  for (let line = 0; line < targetLine; line += 1) {
    offset += (lines[line]?.length ?? 0) + 1;
  }

  const column = Math.max(0, position.column - 1);

  return offset + Math.min(column, lines[targetLine]?.length ?? 0);
}

export function editorPositionAtOffset(
  source: string,
  offset: number,
): EditorPosition {
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

function bladeMemberCompletionInsertText(member: PhpMethodCompletion): string {
  if (member.insertText) {
    return member.insertText;
  }

  if (member.kind === "property" || member.kind === "relation") {
    return member.name;
  }

  return `${member.name}()`;
}

function bladeMemberCompletionDetail(member: PhpMethodCompletion): string {
  const returnType = member.returnType ? `: ${member.returnType}` : "";

  if (member.kind === "property") {
    return `${member.declaringClassName}::$${member.name}${returnType}`;
  }

  if (member.kind === "relation") {
    return `${member.declaringClassName}::${member.name} relation${returnType}`;
  }

  if (member.kind === "scope") {
    return `${member.declaringClassName}::${member.name} scope${returnType}`;
  }

  if (member.kind === "magic-where") {
    return `${member.declaringClassName}::${member.name} dynamic where${returnType}`;
  }

  const parameters = member.parameters ? `(${member.parameters})` : "()";

  return `${member.declaringClassName}::${member.name}${parameters}${returnType}`;
}

function isInsideBladeStringLiteral(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  let quote: "'" | "\"" | null = null;

  for (let index = lineStart; index < offset; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
    }
  }

  return quote !== null;
}

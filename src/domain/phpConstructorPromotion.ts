import type {
  PhpClassStructure,
  PhpPropertyDeclaration,
} from "./phpClassStructure";
import { renderConstructor } from "./phpConstructorCodeGen";
import {
  indentLines,
} from "./phpInsertionPoint";

export interface PhpConstructorPromotionEdit {
  end: number;
  start: number;
  text: string;
}

export interface PhpConstructorPromotionPlan {
  edits: PhpConstructorPromotionEdit[];
}

/**
 * Plans constructor promotion as one atomic set of non-overlapping source edits.
 * A null result means the source model cannot prove that removing declarations
 * and recreating them as promoted parameters is lossless.
 */
export function planPhpConstructorPromotion(
  source: string,
  structure: PhpClassStructure,
): PhpConstructorPromotionPlan | null {
  if (structure.kind !== "class" && structure.kind !== "abstract-class") {
    return null;
  }

  if (hasConstructor(structure) || !structure.propertyParsingComplete) {
    return null;
  }

  const typeDeclaration = structure.typeDeclaration;

  if (!typeDeclaration || !matchesTypeBody(source, typeDeclaration)) {
    return null;
  }

  const declarations = uniqueDeclarations(structure);
  const instanceDeclarations = declarations.filter(
    (declaration) => !declaration.isStatic,
  );

  if (instanceDeclarations.length === 0) {
    return null;
  }

  if (
    instanceDeclarations.some(
      (declaration) =>
        !declaration.isComplete || !declaration.isSafeForPromotion,
    )
  ) {
    return null;
  }

  const instanceProperties = structure.properties.filter(
    (property) => !property.isStatic,
  );

  if (
    instanceProperties.length === 0 ||
    instanceProperties.some((property) => !property.declaration)
  ) {
    return null;
  }

  if (hasMultilineDefault(instanceProperties)) {
    return null;
  }

  if (hasOptionalBeforeRequired(instanceProperties)) {
    return null;
  }

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const block = indentLines(
    renderConstructor(instanceProperties, { mode: "promoted" }),
    memberIndent(source, instanceDeclarations[0]?.startOffset),
  ).replace(/\n/g, newline);
  const leadingBlankLine = typeBodyHasMembers(source, typeDeclaration)
    ? newline
    : "";
  const trailingBlankLine = closingBraceOnOwnLine(
    source,
    typeDeclaration.bodyEndOffset,
  )
    ? ""
    : newline;
  const removals = instanceDeclarations.map((declaration) => {
    const range = wholeDeclarationLineRange(source, declaration);

    return { ...range, text: "" };
  });
  const insertion = {
    end: typeDeclaration.bodyEndOffset,
    start: typeDeclaration.bodyEndOffset,
    text: `${leadingBlankLine}${block}${newline}${trailingBlankLine}`,
  };
  const edits = [...removals, insertion].sort((left, right) =>
    left.start - right.start || left.end - right.end,
  );

  if (editsOverlap(edits)) {
    return null;
  }

  return { edits };
}

function matchesTypeBody(
  source: string,
  declaration: NonNullable<PhpClassStructure["typeDeclaration"]>,
): boolean {
  return (
    source[declaration.bodyStartOffset] === "{" &&
    source[declaration.bodyEndOffset] === "}" &&
    declaration.bodyStartOffset < declaration.bodyEndOffset
  );
}

function hasMultilineDefault(
  properties: readonly PhpClassStructure["properties"][number][],
): boolean {
  return properties.some(
    (property) =>
      property.defaultValue !== null && /[\r\n]/.test(property.defaultValue),
  );
}

function hasOptionalBeforeRequired(
  properties: readonly PhpClassStructure["properties"][number][],
): boolean {
  let sawOptional = false;

  for (const property of properties) {
    if (property.defaultValue !== null) {
      sawOptional = true;
      continue;
    }

    if (sawOptional) {
      return true;
    }
  }

  return false;
}

function memberIndent(source: string, declarationOffset: number | undefined): string {
  if (declarationOffset === undefined) {
    return "    ";
  }

  const lineStart = source.lastIndexOf("\n", declarationOffset - 1) + 1;
  const before = source.slice(lineStart, declarationOffset);

  return /^[\t ]*$/.test(before) ? before : "";
}

function typeBodyHasMembers(
  source: string,
  declaration: NonNullable<PhpClassStructure["typeDeclaration"]>,
): boolean {
  return source
    .slice(declaration.bodyStartOffset + 1, declaration.bodyEndOffset)
    .trim().length > 0;
}

function closingBraceOnOwnLine(source: string, offset: number): boolean {
  for (let index = offset - 1; index >= 0; index -= 1) {
    const character = source[index] || "";

    if (character === "\n") {
      return true;
    }

    if (character !== " " && character !== "\t" && character !== "\r") {
      return false;
    }
  }

  return true;
}

function uniqueDeclarations(
  structure: PhpClassStructure,
): PhpPropertyDeclaration[] {
  const declarations = new Map<number, PhpPropertyDeclaration>();

  for (const declaration of structure.propertyDeclarations) {
    declarations.set(declaration.startOffset, declaration);
  }

  return [...declarations.values()];
}

function hasConstructor(structure: PhpClassStructure): boolean {
  return structure.methods.some(
    (method) => method.name.toLowerCase() === "__construct",
  );
}

function wholeDeclarationLineRange(
  source: string,
  declaration: PhpPropertyDeclaration,
): { end: number; start: number } {
  const lineStart = source.lastIndexOf("\n", declaration.startOffset - 1) + 1;
  const newlineOffset = source.indexOf("\n", declaration.endOffset);
  const lineEnd = newlineOffset < 0 ? source.length : newlineOffset + 1;
  const before = source.slice(lineStart, declaration.startOffset);
  const after = source.slice(
    declaration.endOffset,
    newlineOffset < 0 ? source.length : newlineOffset,
  );

  if (/^[\t ]*$/.test(before) && /^[\t ]*\r?$/.test(after)) {
    return {
      end: followingBlankLinesEnd(source, lineEnd),
      start: lineStart,
    };
  }

  return { end: declaration.endOffset, start: declaration.startOffset };
}

function followingBlankLinesEnd(source: string, start: number): number {
  let end = start;

  while (end < source.length) {
    const newlineOffset = source.indexOf("\n", end);
    const lineEnd = newlineOffset < 0 ? source.length : newlineOffset + 1;
    const line = source.slice(end, newlineOffset < 0 ? source.length : newlineOffset);

    if (!/^[\t ]*\r?$/.test(line)) {
      break;
    }

    end = lineEnd;
  }

  return end;
}

function editsOverlap(edits: readonly PhpConstructorPromotionEdit[]): boolean {
  for (let index = 1; index < edits.length; index += 1) {
    const previous = edits[index - 1];
    const current = edits[index];

    if (previous && current && previous.end > current.start) {
      return true;
    }
  }

  return false;
}

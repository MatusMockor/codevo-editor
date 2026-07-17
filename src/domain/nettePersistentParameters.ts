import type { EditorPosition } from "./languageServerFeatures";
import {
  parsePhpClassStructure,
  type PhpPropertyMember,
} from "./phpClassStructure";
import { resolvePhpClassName } from "./phpClassNameResolution";
import { maskPhpSource } from "./phpSourceMask";

/**
 * Pure extraction of Nette PERSISTENT PARAMETERS from a presenter/component
 * PHP source, plus position lookups for parameter→declaration navigation.
 *
 * Persistent parameters are declared either with the modern
 * `#[Persistent]` attribute (`Nette\Application\Attributes\Persistent`,
 * Nette 3.1+) or with the legacy `/** @persistent *\/` docblock annotation.
 * Nette only honours PUBLIC, non-static properties, so everything else is
 * skipped. Property parsing rides on `parsePhpClassStructure` and attribute
 * discovery rides on `maskPhpSource` — the masked source turns attributes,
 * comments, and strings into whitespace, so the raw text between a property
 * declaration and the previous member is exactly its docblock/attribute
 * prelude and a string literal can never be misread as an attribute.
 */

export interface NettePersistentParameter {
  defaultValue: string | null;
  name: string;
  type: string | null;
}

export interface NetteActionParameter {
  defaultValue: string | null;
  name: string;
  type: string | null;
}

const PERSISTENT_DOC_ANNOTATION = /@persistent\b/;
const PERSISTENT_ATTRIBUTE_NAME = "Persistent";
const PERSISTENT_ATTRIBUTE_CLASS = "Nette\\Application\\Attributes\\Persistent";
const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;

export function nettePersistentParametersFromSource(
  source: string,
): NettePersistentParameter[] {
  const structure = parsePhpClassStructure(source);

  if (structure.properties.length === 0) {
    return [];
  }

  const masked = maskPhpSource(source);
  const parameters: NettePersistentParameter[] = [];
  const seen = new Set<string>();

  for (const property of structure.properties) {
    if (!isPersistentCandidate(property)) {
      continue;
    }

    if (!isPersistentDeclaration(source, masked, property)) {
      continue;
    }

    if (seen.has(property.name)) {
      continue;
    }

    seen.add(property.name);
    parameters.push({
      defaultValue: property.defaultValue,
      name: property.name,
      type: property.type ?? property.phpDoc?.varType ?? null,
    });
  }

  return parameters;
}

export function nettePersistentParameterPositionInSource(
  source: string,
  name: string,
): EditorPosition | null {
  const structure = parsePhpClassStructure(source);
  const masked = maskPhpSource(source);

  for (const property of structure.properties) {
    if (property.name !== name || !isPersistentCandidate(property)) {
      continue;
    }

    if (!isPersistentDeclaration(source, masked, property)) {
      continue;
    }

    const offset = propertyNameOffset(masked, property);

    if (offset === null) {
      return null;
    }

    return editorPositionAtOffset(source, offset);
  }

  return null;
}

export function netteActionParametersFromSource(
  source: string,
  methodNames: readonly string[],
): NetteActionParameter[] | null {
  const structure = parsePhpClassStructure(source);

  for (const methodName of methodNames) {
    const method = structure.methods.find(
      (candidate) => candidate.name === methodName,
    );

    if (method) {
      return method.parameters.map((parameter) => ({
        defaultValue: parameter.defaultValue,
        name: parameter.name.replace(/^\$/, ""),
        type: parameter.type,
      }));
    }
  }

  return null;
}

export function netteActionParameterPositionInSource(
  source: string,
  methodNames: readonly string[],
  parameterName: string,
): EditorPosition | null {
  const masked = maskPhpSource(source);

  for (const methodName of methodNames) {
    const signature = methodSignatureSpan(masked, methodName);

    if (!signature) {
      continue;
    }

    const offset = dollarNameOffset(
      masked,
      parameterName,
      signature.start,
      signature.end,
    );

    if (offset !== null) {
      return editorPositionAtOffset(source, offset);
    }
  }

  return null;
}

function isPersistentCandidate(property: PhpPropertyMember): boolean {
  return property.visibility === "public" && !property.isStatic;
}

function isPersistentDeclaration(
  source: string,
  masked: string,
  property: PhpPropertyMember,
): boolean {
  if (property.phpDoc && PERSISTENT_DOC_ANNOTATION.test(property.phpDoc.raw)) {
    return true;
  }

  const declarationStart = property.declaration?.startOffset;

  if (declarationStart === undefined) {
    return false;
  }

  const prelude = memberPrelude(source, masked, declarationStart);

  if (PERSISTENT_DOC_ANNOTATION.test(prelude)) {
    return true;
  }

  return hasPersistentAttribute(prelude, source);
}

/**
 * The raw source immediately before a member declaration, bounded by the
 * previous piece of REAL code. In the masked source every attribute, comment,
 * and string is whitespace, so walking back over masked whitespace stops at
 * the previous member's `;` / `}` (or the class body `{`) and the original
 * slice contains exactly the member's docblocks and attributes.
 */
function memberPrelude(
  source: string,
  masked: string,
  declarationStart: number,
): string {
  let start = declarationStart;

  while (start > 0 && isWhitespace(masked[start - 1])) {
    start -= 1;
  }

  return source.slice(start, declarationStart);
}

function hasPersistentAttribute(prelude: string, source: string): boolean {
  for (const content of attributeGroupContents(prelude)) {
    const entries = splitTopLevelEntries(content);

    if (entries.some((entry) => isPersistentAttributeEntry(entry, source))) {
      return true;
    }
  }

  return false;
}

/**
 * The inner text of every balanced `#[...]` attribute group in the prelude.
 * Bracket depth and string literals are tracked, so an argument list with
 * nested brackets (`#[Choice([1, 2]), Persistent]`) stays one group.
 */
function attributeGroupContents(prelude: string): string[] {
  const contents: string[] = [];

  for (let index = 0; index < prelude.length - 1; index += 1) {
    if (prelude[index] !== "#" || prelude[index + 1] !== "[") {
      continue;
    }

    const closeOffset = balancedAttributeClose(prelude, index + 1);

    if (closeOffset === null) {
      break;
    }

    contents.push(prelude.slice(index + 2, closeOffset));
    index = closeOffset;
  }

  return contents;
}

function balancedAttributeClose(
  prelude: string,
  openBracket: number,
): number | null {
  let depth = 0;
  let quote: string | null = null;

  for (let index = openBracket; index < prelude.length; index += 1) {
    const character = prelude[index];

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

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "[") {
      depth += 1;
      continue;
    }

    if (character !== "]") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function splitTopLevelEntries(content: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

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

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "," && depth === 0) {
      entries.push(content.slice(start, index));
      start = index + 1;
    }
  }

  entries.push(content.slice(start));

  return entries;
}

function isPersistentAttributeEntry(entry: string, source: string): boolean {
  const name = (entry.split("(")[0] ?? "").trim();

  if (!name) {
    return false;
  }

  const normalized = name.replace(/^\\+/, "");

  if (normalized === PERSISTENT_ATTRIBUTE_NAME) {
    return true;
  }

  if (normalized.endsWith(`\\${PERSISTENT_ATTRIBUTE_NAME}`)) {
    return true;
  }

  return resolvePhpClassName(source, name) === PERSISTENT_ATTRIBUTE_CLASS;
}

function propertyNameOffset(
  masked: string,
  property: PhpPropertyMember,
): number | null {
  const declaration = property.declaration;

  if (!declaration) {
    return null;
  }

  return dollarNameOffset(
    masked,
    property.name,
    declaration.startOffset,
    declaration.endOffset,
  );
}

function dollarNameOffset(
  masked: string,
  name: string,
  start: number,
  end: number,
): number | null {
  const needle = `$${name}`;

  for (
    let offset = masked.indexOf(needle, start);
    offset >= 0 && offset < end;
    offset = masked.indexOf(needle, offset + 1)
  ) {
    const boundary = masked[offset + needle.length];

    if (boundary === undefined || !IDENTIFIER_CHAR.test(boundary)) {
      return offset;
    }
  }

  return null;
}

interface MethodSignatureSpan {
  end: number;
  start: number;
}

function methodSignatureSpan(
  masked: string,
  methodName: string,
): MethodSignatureSpan | null {
  const pattern = new RegExp(`\\bfunction\\s+&?${methodName}\\s*\\(`);
  const match = pattern.exec(masked);

  if (!match) {
    return null;
  }

  const openParen = match.index + match[0].length - 1;
  let depth = 0;

  for (let index = openParen; index < masked.length; index += 1) {
    const character = masked[index];

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character !== ")") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return { end: index, start: openParen + 1 };
    }
  }

  return null;
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const before = source.slice(0, Math.max(0, offset));
  const lines = before.split("\n");

  return {
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    lineNumber: lines.length,
  };
}

function isWhitespace(character: string | undefined): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}

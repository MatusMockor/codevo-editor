export interface PhpNetteDatabaseTypeFamily {
  activeRowType: string;
  selectionType: string;
}

export type PhpNetteDatabaseTypes = PhpNetteDatabaseTypeFamily;
export type PhpNetteDatabaseTypeKind =
  | "activeRow"
  | "repository"
  | "selection";

const REPOSITORY_TRAIT_IMPORT =
  /\buse\s+\\?([A-Za-z_][A-Za-z0-9_\\]*\\Repository\\([A-Za-z_][A-Za-z0-9_]*)RepositoryTrait)\s*;/g;
const ACTIVE_ROW_TYPE_IMPORT =
  /\buse\s+\\?([A-Za-z_][A-Za-z0-9_\\]*\\ActiveRow\\([A-Za-z_][A-Za-z0-9_]*)ActiveRow)\s*;/g;
const SELECTION_TYPE_IMPORT =
  /\buse\s+\\?([A-Za-z_][A-Za-z0-9_\\]*\\Selection\\([A-Za-z_][A-Za-z0-9_]*)Selection)\s*;/g;

export function phpNetteDatabaseTypeFamilyFromRepositorySource(
  source: string,
): PhpNetteDatabaseTypeFamily | null {
  const trait = repositoryTraitImportsUsedByClass(source)[0] ?? null;

  if (trait) {
    const namespacePrefix = trait[1].slice(
      0,
      trait[1].lastIndexOf("\\Repository\\"),
    );
    const familyName = trait[2];

    return {
      activeRowType: `${namespacePrefix}\\ActiveRow\\${familyName}ActiveRow`,
      selectionType: `${namespacePrefix}\\Selection\\${familyName}Selection`,
    };
  }

  const activeRow = firstMatch(ACTIVE_ROW_TYPE_IMPORT, source);
  const selection = firstMatch(SELECTION_TYPE_IMPORT, source);

  if (!activeRow || !selection || activeRow[2] !== selection[2]) {
    return null;
  }

  return {
    activeRowType: activeRow[1],
    selectionType: selection[1],
  };
}

export function phpNetteDatabaseTypeKind(
  className: string,
): PhpNetteDatabaseTypeKind | null {
  const normalized = normalizedSingleType(className);

  if (!normalized) {
    return null;
  }

  if (/\\ActiveRow\\[^\\]+ActiveRow$/i.test(normalized)) {
    return "activeRow";
  }

  if (/\\Selection\\[^\\]+Selection$/i.test(normalized)) {
    return "selection";
  }

  if (/Repository(?:Interface)?$/i.test(normalized)) {
    return "repository";
  }

  return null;
}

export function phpNetteDatabaseTypesFromSource(
  source: string,
  _className: string,
): PhpNetteDatabaseTypes | null {
  return phpNetteDatabaseTypeFamilyFromRepositorySource(source);
}

export function phpNetteRepositoryTraitClassNames(
  source: string,
  _className: string,
): string[] {
  return [
    ...new Set(repositoryTraitImportsUsedByClass(source).map((match) => match[1])),
  ];
}

export function phpNetteSiblingDatabaseType(
  carrierType: string,
  kind: "activeRow" | "selection",
  tableName?: string,
): string | null {
  const normalized = normalizedSingleType(carrierType);

  if (!normalized) {
    return null;
  }

  const activeRowMarker = "\\ActiveRow\\";
  const selectionMarker = "\\Selection\\";
  const normalizedLowerCase = normalized.toLowerCase();
  const marker = normalizedLowerCase.includes(activeRowMarker.toLowerCase())
    ? activeRowMarker
    : normalizedLowerCase.includes(selectionMarker.toLowerCase())
      ? selectionMarker
      : null;

  if (!marker) {
    return null;
  }

  const markerIndex = normalizedLowerCase.indexOf(marker.toLowerCase());
  const namespacePrefix = normalized.slice(0, markerIndex);
  const sourceShortName = normalized.slice(
    markerIndex + marker.length,
  );
  const sourceStem = sourceShortName.replace(/(?:ActiveRow|Selection)$/i, "");
  const targetStem = tableName ? phpNetteTableTypeStem(tableName) : sourceStem;

  if (!targetStem) {
    return null;
  }

  return kind === "activeRow"
    ? `${namespacePrefix}${activeRowMarker}${targetStem}ActiveRow`
    : `${namespacePrefix}${selectionMarker}${targetStem}Selection`;
}

export function phpNetteTableNameFromRepositorySource(
  source: string,
): string | null {
  const match =
    /\b(?:protected|public|private)\s+(?:(?:readonly|static)\s+)*(?:\??string\s+)?\$tableName\s*=\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*;/.exec(
      source,
    );

  return match?.[2] ?? null;
}

export function phpNetteLiteralTableArgument(
  callExpression?: string,
): string | null {
  if (!callExpression) {
    return null;
  }

  const outerCall = outerRelationCall(callExpression);

  if (!outerCall) {
    return null;
  }

  const argument = maskPhpComments(
    firstTopLevelArgument(outerCall.arguments),
  ).trim();
  const literal = /^(['"])([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\1$/.exec(
    argument,
  );

  if (!literal) {
    return null;
  }

  if (outerCall.method === "ref" && literal[2].includes(".")) {
    return null;
  }

  return literal[2].split(".", 1)[0] ?? null;
}

export function phpNetteFetchPairsReturnsRows(
  callExpression?: string,
): boolean {
  if (!callExpression) {
    return false;
  }

  const outerCall = outerMethodCall(callExpression);

  if (!outerCall || outerCall.method !== "fetchpairs") {
    return false;
  }

  const arguments_ = topLevelArguments(outerCall.arguments);

  if (arguments_.length < 1 || arguments_.length > 2) {
    return false;
  }

  const key = maskPhpComments(arguments_[0] ?? "").trim();

  if (!/^(['"])[A-Za-z_][A-Za-z0-9_.]*\1$/.test(key)) {
    return false;
  }

  if (arguments_.length === 1) {
    return true;
  }

  return /^null$/i.test(maskPhpComments(arguments_[1] ?? "").trim());
}

function normalizedSingleType(typeName: string | null): string | null {
  const normalized = typeName?.trim() ?? "";

  if (!normalized || normalized.includes("&")) {
    return null;
  }

  const expanded = normalized.startsWith("?")
    ? `${normalized.slice(1)}|null`
    : normalized;
  const objectTypes = expanded
    .split("|")
    .map((part) => part.trim().replace(/^\\+/, ""))
    .filter((part) => !/^(?:false|null)$/i.test(part));
  const objectFamilies = new Map<string, string[]>();

  for (const objectType of objectTypes) {
    const family = objectType.toLowerCase();
    const spellings = objectFamilies.get(family) ?? [];
    spellings.push(objectType);
    objectFamilies.set(family, spellings);
  }

  if (objectFamilies.size !== 1) {
    return null;
  }

  const spellings = objectFamilies.values().next().value;

  if (!spellings || spellings.length === 0) {
    return null;
  }

  return preferredPhpTypeSpelling(spellings);
}

function outerRelationCall(
  expression: string,
): { arguments: string; method: "ref" | "related" } | null {
  const call = outerMethodCall(expression);

  if (!call || (call.method !== "ref" && call.method !== "related")) {
    return null;
  }

  return {
    arguments: call.arguments,
    method: call.method,
  };
}

function outerMethodCall(
  expression: string,
): { arguments: string; method: string } | null {
  const source = expression.trim();
  const code = maskPhpComments(source);
  const codeEnd = code.trimEnd().length;

  if (codeEnd === 0 || code[codeEnd - 1] !== ")") {
    return null;
  }

  const parentheses: number[] = [];
  let outerOpen = -1;
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < codeEnd; index += 1) {
    const char = code[index];

    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "(") {
      parentheses.push(index);
      continue;
    }

    if (char !== ")") {
      continue;
    }

    const open = parentheses.pop();

    if (open === undefined) {
      return null;
    }

    if (index === codeEnd - 1) {
      outerOpen = open;
    }
  }

  if (quote || parentheses.length > 0 || outerOpen < 0) {
    return null;
  }

  const call = /(?:->|\?->)\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(
    code.slice(0, outerOpen),
  );

  if (!call) {
    return null;
  }

  const receiver = code.slice(0, call.index).trim();

  if (!isWholePhpReceiverExpression(receiver)) {
    return null;
  }

  return {
    arguments: source.slice(outerOpen + 1, codeEnd - 1),
    method: call[1].toLowerCase(),
  };
}

function isWholePhpReceiverExpression(expression: string): boolean {
  const code = expression.trim();
  let index = phpReceiverAtomEnd(code, 0);

  if (index === null) {
    return false;
  }

  while (index < code.length) {
    index = skipWhitespace(code, index);

    if (index >= code.length) {
      return true;
    }

    if (code[index] === "[") {
      const close = matchingPhpDelimiter(code, index, "[", "]");

      if (close === null) {
        return false;
      }

      index = close + 1;
      continue;
    }

    const operatorLength = code.startsWith("?->", index)
      ? 3
      : code.startsWith("->", index)
        ? 2
        : 0;

    if (operatorLength === 0) {
      return false;
    }

    index = skipWhitespace(code, index + operatorLength);
    const member = /^[A-Za-z_][A-Za-z0-9_]*/.exec(code.slice(index));

    if (!member?.[0]) {
      return false;
    }

    index = skipWhitespace(code, index + member[0].length);

    if (code[index] !== "(") {
      continue;
    }

    const close = matchingPhpDelimiter(code, index, "(", ")");

    if (close === null) {
      return false;
    }

    index = close + 1;
  }

  return true;
}

function phpReceiverAtomEnd(code: string, start: number): number | null {
  const index = skipWhitespace(code, start);
  const variable = /^\$[A-Za-z_][A-Za-z0-9_]*/.exec(code.slice(index));

  if (variable?.[0]) {
    return index + variable[0].length;
  }

  if (code[index] === "(") {
    const close = matchingPhpDelimiter(code, index, "(", ")");

    if (close === null || !isWholePhpReceiverExpression(code.slice(index + 1, close))) {
      return null;
    }

    return close + 1;
  }

  const newClass = /^new\s+\\?[A-Za-z_][A-Za-z0-9_\\]*/i.exec(
    code.slice(index),
  );

  if (newClass?.[0]) {
    const end = skipWhitespace(code, index + newClass[0].length);

    if (code[end] !== "(") {
      return end;
    }

    const close = matchingPhpDelimiter(code, end, "(", ")");
    return close === null ? null : close + 1;
  }

  const callable = /^(?:\\?[A-Za-z_][A-Za-z0-9_\\]*)(?:\s*::\s*[A-Za-z_][A-Za-z0-9_]*)?\s*/.exec(
    code.slice(index),
  );

  if (!callable?.[0]) {
    return null;
  }

  const open = index + callable[0].length;

  if (code[open] !== "(") {
    return null;
  }

  const close = matchingPhpDelimiter(code, open, "(", ")");
  return close === null ? null : close + 1;
}

function matchingPhpDelimiter(
  source: string,
  openOffset: number,
  open: "(" | "[",
  close: ")" | "]",
): number | null {
  let depth = 0;
  let quote: "'" | '"' | null = null;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index];

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

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character !== close) {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function skipWhitespace(source: string, start: number): number {
  let index = start;

  while (/\s/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function topLevelArguments(argumentsSource: string): string[] {
  const code = maskPhpComments(argumentsSource);

  if (!code.trim()) {
    return [];
  }

  const arguments_: string[] = [];
  const delimiters: string[] = [];
  let quote: "'" | '"' | null = null;
  let argumentStart = 0;

  for (let index = 0; index < code.length; index += 1) {
    const character = code[index];

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
      delimiters.push(character);
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      const expected = character === ")" ? "(" : character === "]" ? "[" : "{";

      if (delimiters.pop() !== expected) {
        return [];
      }

      continue;
    }

    if (character !== "," || delimiters.length > 0) {
      continue;
    }

    const argument = argumentsSource.slice(argumentStart, index).trim();

    if (!argument) {
      return [];
    }

    arguments_.push(argument);
    argumentStart = index + 1;
  }

  if (quote || delimiters.length > 0) {
    return [];
  }

  const finalArgument = argumentsSource.slice(argumentStart).trim();

  if (!finalArgument) {
    return [];
  }

  arguments_.push(finalArgument);
  return arguments_;
}

function firstTopLevelArgument(argumentsSource: string): string {
  const code = maskPhpComments(argumentsSource);
  const delimiters: string[] = [];
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];

    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      delimiters.push(char);
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      delimiters.pop();
      continue;
    }

    if (char === "," && delimiters.length === 0) {
      return argumentsSource.slice(0, index).trim();
    }
  }

  return argumentsSource.trim();
}

function preferredPhpTypeSpelling(spellings: readonly string[]): string | null {
  let preferred = spellings[0] ?? null;

  if (!preferred) {
    return null;
  }

  for (const spelling of spellings.slice(1)) {
    if (phpTypeCasingScore(spelling) <= phpTypeCasingScore(preferred)) {
      continue;
    }

    preferred = spelling;
  }

  return preferred;
}

function phpTypeCasingScore(typeName: string): number {
  return typeName
    .split("\\")
    .filter((part) => /^[A-Z][A-Za-z0-9_]*$/.test(part) && /[a-z]/.test(part))
    .length;
}

function maskPhpComments(source: string): string {
  const masked = [...source];
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "/" && next === "*") {
      masked[index] = " ";
      masked[index + 1] = " ";
      index += 2;

      while (index < source.length) {
        const isEnd = source[index] === "*" && source[index + 1] === "/";
        masked[index] = " ";

        if (isEnd) {
          masked[index + 1] = " ";
          index += 1;
          break;
        }

        index += 1;
      }

      continue;
    }

    if ((char === "/" && next === "/") || char === "#") {
      while (
        index < source.length &&
        source[index] !== "\n" &&
        source[index] !== "\r"
      ) {
        masked[index] = " ";
        index += 1;
      }
    }
  }

  return masked.join("");
}

function firstMatch(pattern: RegExp, source: string): RegExpExecArray | null {
  pattern.lastIndex = 0;
  return pattern.exec(source);
}

function allMatches(pattern: RegExp, source: string): RegExpExecArray[] {
  pattern.lastIndex = 0;
  return [...source.matchAll(pattern)];
}

function repositoryTraitImportsUsedByClass(
  source: string,
): RegExpExecArray[] {
  const usedTraitNames = new Set(
    [...source.matchAll(/\buse\s+([A-Za-z_][A-Za-z0-9_]*RepositoryTrait)\s*;/g)].map(
      (match) => match[1],
    ),
  );

  if (usedTraitNames.size === 0) {
    return [];
  }

  return allMatches(REPOSITORY_TRAIT_IMPORT, source).filter((match) =>
    usedTraitNames.has(`${match[2]}RepositoryTrait`),
  );
}

function phpNetteTableTypeStem(tableName: string): string {
  return tableName
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

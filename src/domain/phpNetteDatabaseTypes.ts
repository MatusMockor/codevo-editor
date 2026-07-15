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
  const source = expression.trim();
  const code = maskPhpComments(source);

  if (!code.endsWith(")")) {
    return null;
  }

  const parentheses: number[] = [];
  let outerOpen = -1;
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

    if (index === code.length - 1) {
      outerOpen = open;
    }
  }

  if (quote || parentheses.length > 0 || outerOpen < 0) {
    return null;
  }

  const call = /(?:->|\?->)\s*(ref|related)\s*$/i.exec(
    code.slice(0, outerOpen),
  );

  if (!call) {
    return null;
  }

  return {
    arguments: source.slice(outerOpen + 1, -1),
    method: call[1].toLowerCase() as "ref" | "related",
  };
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
      while (index < source.length && source[index] !== "\n") {
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

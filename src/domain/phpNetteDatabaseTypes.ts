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

  if (/\\ActiveRow\\[^\\]+ActiveRow$/.test(normalized)) {
    return "activeRow";
  }

  if (/\\Selection\\[^\\]+Selection$/.test(normalized)) {
    return "selection";
  }

  if (/Repository(?:Interface)?$/.test(normalized)) {
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
  const marker = normalized.includes(activeRowMarker)
    ? activeRowMarker
    : normalized.includes(selectionMarker)
      ? selectionMarker
      : null;

  if (!marker) {
    return null;
  }

  const namespacePrefix = normalized.slice(0, normalized.indexOf(marker));
  const sourceShortName = normalized.slice(
    normalized.indexOf(marker) + marker.length,
  );
  const sourceStem = sourceShortName.replace(/(?:ActiveRow|Selection)$/, "");
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

  const matches = [
    ...callExpression.matchAll(
      /(?:->|\?->)\s*(?:ref|related)\s*\(\s*([^,)]*)/g,
    ),
  ];
  const match = matches[matches.length - 1];
  const argument = match?.[1]?.trim() ?? "";
  const literal = /^(['"])([A-Za-z_][A-Za-z0-9_]*)\1$/.exec(argument);

  return literal?.[2] ?? null;
}

function normalizedSingleType(typeName: string | null): string | null {
  const normalized = typeName?.trim().replace(/^\\+/, "") ?? "";

  if (!normalized || normalized.includes("|") || normalized.includes("&")) {
    return null;
  }

  return normalized;
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

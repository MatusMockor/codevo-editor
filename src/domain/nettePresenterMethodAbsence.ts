import type { PhpTypeDeclarationIdentity } from "./phpClassStructure";

export interface NettePresenterClassTarget {
  bodyEndOffset: number;
  bodyStartOffset: number;
  name?: string;
}

const NETTE_PRESENTER_FQN = "Nette\\Application\\UI\\Presenter";
const DIRECT_NETTE_PRESENTER_PARENTS = new Set([
  "\\Nette\\Application\\UI\\Presenter",
  NETTE_PRESENTER_FQN,
]);

export function canProveNettePresenterMethodAbsenceLocally(
  source: string,
  target?: NettePresenterClassTarget | PhpTypeDeclarationIdentity,
): boolean {
  const classTarget = target ?? firstClassTarget(source);

  if (!classTarget) {
    return false;
  }

  if (hasTraitUseInsideClass(source, classTarget)) {
    return false;
  }

  const parent = classParent(source, classTarget);

  if (parent === null) {
    return true;
  }

  if (DIRECT_NETTE_PRESENTER_PARENTS.has(parent)) {
    return true;
  }

  if (parent !== "Presenter") {
    return false;
  }

  return barePresenterParentResolvesToNette(source, classTarget);
}

function firstClassTarget(source: string): NettePresenterClassTarget | null {
  const match = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(source);

  if (!match) {
    return null;
  }

  const bodyStart = source.indexOf("{", match.index);

  if (bodyStart < 0) {
    return null;
  }

  return {
    bodyEndOffset: firstClassBodyEnd(source, bodyStart),
    bodyStartOffset: bodyStart,
    name: match[1],
  };
}

function hasTraitUseInsideClass(
  source: string,
  target: NettePresenterClassTarget,
): boolean {
  const body = source.slice(target.bodyStartOffset + 1, target.bodyEndOffset);

  return /^\s*use\s+[^;]+;/m.test(body);
}

function classParent(
  source: string,
  target: NettePresenterClassTarget,
): string | null {
  if (target.name) {
    return namedClassParent(source, target);
  }

  const match =
    /\bclass\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+extends\s+([\\A-Za-z_][\\A-Za-z0-9_]*))?/.exec(
      source,
    );

  return match?.[1] ?? null;
}

function namedClassParent(
  source: string,
  target: NettePresenterClassTarget,
): string | null {
  const header = source.slice(0, target.bodyStartOffset);
  const classPattern = new RegExp(
    `\\bclass\\s+${escapeRegExp(target.name ?? "")}\\b(?:\\s+extends\\s+([\\\\A-Za-z_][\\\\A-Za-z0-9_]*))?`,
    "g",
  );
  let parent: string | null = null;

  for (const match of header.matchAll(classPattern)) {
    parent = match[1] ?? null;
  }

  return parent;
}

function barePresenterParentResolvesToNette(
  source: string,
  target: NettePresenterClassTarget,
): boolean {
  const header = source.slice(0, target.bodyStartOffset);
  const importedPresenter = topLevelUseImportForShortName(header, "Presenter");

  if (importedPresenter === null) {
    return true;
  }

  return importedPresenter === NETTE_PRESENTER_FQN;
}

function topLevelUseImportForShortName(
  header: string,
  shortName: string,
): string | null {
  const importPattern = /^\s*use\s+(?!function\b|const\b)([^;]+);/gim;

  for (const match of header.matchAll(importPattern)) {
    const importClause = match[1]?.trim();

    if (!importClause) {
      continue;
    }

    const importedName = useImportForShortName(importClause, shortName);

    if (importedName !== null) {
      return importedName;
    }
  }

  return null;
}

function useImportForShortName(
  importClause: string,
  shortName: string,
): string | null {
  if (importClause.includes("{")) {
    return groupedUseImportForShortName(importClause, shortName);
  }

  return matchingImportName(parseUseImport(importClause), shortName);
}

function groupedUseImportForShortName(
  importClause: string,
  shortName: string,
): string | null {
  const match = /^(.*?)\{([\s\S]+)\}$/.exec(importClause);
  const prefix = match?.[1]?.trim().replace(/\\+$/, "") ?? "";
  const body = match?.[2] ?? "";

  if (!prefix || !body) {
    return null;
  }

  for (const entry of body.split(",")) {
    const importedName = matchingImportName(
      parseUseImport(`${prefix}\\${entry.trim()}`),
      shortName,
    );

    if (importedName !== null) {
      return importedName;
    }
  }

  return null;
}

function matchingImportName(
  parsedImport: { alias: string; name: string } | null,
  shortName: string,
): string | null {
  if (!parsedImport) {
    return null;
  }

  if (parsedImport.alias.toLowerCase() !== shortName.toLowerCase()) {
    return null;
  }

  return parsedImport.name;
}

function parseUseImport(
  importClause: string,
): { alias: string; name: string } | null {
  const aliasMatch = /^(.*?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(
    importClause,
  );
  const name = (aliasMatch?.[1] ?? importClause).trim().replace(/^\\+/, "");
  const alias = aliasMatch?.[2] ?? name.split("\\").pop() ?? "";

  if (!name || !alias) {
    return null;
  }

  return { alias, name };
}

function firstClassBodyEnd(source: string, bodyStart: number): number {
  let depth = 0;

  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character !== "}") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return source.length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

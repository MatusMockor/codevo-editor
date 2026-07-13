import type { PhpTypeDeclarationIdentity } from "./phpClassStructure";

export type NetteBarePresenterParentPolicy = "accept" | "resolve-import";

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
  options: {
    barePresenterParentPolicy?: NetteBarePresenterParentPolicy;
  } = {},
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

  if ((options.barePresenterParentPolicy ?? "accept") === "accept") {
    return true;
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
  const importPattern =
    /^\s*use\s+([^;{]+?)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;/gim;

  for (const match of header.matchAll(importPattern)) {
    const importedName = match[1]?.trim();

    if (!importedName) {
      continue;
    }

    const alias = match[2]?.trim() ?? importedName.split("\\").pop();

    if (alias !== shortName) {
      continue;
    }

    return importedName.replace(/^\\/, "");
  }

  return null;
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

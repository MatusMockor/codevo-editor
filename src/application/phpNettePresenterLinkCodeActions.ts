import {
  detectPhpPresenterLinkAt,
  nettePresenterActionMethodCandidates,
  parseNetteLinkTarget,
} from "../domain/latteLinkNavigation";
import {
  parsePhpClassStructure,
  phpTopLevelTypeDeclarationNames,
  type PhpClassStructure,
  type PhpTypeDeclarationIdentity,
} from "../domain/phpClassStructure";
import { renderCreateMethodStub } from "../domain/phpCreateFromUsage";
import { phpClassBodyInsertionAction } from "./phpClassGenerateCodeActions";
import { phpPreferredQuickfix } from "./phpCreateMemberCodeActions";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

const PRESENTER_SUFFIX = "Presenter";
const NETTE_PRESENTER_FQN = "Nette\\Application\\UI\\Presenter";
const DIRECT_NETTE_PRESENTER_PARENTS = new Set([
  "\\Nette\\Application\\UI\\Presenter",
  "Nette\\Application\\UI\\Presenter",
]);

interface ActivePresenterClass {
  name: string;
  structure: PhpClassStructure;
  typeDeclaration: PhpTypeDeclarationIdentity;
}

export function phpNettePresenterLinkCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const detection = detectPhpPresenterLinkAt(source, range.start);

  if (!detection) {
    return null;
  }

  if (!isCurrentPresenterLinkCall(source, detection)) {
    return null;
  }

  const target = parseNetteLinkTarget(detection.target);

  if (!target || target.absolute || target.module) {
    return null;
  }

  const activeClass = activePresenterClassAt(source, detection.targetStart);

  if (!activeClass || !isEligiblePresenterClass(activeClass, target.presenter)) {
    return null;
  }

  if (!canProvePresenterMethodAbsenceLocally(source, activeClass)) {
    return null;
  }

  const candidateMethodNames = nettePresenterActionMethodCandidates(
    target.action,
    target.isSignal,
  );

  if (candidateMethodNames.length === 0) {
    return null;
  }

  const existingMethodNames = new Set(
    activeClass.structure.methods.map((method) => method.name.toLowerCase()),
  );

  if (
    candidateMethodNames.some((methodName) =>
      existingMethodNames.has(methodName.toLowerCase()),
    )
  ) {
    return null;
  }

  return createPresenterMethodAction(
    source,
    activeClass.typeDeclaration,
    candidateMethodNames[0] ?? "",
  );
}

function activePresenterClassAt(
  source: string,
  offset: number,
): ActivePresenterClass | null {
  for (const className of phpTopLevelTypeDeclarationNames(source)) {
    const structure = parsePhpClassStructure(source, className);
    const typeDeclaration = structure.typeDeclaration;

    if (!typeDeclaration) {
      continue;
    }

    if (
      offset < typeDeclaration.bodyStartOffset ||
      offset > typeDeclaration.bodyEndOffset
    ) {
      continue;
    }

    return { name: className, structure, typeDeclaration };
  }

  return null;
}

function isEligiblePresenterClass(
  activeClass: ActivePresenterClass,
  targetPresenter: string | null,
): boolean {
  if (!activeClass.name.endsWith(PRESENTER_SUFFIX)) {
    return false;
  }

  if (targetPresenter === null) {
    return true;
  }

  return activeClass.name.slice(0, -PRESENTER_SUFFIX.length) === targetPresenter;
}

function canProvePresenterMethodAbsenceLocally(
  source: string,
  activeClass: ActivePresenterClass,
): boolean {
  if (hasTraitUseInsideClass(source, activeClass.typeDeclaration)) {
    return false;
  }

  const parent = classParent(source, activeClass);

  if (parent === null) {
    return true;
  }

  if (DIRECT_NETTE_PRESENTER_PARENTS.has(parent)) {
    return true;
  }

  if (parent !== "Presenter") {
    return false;
  }

  return barePresenterParentResolvesToNette(source, activeClass);
}

function hasTraitUseInsideClass(
  source: string,
  typeDeclaration: PhpTypeDeclarationIdentity,
): boolean {
  const body = source.slice(
    typeDeclaration.bodyStartOffset + 1,
    typeDeclaration.bodyEndOffset,
  );

  return /^\s*use\s+[^;]+;/m.test(body);
}

function classParent(
  source: string,
  activeClass: ActivePresenterClass,
): string | null {
  const header = source.slice(0, activeClass.typeDeclaration.bodyStartOffset);
  const classPattern = new RegExp(
    `\\bclass\\s+${escapeRegExp(activeClass.name)}\\b(?:\\s+extends\\s+([\\\\A-Za-z_][\\\\A-Za-z0-9_]*))?`,
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
  activeClass: ActivePresenterClass,
): boolean {
  const header = source.slice(0, activeClass.typeDeclaration.bodyStartOffset);
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

function isCurrentPresenterLinkCall(
  source: string,
  detection: { call: string; targetStart: number },
): boolean {
  const callPrefix = source.slice(
    Math.max(0, detection.targetStart - 300),
    detection.targetStart,
  );
  const callName = escapeRegExp(detection.call);
  const currentPresenterCallPattern = new RegExp(
    String.raw`\$this\s*->\s*${callName}\b\s*\([^;{}]*['"]$`,
    "s",
  );

  return currentPresenterCallPattern.test(callPrefix);
}

function createPresenterMethodAction(
  source: string,
  typeDeclaration: PhpTypeDeclarationIdentity,
  methodName: string,
): PhpCodeActionDescriptor | null {
  if (methodName.length === 0) {
    return null;
  }

  const stub = renderCreateMethodStub(methodName, [], {
    indent: "",
    target: { kind: "class", relationship: "self" },
    visibility: "public",
  });

  if (!stub) {
    return null;
  }

  return phpPreferredQuickfix(
    phpClassBodyInsertionAction(source, stub, `Create ${methodName}`, {
      bodyStartOffset: typeDeclaration.bodyStartOffset,
    }),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

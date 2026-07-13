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
import { canProveNettePresenterMethodAbsenceLocally } from "../domain/nettePresenterMethodAbsence";
import { phpClassBodyInsertionAction } from "./phpClassGenerateCodeActions";
import { phpPreferredQuickfix } from "./phpCreateMemberCodeActions";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

const PRESENTER_SUFFIX = "Presenter";

interface ActivePresenterClass {
  name: string;
  structure: PhpClassStructure;
  typeDeclaration: PhpTypeDeclarationIdentity;
}

export function phpNettePresenterLinkCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  return phpNettePresenterLinkCodeActions(source, range)[0] ?? null;
}

export function phpNettePresenterLinkCodeActions(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor[] {
  const detection = detectPhpPresenterLinkAt(source, range.start);

  if (!detection) {
    return [];
  }

  if (!isCurrentPresenterLinkCall(source, detection)) {
    return [];
  }

  const target = parseNetteLinkTarget(detection.target);

  if (!target || target.absolute || target.module) {
    return [];
  }

  const activeClass = activePresenterClassAt(source, detection.targetStart);

  if (!activeClass || !isEligiblePresenterClass(activeClass, target.presenter)) {
    return [];
  }

  if (
    !canProveNettePresenterMethodAbsenceLocally(
      source,
      {
        ...activeClass.typeDeclaration,
        name: activeClass.name,
      },
      { barePresenterParentPolicy: "resolve-import" },
    )
  ) {
    return [];
  }

  const candidateMethodNames = nettePresenterActionMethodCandidates(
    target.action,
    target.isSignal,
  );

  if (candidateMethodNames.length === 0) {
    return [];
  }

  const existingMethodNames = new Set(
    activeClass.structure.methods.map((method) => method.name.toLowerCase()),
  );

  if (
    candidateMethodNames.some((methodName) =>
      existingMethodNames.has(methodName.toLowerCase()),
    )
  ) {
    return [];
  }

  return candidateMethodNames.flatMap((methodName, index) => {
    const action = createPresenterMethodAction(
      source,
      activeClass.typeDeclaration,
      methodName,
      index === 0,
    );

    return action ? [action] : [];
  });
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
  isPreferred: boolean,
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

  const action = phpClassBodyInsertionAction(
    source,
    stub,
    `Create ${methodName}`,
    {
      bodyStartOffset: typeDeclaration.bodyStartOffset,
    },
  );

  if (isPreferred) {
    return phpPreferredQuickfix(action);
  }

  return action
    ? {
        ...action,
        kind: "quickfix",
      }
    : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

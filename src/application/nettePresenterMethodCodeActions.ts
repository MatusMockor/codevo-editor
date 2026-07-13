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
import type { NettePresenterLinkDiagnosticData } from "./nettePresenterLinkDiagnostics";
import type { PhpCodeActionDescriptor } from "./phpCodeActionTypes";

export interface NettePresenterMethodCodeActionInput {
  candidateMethodNames: NettePresenterLinkDiagnosticData["candidateMethodNames"];
  presenterPath: NettePresenterLinkDiagnosticData["presenterPath"];
  presenterSource: string;
}

interface PresenterClassTarget {
  structure: PhpClassStructure;
  typeDeclaration: PhpTypeDeclarationIdentity;
}

export function nettePresenterMethodCodeActionsFromDiagnosticData({
  candidateMethodNames,
  presenterPath,
  presenterSource,
}: NettePresenterMethodCodeActionInput): PhpCodeActionDescriptor[] {
  if (candidateMethodNames.length === 0) {
    return [];
  }

  const target = safePresenterClassTarget(
    presenterSource,
    presenterClassNameFromPath(presenterPath),
  );

  if (!target) {
    return [];
  }

  const existingMethodNames = new Set(
    target.structure.methods.map((method) => method.name.toLowerCase()),
  );

  if (
    candidateMethodNames.some((methodName) =>
      existingMethodNames.has(methodName.toLowerCase()),
    )
  ) {
    return [];
  }

  let preferredAssigned = false;

  return candidateMethodNames.flatMap((methodName) => {
    const action = createPresenterMethodAction(
      presenterSource,
      presenterPath,
      target.typeDeclaration,
      methodName,
      !preferredAssigned,
    );

    if (!action) {
      return [];
    }

    preferredAssigned = true;
    return [action];
  });
}

function safePresenterClassTarget(
  source: string,
  expectedClassName: string | null,
): PresenterClassTarget | null {
  for (const className of phpTopLevelTypeDeclarationNames(source)) {
    if (expectedClassName && className !== expectedClassName) {
      continue;
    }

    const structure = parsePhpClassStructure(source, className);
    const typeDeclaration = structure.typeDeclaration;

    if (
      !typeDeclaration ||
      (structure.kind !== "class" && structure.kind !== "abstract-class")
    ) {
      continue;
    }

    if (
      !canProveNettePresenterMethodAbsenceLocally(
        source,
        typeDeclaration,
        { barePresenterParentPolicy: "accept" },
      )
    ) {
      continue;
    }

    return { structure, typeDeclaration };
  }

  return null;
}

function presenterClassNameFromPath(path: string): string | null {
  const fileName = path.split(/[\\/]/).pop();

  if (!fileName?.endsWith(".php")) {
    return null;
  }

  const className = fileName.slice(0, -".php".length);

  return className.endsWith("Presenter") ? className : null;
}

function createPresenterMethodAction(
  source: string,
  path: string,
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

  if (!action) {
    return null;
  }

  const crossFileAction: PhpCodeActionDescriptor = {
    ...action,
    edits: action.edits.map((edit) => ({ ...edit, path })),
    kind: "quickfix",
  };

  return isPreferred ? phpPreferredQuickfix(crossFileAction) : crossFileAction;
}

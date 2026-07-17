import {
  parsePhpClassStructure,
  phpTopLevelTypeDeclarationNames,
  type PhpClassStructure,
  type PhpTypeDeclarationIdentity,
} from "../domain/phpClassStructure";
import { canProveNettePresenterMethodAbsenceLocally } from "../domain/nettePresenterMethodAbsence";
import { createNettePresenterMethodAction } from "./nettePresenterMethodActionFactory";
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
    const action = createNettePresenterMethodAction({
      editPath: presenterPath,
      isPreferred: !preferredAssigned,
      methodName,
      source: presenterSource,
      typeDeclaration: target.typeDeclaration,
    });

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
      !canProveNettePresenterMethodAbsenceLocally(source, typeDeclaration)
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

import type { PhpTypeDeclarationIdentity } from "../domain/phpClassStructure";
import { renderCreateMethodStub } from "../domain/phpCreateFromUsage";
import { phpClassBodyInsertionAction } from "./phpClassGenerateCodeActions";
import { phpPreferredQuickfix } from "./phpCreateMemberCodeActions";
import type { PhpCodeActionDescriptor } from "./phpCodeActionTypes";

export interface NettePresenterMethodActionFactoryInput {
  editPath?: string;
  isPreferred: boolean;
  methodName: string;
  source: string;
  typeDeclaration: PhpTypeDeclarationIdentity;
}

export function createNettePresenterMethodAction({
  editPath,
  isPreferred,
  methodName,
  source,
  typeDeclaration,
}: NettePresenterMethodActionFactoryInput): PhpCodeActionDescriptor | null {
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

  const quickfixAction = {
    ...action,
    edits: editPath
      ? action.edits.map((edit) => ({ ...edit, path: editPath }))
      : action.edits,
    kind: "quickfix",
  };

  return isPreferred ? phpPreferredQuickfix(quickfixAction) : quickfixAction;
}

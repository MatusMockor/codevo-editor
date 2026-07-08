import type { PhpClassStructure } from "../domain/phpClassStructure";
import {
  phpGenerateAccessorsCodeAction,
  phpGenerateConstructorCodeAction,
  phpGenerateConstructorWithPromotionCodeAction,
  phpGeneratePhpDocCodeAction,
} from "./phpClassGenerateCodeActions";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";
import { phpCreateFromUsageCodeAction } from "./phpCreateMemberCodeActions";
import {
  phpRemoveUnusedImportCodeAction,
  phpRemoveUnusedMethodCodeAction,
  phpRemoveUnusedVariableCodeAction,
} from "./phpInspectionCodeActions";
import {
  phpAddParameterCodeAction,
  phpAddParameterTypeCodeAction,
  phpAddReturnTypeCodeAction,
  phpExtractMethodCodeAction,
  phpExtractVariableCodeAction,
  phpInlineVariableCodeAction,
  phpIntroduceConstantCodeAction,
  phpIntroduceFieldCodeAction,
} from "./phpLocalRefactorCodeActions";
import { phpOptimizeImportsCodeAction } from "./phpImportCodeActions";

/**
 * Pure local PHP code actions that need only the current source/range. They are
 * valid before we know whether the cursor is inside a class, so the React
 * provider can keep workspace async checks separate from single-file planning.
 */
export function collectPhpFileScopedCodeActions(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor[] {
  return compactCodeActions([
    phpRemoveUnusedImportCodeAction(source, range),
    phpRemoveUnusedVariableCodeAction(source, range),
    phpExtractVariableCodeAction(source, range),
    phpInlineVariableCodeAction(source, range),
    phpAddParameterCodeAction(source, range),
    phpAddReturnTypeCodeAction(source, range),
    phpAddParameterTypeCodeAction(source, range),
  ]);
}

/**
 * Pure class-body PHP code actions. Cross-file / async actions such as
 * Implement methods, Override methods, Import class and Extract interface stay
 * in the provider orchestration because they depend on the active workspace.
 */
export function collectPhpClassScopedCodeActions(
  source: string,
  range: PhpCodeActionRange,
  structure: PhpClassStructure,
): PhpCodeActionDescriptor[] {
  return compactCodeActions([
    phpCreateFromUsageCodeAction(source, range),
    phpRemoveUnusedMethodCodeAction(source, range),
    phpExtractMethodCodeAction(source, range),
    phpIntroduceConstantCodeAction(source, range),
    phpIntroduceFieldCodeAction(source, range),
    phpGenerateAccessorsCodeAction(source, structure),
    phpGenerateConstructorCodeAction(source, structure),
    phpGenerateConstructorWithPromotionCodeAction(source, structure),
    phpGeneratePhpDocCodeAction(source, structure, range),
    phpOptimizeImportsCodeAction(source),
  ]);
}

function compactCodeActions(
  actions: Array<PhpCodeActionDescriptor | null>,
): PhpCodeActionDescriptor[] {
  return actions.filter(
    (action): action is PhpCodeActionDescriptor => action !== null,
  );
}

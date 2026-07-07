import { useCallback } from "react";
import { shouldIndexWorkspace } from "../domain/intelligence";
import { parsePhpClassStructure } from "../domain/phpClassStructure";
import { phpCurrentTypeKind } from "../domain/phpNavigation";
import {
  isTypeProjectSymbol,
  type ProjectSymbolSearchGateway,
} from "../domain/projectSymbols";
import {
  type IntelligenceMode,
  type WorkspaceDescriptor,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { buildCreateMissingBladeViewCodeAction } from "./phpBladeViewCodeActions";
import {
  phpGenerateAccessorsCodeAction,
  phpGenerateConstructorCodeAction,
  phpGenerateConstructorWithPromotionCodeAction,
  phpGeneratePhpDocCodeAction,
} from "./phpClassGenerateCodeActions";
import { buildPhpCreateClassCodeAction } from "./phpCreateClassWorkspaceCodeAction";
import { phpExtractInterfaceCodeAction } from "./phpExtractInterfaceCodeActions";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";
import { orderPhpCodeActions } from "./phpCodeActionOrdering";
import { phpCreateFromUsageCodeAction } from "./phpCreateMemberCodeActions";
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
import {
  phpRemoveUnusedImportCodeAction,
  phpRemoveUnusedMethodCodeAction,
  phpRemoveUnusedVariableCodeAction,
} from "./phpInspectionCodeActions";
import {
  phpImportClassCodeActions,
  phpImportClassShortNameAt,
  phpOptimizeImportsCodeAction,
} from "./phpImportCodeActions";
import {
  phpImplementMethodsCodeAction,
  phpOverrideMethodsCodeAction,
  type PhpAbstractMembersCollector,
  type PhpOverridableParentMethodsCollector,
} from "./phpInheritedMemberCodeActions";

export {
  isPhpOverridableParentMethod,
  phpSuperMethodHierarchyReferences,
} from "./phpInheritedMemberCodeActions";

export type { AbstractMemberToImplement } from "./phpInheritedMemberCodeActions";

export type {
  PhpCodeActionDescriptor,
  PhpCodeActionNewFile,
  PhpCodeActionRange,
  PhpCodeActionTextEdit,
  PhpCodeActionTextEditRange,
} from "./phpCodeActionTypes";

export type CreateMissingBladeViewCodeAction = (
  source: string,
  range: PhpCodeActionRange,
  language: "blade" | "php",
  isRequestedRootActive: () => boolean,
) => Promise<PhpCodeActionDescriptor | null>;

export interface UsePhpCodeActionsOptions {
  activeDocumentPath: string | null;
  collectPhpAbstractMembersToImplement: PhpAbstractMembersCollector;
  collectPhpLaravelViewTargets: () => Promise<ReadonlyArray<{ name: string }>>;
  collectPhpOverridableParentMethods: PhpOverridableParentMethodsCollector;
  currentWorkspaceRootRef: { readonly current: string | null };
  intelligenceMode: IntelligenceMode;
  isLaravelFrameworkActive: boolean;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface UsePhpCodeActionsResult {
  createMissingBladeViewCodeAction: CreateMissingBladeViewCodeAction;
  providePhpCodeActions: (
    source: string,
    range?: PhpCodeActionRange,
  ) => Promise<PhpCodeActionDescriptor[]>;
}

export function usePhpCodeActions({
  activeDocumentPath,
  collectPhpAbstractMembersToImplement,
  collectPhpLaravelViewTargets,
  collectPhpOverridableParentMethods,
  currentWorkspaceRootRef,
  intelligenceMode,
  isLaravelFrameworkActive,
  projectSymbolSearch,
  readTestFileIfExists,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpCodeActionsOptions): UsePhpCodeActionsResult {
  const createMissingBladeViewCodeAction = useCallback(
    buildCreateMissingBladeViewCodeAction({
      collectPhpLaravelViewTargets,
      isLaravelFrameworkActive,
      readTestFileIfExists,
      workspaceRoot,
    }),
    [
      collectPhpLaravelViewTargets,
      isLaravelFrameworkActive,
      readTestFileIfExists,
      workspaceRoot,
    ],
  );

  const phpCreateClassCodeAction = useCallback(
    buildPhpCreateClassCodeAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    }),
    [
      readTestFileIfExists,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const providePhpCodeActions = useCallback(
    async (
      source: string,
      range: PhpCodeActionRange = { end: 0, start: 0 },
    ): Promise<PhpCodeActionDescriptor[]> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return [];
      }

      const actions: PhpCodeActionDescriptor[] = [];

      // "Remove unused import" pairs with the unused-import inspection. It is a
      // single-line deletion valid anywhere a top-level `use` sits (not only in
      // a class), so it runs before the class-only guard below. Offered only
      // when the cursor is on a conservatively-detected unused class import.
      const removeUnusedImportAction = phpRemoveUnusedImportCodeAction(
        source,
        range,
      );

      if (removeUnusedImportAction) {
        actions.push(removeUnusedImportAction);
      }

      // "Remove unused variable" pairs with the unused-variable inspection. A
      // local assignment can sit in a class method OR a free function, and the
      // action is offered only for a side-effect-free assignment, so it runs
      // before the class-only guard below.
      const removeUnusedVariableAction = phpRemoveUnusedVariableCodeAction(
        source,
        range,
      );

      if (removeUnusedVariableAction) {
        actions.push(removeUnusedVariableAction);
      }

      // "Extract variable" is a pure single-file synthesis from the current
      // selection and is valid anywhere a PHP expression sits (class body or a
      // free function), so it runs before the class-only guard below.
      const extractVariableAction = phpExtractVariableCodeAction(source, range);

      if (extractVariableAction) {
        actions.push(extractVariableAction);
      }

      // "Inline variable" is the inverse of "Extract variable": from the cursor
      // on a single-assignment local it deletes the declaration and substitutes
      // the value at every usage. Like extract it is a pure single-file
      // synthesis valid in a class body or a free function, so it runs before
      // the class-only guard below.
      const inlineVariableAction = phpInlineVariableCodeAction(source, range);

      if (inlineVariableAction) {
        actions.push(inlineVariableAction);
      }

      // "Add parameter" (Change Signature - slice 1) appends an optional
      // placeholder parameter to the enclosing function's signature. It is a
      // pure single-file synthesis valid on a class method OR a free function,
      // so it runs before the class-only guard below.
      const addParameterAction = phpAddParameterCodeAction(source, range);

      if (addParameterAction) {
        actions.push(addParameterAction);
      }

      // "Add return type" / "Add type hint" (PhpStorm Alt+Enter) conservatively
      // infer a missing return type / parameter type and insert it. Both are
      // pure single-file additive insertions valid on a class method OR a free
      // function (and, for the return type, an abstract / interface
      // declaration), so they run before the class-only guard below.
      const addReturnTypeAction = phpAddReturnTypeCodeAction(source, range);

      if (addReturnTypeAction) {
        actions.push(addReturnTypeAction);
      }

      const addParameterTypeAction = phpAddParameterTypeCodeAction(
        source,
        range,
      );

      if (addParameterTypeAction) {
        actions.push(addParameterTypeAction);
      }

      // "Create class X" (PhpStorm Alt+Enter) when the cursor sits on a
      // referenced-but-unresolved class/interface/trait/enum (`new X()`,
      // `X::method()`/`X::CONST`, a type hint / return type, `extends`/
      // `implements`, `catch (X $e)`). It WRITES a new PSR-4 file with a minimal
      // skeleton, so it runs before the class-only guard (a reference may sit in
      // a class header type position OR a free function). The build is async
      // (existence probes) and re-checks the requested root after every await so
      // a tab switch mid-flight drops a stale offer (per-workspace isolation).
      const createClassAction = await phpCreateClassCodeAction(
        source,
        range,
        isRequestedRootActive,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      if (createClassAction) {
        actions.push(createClassAction);
      }

      const createMissingViewAction = await createMissingBladeViewCodeAction(
        source,
        range,
        "php",
        isRequestedRootActive,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      if (createMissingViewAction) {
        actions.push(createMissingViewAction);
      }

      if (phpCurrentTypeKind(source) !== "class") {
        // Free-function context: only the pre-class-guard refactors are offered.
        // Order them like the class path so the list stays "most likely first".
        return orderPhpCodeActions(actions);
      }

      const structure = parsePhpClassStructure(source);

      // "Create method / property from usage" is a pure single-file synthesis
      // from the cursor offset; offered only when the cursor sits on an
      // unresolved `$this->member` usage inside the class.
      const createFromUsageAction = phpCreateFromUsageCodeAction(source, range);

      if (createFromUsageAction) {
        actions.push(createFromUsageAction);
      }

      // "Remove unused method" pairs with the unused-private-method inspection.
      // Offered only when the cursor sits on a conservatively-detected unused
      // private method; deletes the whole method (and its decorating lines).
      const removeUnusedMethodAction = phpRemoveUnusedMethodCodeAction(
        source,
        range,
      );

      if (removeUnusedMethodAction) {
        actions.push(removeUnusedMethodAction);
      }

      // "Extract method" lifts a contiguous, whole-statement selection inside a
      // class method into a new private method and replaces it with a call. It
      // is a pure single-file synthesis from the selection; the conservative
      // planner returns null whenever the extraction could change behaviour.
      const extractMethodAction = phpExtractMethodCodeAction(source, range);

      if (extractMethodAction) {
        actions.push(extractMethodAction);
      }

      // "Extract interface" (PhpStorm) synthesises a sibling
      // `<Class>Interface.php` from the class's public instance methods and adds
      // an `implements` clause to the class. It needs the active document's
      // path to place the new file (PSR-4 sibling), so it is keyed off
      // `activeDocument`. The conservative planner returns null for anything but
      // a plain class with public instance methods.
      const extractInterfaceAction = phpExtractInterfaceCodeAction(
        source,
        range,
        activeDocumentPath,
      );

      if (extractInterfaceAction?.newFile) {
        const existingInterface = await readTestFileIfExists(
          extractInterfaceAction.newFile.path,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        if (existingInterface === null) {
          actions.push(extractInterfaceAction);
        }
      }

      // "Introduce constant / field" are pure single-file syntheses keyed off the
      // cursor offset on a scalar literal (or a local variable for the field).
      // Both insert at the top of the class body and replace the original token.
      const introduceConstantAction = phpIntroduceConstantCodeAction(
        source,
        range,
      );

      if (introduceConstantAction) {
        actions.push(introduceConstantAction);
      }

      const introduceFieldAction = phpIntroduceFieldCodeAction(source, range);

      if (introduceFieldAction) {
        actions.push(introduceFieldAction);
      }

      const declaredMethodNames = new Set(
        structure.methods.map((method) => method.name.toLowerCase()),
      );
      const implementMethodsAction = await phpImplementMethodsCodeAction(
        source,
        declaredMethodNames,
        collectPhpAbstractMembersToImplement,
        isRequestedRootActive,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      if (implementMethodsAction) {
        actions.push(implementMethodsAction);
      }

      const overrideMethodsAction = await phpOverrideMethodsCodeAction(
        source,
        declaredMethodNames,
        collectPhpOverridableParentMethods,
        isRequestedRootActive,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      if (overrideMethodsAction) {
        actions.push(overrideMethodsAction);
      }

      const accessorsAction = phpGenerateAccessorsCodeAction(source, structure);

      if (accessorsAction) {
        actions.push(accessorsAction);
      }

      const constructorAction = phpGenerateConstructorCodeAction(
        source,
        structure,
      );

      if (constructorAction) {
        actions.push(constructorAction);
      }

      const constructorWithPromotionAction =
        phpGenerateConstructorWithPromotionCodeAction(source, structure);

      if (constructorWithPromotionAction) {
        actions.push(constructorWithPromotionAction);
      }

      const generatePhpDocAction = phpGeneratePhpDocCodeAction(
        source,
        structure,
        range,
      );

      if (generatePhpDocAction) {
        actions.push(generatePhpDocAction);
      }

      const optimizeImportsAction = phpOptimizeImportsCodeAction(source);

      if (optimizeImportsAction) {
        actions.push(optimizeImportsAction);
      }

      // "Import class" (PhpStorm Alt+Enter -> Import): when the cursor sits on an
      // unimported, unqualified class reference, look the short name up in the
      // workspace symbol index and offer a `use FQN;` insertion per candidate
      // namespace. Indexed-only (the index is per-root); the requested root is
      // re-checked after the async search and before mutating `actions` so a tab
      // switch mid-search drops stale results (per-workspace isolation).
      const importShortName = phpImportClassShortNameAt(source, range);

      if (importShortName && shouldIndexWorkspace(intelligenceMode)) {
        const indexedSymbols = await projectSymbolSearch.searchProjectSymbols(
          requestedRoot,
          importShortName,
          25,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        const candidateFqns = indexedSymbols
          .filter(isTypeProjectSymbol)
          .filter(
            (symbol) =>
              symbol.name.toLowerCase() === importShortName.toLowerCase(),
          )
          .map((symbol) => symbol.fullyQualifiedName);

        for (const importAction of phpImportClassCodeActions(
          source,
          candidateFqns,
        )) {
          actions.push(importAction);
        }
      }

      return orderPhpCodeActions(actions);
    },
    [
      activeDocumentPath,
      collectPhpAbstractMembersToImplement,
      collectPhpOverridableParentMethods,
      createMissingBladeViewCodeAction,
      intelligenceMode,
      phpCreateClassCodeAction,
      projectSymbolSearch,
      readTestFileIfExists,
      workspaceRoot,
    ],
  );

  return { createMissingBladeViewCodeAction, providePhpCodeActions };
}

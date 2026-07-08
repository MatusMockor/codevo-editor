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
import { buildPhpCreateClassCodeAction } from "./phpCreateClassWorkspaceCodeAction";
import {
  collectPhpClassScopedCodeActions,
  collectPhpFileScopedCodeActions,
} from "./phpCodeActionLocalCollector";
import { phpExtractInterfaceCodeAction } from "./phpExtractInterfaceCodeActions";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";
import { orderPhpCodeActions } from "./phpCodeActionOrdering";
import {
  phpImportClassCodeActions,
  phpImportClassShortNameAt,
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

      const actions = collectPhpFileScopedCodeActions(source, range);

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
      actions.push(...collectPhpClassScopedCodeActions(source, range, structure));

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

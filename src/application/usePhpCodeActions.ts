import { useCallback } from "react";
import { parsePhpClassStructure } from "../domain/phpClassStructure";
import { phpCurrentTypeKind } from "../domain/phpNavigation";
import type { ProjectSymbolSearchGateway } from "../domain/projectSymbols";
import {
  type IntelligenceMode,
  type WorkspaceDescriptor,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { buildPhpCreateClassCodeAction } from "./phpCreateClassWorkspaceCodeAction";
import {
  collectPhpClassScopedCodeActions,
  collectPhpFileScopedCodeActions,
} from "./phpCodeActionLocalCollector";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";
import { orderPhpCodeActions } from "./phpCodeActionOrdering";
import {
  collectPhpWorkspaceCodeActions,
  type PhpFrameworkCodeActionContribution,
} from "./phpCodeActionWorkspaceCollector";
import {
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

export interface UsePhpCodeActionsOptions {
  activeDocumentPath: string | null;
  collectPhpAbstractMembersToImplement: PhpAbstractMembersCollector;
  collectPhpOverridableParentMethods: PhpOverridableParentMethodsCollector;
  frameworkCodeActionContributions: readonly PhpFrameworkCodeActionContribution[];
  currentWorkspaceRootRef: { readonly current: string | null };
  intelligenceMode: IntelligenceMode;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface UsePhpCodeActionsResult {
  providePhpCodeActions: (
    source: string,
    range?: PhpCodeActionRange,
  ) => Promise<PhpCodeActionDescriptor[]>;
}

export function usePhpCodeActions({
  activeDocumentPath,
  collectPhpAbstractMembersToImplement,
  collectPhpOverridableParentMethods,
  currentWorkspaceRootRef,
  frameworkCodeActionContributions,
  intelligenceMode,
  projectSymbolSearch,
  readTestFileIfExists,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpCodeActionsOptions): UsePhpCodeActionsResult {
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

      const structure =
        phpCurrentTypeKind(source) === "class"
          ? parsePhpClassStructure(source)
          : null;
      const actions = [
        ...collectPhpFileScopedCodeActions(source, range),
        ...(structure
          ? collectPhpClassScopedCodeActions(source, range, structure)
          : []),
      ];
      const workspaceActions = await collectPhpWorkspaceCodeActions(
        {
          activeDocumentPath,
          collectPhpAbstractMembersToImplement,
          collectPhpOverridableParentMethods,
          frameworkCodeActionContributions,
          intelligenceMode,
          isRequestedRootActive,
          phpCreateClassCodeAction,
          projectSymbolSearch,
          range,
          readTestFileIfExists,
          requestedRoot,
          source,
          structure,
        },
      );

      if (!workspaceActions) {
        return [];
      }

      actions.push(...workspaceActions);

      return orderPhpCodeActions(actions);
    },
    [
      activeDocumentPath,
      collectPhpAbstractMembersToImplement,
      collectPhpOverridableParentMethods,
      frameworkCodeActionContributions,
      intelligenceMode,
      phpCreateClassCodeAction,
      projectSymbolSearch,
      readTestFileIfExists,
      workspaceRoot,
    ],
  );

  return { providePhpCodeActions };
}

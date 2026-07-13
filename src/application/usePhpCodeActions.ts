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
import { buildPhpCreateMemberWorkspaceCodeAction } from "./phpCreateParentMemberWorkspaceCodeAction";
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
  getPhpDocumentSyncVersion: (rootPath: string, path: string) => number | null;
  intelligenceMode: IntelligenceMode;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  readOpenDocumentContent: (path: string) => string | null;
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
  getPhpDocumentSyncVersion,
  intelligenceMode,
  projectSymbolSearch,
  readOpenDocumentContent,
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

  const phpCreateMemberCodeAction = useCallback(
    buildPhpCreateMemberWorkspaceCodeAction({
      getOpenDocumentSyncVersion: (path) =>
        workspaceRoot ? getPhpDocumentSyncVersion(workspaceRoot, path) : null,
      readOpenDocumentContent,
      readTestFileIfExists,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    }),
    [
      getPhpDocumentSyncVersion,
      readOpenDocumentContent,
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
          phpCreateMemberCodeAction,
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
      phpCreateMemberCodeAction,
      projectSymbolSearch,
      readTestFileIfExists,
      workspaceRoot,
    ],
  );

  return { providePhpCodeActions };
}

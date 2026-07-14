import { useMemo } from "react";
import {
  type IntelligenceMode,
  type WorkspaceDescriptor,
} from "../domain/workspace";
import { type ProjectSymbolSearchGateway } from "../domain/projectSymbols";
import {
  usePhpCodeActions,
  type UsePhpCodeActionsResult,
} from "./usePhpCodeActions";
import { usePhpInheritedMemberCollector } from "./usePhpInheritedMemberCollector";
import {
  activePhpFrameworkCodeActions,
  type ActivePhpFrameworkCodeActions,
} from "./phpFrameworkCodeActionContributionRegistry";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

interface UsePhpCodeActionProviderOptions {
  activeDocumentPath: string | null;
  collectViewTargets: () => Promise<ReadonlyArray<{ name: string }>>;
  currentWorkspaceRootRef: { readonly current: string | null };
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "providers" | "supports">;
  getPhpDocumentSyncVersion: (rootPath: string, path: string) => number | null;
  intelligenceMode: IntelligenceMode;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  readNavigationFileContent: (path: string) => Promise<string>;
  readOpenDocumentContent: (path: string) => string | null;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface UsePhpCodeActionProviderResult
  extends UsePhpCodeActionsResult {
  createMissingBladeViewCodeAction: ActivePhpFrameworkCodeActions["createMissingBladeViewCodeAction"];
}

export function usePhpCodeActionProvider({
  activeDocumentPath,
  collectViewTargets,
  currentWorkspaceRootRef,
  frameworkRuntime,
  getPhpDocumentSyncVersion,
  intelligenceMode,
  projectSymbolSearch,
  readNavigationFileContent,
  readOpenDocumentContent,
  readTestFileIfExists,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpCodeActionProviderOptions): UsePhpCodeActionProviderResult {
  const {
    collectPhpAbstractMembersToImplement,
    collectPhpOverridableParentMethods,
  } = usePhpInheritedMemberCollector({
    readNavigationFileContent,
    resolvePhpClassSourcePaths,
  });
  const {
    contributions: frameworkCodeActionContributions,
    createMissingBladeViewCodeAction,
  } = useMemo(
    () =>
      activePhpFrameworkCodeActions({
        collectViewTargets,
        frameworkRuntime,
        readTestFileIfExists,
        workspaceRoot,
      }),
    [collectViewTargets, frameworkRuntime, readTestFileIfExists, workspaceRoot],
  );
  const { providePhpCodeActions } = usePhpCodeActions({
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
  });

  return { createMissingBladeViewCodeAction, providePhpCodeActions };
}

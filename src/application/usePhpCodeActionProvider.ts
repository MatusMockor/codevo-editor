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
import { activePhpFrameworkCodeActions } from "./phpFrameworkCodeActionContributionRegistry";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { createActiveMissingTemplateFileCodeAction } from "./phpMissingTemplateFileCodeActionContribution";
import type { CreateMissingViewFileCodeAction } from "./phpBladeViewCodeActions";
import { createPhpFrameworkCodeActionContributionCatalog } from "./phpFrameworkCodeActionContributionCatalog";

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

export interface UsePhpCodeActionProviderResult extends UsePhpCodeActionsResult {
  createMissingBladeViewCodeAction: CreateMissingViewFileCodeAction;
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
  const { contributions: frameworkCodeActionContributions } = useMemo(() => {
    const contributionAdapters =
      createPhpFrameworkCodeActionContributionCatalog({
        collectViewTargets,
        readTestFileIfExists,
        workspaceRoot,
      });

    return activePhpFrameworkCodeActions({
      contributionAdapters,
      frameworkRuntime,
    });
  }, [
    collectViewTargets,
    frameworkRuntime,
    readTestFileIfExists,
    workspaceRoot,
  ]);
  const createMissingBladeViewCodeAction = useMemo(
    () =>
      createActiveMissingTemplateFileCodeAction({
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

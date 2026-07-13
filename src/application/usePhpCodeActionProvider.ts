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
import type { PhpFrameworkCodeActionContribution } from "./phpCodeActionWorkspaceCollector";

interface UsePhpCodeActionProviderOptions {
  activeDocumentPath: string | null;
  currentWorkspaceRootRef: { readonly current: string | null };
  frameworkCodeActionContributions: readonly PhpFrameworkCodeActionContribution[];
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

export function usePhpCodeActionProvider({
  activeDocumentPath,
  currentWorkspaceRootRef,
  frameworkCodeActionContributions,
  getPhpDocumentSyncVersion,
  intelligenceMode,
  projectSymbolSearch,
  readNavigationFileContent,
  readOpenDocumentContent,
  readTestFileIfExists,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpCodeActionProviderOptions): UsePhpCodeActionsResult {
  const {
    collectPhpAbstractMembersToImplement,
    collectPhpOverridableParentMethods,
  } = usePhpInheritedMemberCollector({
    readNavigationFileContent,
    resolvePhpClassSourcePaths,
  });
  return usePhpCodeActions({
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
}

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
  intelligenceMode: IntelligenceMode;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  readNavigationFileContent: (path: string) => Promise<string>;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export function usePhpCodeActionProvider({
  activeDocumentPath,
  currentWorkspaceRootRef,
  frameworkCodeActionContributions,
  intelligenceMode,
  projectSymbolSearch,
  readNavigationFileContent,
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
    intelligenceMode,
    projectSymbolSearch,
    readTestFileIfExists,
    resolvePhpClassSourcePaths,
    workspaceDescriptor,
    workspaceRoot,
  });
}

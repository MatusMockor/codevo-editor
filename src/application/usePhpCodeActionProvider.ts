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

interface UsePhpCodeActionProviderOptions {
  activeDocumentPath: string | null;
  collectPhpLaravelViewTargets: () => Promise<ReadonlyArray<{ name: string }>>;
  currentWorkspaceRootRef: { readonly current: string | null };
  intelligenceMode: IntelligenceMode;
  isLaravelFrameworkActive: boolean;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  readNavigationFileContent: (path: string) => Promise<string>;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export function usePhpCodeActionProvider({
  activeDocumentPath,
  collectPhpLaravelViewTargets,
  currentWorkspaceRootRef,
  intelligenceMode,
  isLaravelFrameworkActive,
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
  });
}

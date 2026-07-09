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
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

interface UsePhpCodeActionProviderOptions {
  activeDocumentPath: string | null;
  collectPhpLaravelViewTargets: () => Promise<ReadonlyArray<{ name: string }>>;
  currentWorkspaceRootRef: { readonly current: string | null };
  frameworkRuntime?: PhpFrameworkRuntimeContext;
  intelligenceMode: IntelligenceMode;
  isLaravelFrameworkActive?: boolean;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  readNavigationFileContent: (path: string) => Promise<string>;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

interface PhpCodeActionFrameworkCapabilityOptions {
  frameworkRuntime?: PhpFrameworkRuntimeContext;
  legacyIsLaravelFrameworkActive: boolean;
}

interface PhpCodeActionFrameworkCapabilities {
  canCreateMissingBladeViews: boolean;
}

export function usePhpCodeActionProvider({
  activeDocumentPath,
  collectPhpLaravelViewTargets,
  currentWorkspaceRootRef,
  frameworkRuntime,
  intelligenceMode,
  isLaravelFrameworkActive: legacyIsLaravelFrameworkActive = false,
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
  const { canCreateMissingBladeViews } =
    resolvePhpCodeActionFrameworkCapabilities({
      frameworkRuntime,
      legacyIsLaravelFrameworkActive,
    });

  return usePhpCodeActions({
    activeDocumentPath,
    canCreateMissingBladeViews,
    collectPhpAbstractMembersToImplement,
    collectPhpLaravelViewTargets,
    collectPhpOverridableParentMethods,
    currentWorkspaceRootRef,
    intelligenceMode,
    projectSymbolSearch,
    readTestFileIfExists,
    resolvePhpClassSourcePaths,
    workspaceDescriptor,
    workspaceRoot,
  });
}

function resolvePhpCodeActionFrameworkCapabilities({
  frameworkRuntime,
  legacyIsLaravelFrameworkActive,
}: PhpCodeActionFrameworkCapabilityOptions): PhpCodeActionFrameworkCapabilities {
  if (!frameworkRuntime) {
    return {
      canCreateMissingBladeViews: legacyIsLaravelFrameworkActive,
    };
  }

  return {
    canCreateMissingBladeViews:
      frameworkRuntime.isLaravel && frameworkRuntime.supports("views"),
  };
}

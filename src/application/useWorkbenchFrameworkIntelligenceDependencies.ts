import { useMemo } from "react";
import { shouldStartLanguageServer } from "../domain/intelligence";
import {
  isTypeProjectSymbol,
  type ProjectSymbolSearchGateway,
} from "../domain/projectSymbols";
import type {
  EditorDocument,
  IntelligenceMode,
  TextSearchGateway,
  WorkspaceFileGateway,
} from "../domain/workspace";
import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import type {
  WorkbenchFrameworkIntelligenceDependencies,
} from "./workbenchFrameworkIntelligenceContracts";

export interface WorkbenchFrameworkIntelligenceDependencyInputs {
  activeDocument: WorkbenchFrameworkIntelligenceDependencies["blade"]["activeDocument"];
  activeDocumentRef: { readonly current: EditorDocument | null };
  activePhpFrameworkProviders: WorkbenchFrameworkIntelligenceDependencies["activePhpFrameworkProviders"];
  collectConfigTargets: WorkbenchFrameworkIntelligenceDependencies["blade"]["collectConfigTargets"];
  collectNamedRouteTargets: WorkbenchFrameworkIntelligenceDependencies["blade"]["collectNamedRouteTargets"];
  collectTranslationTargets: WorkbenchFrameworkIntelligenceDependencies["blade"]["collectTranslationTargets"];
  collectViewTargets: WorkbenchFrameworkIntelligenceDependencies["blade"]["collectViewTargets"];
  createMissingBladeViewCodeAction: WorkbenchFrameworkIntelligenceDependencies["blade"]["createMissingBladeViewCodeAction"];
  currentWorkspaceRootRef: WorkbenchFrameworkIntelligenceDependencies["blade"]["currentWorkspaceRootRef"];
  ensurePhpFrameworkSourceCollectionsLoaded: WorkbenchFrameworkIntelligenceDependencies["blade"]["ensurePhpFrameworkSourceCollectionsLoaded"];
  findConfigTarget: WorkbenchFrameworkIntelligenceDependencies["blade"]["findConfigTarget"];
  findTranslationTarget: WorkbenchFrameworkIntelligenceDependencies["blade"]["findTranslationTarget"];
  findViewTarget: WorkbenchFrameworkIntelligenceDependencies["blade"]["findViewTarget"];
  intelligenceMode: IntelligenceMode;
  joinWorkspacePath: WorkbenchFrameworkIntelligenceDependencies["latte"]["joinPath"];
  openDirectPhpMethodTarget: WorkbenchFrameworkIntelligenceDependencies["blade"]["openDirectPhpMethodTarget"];
  openDirectPhpPropertyTarget: WorkbenchFrameworkIntelligenceDependencies["blade"]["openDirectPhpPropertyTarget"];
  openNavigationTarget: WorkbenchFrameworkIntelligenceDependencies["blade"]["openNavigationTarget"];
  openPhpClassTarget: (
    className: string,
    label: string,
  ) => Promise<boolean>;
  openPhpLaravelModelAttributeTarget: WorkbenchFrameworkIntelligenceDependencies["blade"]["openPhpFrameworkModelAttributeTarget"];
  phpFrameworkIntelligence: PhpFrameworkIntelligence;
  phpFrameworkRuntimeContext: WorkbenchFrameworkIntelligenceDependencies["blade"]["frameworkRuntime"];
  projectSymbolSearch: ProjectSymbolSearchGateway;
  readNavigationFileContent: WorkbenchFrameworkIntelligenceDependencies["blade"]["readNavigationFileContent"];
  relativeWorkspacePath: WorkbenchFrameworkIntelligenceDependencies["blade"]["relativeWorkspacePath"];
  resolvePhpClassPropertyOrRelationType: WorkbenchFrameworkIntelligenceDependencies["blade"]["resolvePhpClassPropertyOrRelationType"];
  resolvePhpClassSourcePaths: (className: string) => Promise<readonly string[]>;
  resolvePhpDeclaredType: WorkbenchFrameworkIntelligenceDependencies["blade"]["resolvePhpDeclaredType"];
  resolvePhpExpressionType: WorkbenchFrameworkIntelligenceDependencies["blade"]["resolvePhpExpressionType"];
  resolvePhpReceiverMethodCompletions: WorkbenchFrameworkIntelligenceDependencies["blade"]["resolvePhpReceiverMethodCompletions"];
  setImplementationChooser: WorkbenchFrameworkIntelligenceDependencies["neon"]["setImplementationChooser"];
  synthesizePhpTypedReceiverSource: WorkbenchFrameworkIntelligenceDependencies["latte"]["synthesizeTypedReceiverSource"];
  textSearch: Pick<TextSearchGateway, "searchText">;
  workspaceFiles: Pick<WorkspaceFileGateway, "readDirectory">;
  workspaceRoot: string | null;
}

export function useWorkbenchFrameworkIntelligenceDependencies(
  inputs: WorkbenchFrameworkIntelligenceDependencyInputs,
): WorkbenchFrameworkIntelligenceDependencies {
  const {
    activeDocument,
    activeDocumentRef,
    activePhpFrameworkProviders,
    collectConfigTargets,
    collectNamedRouteTargets,
    collectTranslationTargets,
    collectViewTargets,
    createMissingBladeViewCodeAction,
    currentWorkspaceRootRef,
    ensurePhpFrameworkSourceCollectionsLoaded,
    findConfigTarget,
    findTranslationTarget,
    findViewTarget,
    intelligenceMode,
    joinWorkspacePath,
    openDirectPhpMethodTarget,
    openDirectPhpPropertyTarget,
    openNavigationTarget,
    openPhpClassTarget,
    openPhpLaravelModelAttributeTarget,
    phpFrameworkIntelligence,
    phpFrameworkRuntimeContext,
    projectSymbolSearch,
    readNavigationFileContent,
    relativeWorkspacePath,
    resolvePhpClassPropertyOrRelationType,
    resolvePhpClassSourcePaths,
    resolvePhpDeclaredType,
    resolvePhpExpressionType,
    resolvePhpReceiverMethodCompletions,
    setImplementationChooser,
    synthesizePhpTypedReceiverSource,
    textSearch,
    workspaceFiles,
    workspaceRoot,
  } = inputs;

  return useMemo(
    () => ({
      activePhpFrameworkProviders,
      blade: {
        activeDocument,
        collectConfigTargets,
        collectNamedRouteTargets,
        collectTranslationTargets,
        collectViewTargets,
        createMissingBladeViewCodeAction,
        currentWorkspaceRootRef,
        ensurePhpFrameworkSourceCollectionsLoaded,
        findConfigTarget,
        findTranslationTarget,
        findViewTarget,
        frameworkRuntime: phpFrameworkRuntimeContext,
        openDirectPhpMethodTarget,
        openDirectPhpPropertyTarget,
        openNavigationTarget,
        openPhpFrameworkModelAttributeTarget: openPhpLaravelModelAttributeTarget,
        readNavigationFileContent,
        relativeWorkspacePath,
        resolvePhpClassPropertyOrRelationType,
        resolvePhpDeclaredType,
        resolvePhpExpressionType,
        resolvePhpReceiverMethodCompletions,
        textSearch,
        workspaceFiles,
        workspaceRoot,
      },

      latte: {
        collectTranslationTargets,
        currentWorkspaceRootRef,
        findTranslationTarget,
        frameworkIntelligence: phpFrameworkIntelligence,
        getActiveDocument: () => activeDocumentRef.current,
        isSemanticIntelligenceActive: shouldStartLanguageServer(intelligenceMode),
        joinPath: joinWorkspacePath,
        listDirectory: (path) => workspaceFiles.readDirectory(path),
        openPhpMethodTarget: openDirectPhpMethodTarget,
        openPhpPropertyTarget: openDirectPhpPropertyTarget,
        openTarget: openNavigationTarget,
        readFileContent: readNavigationFileContent,
        readPhpClassSource: async (className) => {
          for (const path of await resolvePhpClassSourcePaths(className)) {
            try {
              return {
                path,
                source: await readNavigationFileContent(path),
              };
            } catch {
              continue;
            }
          }

          return null;
        },
        resolveDeclaredType: resolvePhpDeclaredType,
        resolveExpressionType: resolvePhpExpressionType,
        resolvePhpReceiverCompletions: resolvePhpReceiverMethodCompletions,
        searchText: (root, query, maxResults) =>
          textSearch.searchText(root, query, maxResults),
        synthesizeTypedReceiverSource: synthesizePhpTypedReceiverSource,
        toRelativePath: relativeWorkspacePath,
        workspaceRoot,
      },

      neon: {
        currentWorkspaceRootRef,
        frameworkIntelligence: phpFrameworkIntelligence,
        getActiveDocument: () => activeDocumentRef.current,
        isSemanticIntelligenceActive: shouldStartLanguageServer(intelligenceMode),
        joinPath: joinWorkspacePath,
        listDirectory: (path) => workspaceFiles.readDirectory(path),
        openClassTarget: (className) =>
          openPhpClassTarget(className, className.split("\\").pop() ?? className),
        openDirectPhpMethodTarget,
        openTarget: openNavigationTarget,
        readFileContent: readNavigationFileContent,
        resolvePhpReceiverCompletions: resolvePhpReceiverMethodCompletions,
        searchClassNames: async (root, prefix, maxResults) => {
          const symbols = await projectSymbolSearch.searchProjectSymbols(
            root,
            prefix,
            maxResults,
          );

          return symbols
            .filter(isTypeProjectSymbol)
            .map((symbol) => symbol.fullyQualifiedName);
        },
        setImplementationChooser,
        synthesizeTypedReceiverSource: synthesizePhpTypedReceiverSource,
        toRelativePath: relativeWorkspacePath,
        workspaceRoot,
      },
    }),
    [
      activeDocument,
      activeDocumentRef,
      activePhpFrameworkProviders,
      collectConfigTargets,
      collectNamedRouteTargets,
      collectTranslationTargets,
      collectViewTargets,
      createMissingBladeViewCodeAction,
      currentWorkspaceRootRef,
      ensurePhpFrameworkSourceCollectionsLoaded,
      findConfigTarget,
      findTranslationTarget,
      findViewTarget,
      intelligenceMode,
      joinWorkspacePath,
      openDirectPhpMethodTarget,
      openDirectPhpPropertyTarget,
      openNavigationTarget,
      openPhpClassTarget,
      openPhpLaravelModelAttributeTarget,
      phpFrameworkIntelligence,
      phpFrameworkRuntimeContext,
      projectSymbolSearch,
      readNavigationFileContent,
      relativeWorkspacePath,
      resolvePhpClassPropertyOrRelationType,
      resolvePhpClassSourcePaths,
      resolvePhpDeclaredType,
      resolvePhpExpressionType,
      resolvePhpReceiverMethodCompletions,
      setImplementationChooser,
      synthesizePhpTypedReceiverSource,
      textSearch,
      workspaceFiles,
      workspaceRoot,
    ],
  );
}

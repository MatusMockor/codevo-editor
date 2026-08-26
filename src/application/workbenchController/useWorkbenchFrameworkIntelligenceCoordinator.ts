import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { EditorPosition } from "../../domain/languageServerFeatures";
import type { LanguageServerDiagnostic } from "../../domain/languageServerDiagnostics";
import type { PhpFrameworkProvider } from "../../domain/phpFrameworkProviders";
import type { ProjectSymbolSearchGateway } from "../../domain/projectSymbols";
import type {
  EditorDocument,
  FileSearchGateway,
  IntelligenceMode,
  TextSearchGateway,
  WorkspaceDescriptor,
  WorkspaceFileGateway,
} from "../../domain/workspace";
import { joinWorkspacePath } from "../../domain/workspace";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { resolvePhpClassName } from "../../domain/phpNavigation";
import { identifierAtEditorPosition } from "../editorPositionText";
import {
  createDefaultPhpFrameworkIdentifierNavigationActivationAdapters,
  createPhpFrameworkIdentifierNavigationAdapters,
} from "../phpFrameworkIdentifierNavigationAdapterComposition";
import { composePhpFrameworkActiveDocumentDiagnosticsContributions } from "../phpFrameworkActiveDocumentDiagnosticsComposition";
import { composePhpFrameworkFileChangeInvalidationContributions } from "../phpFrameworkFileChangeInvalidationComposition";
import { createPhpFrameworkBindingFileChangeInvalidator } from "../phpFrameworkBindingInvalidation";
import { createPhpFrameworkFileChangeInvalidator } from "../phpFrameworkFileChangeInvalidationRegistry";
import type { PhpFrameworkIntelligence } from "../phpFrameworkIntelligence";
import type { PhpFrameworkRuntimeContext } from "../phpFrameworkRuntimeContext";
import { reclassifyPhpDiagnosticsForOwner } from "../phpDiagnosticsReclassificationCoordinator";
import {
  phpNormalizedReceiverExpressionIsThis,
  usePhpMethodCompletionProvider,
} from "../usePhpMethodCompletionProvider";
import { synthesizePhpTypedReceiverSource } from "../phpTypedReceiverSource";
import type { WorkbenchNotice } from "../workbenchNotice";
import type { NavigationRequest } from "../navigationRequest";
import type { WorkbenchNavigation } from "../useWorkbenchNavigation";
import { usePhpClassHierarchyPredicates } from "../usePhpClassHierarchyPredicates";
import { usePhpClassMemberCollectors } from "../usePhpClassMemberCollectors";
import { usePhpClassTargetNavigation } from "../usePhpClassTargetNavigation";
import { usePhpCodeActionProvider } from "../usePhpCodeActionProvider";
import { usePhpContextualDefinitionNavigation } from "../usePhpContextualDefinitionNavigation";
import { usePhpContextualFrameworkLiteralDefinitionNavigation } from "../usePhpContextualFrameworkLiteralDefinitionNavigation";
import { usePhpContextualMemberDefinitionNavigation } from "../usePhpContextualMemberDefinitionNavigation";
import {
  usePhpDiagnosticContextFilter,
  type PhpContextualDiagnosticsFilter,
} from "../usePhpDiagnosticContextFilter";
import { usePhpFrameworkActiveDocumentDiagnostics } from "../usePhpFrameworkActiveDocumentDiagnostics";
import { usePhpFrameworkAuthorizationMiddlewareDefinitionNavigation } from "../usePhpFrameworkAuthorizationMiddlewareDefinitionNavigation";
import { usePhpFrameworkDefinitionNavigation } from "../usePhpFrameworkDefinitionNavigation";
import { usePhpFrameworkIdentifierDefinitionNavigation } from "../usePhpFrameworkIdentifierDefinitionNavigation";
import { usePhpFrameworkLiteralNavigationDependencies } from "../usePhpFrameworkLiteralNavigationDependencies";
import { usePhpFrameworkModelNavigationTargets } from "../usePhpFrameworkModelNavigationTargets";
import { usePhpFrameworkModelSemantics } from "../usePhpFrameworkModelSemantics";
import { usePhpFrameworkMorphMapResolver } from "../usePhpFrameworkMorphMapResolver";
import type { PhpFrameworkSourceRegistryContext } from "../usePhpFrameworkSourceRegistries";
import { usePhpFrameworkTargets } from "../usePhpFrameworkTargets";
import { usePhpImplementationNavigation } from "../usePhpImplementationNavigation";
import { usePhpIndexedDefinitionNavigation } from "../usePhpIndexedDefinitionNavigation";
import { usePhpLaravelModelNavigationTargets } from "../usePhpLaravelModelNavigationTargets";
import { usePhpLaravelModelSemanticsAdapter } from "../usePhpLaravelModelSemanticsAdapter";
import { usePhpLaravelScopePredicates } from "../usePhpLaravelScopePredicates";
import { usePhpMemberPropertyDefinitionNavigation } from "../usePhpMemberPropertyDefinitionNavigation";
import { usePhpMethodCompletionResolvers } from "../usePhpMethodCompletionResolvers";
import { usePhpMethodTargetNavigation } from "../usePhpMethodTargetNavigation";
import { usePhpPropertyTargetNavigation } from "../usePhpPropertyTargetNavigation";
import { usePhpSemanticResolver } from "../usePhpSemanticResolver";
import { usePhpSignatureHelpProvider } from "../usePhpSignatureHelpProvider";
import { usePhpSuperMethodNavigation } from "../usePhpSuperMethodNavigation";
import { usePhpTraitHostPredicates } from "../usePhpTraitHostPredicates";
import { useSymfonyWorkspaceNavigation } from "../useSymfonyWorkspaceNavigation";
import { useWorkbenchFrameworkIntelligence } from "../useWorkbenchFrameworkIntelligence";
import {
  useWorkbenchFrameworkIntelligenceDependencies,
  type WorkbenchFrameworkIntelligenceDependencyInputs,
} from "../useWorkbenchFrameworkIntelligenceDependencies";
import { useWorkbenchFrameworkProviderAdapter } from "../useWorkbenchFrameworkProviderAdapter";
import { isPhpPath, relativeWorkspacePath } from "./workspacePathPolicy";

export interface WorkbenchFrameworkIntelligenceCoordinatorDependencies {
  readonly activeDocument: EditorDocument | null;
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  readonly activePhpFrameworkProviders: readonly PhpFrameworkProvider[];
  readonly contextualDiagnosticsFilterRef: MutableRefObject<PhpContextualDiagnosticsFilter>;
  currentPhpFrameworkSourceContext(): PhpFrameworkSourceRegistryContext;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  ensurePhpFrameworkSourceCollectionsLoaded(rootPath: string): Promise<void>;
  readonly fileSearch: FileSearchGateway;
  getPhpDocumentSyncVersion(rootPath: string, path: string): number | null;
  readonly intelligenceMode: IntelligenceMode;
  readonly invalidatePhpFrameworkBindingCacheRef: MutableRefObject<() => void>;
  readonly isPhpFrameworkBindingDependencyPathRef: MutableRefObject<(path: string) => boolean>;
  readonly languageServerDiagnosticsByRootRef: MutableRefObject<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >;
  readonly openNavigationTarget: WorkbenchNavigation["openNavigationTarget"];
  readonly phpClassSourcePathCacheRef: MutableRefObject<Record<string, string[]>>;
  readonly phpFrameworkBindingCacheRef: MutableRefObject<Record<string, string | null>>;
  readonly phpFrameworkIntelligence: PhpFrameworkIntelligence;
  readonly phpFrameworkNavigationGenerationRef: MutableRefObject<number>;
  readonly phpFrameworkRuntimeContext: PhpFrameworkRuntimeContext;
  readonly projectSymbolSearch: ProjectSymbolSearchGateway;
  readonly readNavigationFileContent: WorkbenchNavigation["readNavigationFileContent"];
  readTestFileIfExists(path: string): Promise<string | null>;
  readonly reclassifyPhpLanguageServerDiagnosticsForRootRef: MutableRefObject<
    (rootPath: string, expectedOwnerKey: string) => boolean
  >;
  reportErrorForActiveWorkspaceRoot(rootPath: string, source: string, error: unknown): void;
  readonly resetPhpClassMemberCacheRef: MutableRefObject<() => void>;
  readonly resetPhpFrameworkCachesRef: MutableRefObject<() => void>;
  readonly resetPhpFrameworkMorphMapModelTypeCacheRef: MutableRefObject<() => void>;
  resetPhpFrameworkSourceRegistries(): void;
  resolveCurrentWorkspaceRuntimeOwner(): WorkspaceRuntimeOwner | null;
  resolveWorkspaceRuntimeOwner(rootPath: string): WorkspaceRuntimeOwner | null;
  readonly setFrameworkDiagnosticsByPath: Dispatch<
    SetStateAction<Record<string, LanguageServerDiagnostic[]>>
  >;
  readonly setImplementationChooser: WorkbenchFrameworkIntelligenceDependencyInputs["setImplementationChooser"];
  readonly setLanguageServerDiagnosticsByPath: Dispatch<
    SetStateAction<Record<string, LanguageServerDiagnostic[]>>
  >;
  setMessage(message: string | null): void;
  readonly setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;
  readonly textSearch: TextSearchGateway;
  readonly workspaceDescriptor: WorkspaceDescriptor | null;
  readonly workspaceFiles: WorkspaceFileGateway;
  readonly workspaceRoot: string | null;
  readonly workspaceRuntimeOwnerRef: MutableRefObject<WorkspaceRuntimeOwner | null>;
}

export interface WorkbenchFrameworkIntelligenceCoordinator {
  readonly frameworkIntelligenceProviders: ReturnType<typeof useWorkbenchFrameworkProviderAdapter>;
  readonly goToContextualPhpDefinition: ReturnType<
    typeof usePhpContextualDefinitionNavigation
  >["goToContextualPhpDefinition"];
  readonly goToIndexedPhpImplementation: ReturnType<
    typeof usePhpImplementationNavigation
  >["goToIndexedPhpImplementation"];
  readonly goToIndexedSymbolDefinition: ReturnType<
    typeof usePhpIndexedDefinitionNavigation
  >["goToIndexedSymbolDefinition"];
  readonly goToSuperMethod: ReturnType<typeof usePhpSuperMethodNavigation>["goToSuperMethod"];
  readonly invalidateFrameworkCachesForPath: ReturnType<
    typeof createPhpFrameworkFileChangeInvalidator
  >;
  readonly invalidatePhpFrameworkBindingsForFileChange: ReturnType<
    typeof createPhpFrameworkBindingFileChangeInvalidator
  >;
  readonly invalidatePhpTraitHostClassNames: ReturnType<
    typeof usePhpTraitHostPredicates
  >["invalidatePhpTraitHostClassNames"];
  readonly openPhpClassTarget: ReturnType<typeof usePhpClassTargetNavigation>["openPhpClassTarget"];
  readonly openSymfonyRouteController: ReturnType<
    typeof useSymfonyWorkspaceNavigation
  >["openSymfonyRouteController"];
  readonly openSymfonyService: ReturnType<
    typeof useSymfonyWorkspaceNavigation
  >["openSymfonyService"];
  readonly provideBladeDefinition: ReturnType<
    typeof useWorkbenchFrameworkIntelligence
  >["provideBladeDefinition"];
  readonly provideLatteDefinitionOutcome: ReturnType<
    typeof useWorkbenchFrameworkIntelligence
  >["provideLatteDefinitionOutcome"];
  readonly provideNeonDefinition: ReturnType<
    typeof useWorkbenchFrameworkIntelligence
  >["provideNeonDefinition"];
  readonly providePhpCodeActions: ReturnType<
    typeof usePhpCodeActionProvider
  >["providePhpCodeActions"];
  readonly providePhpFrameworkDefinition: ReturnType<
    typeof usePhpFrameworkDefinitionNavigation
  >["providePhpFrameworkDefinition"];
  readonly providePhpMethodCompletions: ReturnType<
    typeof usePhpMethodCompletionProvider
  >["providePhpMethodCompletions"];
  readonly providePhpMethodSignature: ReturnType<
    typeof usePhpSignatureHelpProvider
  >["providePhpMethodSignature"];
  readonly providePhpParameterInlayHints: ReturnType<
    typeof usePhpSignatureHelpProvider
  >["providePhpParameterInlayHints"];
}

export interface PhpFrameworkDefinitionNavigationActivationDependencies {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly generation: number;
  readonly generationRef: MutableRefObject<number>;
  readonly ownerKey: string;
  resolveCurrentWorkspaceRuntimeOwner(): WorkspaceRuntimeOwner | null;
  readonly rootPath: string;
}

export function usePhpFrameworkDefinitionNavigationActivation({
  currentWorkspaceRootRef,
  generation,
  generationRef,
  ownerKey,
  resolveCurrentWorkspaceRuntimeOwner,
  rootPath,
}: PhpFrameworkDefinitionNavigationActivationDependencies) {
  return useMemo(
    () => ({
      generation,
      ownerKey,
      rootPath,
      isCurrent: () => {
        if (generationRef.current !== generation) return false;
        const currentOwner = resolveCurrentWorkspaceRuntimeOwner();
        if (!currentOwner || currentOwner.ownerKey !== ownerKey) return false;
        return workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath);
      },
    }),
    [
      currentWorkspaceRootRef,
      generation,
      generationRef,
      ownerKey,
      resolveCurrentWorkspaceRuntimeOwner,
      rootPath,
    ],
  );
}

export function useWorkbenchFrameworkIntelligenceCoordinator({
  activeDocument,
  activeDocumentRef,
  activeEditorPositionRef,
  activePhpFrameworkProviders,
  contextualDiagnosticsFilterRef,
  currentPhpFrameworkSourceContext,
  currentWorkspaceRootRef,
  documentsRef,
  ensurePhpFrameworkSourceCollectionsLoaded,
  fileSearch,
  getPhpDocumentSyncVersion,
  intelligenceMode,
  invalidatePhpFrameworkBindingCacheRef,
  isPhpFrameworkBindingDependencyPathRef,
  languageServerDiagnosticsByRootRef,
  openNavigationTarget,
  phpClassSourcePathCacheRef,
  phpFrameworkBindingCacheRef,
  phpFrameworkIntelligence,
  phpFrameworkNavigationGenerationRef,
  phpFrameworkRuntimeContext,
  projectSymbolSearch,
  readNavigationFileContent,
  readTestFileIfExists,
  reclassifyPhpLanguageServerDiagnosticsForRootRef,
  reportErrorForActiveWorkspaceRoot,
  resetPhpClassMemberCacheRef,
  resetPhpFrameworkCachesRef,
  resetPhpFrameworkMorphMapModelTypeCacheRef,
  resetPhpFrameworkSourceRegistries,
  resolveCurrentWorkspaceRuntimeOwner,
  resolveWorkspaceRuntimeOwner,
  setFrameworkDiagnosticsByPath,
  setImplementationChooser,
  setLanguageServerDiagnosticsByPath,
  setMessage,
  setNotices,
  textSearch,
  workspaceDescriptor,
  workspaceFiles,
  workspaceRoot,
  workspaceRuntimeOwnerRef,
}: WorkbenchFrameworkIntelligenceCoordinatorDependencies): WorkbenchFrameworkIntelligenceCoordinator {
  const {
    currentPhpFrameworkBindingCacheGeneration,
    invalidatePhpFrameworkBindingCache,
    isPhpFrameworkBindingSearchCandidatePath,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpDeclaredType,
    resolvePhpFrameworkBoundConcrete,
    resolvePhpFrameworkReturnTypeReference,
    resolvePhpMethodDeclaredReturnType,
    resolvePhpSemanticTypeReference,
  } = usePhpSemanticResolver({
    activePhpFrameworkProviders,
    currentPhpFrameworkSourceContext,
    currentWorkspaceRootRef,
    fileSearch,
    intelligenceMode,
    phpClassSourcePathCacheRef,
    phpFrameworkBindingCacheRef,
    projectSymbolSearch,
    readNavigationFileContent,
    textSearch,
    workspaceDescriptor,
    workspaceRoot,
  });
  invalidatePhpFrameworkBindingCacheRef.current = invalidatePhpFrameworkBindingCache;
  isPhpFrameworkBindingDependencyPathRef.current = isPhpFrameworkBindingSearchCandidatePath;

  const invalidatePhpFrameworkBindingsForFileChange = useMemo(
    () =>
      createPhpFrameworkBindingFileChangeInvalidator({
        frameworkRuntime: phpFrameworkRuntimeContext,
        frameworkProviders: activePhpFrameworkProviders,
        currentRootPath: () => currentWorkspaceRootRef.current,
        currentBindingCacheGeneration: currentPhpFrameworkBindingCacheGeneration,
        invalidateBindingCache: () => invalidatePhpFrameworkBindingCacheRef.current(),
        isBindingSearchCandidatePath: isPhpFrameworkBindingSearchCandidatePath,
        readTextFile: (path) => workspaceFiles.readTextFile(path),
      }),
    [
      activePhpFrameworkProviders,
      currentPhpFrameworkBindingCacheGeneration,
      currentWorkspaceRootRef,
      invalidatePhpFrameworkBindingCacheRef,
      isPhpFrameworkBindingSearchCandidatePath,
      phpFrameworkRuntimeContext,
      workspaceFiles,
    ],
  );

  const { resetPhpFrameworkMorphMapModelTypeCache, resolvePhpFrameworkProjectMorphMapModelType } =
    usePhpFrameworkMorphMapResolver({
      currentWorkspaceRootRef,
      frameworkRuntime: phpFrameworkRuntimeContext,
      readNavigationFileContent,
      textSearch,
      workspaceDescriptor,
      workspaceRoot,
    });
  resetPhpFrameworkMorphMapModelTypeCacheRef.current = resetPhpFrameworkMorphMapModelTypeCache;

  const reclassifyPhpLanguageServerDiagnosticsForRoot = useCallback(
    (rootPath: string, expectedOwnerKey: string): boolean =>
      reclassifyPhpDiagnosticsForOwner({
        activePhpFrameworkProviders,
        currentWorkspaceRoot: currentWorkspaceRootRef.current,
        diagnosticsByOwnerRef: languageServerDiagnosticsByRootRef,
        documentsRef,
        expectedOwnerKey,
        resolveOwnerKey: (requestedRoot) =>
          resolveWorkspaceRuntimeOwner(requestedRoot)?.ownerKey ??
          normalizedWorkspaceRootKey(requestedRoot),
        rootPath,
        setDiagnosticsByPath: setLanguageServerDiagnosticsByPath,
        setNotices,
        workspaceSources: currentPhpFrameworkSourceContext().workspaceSources,
      }),
    [
      activePhpFrameworkProviders,
      currentPhpFrameworkSourceContext,
      currentWorkspaceRootRef,
      documentsRef,
      languageServerDiagnosticsByRootRef,
      resolveWorkspaceRuntimeOwner,
      setLanguageServerDiagnosticsByPath,
      setNotices,
    ],
  );

  useEffect(() => {
    reclassifyPhpLanguageServerDiagnosticsForRootRef.current =
      reclassifyPhpLanguageServerDiagnosticsForRoot;
  }, [
    reclassifyPhpLanguageServerDiagnosticsForRoot,
    reclassifyPhpLanguageServerDiagnosticsForRootRef,
  ]);

  const {
    readPhpClassMembersFromPath,
    collectPhpMethodsForClass,
    collectPhpFrameworkSyntheticMethodsForClass,
    collectPhpFrameworkRelationCompletionsForClass,
    resolvePhpGenericTemplateTypesForInheritedClass,
    resolvePhpGenericTemplateTypesForMixinClass,
    resetPhpClassMemberCache,
  } = usePhpClassMemberCollectors({
    currentPhpFrameworkSourceContext,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpDeclaredType,
    resolvePhpFrameworkBoundConcrete,
    workspaceDescriptor,
    workspaceRoot,
  });

  useEffect(() => {
    resetPhpClassMemberCacheRef.current = resetPhpClassMemberCache;
  }, [resetPhpClassMemberCache, resetPhpClassMemberCacheRef]);

  const readWorkspaceDirectory = useCallback(
    (path: string) => workspaceFiles.readDirectory(path),
    [workspaceFiles],
  );

  const {
    collectNamedRouteTargets,
    collectAuthorizationAbilityTargets,
    collectMiddlewareAliasTargets,
    collectEnvironmentTargets,
    collectViewTargets,
    collectConfigTargets,
    collectTranslationTargets,
    collectAuthGuardTargets,
    collectCacheStoreTargets,
    collectDatabaseConnectionTargets,
    collectBroadcastConnectionTargets,
    collectQueueConnectionTargets,
    collectRedisConnectionTargets,
    collectMailMailerTargets,
    collectPasswordBrokerTargets,
    collectLogChannelTargets,
    collectStorageDiskTargets,
    findViewTarget,
    findConfigTarget,
    findTranslationTarget,
    findAuthGuardTarget,
    findCacheStoreTarget,
    findDatabaseConnectionTarget,
    findBroadcastConnectionTarget,
    findQueueConnectionTarget,
    findRedisConnectionTarget,
    findMailMailerTarget,
    findPasswordBrokerTarget,
    findLogChannelTarget,
    findStorageDiskTarget,
    findEnvironmentTarget,
    invalidateTargetCache: invalidateFrameworkTargetCache,
  } = usePhpFrameworkTargets({
    currentWorkspaceRootRef,
    workspaceRoot,
    textSearch,
    readNavigationFileContent,
    readWorkspaceDirectory,
    relativeWorkspacePath,
    joinWorkspacePath,
    isPhpPath,
    frameworkIntelligence: phpFrameworkIntelligence,
  });

  const {
    phpClassHierarchyHasConstant,
    phpClassHierarchyHasMethod,
    phpClassHierarchyHasProperty,
    phpClassHierarchyHasStaticMethod,
  } = usePhpClassHierarchyPredicates({
    currentWorkspaceRootRef,
    readPhpClassMembersFromPath,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    workspaceDescriptor,
    workspaceRoot,
  });

  const { phpClassHasLaravelDynamicWhere, phpClassHasLaravelLocalScope } =
    usePhpLaravelScopePredicates({
      collectPhpFrameworkSyntheticMethodsForClass,
      collectPhpMethodsForClass,
      frameworkRuntime: phpFrameworkRuntimeContext,
    });

  const {
    resolvePhpClassPropertyOrRelationType,
    resolvePhpFrameworkBuilderModelType,
    resolvePhpFrameworkRelationPathOwnerType,
    resolvePhpExpressionType,
  } = usePhpFrameworkModelSemantics({
    collectPhpMethodsForClass,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    phpClassHasDynamicBuilderFinder: phpClassHasLaravelDynamicWhere,
    phpClassHasNamedBuilderScope: phpClassHasLaravelLocalScope,
    readNavigationFileContent,
    readPhpClassMembersFromPath,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpDeclaredType,
    resolvePhpFrameworkBoundConcrete,
    resolvePhpFrameworkProjectMorphMapModelType,
    resolvePhpFrameworkReturnTypeReference,
    resolvePhpGenericTemplateTypesForInheritedClass,
    resolvePhpGenericTemplateTypesForMixinClass,
    resolvePhpMethodDeclaredReturnType,
    resolvePhpSemanticTypeReference,
    useModelSemanticsAdapter: usePhpLaravelModelSemanticsAdapter,
    workspaceDescriptor,
    workspaceRoot,
  });

  const {
    invalidatePhpTraitHostClassNames,
    phpTraitHostConstantExists,
    phpTraitHostMethodExists,
    phpTraitHostPropertyExists,
    phpTraitHostPropertyMethodExists,
    resolvePhpTraitHostClassNames,
  } = usePhpTraitHostPredicates({
    currentWorkspaceRootRef,
    isPhpPath,
    phpClassHierarchyHasConstant,
    phpClassHierarchyHasMethod,
    phpClassHierarchyHasProperty,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpClassPropertyOrRelationType,
    searchText: (root, query, limit, options) =>
      options === undefined
        ? textSearch.searchText(root, query, limit)
        : textSearch.searchText(root, query, limit, options),
    workspaceRoot,
  });

  usePhpDiagnosticContextFilter({
    contextualDiagnosticsFilterRef,
    currentPhpFrameworkSourceContext,
    currentWorkspaceRoot: () => currentWorkspaceRootRef.current,
    ensurePhpFrameworkSourceCollectionsLoaded,
    frameworkRuntime: phpFrameworkRuntimeContext,
    isPhpPath,
    phpClassHasLaravelDynamicWhere,
    phpClassHasLaravelLocalScope,
    phpClassHierarchyHasMethod,
    phpClassHierarchyHasProperty,
    phpClassHierarchyHasStaticMethod,
    phpTraitHostConstantExists,
    phpTraitHostMethodExists,
    phpTraitHostPropertyExists,
    phpTraitHostPropertyMethodExists,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpFrameworkBuilderModelType,
    resolvePhpExpressionType,
  });

  const { resolvePhpReceiverMethodCompletions, resolvePhpStaticMethodCompletions } =
    usePhpMethodCompletionResolvers({
      collectPhpFrameworkSyntheticMethodsForClass,
      collectPhpMethodsForClass,
      currentPhpFrameworkSourceContext,
      frameworkRuntime: phpFrameworkRuntimeContext,
      phpNormalizedReceiverExpressionIsThis,
      resolvePhpClassReference,
      resolvePhpFrameworkBuilderModelType,
      resolvePhpExpressionType,
    });

  const { providePhpMethodCompletions } = usePhpMethodCompletionProvider({
    activeDocument,
    collectAuthGuardTargets,
    collectBroadcastConnectionTargets,
    collectCacheStoreTargets,
    collectConfigTargets,
    collectDatabaseConnectionTargets,
    collectEnvTargets: collectEnvironmentTargets,
    collectGateAbilityTargets: collectAuthorizationAbilityTargets,
    collectLogChannelTargets,
    collectMailMailerTargets,
    collectMiddlewareAliasTargets,
    collectNamedRouteTargets,
    collectPasswordBrokerTargets,
    collectPhpFrameworkRelationCompletionsForClass,
    collectPhpMethodsForClass,
    collectQueueConnectionTargets,
    collectRedisConnectionTargets,
    collectStorageDiskTargets,
    collectTranslationTargets,
    collectViewTargets,
    currentWorkspaceRootRef,
    ensurePhpFrameworkSourceCollectionsLoaded,
    frameworkRuntime: phpFrameworkRuntimeContext,
    joinWorkspacePath,
    projectSymbolSearch,
    readNavigationFileContent,
    relativeWorkspacePath,
    resolvePhpClassReference,
    resolvePhpFrameworkBuilderModelType,
    resolvePhpExpressionType,
    resolvePhpFrameworkRelationPathOwnerType,
    resolvePhpReceiverMethodCompletions,
    resolvePhpStaticMethodCompletions,
    resolvePhpTraitHostClassNames,
    workspaceRoot,
  });

  const { providePhpMethodSignature, providePhpParameterInlayHints } = usePhpSignatureHelpProvider({
    currentWorkspaceRootRef,
    resolvePhpReceiverMethodCompletions,
    resolvePhpStaticMethodCompletions,
    workspaceRoot,
  });

  const readOpenDocumentContent = useCallback(
    (path: string): string | null => documentsRef.current[path]?.content ?? null,
    [documentsRef],
  );
  const { createMissingBladeViewCodeAction, providePhpCodeActions } = usePhpCodeActionProvider({
    activeDocumentPath: activeDocument?.path ?? null,
    collectViewTargets,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    getPhpDocumentSyncVersion,
    intelligenceMode,
    projectSymbolSearch,
    readNavigationFileContent,
    readOpenDocumentContent,
    readTestFileIfExists,
    resolvePhpClassSourcePaths,
    workspaceDescriptor,
    workspaceRoot,
  });

  const { openPhpClassTarget } = usePhpClassTargetNavigation({
    activeDocument,
    currentWorkspaceRootRef,
    intelligenceMode,
    openNavigationTarget,
    projectSymbolSearch,
    readNavigationFileContent,
    workspaceDescriptor,
    workspaceRoot,
  });

  const phpFrameworkLiteralNavigationDependencies = usePhpFrameworkLiteralNavigationDependencies({
    collectNamedRouteTargets,
    currentWorkspaceRootRef,
    findAuthGuardTarget,
    findBroadcastConnectionTarget,
    findCacheStoreTarget,
    findConfigTarget,
    findDatabaseConnectionTarget,
    findEnvTarget: findEnvironmentTarget,
    findLogChannelTarget,
    findMailMailerTarget,
    findPasswordBrokerTarget,
    findQueueConnectionTarget,
    findRedisConnectionTarget,
    findStorageDiskTarget,
    findTranslationTarget,
    findViewTarget,
    joinWorkspacePath,
    providers: activePhpFrameworkProviders,
    readNavigationFileContent,
    readWorkspaceDirectory,
    relativeWorkspacePath,
    workspaceRoot,
  });

  const phpFrameworkRuntimeOwnerKey = workspaceRuntimeOwnerRef.current?.ownerKey ?? "";
  const phpFrameworkNavigationGeneration = phpFrameworkNavigationGenerationRef.current;
  const phpFrameworkDefinitionNavigationActivation = usePhpFrameworkDefinitionNavigationActivation({
    currentWorkspaceRootRef,
    generation: phpFrameworkNavigationGeneration,
    generationRef: phpFrameworkNavigationGenerationRef,
    ownerKey: phpFrameworkRuntimeOwnerKey,
    resolveCurrentWorkspaceRuntimeOwner,
    rootPath: workspaceRoot ?? "",
  });

  const { providePhpFrameworkDefinition } = usePhpFrameworkDefinitionNavigation({
    activeDocument,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    frameworkActivation: phpFrameworkDefinitionNavigationActivation,
    frameworkLiteralNavigationDependencies: phpFrameworkLiteralNavigationDependencies,
    openNavigationTarget,
    openPhpClassTarget,
    readNavigationFileContent,
    resolvePhpExpressionType,
    resolvePhpClassSourcePaths,
    textSearch,
    workspaceDescriptor,
    workspaceRoot,
  });

  const { openDirectPhpMethodTarget, openPhpMethodHintTarget } = usePhpMethodTargetNavigation({
    currentWorkspaceRootRef,
    intelligenceMode,
    openNavigationTarget,
    projectSymbolSearch,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpFrameworkBoundConcrete,
    workspaceDescriptor,
    workspaceRoot,
  });

  const { openSymfonyRouteController, openSymfonyService } = useSymfonyWorkspaceNavigation({
    openPhpClassTarget,
    openPhpMethodTarget: openDirectPhpMethodTarget,
  });

  const { openDirectPhpPropertyTarget } = usePhpPropertyTargetNavigation({
    currentWorkspaceRootRef,
    openNavigationTarget,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    workspaceDescriptor,
    workspaceRoot,
  });

  const { goToIndexedPhpImplementation } = usePhpImplementationNavigation({
    activeDocument,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    identifierAtEditorPosition,
    intelligenceMode,
    openNavigationTarget,
    projectSymbolSearch,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    setImplementationChooser,
    workspaceRoot,
  });

  const { findValidationRuleModelTargets } = usePhpFrameworkModelNavigationTargets({
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    projectSymbolSearch,
    providers: activePhpFrameworkProviders,
    readNavigationFileContent,
    resolvePhpClassSourcePaths,
    workspaceDescriptor,
    workspaceRoot,
  });

  const { openPhpLaravelDynamicWhereTarget, openPhpLaravelModelAttributeTarget } =
    usePhpLaravelModelNavigationTargets({
      currentWorkspaceRootRef,
      frameworkRuntime: phpFrameworkRuntimeContext,
      openNavigationTarget,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    });

  const { goToPhpMemberPropertyDefinition } = usePhpMemberPropertyDefinitionNavigation({
    activeDocument,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    openDirectPhpMethodTarget,
    openDirectPhpPropertyTarget,
    openPhpClassTarget,
    openPhpLaravelModelAttributeTarget,
    phpClassHierarchyHasProperty,
    resolvePhpExpressionType,
    setMessage,
    workspaceRoot,
  });

  const {
    goToPhpClassConstantDefinition,
    goToPhpLaravelRelationStringDefinition,
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
  } = usePhpContextualMemberDefinitionNavigation({
    activeDocument,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    openDirectPhpMethodTarget,
    openNavigationTarget,
    openPhpClassTarget,
    openPhpLaravelDynamicWhereTarget,
    openPhpMethodHintTarget,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpFrameworkBuilderModelType,
    resolvePhpExpressionType,
    resolvePhpFrameworkRelationPathOwnerType,
    setMessage,
    workspaceDescriptor,
    workspaceRoot,
  });

  const workbenchFrameworkIntelligenceDependencies = useWorkbenchFrameworkIntelligenceDependencies({
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
  });

  const workbenchFrameworkIntelligence = useWorkbenchFrameworkIntelligence(
    workbenchFrameworkIntelligenceDependencies,
  );
  const {
    provideBladeDefinition,
    invalidateBladeComponentNamesForPath,
    invalidateBladeViewDataEntriesForPath,
    invalidateLatteExpressionDataForPath,
    invalidateNeonConfigForPath,
    providePhpNetteInjectionDefinition,
    resetBladeIntelligenceCaches,
    collectCompleteLatteTemplateRelativePaths,
    provideLattePresenterLinkDiagnostics,
    provideLatteDefinitionOutcome,
    provideNeonDefinition,
  } = workbenchFrameworkIntelligence;

  const activeDocumentDiagnosticsContributions = useMemo(
    () =>
      composePhpFrameworkActiveDocumentDiagnosticsContributions({
        collectCompleteLatteTemplateRelativePaths,
        collectViewTargets,
        provideLattePresenterLinkDiagnostics,
      }),
    [
      collectCompleteLatteTemplateRelativePaths,
      collectViewTargets,
      provideLattePresenterLinkDiagnostics,
    ],
  );

  usePhpFrameworkActiveDocumentDiagnostics({
    activeDocument,
    activeDocumentRef,
    contributions: activeDocumentDiagnosticsContributions,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    setFrameworkDiagnosticsByPath,
    workspaceRoot,
  });

  const fileChangeInvalidationContributions = useMemo(
    () =>
      composePhpFrameworkFileChangeInvalidationContributions({
        invalidateBladeComponentNamesForPath,
        invalidateBladeViewDataEntriesForPath,
        invalidateLatteExpressionDataForPath,
        invalidateNeonConfigForPath,
      }),
    [
      invalidateBladeComponentNamesForPath,
      invalidateBladeViewDataEntriesForPath,
      invalidateLatteExpressionDataForPath,
      invalidateNeonConfigForPath,
    ],
  );
  const invalidateFrameworkCachesForPath = useMemo(
    () =>
      createPhpFrameworkFileChangeInvalidator({
        contributions: fileChangeInvalidationContributions,
        frameworkRuntime: phpFrameworkRuntimeContext,
      }),
    [fileChangeInvalidationContributions, phpFrameworkRuntimeContext],
  );
  resetPhpFrameworkCachesRef.current = () => {
    phpClassSourcePathCacheRef.current = {};
    invalidatePhpTraitHostClassNames();
    resetPhpClassMemberCacheRef.current();
    invalidatePhpFrameworkBindingCache();
    resetPhpFrameworkMorphMapModelTypeCache();
    invalidateFrameworkTargetCache();
    resetPhpFrameworkSourceRegistries();
    resetBladeIntelligenceCaches();
  };
  const frameworkIntelligenceProviders = useWorkbenchFrameworkProviderAdapter(
    workbenchFrameworkIntelligence,
  );

  const {
    goToPhpFrameworkAuthorizationAbilityDefinition,
    goToPhpFrameworkMiddlewareAliasDefinition,
  } = usePhpFrameworkAuthorizationMiddlewareDefinitionNavigation({
    activeDocument,
    collectAuthorizationAbilityTargets,
    collectMiddlewareAliasTargets,
    currentWorkspaceRootRef,
    frameworkRuntime: phpFrameworkRuntimeContext,
    openNavigationTarget,
    setMessage,
    workspaceRoot,
  });

  const { goToPhpFrameworkLiteralDefinition } =
    usePhpContextualFrameworkLiteralDefinitionNavigation({
      activeDocument,
      currentWorkspaceRootRef,
      frameworkLiteralNavigationDependencies: {
        ...phpFrameworkLiteralNavigationDependencies,
        findValidationRuleModelTargets,
      },
      openNavigationTarget,
      providers: activePhpFrameworkProviders,
      setMessage,
      supportsStringLiterals: phpFrameworkRuntimeContext.supports("stringLiterals"),
      workspaceRoot,
    });

  const goToPhpClassIdentifierDefinition = useCallback(
    async (name: string, request?: NavigationRequest): Promise<boolean> => {
      if (!activeDocument) {
        return false;
      }

      const className = resolvePhpClassName(activeDocument.content, name);

      if (!className) {
        return false;
      }

      return request
        ? openPhpClassTarget(className, name, request)
        : openPhpClassTarget(className, name);
    },
    [activeDocument, openPhpClassTarget],
  );

  const {
    adapters: phpFrameworkIdentifierDefinitionAdapters,
    contextualAdapters: contextualPhpFrameworkIdentifierDefinitionAdapters,
  } = useMemo(
    () =>
      createPhpFrameworkIdentifierNavigationAdapters({
        activationAdapters: createDefaultPhpFrameworkIdentifierNavigationActivationAdapters({
          laravel: {
            activeDocument,
            goToPhpFrameworkLiteralDefinition,
            goToPhpFrameworkAuthorizationAbilityDefinition,
            goToPhpFrameworkMiddlewareAliasDefinition,
            goToPhpLaravelRelationStringDefinition,
            openDirectPhpMethodTarget,
            openPhpClassTarget,
          },
          nette: {
            activeDocument,
            activeEditorPositionRef,
            providePhpNetteInjectionDefinition,
          },
        }),
        frameworkRuntime: phpFrameworkRuntimeContext,
      }),
    [
      activeDocument,
      activeEditorPositionRef,
      goToPhpFrameworkLiteralDefinition,
      goToPhpFrameworkAuthorizationAbilityDefinition,
      goToPhpFrameworkMiddlewareAliasDefinition,
      goToPhpLaravelRelationStringDefinition,
      providePhpNetteInjectionDefinition,
      openDirectPhpMethodTarget,
      openPhpClassTarget,
      phpFrameworkRuntimeContext,
    ],
  );

  const { goToContextualPhpFrameworkIdentifierDefinition, goToPhpFrameworkIdentifierDefinition } =
    usePhpFrameworkIdentifierDefinitionNavigation({
      adapters: phpFrameworkIdentifierDefinitionAdapters,
      contextualAdapters: contextualPhpFrameworkIdentifierDefinitionAdapters,
    });

  const { goToContextualPhpDefinition } = usePhpContextualDefinitionNavigation({
    activeDocument,
    activeEditorPositionRef,
    goToPhpClassConstantDefinition,
    goToPhpClassIdentifierDefinition,
    goToPhpFrameworkIdentifierDefinition: goToContextualPhpFrameworkIdentifierDefinition,
    goToPhpMemberPropertyDefinition,
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
    providers: activePhpFrameworkProviders,
  });

  const { goToSuperMethod } = usePhpSuperMethodNavigation({
    activeDocument,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    openNavigationTarget,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    setMessage,
    workspaceDescriptor,
    workspaceRoot,
  });

  const { goToIndexedSymbolDefinition } = usePhpIndexedDefinitionNavigation({
    activeDocument,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    goToPhpClassConstantDefinition,
    goToPhpClassIdentifierDefinition,
    goToPhpFrameworkIdentifierDefinition,
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
    identifierAtEditorPosition,
    intelligenceMode,
    openNavigationTarget,
    projectSymbolSearch,
    providers: activePhpFrameworkProviders,
    reportErrorForActiveWorkspaceRoot,
    setMessage,
    workspaceRoot,
  });

  return {
    frameworkIntelligenceProviders,
    goToContextualPhpDefinition,
    goToIndexedPhpImplementation,
    goToIndexedSymbolDefinition,
    goToSuperMethod,
    invalidateFrameworkCachesForPath,
    invalidatePhpFrameworkBindingsForFileChange,
    invalidatePhpTraitHostClassNames,
    openPhpClassTarget,
    openSymfonyRouteController,
    openSymfonyService,
    provideBladeDefinition,
    provideLatteDefinitionOutcome,
    provideNeonDefinition,
    providePhpCodeActions,
    providePhpFrameworkDefinition,
    providePhpMethodCompletions,
    providePhpMethodSignature,
    providePhpParameterInlayHints,
  };
}

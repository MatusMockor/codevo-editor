import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import {
  shouldIndexWorkspace,
  shouldStartLanguageServer,
  type SmartModeGateway,
} from "../../domain/intelligence";
import type { Bookmark } from "../../domain/bookmarks";
import type { BottomPanelView } from "../../domain/bottomPanel";
import type { CallHierarchyView } from "../../domain/callHierarchy";
import type { DiagnosticsCoalescer } from "../../domain/diagnosticsCoalescer";
import type { EditorGroupsState } from "../../domain/editorGroups";
import type { EditorSessionOwnerKey } from "../../domain/editorSessionOwnerKey";
import type { FilePrefetchCache } from "../../domain/filePrefetchCache";
import type { LanguageServerPlan } from "../../domain/languageServer";
import type { LanguageServerDiagnostic } from "../../domain/languageServerDiagnostics";
import type { EditorRevealTarget } from "../../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import { cachedLanguageServerRuntimeStatusForOwner } from "../../domain/languageServerRuntimeStatusCache";
import type { PackageScript } from "../../domain/packageScripts";
import type { PhpFileStructureScope } from "../../domain/phpFileOutline";
import type { ProjectSymbolSearchResult } from "../../domain/projectSymbols";
import type { RecentFileEntry } from "../../domain/recentFiles";
import type { RecentLocation } from "../../domain/recentLocations";
import type { ReferencesView } from "../../domain/referencesView";
import {
  defaultWorkspaceSettings,
  pushRecentWorkspacePath,
  type AppSettings,
  type SettingsGateway,
  type WorkspaceSessionViewState,
} from "../../domain/settings";
import type { TypeHierarchyView } from "../../domain/typeHierarchy";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../../domain/trust";
import type {
  FileEntry,
  IntelligenceMode,
  WorkspaceDescriptor,
  WorkspaceDetectionGateway,
  WorkspaceFileGateway,
} from "../../domain/workspace";
import type { ProjectRuntimeStopResult } from "../../domain/workspaceRuntimeLifecycle";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import {
  resolveDocumentSessionWorkspaceTransition,
  workspaceIdentityAliasPaths,
  workspaceTabsWithPath,
} from "../documentSessionAuthorityLifecycleCoordinator";
import type { RunWithDocumentSaveExclusion } from "../documentSaveCoordinator";
import type { ResolveDocumentSaveOwnership } from "../documentSaveIdentity";
import {
  captureWorkspaceBeforeSwitch,
  closeWorkspaceDocumentsBeforeSwitch,
} from "../workspaceSessionSwitchLifecycle";
import { loadWorkspaceTrustForOwner } from "../useWorkbenchControllerAgents";
import type { ImplementationChooserState } from "../useFloatingSurfaces";
import type { CachedWorkspaceWorkbenchState } from "../useWorkspaceStateCache";
import type { WorkbenchNotice } from "../workbenchNotice";
import type { WorkspaceSettingsByRootSnapshot } from "../workspaceSettingsForRoot";
import type { WorkspaceSettingsSaveCoordinator } from "../workspaceSettingsSaveCoordinator";
import type { WorkspaceFileChangeGateway } from "../../domain/workspaceFileChange";
import type { WorkspaceDocumentCloseCoordinator } from "../workspaceSessionSwitchLifecycle";
import type { DocumentSessionAuthorityLifecycleCoordinator } from "../documentSessionAuthorityLifecycleCoordinator";
import { disposeWorkspaceFileChanges } from "./workspaceRetainedStateCleanup";
import { loadCompleteWorkspaceDirectoryEntries } from "./useWorkspaceDirectoryLoader";
import type { WorkspaceRuntimeOwnerClaimRegistry } from "../workspaceRuntimeOwnerClaimRegistry";
import type { WorkbenchLanguageRuntimeProjectionCommands } from "./useWorkbenchLanguageRuntimeProjection";
import type { WorkbenchSmartModeIntentState } from "./useWorkbenchLanguageRuntimeCoordinator";
import type { LatestWorkspaceRequestTokenRegistry } from "./workspaceRequestTokenRegistry";
import type { BoundedPendingWorkspaceSettingsLoads } from "./boundedPendingWorkspaceSettingsLoads";
import {
  useWorkspaceOpenRequestLifecycle,
  useWorkspacePackageScriptHydration,
} from "./useWorkspaceOpenRequestLifecycle";
import { useWorkspaceSessionRestorer } from "./useWorkspaceSessionRestorer";
import {
  adoptLegacyCachedWorkspaceState,
  workspaceSettingsIdentity,
} from "./workspaceIdentityPolicy";
import {
  backgroundRuntimeOwnersForPolicy,
  workspaceRuntimeOwnerFor,
} from "./workspaceRuntimePolicy";
import { beginWorkbenchSmartModeIntent } from "./useWorkbenchLanguageRuntimeCoordinator";
import { PendingWorkspaceSettingsLoadCapacityError } from "./boundedPendingWorkspaceSettingsLoads";
import type { WorkspaceCloseOwnership } from "../useWorkbenchCloseLifecycle";
import type { WorkspaceSettings } from "../../domain/settings";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import type { WorkspaceIdentityGateway } from "../workspaceIdentityGatewayPort";
import type { EditorDocument } from "../../domain/workspace";
import {
  workspaceIdentityStateCacheKey,
  shouldRunInitialIndexScan,
} from "../useWorkspaceStateCache";
import { replaceWorkbenchNoticeGroup } from "../workbenchNotice";
import { removeWorkspaceIdentityMappings } from "./workspaceIdentityPolicy";

interface OpenWorkspacePathOptions {
  readonly cachePreviousWorkspace?: boolean;
  readonly isOpenIntentCurrent?: () => boolean;
}

type SidebarView = "files" | "git" | "php" | "scripts";
type Documents = Record<string, EditorDocument>;
type DirectoryExplorer = ReturnType<
  typeof import("./useWorkspaceDirectoryExplorer").useWorkspaceDirectoryExplorer
>;
type LoadDirectory = DirectoryExplorer["loadDirectory"];
type AdoptCachedDirectoryProjection = DirectoryExplorer["adoptCachedDirectoryProjection"];
type PrimeCachedDirectoryEntries = DirectoryExplorer["primeCachedDirectoryEntries"];
type RefreshCachedExpandedDirectories = DirectoryExplorer["refreshCachedExpandedDirectories"];

interface FlatWorkspaceTransitionDependencies {
  readonly adoptCachedDirectoryProjection: AdoptCachedDirectoryProjection;
  readonly appSettingsRef: RefObject<AppSettings>;
  readonly applyWorkspaceSettings: (
    settings: import("../../domain/settings").WorkspaceSettings,
  ) => void;
  readonly autoStartedJavaScriptTypeScriptLanguageServerRootRef: RefObject<string | null>;
  readonly autoStartedLanguageServerRootRef: RefObject<string | null>;
  readonly cacheCurrentWorkspaceState: (rootPath: string) => void;
  readonly canonicalDocumentSaveRoot: (rootPath: string) => string;
  readonly clearIndexWorkspaceState: () => void;
  readonly clearJavaScriptTypeScriptLanguageServerDiagnostics: () => void;
  readonly clearLanguageServerDiagnostics: () => void;
  readonly clearPhpLocalDiagnostics: () => void;
  readonly clearPhpstanDiagnosticsForRoot: (rootPath: string) => void;
  readonly clearWorkspaceStateCache: () => void;
  readonly closeSyncedJavaScriptTypeScriptDocumentsForRoot: (rootPath: string) => Promise<void>;
  readonly closeSyncedLanguageServerDocumentsForRoot: (rootPath: string) => Promise<void>;
  readonly coalesceWorkspaceStateCache: (
    identity: WorkspaceIdentityDescriptor,
    requestedRootPath?: string,
  ) => CachedWorkspaceWorkbenchState | null;
  readonly currentEditorSessionOwnerKeyRef: RefObject<EditorSessionOwnerKey | null>;
  readonly currentWorkspaceRootRef: RefObject<string | null>;
  readonly documentSessionAuthorityLifecycle: DocumentSessionAuthorityLifecycleCoordinator;
  readonly documentsRef: MutableRefObject<Documents>;
  readonly editorSessionOwnerKeyForRoot: (rootPath: string) => EditorSessionOwnerKey;
  readonly externallyRemovedDocumentRootByPathRef: RefObject<Record<string, string>>;
  readonly filePrefetchCacheRef: RefObject<FilePrefetchCache>;
  readonly filePrefetchTimersRef: RefObject<Map<string, ReturnType<typeof setTimeout>>>;
  readonly flushDeferredWorkspaceIdentityCleanup: () => void;
  readonly forgetCachedWorkspaceState: (
    rootPath: string,
    identity?: WorkspaceIdentityDescriptor | null,
  ) => void;
  readonly hasPhpWorkspaceByOwnerRef: RefObject<Record<string, boolean>>;
  readonly intelligenceModeRef: RefObject<IntelligenceMode>;
  readonly javaScriptTypeScriptDiagnosticsByRootRef: RefObject<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >;
  readonly javaScriptTypeScriptDiagnosticsCoalescerRef: RefObject<DiagnosticsCoalescer | null>;
  readonly javaScriptTypeScriptRuntimeStatusByRootRef: RefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;
  readonly languageRuntimeProjectionCommands: WorkbenchLanguageRuntimeProjectionCommands;
  readonly languageServerDiagnosticsByRootRef: RefObject<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >;
  readonly languageServerDiagnosticsCoalescerRef: RefObject<DiagnosticsCoalescer | null>;
  readonly languageServerRuntimeStatusByRootRef: RefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;
  readonly lastLanguageServerCrashRef: RefObject<string | null>;
  readonly lastPhpFileOutlineRefreshKeyRef: RefObject<string | null>;
  readonly lastPhpIdeReadinessSignatureRef: RefObject<string | null>;
  readonly loadDirectory: LoadDirectory;
  readonly openFileRequestTokenRef: RefObject<number>;
  readonly openWorkspaceRequestInFlightTokenRef: RefObject<number | null>;
  readonly openWorkspaceRequestPathRef: RefObject<string | null>;
  readonly openWorkspaceRequestTokenRef: RefObject<number>;
  readonly ownedWorkspaceIdentityGenerationByIdRef: RefObject<Record<string, number>>;
  readonly persistAppSettings: (nextSettings: AppSettings) => Promise<void>;
  readonly persistCurrentWorkspaceSession: (rootPath: string) => Promise<void>;
  readonly phpFrameworkNavigationGenerationRef: RefObject<number>;
  readonly phpLanguageServerAutostartAttemptsByRootRef: RefObject<Record<string, number>>;
  readonly primeCachedDirectoryEntries: PrimeCachedDirectoryEntries;
  readonly readTestFileIfExists: (path: string) => Promise<string | null>;
  readonly refreshCachedExpandedDirectories: RefreshCachedExpandedDirectories;
  readonly refreshJavaScriptTypeScriptLanguageServerPlan: (
    rootPath: string,
    typeScriptVersionPreference?: import("../../domain/settings").WorkspaceSettings["javaScriptTypeScriptVersion"],
    owner?: WorkspaceRuntimeOwner,
    requestIsValid?: () => boolean,
  ) => Promise<LanguageServerPlan | null>;
  readonly releaseOwnedWorkspaceIdentity: (workspaceId: string) => Promise<"deferred" | "released">;
  readonly reportError: (source: string, error: unknown) => void;
  readonly reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
  readonly resetActiveEditorPosition: () => void;
  readonly resetDirectoryExplorerLifecycle: () => void;
  readonly resetEditorConfigCache: () => void;
  readonly resetEditorSurfaceState: () => void;
  readonly resetGitDiffWorkspaceState: () => void;
  readonly resetGitStatusSurface: (rootPath?: string) => void;
  readonly resetHistory: () => void;
  readonly resetJavaScriptTypeScriptFileStructure: () => void;
  readonly resetJavaScriptTypeScriptLanguageServerDocuments: () => void;
  readonly resetLanguageServerDocuments: () => void;
  readonly resetPhpFrameworkCachesRef: RefObject<() => void>;
  readonly resetPhpOutlineState: () => void;
  readonly resetSearchEverywhere: () => void;
  readonly resetTextSearchState: () => void;
  readonly resolveCachedWorkspaceState: (
    rootPath: string,
    identity?: WorkspaceIdentityDescriptor | null,
  ) => CachedWorkspaceWorkbenchState | null;
  readonly resolveDocumentSaveOwnership: ResolveDocumentSaveOwnership;
  readonly restoreCachedWorkspaceState: (
    rootPath: string,
    cached: CachedWorkspaceWorkbenchState,
  ) => void;
  readonly restoreIndexRoot: (rootPath: string | null) => void;
  readonly restoreJavaScriptTypeScriptDiagnosticsForRoot: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  readonly restoreLanguageServerDiagnosticsForRoot: (
    rootPath: string | null | undefined,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  readonly restorePersistedNavigationSession: (
    rootPath: string,
    activeRootPath: () => string | null,
    session: import("../../domain/settings").WorkspaceSessionState,
    resetNavigation: boolean,
    restoreSession: (
      rootPath: string,
      session: import("../../domain/settings").WorkspaceSessionState,
      isCurrent: () => boolean,
    ) => Promise<void>,
    isCurrent: () => boolean,
  ) => Promise<boolean>;
  readonly retireWorkspaceIdentityAuthority: () => readonly string[];
  readonly retireWorkspaceRuntimeOwnerClaim: (
    ownerKey: string,
    expectedGeneration?: number | null,
  ) => void;
  readonly runGitRepositoryDiscovery: (
    rootPath: string,
    settings: import("../../domain/settings").WorkspaceSettings,
  ) => Promise<void>;
  readonly runPhpWorkspaceProbe: (rootPath: string, owner?: WorkspaceRuntimeOwner) => Promise<void>;
  readonly setArtisanMakePaletteRoot: Dispatch<SetStateAction<string | null>>;
  readonly setBookmarks: Dispatch<SetStateAction<Bookmark[]>>;
  readonly setBottomPanelView: Dispatch<SetStateAction<BottomPanelView>>;
  readonly setBottomPanelVisible: Dispatch<SetStateAction<boolean>>;
  readonly setCallHierarchyView: Dispatch<SetStateAction<CallHierarchyView | null>>;
  readonly setClassOpenLoading: Dispatch<SetStateAction<boolean>>;
  readonly setClassOpenOpen: Dispatch<SetStateAction<boolean>>;
  readonly setClassOpenQuery: Dispatch<SetStateAction<string>>;
  readonly setClassOpenResults: Dispatch<SetStateAction<ProjectSymbolSearchResult[]>>;
  readonly setEditorRevealTarget: Dispatch<SetStateAction<EditorRevealTarget | null>>;
  readonly setEntriesByDirectory: Dispatch<SetStateAction<Record<string, FileEntry[]>>>;
  readonly setDocuments: Dispatch<SetStateAction<Documents>>;
  readonly setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>;
  readonly setFileStructureOpen: Dispatch<SetStateAction<boolean>>;
  readonly setFileStructureScope: Dispatch<SetStateAction<PhpFileStructureScope>>;
  readonly setGitBlameEnabledPaths: Dispatch<SetStateAction<Set<string>>>;
  readonly setImplementationChooser: (chooser: ImplementationChooserState | null) => void;
  readonly setInstallingManagedPhpactor: Dispatch<SetStateAction<boolean>>;
  readonly setInstallingManagedTypeScriptLanguageServer: Dispatch<SetStateAction<boolean>>;
  readonly setIntelligenceMode: Dispatch<SetStateAction<IntelligenceMode>>;
  readonly setLanguageServerPlan: Dispatch<SetStateAction<LanguageServerPlan | null>>;
  readonly setLoadingDirectories: Dispatch<SetStateAction<Set<string>>>;
  readonly setManuallyCollapsedDirectories: Dispatch<SetStateAction<Set<string>>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;
  readonly setPackageScriptsByRoot: Dispatch<
    SetStateAction<Record<string, { composerScripts: PackageScript[]; hasArtisan: boolean }>>
  >;
  readonly setPaletteOpen: (open: boolean) => void;
  readonly setQuickOpenOpen: (isOpen: boolean) => void;
  readonly setRecentFiles: Dispatch<SetStateAction<RecentFileEntry[]>>;
  readonly setRecentFilesSwitcherOpen: Dispatch<SetStateAction<boolean>>;
  readonly setRecentLocations: Dispatch<SetStateAction<RecentLocation[]>>;
  readonly setRecentLocationsPanelOpen: Dispatch<SetStateAction<boolean>>;
  readonly setReferencesView: Dispatch<SetStateAction<ReferencesView | null>>;
  readonly setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  readonly setSidebarView: Dispatch<SetStateAction<SidebarView>>;
  readonly setTypeHierarchyView: Dispatch<SetStateAction<TypeHierarchyView | null>>;
  readonly setWorkspaceDescriptor: Dispatch<SetStateAction<WorkspaceDescriptor | null>>;
  readonly setWorkspaceIdentityDescriptor: Dispatch<
    SetStateAction<WorkspaceIdentityDescriptor | null>
  >;
  readonly setWorkspaceRoot: Dispatch<SetStateAction<string | null>>;
  readonly setWorkspaceSymbolsLoading: Dispatch<SetStateAction<boolean>>;
  readonly setWorkspaceSymbolsOpen: Dispatch<SetStateAction<boolean>>;
  readonly setWorkspaceSymbolsQuery: Dispatch<SetStateAction<string>>;
  readonly setWorkspaceSymbolsResults: Dispatch<SetStateAction<ProjectSymbolSearchResult[]>>;
  readonly setWorkspaceTrust: Dispatch<SetStateAction<WorkspaceTrustState | null>>;
  readonly settingsGateway: SettingsGateway;
  readonly smartModeGateway: SmartModeGateway;
  readonly smartModeRequestGenerationRef: RefObject<number>;
  readonly smartModeRequestIntentRef: RefObject<WorkbenchSmartModeIntentState | null>;
  readonly startInitialIndexScan: (
    rootPath: string,
    requestIsCurrent: () => boolean,
  ) => Promise<void>;
  readonly stopBackgroundProjectRuntimes: (
    policy: AppSettings["runtimePolicy"],
    activeRootPath: string | null,
    previousRootPath: string | null,
  ) => Promise<void>;
  readonly stopProjectRuntimes: (
    rootPath?: string,
    owner?: WorkspaceRuntimeOwner,
  ) => Promise<ProjectRuntimeStopResult>;
  readonly updateEditorGroups: (update: (current: EditorGroupsState) => EditorGroupsState) => void;
  readonly updateLocalPhpDiagnostics: (
    diagnosticPath: string,
    diagnostics: LanguageServerDiagnostic[],
  ) => void;
  readonly workbenchMountedRef: RefObject<boolean>;
  readonly workspaceDetection: WorkspaceDetectionGateway;
  readonly workspaceDocumentCloseCoordinatorRef: RefObject<WorkspaceDocumentCloseCoordinator>;
  readonly workspaceEditorViewStatesRef: RefObject<
    Record<string, Record<string, Record<string, WorkspaceSessionViewState>>>
  >;
  readonly workspaceFileChangeGateway: WorkspaceFileChangeGateway;
  readonly workspaceFiles: WorkspaceFileGateway;
  readonly workspaceIdentityGateway: WorkspaceIdentityGateway;
  readonly workspaceIdentityByRootRef: RefObject<Record<string, WorkspaceIdentityDescriptor>>;
  readonly workspaceIdentityDescriptorRef: RefObject<WorkspaceIdentityDescriptor | null>;
  readonly workspaceRuntimeOwnerByTabRef: RefObject<Record<string, WorkspaceRuntimeOwner>>;
  readonly workspaceRuntimeOwnerClaimsRef: RefObject<WorkspaceRuntimeOwnerClaimRegistry>;
  readonly workspaceRuntimeOwnerRef: RefObject<WorkspaceRuntimeOwner | null>;
  readonly workspaceRuntimeRootByTabRef: RefObject<Record<string, string>>;
  readonly workspaceSessionRestoredRef: RefObject<boolean>;
  readonly workspaceSettingsByRoot: WorkspaceSettingsByRootSnapshot;
  readonly workspaceSettingsLoadByRootRef: RefObject<BoundedPendingWorkspaceSettingsLoads>;
  readonly workspaceSettingsSaveCoordinator: WorkspaceSettingsSaveCoordinator;
  readonly workspaceStateCacheRef: MutableRefObject<Record<string, CachedWorkspaceWorkbenchState>>;
  readonly workspaceTrustGateway: WorkspaceTrustGateway;
  readonly workspaceTrustRevisionByOwnerRef: RefObject<Record<string, number>>;
  readonly pendingWorkspaceIdentityRequestTokensRef: RefObject<LatestWorkspaceRequestTokenRegistry>;
  readonly withManagedWorkspaceIdentityLease: (
    descriptor: WorkspaceIdentityDescriptor,
    useLease: (adopt: () => void) => Promise<void>,
  ) => Promise<void>;
  readonly workspaceCloseGenerationByRootRef: RefObject<Record<string, number>>;
  readonly workspaceCloseOwnershipByKeyRef: RefObject<Record<string, number>>;
  readonly workspaceCloseOwnershipGenerationRef: RefObject<number>;
  readonly workspaceRoot: string | null;
}

type AuthorityDependencies = Pick<
  FlatWorkspaceTransitionDependencies,
  | "currentEditorSessionOwnerKeyRef"
  | "currentWorkspaceRootRef"
  | "documentSessionAuthorityLifecycle"
  | "workbenchMountedRef"
  | "openWorkspaceRequestInFlightTokenRef"
  | "openWorkspaceRequestPathRef"
  | "openWorkspaceRequestTokenRef"
  | "ownedWorkspaceIdentityGenerationByIdRef"
  | "pendingWorkspaceIdentityRequestTokensRef"
  | "withManagedWorkspaceIdentityLease"
  | "workspaceCloseGenerationByRootRef"
  | "workspaceCloseOwnershipByKeyRef"
  | "workspaceCloseOwnershipGenerationRef"
  | "workspaceIdentityByRootRef"
  | "workspaceIdentityDescriptorRef"
  | "releaseOwnedWorkspaceIdentity"
  | "retireWorkspaceIdentityAuthority"
  | "retireWorkspaceRuntimeOwnerClaim"
  | "flushDeferredWorkspaceIdentityCleanup"
>;

type CacheDependencies = Pick<
  FlatWorkspaceTransitionDependencies,
  | "cacheCurrentWorkspaceState"
  | "clearWorkspaceStateCache"
  | "coalesceWorkspaceStateCache"
  | "forgetCachedWorkspaceState"
  | "resolveCachedWorkspaceState"
  | "restoreCachedWorkspaceState"
  | "workspaceStateCacheRef"
  | "filePrefetchCacheRef"
  | "filePrefetchTimersRef"
  | "resetEditorConfigCache"
  | "workspaceSessionRestoredRef"
  | "workspaceEditorViewStatesRef"
>;

type DocumentsDependencies = Pick<
  FlatWorkspaceTransitionDependencies,
  | "canonicalDocumentSaveRoot"
  | "closeSyncedJavaScriptTypeScriptDocumentsForRoot"
  | "closeSyncedLanguageServerDocumentsForRoot"
  | "documentsRef"
  | "editorSessionOwnerKeyForRoot"
  | "openFileRequestTokenRef"
  | "persistCurrentWorkspaceSession"
  | "resolveDocumentSaveOwnership"
  | "restorePersistedNavigationSession"
  | "workspaceDocumentCloseCoordinatorRef"
  | "setDocuments"
  | "updateEditorGroups"
  | "updateLocalPhpDiagnostics"
>;

type DirectoryDependencies = Pick<
  FlatWorkspaceTransitionDependencies,
  | "adoptCachedDirectoryProjection"
  | "loadDirectory"
  | "primeCachedDirectoryEntries"
  | "readTestFileIfExists"
  | "refreshCachedExpandedDirectories"
  | "resetDirectoryExplorerLifecycle"
  | "setEntriesByDirectory"
  | "setExpandedDirectories"
  | "setLoadingDirectories"
  | "setManuallyCollapsedDirectories"
  | "setPackageScriptsByRoot"
  | "workspaceFiles"
>;

type LanguageDependencies = Pick<
  FlatWorkspaceTransitionDependencies,
  | "autoStartedJavaScriptTypeScriptLanguageServerRootRef"
  | "autoStartedLanguageServerRootRef"
  | "clearJavaScriptTypeScriptLanguageServerDiagnostics"
  | "clearLanguageServerDiagnostics"
  | "clearPhpLocalDiagnostics"
  | "clearPhpstanDiagnosticsForRoot"
  | "javaScriptTypeScriptDiagnosticsByRootRef"
  | "javaScriptTypeScriptDiagnosticsCoalescerRef"
  | "javaScriptTypeScriptRuntimeStatusByRootRef"
  | "languageRuntimeProjectionCommands"
  | "languageServerDiagnosticsByRootRef"
  | "languageServerDiagnosticsCoalescerRef"
  | "languageServerRuntimeStatusByRootRef"
  | "lastLanguageServerCrashRef"
  | "lastPhpFileOutlineRefreshKeyRef"
  | "lastPhpIdeReadinessSignatureRef"
  | "phpFrameworkNavigationGenerationRef"
  | "phpLanguageServerAutostartAttemptsByRootRef"
  | "refreshJavaScriptTypeScriptLanguageServerPlan"
  | "resetJavaScriptTypeScriptLanguageServerDocuments"
  | "resetLanguageServerDocuments"
  | "resetPhpFrameworkCachesRef"
  | "resetPhpOutlineState"
  | "restoreJavaScriptTypeScriptDiagnosticsForRoot"
  | "restoreLanguageServerDiagnosticsForRoot"
  | "runPhpWorkspaceProbe"
  | "setLanguageServerPlan"
>;

type RuntimeDependencies = Pick<
  FlatWorkspaceTransitionDependencies,
  | "clearIndexWorkspaceState"
  | "hasPhpWorkspaceByOwnerRef"
  | "intelligenceModeRef"
  | "restoreIndexRoot"
  | "runGitRepositoryDiscovery"
  | "setIntelligenceMode"
  | "smartModeGateway"
  | "smartModeRequestGenerationRef"
  | "smartModeRequestIntentRef"
  | "startInitialIndexScan"
  | "stopBackgroundProjectRuntimes"
  | "stopProjectRuntimes"
  | "workspaceRuntimeOwnerByTabRef"
  | "workspaceRuntimeOwnerClaimsRef"
  | "workspaceRuntimeOwnerRef"
  | "workspaceRuntimeRootByTabRef"
>;

type SettingsDependencies = Pick<
  FlatWorkspaceTransitionDependencies,
  | "appSettingsRef"
  | "applyWorkspaceSettings"
  | "persistAppSettings"
  | "settingsGateway"
  | "workspaceSettingsByRoot"
  | "workspaceSettingsLoadByRootRef"
  | "workspaceSettingsSaveCoordinator"
>;

type WorkspaceDependencies = Pick<
  FlatWorkspaceTransitionDependencies,
  | "externallyRemovedDocumentRootByPathRef"
  | "reportError"
  | "reportErrorForActiveWorkspaceRoot"
  | "resetActiveEditorPosition"
  | "workspaceDetection"
  | "workspaceFileChangeGateway"
  | "workspaceIdentityGateway"
  | "workspaceRoot"
  | "setWorkspaceDescriptor"
  | "setWorkspaceIdentityDescriptor"
  | "setWorkspaceRoot"
  | "setWorkspaceTrust"
  | "workspaceTrustGateway"
  | "workspaceTrustRevisionByOwnerRef"
>;

type SurfacePrimaryDependencies = Pick<
  FlatWorkspaceTransitionDependencies,
  | "resetEditorSurfaceState"
  | "resetGitDiffWorkspaceState"
  | "resetGitStatusSurface"
  | "resetHistory"
  | "resetJavaScriptTypeScriptFileStructure"
  | "resetSearchEverywhere"
  | "resetTextSearchState"
  | "setArtisanMakePaletteRoot"
  | "setBookmarks"
  | "setBottomPanelView"
  | "setBottomPanelVisible"
  | "setEditorRevealTarget"
  | "setFileStructureOpen"
  | "setFileStructureScope"
  | "setGitBlameEnabledPaths"
  | "setImplementationChooser"
  | "setMessage"
  | "setNotices"
>;

type SurfaceNavigationDependencies = Pick<
  FlatWorkspaceTransitionDependencies,
  | "setCallHierarchyView"
  | "setClassOpenLoading"
  | "setClassOpenOpen"
  | "setClassOpenQuery"
  | "setClassOpenResults"
  | "setInstallingManagedPhpactor"
  | "setInstallingManagedTypeScriptLanguageServer"
  | "setPaletteOpen"
  | "setQuickOpenOpen"
  | "setRecentFiles"
  | "setRecentFilesSwitcherOpen"
  | "setRecentLocations"
  | "setRecentLocationsPanelOpen"
  | "setReferencesView"
  | "setSettingsOpen"
  | "setSidebarView"
  | "setTypeHierarchyView"
  | "setWorkspaceSymbolsLoading"
  | "setWorkspaceSymbolsOpen"
  | "setWorkspaceSymbolsQuery"
  | "setWorkspaceSymbolsResults"
>;

interface WorkspaceTransitionDependencies {
  readonly authority: AuthorityDependencies;
  readonly cache: CacheDependencies;
  readonly documents: DocumentsDependencies;
  readonly directory: DirectoryDependencies;
  readonly language: LanguageDependencies;
  readonly runtime: RuntimeDependencies;
  readonly settings: SettingsDependencies;
  readonly workspace: WorkspaceDependencies;
  readonly surfacePrimary: SurfacePrimaryDependencies;
  readonly surfaceNavigation: SurfaceNavigationDependencies;
}

export function useWorkbenchWorkspaceTransitionCoordinator(
  dependencies: WorkspaceTransitionDependencies,
) {
  const {
    authority,
    cache,
    documents,
    directory,
    language,
    runtime,
    settings,
    workspace,
    surfacePrimary,
    surfaceNavigation,
  } = dependencies;
  const {
    currentEditorSessionOwnerKeyRef,
    currentWorkspaceRootRef,
    documentSessionAuthorityLifecycle,
    workbenchMountedRef,
    openWorkspaceRequestInFlightTokenRef,
    openWorkspaceRequestPathRef,
    openWorkspaceRequestTokenRef,
    ownedWorkspaceIdentityGenerationByIdRef,
    pendingWorkspaceIdentityRequestTokensRef,
    withManagedWorkspaceIdentityLease,
    workspaceCloseGenerationByRootRef,
    workspaceCloseOwnershipByKeyRef,
    workspaceCloseOwnershipGenerationRef,
    workspaceIdentityByRootRef,
    workspaceIdentityDescriptorRef,
    releaseOwnedWorkspaceIdentity,
    retireWorkspaceIdentityAuthority,
    retireWorkspaceRuntimeOwnerClaim,
    flushDeferredWorkspaceIdentityCleanup,
  } = authority;
  const {
    cacheCurrentWorkspaceState,
    clearWorkspaceStateCache,
    coalesceWorkspaceStateCache,
    forgetCachedWorkspaceState,
    resolveCachedWorkspaceState,
    restoreCachedWorkspaceState,
    workspaceStateCacheRef,
    filePrefetchCacheRef,
    filePrefetchTimersRef,
    resetEditorConfigCache,
    workspaceSessionRestoredRef,
    workspaceEditorViewStatesRef,
  } = cache;
  const {
    canonicalDocumentSaveRoot,
    closeSyncedJavaScriptTypeScriptDocumentsForRoot,
    closeSyncedLanguageServerDocumentsForRoot,
    documentsRef,
    editorSessionOwnerKeyForRoot,
    openFileRequestTokenRef,
    persistCurrentWorkspaceSession,
    resolveDocumentSaveOwnership,
    restorePersistedNavigationSession,
    workspaceDocumentCloseCoordinatorRef,
    setDocuments,
    updateEditorGroups,
    updateLocalPhpDiagnostics,
  } = documents;
  const {
    adoptCachedDirectoryProjection,
    loadDirectory,
    primeCachedDirectoryEntries,
    readTestFileIfExists,
    refreshCachedExpandedDirectories,
    resetDirectoryExplorerLifecycle,
    setEntriesByDirectory,
    setExpandedDirectories,
    setLoadingDirectories,
    setManuallyCollapsedDirectories,
    setPackageScriptsByRoot,
    workspaceFiles,
  } = directory;
  const {
    autoStartedJavaScriptTypeScriptLanguageServerRootRef,
    autoStartedLanguageServerRootRef,
    clearJavaScriptTypeScriptLanguageServerDiagnostics,
    clearLanguageServerDiagnostics,
    clearPhpLocalDiagnostics,
    clearPhpstanDiagnosticsForRoot,
    javaScriptTypeScriptDiagnosticsByRootRef,
    javaScriptTypeScriptDiagnosticsCoalescerRef,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    languageRuntimeProjectionCommands,
    languageServerDiagnosticsByRootRef,
    languageServerDiagnosticsCoalescerRef,
    languageServerRuntimeStatusByRootRef,
    lastLanguageServerCrashRef,
    lastPhpFileOutlineRefreshKeyRef,
    lastPhpIdeReadinessSignatureRef,
    phpFrameworkNavigationGenerationRef,
    phpLanguageServerAutostartAttemptsByRootRef,
    refreshJavaScriptTypeScriptLanguageServerPlan,
    resetJavaScriptTypeScriptLanguageServerDocuments,
    resetLanguageServerDocuments,
    resetPhpFrameworkCachesRef,
    resetPhpOutlineState,
    restoreJavaScriptTypeScriptDiagnosticsForRoot,
    restoreLanguageServerDiagnosticsForRoot,
    runPhpWorkspaceProbe,
    setLanguageServerPlan,
  } = language;
  const {
    clearIndexWorkspaceState,
    hasPhpWorkspaceByOwnerRef,
    intelligenceModeRef,
    restoreIndexRoot,
    runGitRepositoryDiscovery,
    setIntelligenceMode,
    smartModeGateway,
    smartModeRequestGenerationRef,
    smartModeRequestIntentRef,
    startInitialIndexScan,
    stopBackgroundProjectRuntimes,
    stopProjectRuntimes,
    workspaceRuntimeOwnerByTabRef,
    workspaceRuntimeOwnerClaimsRef,
    workspaceRuntimeOwnerRef,
    workspaceRuntimeRootByTabRef,
  } = runtime;
  const {
    appSettingsRef,
    applyWorkspaceSettings,
    persistAppSettings,
    settingsGateway,
    workspaceSettingsByRoot,
    workspaceSettingsLoadByRootRef,
    workspaceSettingsSaveCoordinator,
  } = settings;
  const {
    externallyRemovedDocumentRootByPathRef,
    reportError,
    reportErrorForActiveWorkspaceRoot,
    resetActiveEditorPosition,
    workspaceDetection,
    workspaceFileChangeGateway,
    workspaceIdentityGateway,
    workspaceRoot,
    setWorkspaceDescriptor,
    setWorkspaceIdentityDescriptor,
    setWorkspaceRoot,
    setWorkspaceTrust,
    workspaceTrustGateway,
    workspaceTrustRevisionByOwnerRef,
  } = workspace;
  const {
    resetEditorSurfaceState,
    resetGitDiffWorkspaceState,
    resetGitStatusSurface,
    resetHistory,
    resetJavaScriptTypeScriptFileStructure,
    resetSearchEverywhere,
    resetTextSearchState,
    setArtisanMakePaletteRoot,
    setBookmarks,
    setBottomPanelView,
    setBottomPanelVisible,
    setEditorRevealTarget,
    setFileStructureOpen,
    setFileStructureScope,
    setGitBlameEnabledPaths,
    setImplementationChooser,
    setMessage,
    setNotices,
  } = surfacePrimary;
  const {
    setCallHierarchyView,
    setClassOpenLoading,
    setClassOpenOpen,
    setClassOpenQuery,
    setClassOpenResults,
    setInstallingManagedPhpactor,
    setInstallingManagedTypeScriptLanguageServer,
    setPaletteOpen,
    setQuickOpenOpen,
    setRecentFiles,
    setRecentFilesSwitcherOpen,
    setRecentLocations,
    setRecentLocationsPanelOpen,
    setReferencesView,
    setSettingsOpen,
    setSidebarView,
    setTypeHierarchyView,
    setWorkspaceSymbolsLoading,
    setWorkspaceSymbolsOpen,
    setWorkspaceSymbolsQuery,
    setWorkspaceSymbolsResults,
  } = surfaceNavigation;
  const resetFilePrefetchState = useCallback(() => {
    for (const timer of filePrefetchTimersRef.current.values()) {
      clearTimeout(timer);
    }

    filePrefetchTimersRef.current.clear();
    filePrefetchCacheRef.current.clear();
  }, [filePrefetchCacheRef, filePrefetchTimersRef]);

  const closeBookmarksPanelRef = useRef<() => void>(() => {});
  const resetWorkspaceTodosRef = useRef<() => void>(() => {});

  const clearActiveWorkspace = useCallback(
    async (options?: { ownership?: WorkspaceCloseOwnership; runtimeAlreadyStopped?: boolean }) => {
      const ownership = options?.ownership;
      if (ownership && !ownership.isCurrent()) {
        return;
      }

      const currentRootPath = currentWorkspaceRootRef.current;
      if (currentRootPath) {
        clearPhpstanDiagnosticsForRoot(currentRootPath);
      }

      if (currentRootPath && !options?.runtimeAlreadyStopped) {
        await stopProjectRuntimes(
          workspaceRuntimeRootByTabRef.current[currentRootPath] ?? currentRootPath,
          workspaceRuntimeOwnerByTabRef.current[currentRootPath],
        );
        if (ownership && !ownership.isCurrent()) {
          return;
        }
      }

      if (currentRootPath) {
        languageServerDiagnosticsCoalescerRef.current?.dropRoot(currentRootPath);
        javaScriptTypeScriptDiagnosticsCoalescerRef.current?.dropRoot(currentRootPath);
      }

      documentSessionAuthorityLifecycle.deactivate();
      workspaceSessionRestoredRef.current = false;
      workspaceEditorViewStatesRef.current = {};
      currentEditorSessionOwnerKeyRef.current = null;
      currentWorkspaceRootRef.current = null;
      clearWorkspaceStateCache();
      workspaceIdentityByRootRef.current = {};
      workspaceRuntimeRootByTabRef.current = {};
      workspaceRuntimeOwnerByTabRef.current = {};
      hasPhpWorkspaceByOwnerRef.current = {};
      workspaceRuntimeOwnerClaimsRef.current.clear();
      resetEditorConfigCache();
      resetFilePrefetchState();
      languageServerRuntimeStatusByRootRef.current = {};
      languageServerDiagnosticsByRootRef.current = {};
      javaScriptTypeScriptRuntimeStatusByRootRef.current = {};
      javaScriptTypeScriptDiagnosticsByRootRef.current = {};
      lastLanguageServerCrashRef.current = null;
      lastPhpIdeReadinessSignatureRef.current = null;
      openWorkspaceRequestTokenRef.current += 1;
      openWorkspaceRequestPathRef.current = null;
      openFileRequestTokenRef.current += 1;
      resetActiveEditorPosition();
      setWorkspaceRoot(null);
      setWorkspaceIdentityDescriptor(null);
      setWorkspaceDescriptor(null);
      setPackageScriptsByRoot({});
      setWorkspaceTrust(null);
      languageRuntimeProjectionCommands.reset();
      setEntriesByDirectory({});
      setLoadingDirectories(new Set());
      resetDirectoryExplorerLifecycle();
      setExpandedDirectories(new Set());
      setManuallyCollapsedDirectories(new Set());
      resetEditorSurfaceState();
      setArtisanMakePaletteRoot(null);
      setRecentFiles([]);
      setRecentLocations([]);
      setBookmarks([]);
      closeBookmarksPanelRef.current();
      setGitBlameEnabledPaths(new Set());
      setEditorRevealTarget(null);
      resetHistory();
      setSidebarView("files");
      setBottomPanelView("problems");
      setBottomPanelVisible(false);
      resetWorkspaceTodosRef.current();
      resetGitStatusSurface();
      resetGitDiffWorkspaceState();
      resetPhpOutlineState();
      resetJavaScriptTypeScriptFileStructure();
      setClassOpenOpen(false);
      setClassOpenQuery("");
      setClassOpenLoading(false);
      setClassOpenResults([]);
      setWorkspaceSymbolsOpen(false);
      setWorkspaceSymbolsQuery("");
      setWorkspaceSymbolsLoading(false);
      setWorkspaceSymbolsResults([]);
      resetSearchEverywhere();
      setQuickOpenOpen(false);
      setRecentFilesSwitcherOpen(false);
      setRecentLocationsPanelOpen(false);
      resetTextSearchState();
      setPaletteOpen(false);
      setFileStructureOpen(false);
      setFileStructureScope("current");
      setImplementationChooser(null);
      setCallHierarchyView(null);
      setTypeHierarchyView(null);
      setReferencesView(null);
      setSettingsOpen(false);
      setMessage(null);
      setNotices([]);
      clearLanguageServerDiagnostics();
      clearJavaScriptTypeScriptLanguageServerDiagnostics();
      clearPhpLocalDiagnostics();
      applyWorkspaceSettings(defaultWorkspaceSettings());
      setIntelligenceMode("basic");
      intelligenceModeRef.current = "basic";
      clearIndexWorkspaceState();
    },
    [
      applyWorkspaceSettings,
      closeBookmarksPanelRef,
      clearIndexWorkspaceState,
      clearJavaScriptTypeScriptLanguageServerDiagnostics,
      clearLanguageServerDiagnostics,
      javaScriptTypeScriptDiagnosticsByRootRef,
      javaScriptTypeScriptDiagnosticsCoalescerRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      languageServerDiagnosticsByRootRef,
      languageServerDiagnosticsCoalescerRef,
      languageServerRuntimeStatusByRootRef,
      languageRuntimeProjectionCommands,
      clearPhpLocalDiagnostics,
      clearPhpstanDiagnosticsForRoot,
      clearWorkspaceStateCache,
      currentEditorSessionOwnerKeyRef,
      documentSessionAuthorityLifecycle,
      resetActiveEditorPosition,
      resetFilePrefetchState,
      resetEditorSurfaceState,
      resetHistory,
      resetGitDiffWorkspaceState,
      resetGitStatusSurface,
      resetSearchEverywhere,
      resetJavaScriptTypeScriptFileStructure,
      resetDirectoryExplorerLifecycle,
      resetWorkspaceTodosRef,
      resetEditorConfigCache,
      resetTextSearchState,
      setExpandedDirectories,
      setNotices,
      setPaletteOpen,
      resetPhpOutlineState,
      stopProjectRuntimes,
      setCallHierarchyView,
      setClassOpenLoading,
      setClassOpenOpen,
      setClassOpenQuery,
      setClassOpenResults,
      setEditorRevealTarget,
      setImplementationChooser,
      setQuickOpenOpen,
      setRecentFiles,
      setRecentFilesSwitcherOpen,
      setRecentLocations,
      setRecentLocationsPanelOpen,
      setReferencesView,
      setTypeHierarchyView,
      setWorkspaceSymbolsLoading,
      setWorkspaceSymbolsOpen,
      setWorkspaceSymbolsQuery,
      setWorkspaceSymbolsResults,
      currentWorkspaceRootRef,
      hasPhpWorkspaceByOwnerRef,
      intelligenceModeRef,
      lastLanguageServerCrashRef,
      lastPhpIdeReadinessSignatureRef,
      openFileRequestTokenRef,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      setArtisanMakePaletteRoot,
      setBookmarks,
      setBottomPanelView,
      setBottomPanelVisible,
      setEntriesByDirectory,
      setFileStructureOpen,
      setFileStructureScope,
      setGitBlameEnabledPaths,
      setIntelligenceMode,
      setLoadingDirectories,
      setManuallyCollapsedDirectories,
      setMessage,
      setPackageScriptsByRoot,
      setSettingsOpen,
      setSidebarView,
      setWorkspaceDescriptor,
      setWorkspaceIdentityDescriptor,
      setWorkspaceRoot,
      setWorkspaceTrust,
      workspaceEditorViewStatesRef,
      workspaceIdentityByRootRef,
      workspaceRuntimeOwnerByTabRef,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeRootByTabRef,
      workspaceSessionRestoredRef,
    ],
  );

  const loadPackageScripts = useWorkspacePackageScriptHydration({
    currentWorkspaceRootRef,
    readFileIfExists: readTestFileIfExists,
    setPackageScriptsByRoot,
  });

  const restoreWorkspaceSession = useWorkspaceSessionRestorer({
    currentWorkspaceRootRef,
    editorSessionOwnerKeyForRoot,
    openFileRequestTokenRef,
    setBottomPanelView,
    setDocuments,
    setNotices,
    setSidebarView,
    updateEditorGroups,
    updateLocalPhpDiagnostics,
    viewStatesRef: workspaceEditorViewStatesRef,
    workspaceFiles,
  });

  const runWithIssuedWriteDrainRef = useRef<RunWithDocumentSaveExclusion>(
    async (_scope, operation) => operation(),
  );
  const runWithIssuedWriteDrainDelegate = useCallback<RunWithDocumentSaveExclusion>(
    (scope, operation) => runWithIssuedWriteDrainRef.current(scope, operation),
    [],
  );

  const performOpenWorkspacePath = useCallback(
    async (
      path: string,
      identityDescriptor: WorkspaceIdentityDescriptor | null,
      adoptIdentity: (() => number | null) | null,
      requestToken: number,
      commitOpenWorkspaceRequest: (path: string, admissionGeneration: number | null) => void,
      options: OpenWorkspacePathOptions = {},
    ) => {
      const shouldCachePreviousWorkspace = options.cachePreviousWorkspace !== false;
      if (openWorkspaceRequestTokenRef.current !== requestToken) {
        return;
      }

      openWorkspaceRequestPathRef.current = path;
      setArtisanMakePaletteRoot(null);
      const isCurrentOpenWorkspaceRequest = () =>
        workbenchMountedRef.current &&
        openWorkspaceRequestTokenRef.current === requestToken &&
        workspaceRootKeysEqual(openWorkspaceRequestPathRef.current, path) &&
        (!options.isOpenIntentCurrent || options.isOpenIntentCurrent());
      const previousRootPath = currentWorkspaceRootRef.current;
      const canonicalKey = identityDescriptor?.canonicalRoot ?? path;
      const workspaceSettingsLoadKey = normalizedWorkspaceRootKey(canonicalKey);
      const requestedSettingsIdentity = identityDescriptor
        ? workspaceSettingsIdentity(canonicalKey, path)
        : path;
      const requestedLegacyRawKeys =
        typeof requestedSettingsIdentity === "string"
          ? [requestedSettingsIdentity]
          : (requestedSettingsIdentity.legacyRawKeys ?? []);
      const previousWorkspaceIdentity = previousRootPath
        ? (workspaceIdentityByRootRef.current[previousRootPath] ?? null)
        : null;
      const previousWorkspaceSettingsSaveCoordinator = workspaceSettingsSaveCoordinator;
      const { nextOwnerKey, replacingOwnerAtSameRoot, switchingWorkspace } =
        resolveDocumentSessionWorkspaceTransition(
          previousRootPath,
          previousWorkspaceIdentity,
          path,
          identityDescriptor,
        );

      let cachedWorkspaceState =
        identityDescriptor && switchingWorkspace
          ? null
          : identityDescriptor
            ? coalesceWorkspaceStateCache(identityDescriptor, path)
            : resolveCachedWorkspaceState(canonicalKey);

      const adoptLegacyWorkspaceCache = () => {
        if (!identityDescriptor || cachedWorkspaceState) {
          return;
        }

        const legacyCachedWorkspaceState = adoptLegacyCachedWorkspaceState(identityDescriptor, [
          resolveCachedWorkspaceState(identityDescriptor.canonicalRoot),
          resolveCachedWorkspaceState(path),
        ]);
        if (!legacyCachedWorkspaceState) {
          return;
        }

        cachedWorkspaceState = coalesceWorkspaceStateCache(identityDescriptor, path);
      };

      if (switchingWorkspace && previousRootPath) {
        resetFilePrefetchState();
      }

      if (switchingWorkspace && previousRootPath) {
        const captureAndDeactivatePreviousWorkspace = async () => {
          if (!isCurrentOpenWorkspaceRequest()) {
            return "stale" as const;
          }

          const captureResult = await captureWorkspaceBeforeSwitch(
            {
              rootPath: previousRootPath,
              cacheWorkspace: shouldCachePreviousWorkspace,
              isRequestCurrent: isCurrentOpenWorkspaceRequest,
            },
            {
              invalidatePendingFileOpen: () => {
                openFileRequestTokenRef.current += 1;
              },
              persistWorkspaceSession: persistCurrentWorkspaceSession,
              cacheWorkspaceState: cacheCurrentWorkspaceState,
              reportPersistenceError: (rootPath, error) => {
                reportErrorForActiveWorkspaceRoot(rootPath, "Session", error);
              },
            },
          );

          if (captureResult === "stale" || !isCurrentOpenWorkspaceRequest()) {
            return "stale" as const;
          }

          return closeWorkspaceDocumentsBeforeSwitch(
            {
              rootPath: previousRootPath,
              isRequestCurrent: isCurrentOpenWorkspaceRequest,
            },
            {
              closeLanguageServerDocuments: closeSyncedLanguageServerDocumentsForRoot,
              closeJavaScriptTypeScriptDocuments: closeSyncedJavaScriptTypeScriptDocumentsForRoot,
            },
            workspaceDocumentCloseCoordinatorRef.current,
          );
        };

        const switchResult = shouldCachePreviousWorkspace
          ? await runWithIssuedWriteDrainDelegate(
              {
                kind: "workspace",
                canonicalRoot: canonicalDocumentSaveRoot(previousRootPath),
              },
              captureAndDeactivatePreviousWorkspace,
            )
          : await captureAndDeactivatePreviousWorkspace();

        if (switchResult === "stale" || !isCurrentOpenWorkspaceRequest()) {
          return;
        }

        if (identityDescriptor) {
          const isNewIdentityForActiveLegacyWorkspace =
            !previousWorkspaceIdentity && workspaceRootKeysEqual(previousRootPath, path);
          if (isNewIdentityForActiveLegacyWorkspace) {
            const capturedLegacyState = adoptLegacyCachedWorkspaceState(identityDescriptor, [
              resolveCachedWorkspaceState(previousRootPath),
              resolveCachedWorkspaceState(identityDescriptor.canonicalRoot),
            ]);
            if (capturedLegacyState) {
              forgetCachedWorkspaceState(path, identityDescriptor);
              workspaceStateCacheRef.current[
                workspaceIdentityStateCacheKey(
                  identityDescriptor.workspaceId,
                  identityDescriptor.canonicalRoot,
                )
              ] = capturedLegacyState;
            }
          }

          cachedWorkspaceState = coalesceWorkspaceStateCache(identityDescriptor, path);
        }
      }

      adoptLegacyWorkspaceCache();
      const pendingWorkspaceSettingsSave =
        previousWorkspaceSettingsSaveCoordinator.waitForIdle(canonicalKey);
      if (pendingWorkspaceSettingsSave) {
        await pendingWorkspaceSettingsSave;
      }
      if (!isCurrentOpenWorkspaceRequest()) {
        return;
      }

      const workspaceSettingsRevisionAtLoad = workspaceSettingsByRoot.revision(canonicalKey);
      let workspaceSettingsLoad =
        workspaceSettingsLoadByRootRef.current.get(workspaceSettingsLoadKey);
      try {
        const trackWorkspaceSettingsLoad = (
          start: () => Promise<WorkspaceSettings>,
          legacyRawKeys: readonly string[],
        ) =>
          workspaceSettingsLoadByRootRef.current.track(
            workspaceSettingsLoadKey,
            legacyRawKeys,
            start,
          );
        workspaceSettingsLoad ??= trackWorkspaceSettingsLoad(
          () => settingsGateway.loadWorkspaceSettings(requestedSettingsIdentity),
          requestedLegacyRawKeys,
        );
        if (
          !requestedLegacyRawKeys.every((legacyRawKey) =>
            workspaceSettingsLoad?.legacyRawKeys.includes(legacyRawKey),
          )
        ) {
          const previousLoad = workspaceSettingsLoad;
          const continueWithWinningAlias = () =>
            isCurrentOpenWorkspaceRequest()
              ? settingsGateway.loadWorkspaceSettings(requestedSettingsIdentity)
              : defaultWorkspaceSettings();
          workspaceSettingsLoad = trackWorkspaceSettingsLoad(
            () => previousLoad.promise.then(continueWithWinningAlias, continueWithWinningAlias),
            [...new Set([...previousLoad.legacyRawKeys, ...requestedLegacyRawKeys])],
          );
        }
      } catch (error) {
        reportError("Settings", error);
        if (error instanceof PendingWorkspaceSettingsLoadCapacityError) {
          return;
        }
      }
      const identityAliasPaths = identityDescriptor
        ? workspaceIdentityAliasPaths(
            workspaceIdentityByRootRef.current,
            identityDescriptor,
            cachedWorkspaceState?.workspaceIdentityDescriptor ?? null,
          )
        : [];

      workspaceSessionRestoredRef.current = false;
      resetLanguageServerDocuments();
      resetJavaScriptTypeScriptLanguageServerDocuments();
      resetActiveEditorPosition();
      clearLanguageServerDiagnostics();
      clearJavaScriptTypeScriptLanguageServerDiagnostics();
      clearPhpLocalDiagnostics();
      let workspaceSettings = defaultWorkspaceSettings();

      try {
        if (workspaceSettingsLoad) {
          workspaceSettings = await workspaceSettingsLoad.promise;
        }
      } catch (error) {
        if (!isCurrentOpenWorkspaceRequest()) {
          return;
        }

        reportError("Settings", error);
        if (error instanceof PendingWorkspaceSettingsLoadCapacityError) {
          return;
        }
      }

      if (!isCurrentOpenWorkspaceRequest()) {
        return;
      }

      const capturedWorkspaceSettings = workspaceSettingsByRoot.captureIfRevision(
        canonicalKey,
        workspaceSettingsRevisionAtLoad,
        workspaceSettings,
      );
      if (capturedWorkspaceSettings) {
        workspaceSettingsSaveCoordinator.captureCommitted(canonicalKey, workspaceSettings);
      }
      if (!capturedWorkspaceSettings) {
        workspaceSettings = workspaceSettingsByRoot.resolve(canonicalKey) ?? workspaceSettings;
      }

      const runtimePolicy = appSettingsRef.current.runtimePolicy;
      if (runtimePolicy !== "keepAlive") {
        const disposedRuntimeOwnerClaims = backgroundRuntimeOwnersForPolicy(
          runtimePolicy,
          path,
          previousRootPath,
          appSettingsRef.current.workspaceTabs,
          workspaceRuntimeOwnerByTabRef.current,
        ).map((owner) => ({
          generation: workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey),
          owner,
        }));
        try {
          await stopBackgroundProjectRuntimes(runtimePolicy, path, previousRootPath);
          if (!isCurrentOpenWorkspaceRequest()) {
            return;
          }
          for (const disposedRuntimeOwnerClaim of disposedRuntimeOwnerClaims) {
            const disposedRuntimeOwner = disposedRuntimeOwnerClaim.owner;
            if (disposedRuntimeOwnerClaim.generation === undefined) {
              continue;
            }
            if (identityDescriptor?.workspaceId === disposedRuntimeOwner.ownerKey) {
              continue;
            }
            retireWorkspaceRuntimeOwnerClaim(
              disposedRuntimeOwner.ownerKey,
              disposedRuntimeOwnerClaim.generation,
            );
          }
        } catch (error) {
          if (!isCurrentOpenWorkspaceRequest()) {
            return;
          }

          reportError("Settings", error);
        }
      }

      const adoptedAdmissionGeneration = adoptIdentity?.() ?? null;
      if (adoptIdentity && adoptedAdmissionGeneration === null) return;
      documentSessionAuthorityLifecycle.deactivate();
      if (identityDescriptor) {
        const previousIdentity =
          workspaceIdentityByRootRef.current[path] ??
          cachedWorkspaceState?.workspaceIdentityDescriptor ??
          null;
        if (cachedWorkspaceState) {
          cachedWorkspaceState.workspaceIdentityDescriptor = identityDescriptor;
        }
        if (previousIdentity && previousIdentity.workspaceId !== identityDescriptor.workspaceId) {
          retireWorkspaceRuntimeOwnerClaim(
            previousIdentity.workspaceId,
            workspaceRuntimeOwnerClaimsRef.current.generationFor(previousIdentity.workspaceId),
          );
          delete workspaceRuntimeRootByTabRef.current[previousIdentity.selectedPath];
          delete workspaceRuntimeRootByTabRef.current[previousIdentity.canonicalRoot];
          delete workspaceRuntimeOwnerByTabRef.current[previousIdentity.selectedPath];
          delete workspaceRuntimeOwnerByTabRef.current[previousIdentity.canonicalRoot];
          removeWorkspaceIdentityMappings(workspaceIdentityByRootRef.current, previousIdentity);
          void releaseOwnedWorkspaceIdentity(previousIdentity.workspaceId).catch((error) =>
            reportError("Workspace", error),
          );
        }
        removeWorkspaceIdentityMappings(workspaceIdentityByRootRef.current, identityDescriptor);
        for (const aliasPath of identityAliasPaths) {
          delete workspaceRuntimeRootByTabRef.current[aliasPath];
          delete workspaceRuntimeOwnerByTabRef.current[aliasPath];
        }
      }

      primeCachedDirectoryEntries(cachedWorkspaceState, replacingOwnerAtSameRoot);
      phpFrameworkNavigationGenerationRef.current += 1;
      setWorkspaceRoot(path);
      setPackageScriptsByRoot((current) => ({
        ...current,
        [path]: {
          composerScripts: [],
          hasArtisan: false,
        },
      }));
      setWorkspaceIdentityDescriptor(identityDescriptor);
      workspaceIdentityDescriptorRef.current = identityDescriptor;
      const admittedRuntimeOwner = workspaceRuntimeOwnerFor(path, identityDescriptor);
      const explicitRuntimeOwner = identityDescriptor ? admittedRuntimeOwner : undefined;
      const admittedRuntimeGeneration = identityDescriptor
        ? (adoptedAdmissionGeneration ??
          (adoptIdentity
            ? null
            : (ownedWorkspaceIdentityGenerationByIdRef.current[identityDescriptor.workspaceId] ??
              null)))
        : null;
      workspaceRuntimeOwnerRef.current = admittedRuntimeOwner;
      const isCurrentOpenWorkspaceOwnerRequest = () => {
        if (!isCurrentOpenWorkspaceRequest() || admittedRuntimeGeneration === null) return false;

        return (
          workspaceRuntimeOwnerByTabRef.current[path] === admittedRuntimeOwner &&
          workspaceRuntimeOwnerClaimsRef.current.generationFor(admittedRuntimeOwner.ownerKey) ===
            admittedRuntimeGeneration &&
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, path)
        );
      };
      if (identityDescriptor) {
        workspaceRuntimeOwnerClaimsRef.current.register(
          admittedRuntimeOwner,
          identityAliasPaths,
          admittedRuntimeGeneration,
        );
        workspaceIdentityByRootRef.current[path] = identityDescriptor;
        workspaceIdentityByRootRef.current[identityDescriptor.canonicalRoot] = identityDescriptor;
        workspaceRuntimeRootByTabRef.current[path] = path;
        workspaceRuntimeRootByTabRef.current[identityDescriptor.canonicalRoot] = path;
        workspaceRuntimeOwnerByTabRef.current[path] = admittedRuntimeOwner;
        workspaceRuntimeOwnerByTabRef.current[identityDescriptor.canonicalRoot] =
          admittedRuntimeOwner;
      }
      if (!identityDescriptor) {
        workspaceRuntimeOwnerByTabRef.current[path] = admittedRuntimeOwner;
      }
      currentWorkspaceRootRef.current = path;
      currentEditorSessionOwnerKeyRef.current = nextOwnerKey;
      commitOpenWorkspaceRequest(path, admittedRuntimeGeneration);
      const openSmartModeIntent = beginWorkbenchSmartModeIntent({
        currentWorkspaceRootRef,
        identity: identityDescriptor,
        intentGenerationRef: smartModeRequestGenerationRef,
        intentStateRef: smartModeRequestIntentRef,
        mode: workspaceSettings.intelligenceMode,
        owner: admittedRuntimeOwner,
        rootPath: path,
        workspaceRuntimeOwnerClaimsRef,
        workspaceRuntimeOwnerRef,
      });
      const isCurrentOpenWorkspaceSmartModeRequest = () =>
        isCurrentOpenWorkspaceOwnerRequest() && !!openSmartModeIntent?.isCurrent();
      const activateCurrentDocumentSessionAuthority = () =>
        documentSessionAuthorityLifecycle.activate({
          descriptor: identityDescriptor,
          documents: documentsRef.current,
          isCurrent: () =>
            workbenchMountedRef.current &&
            workspaceRootKeysEqual(currentWorkspaceRootRef.current, path) &&
            currentEditorSessionOwnerKeyRef.current === nextOwnerKey &&
            !!identityDescriptor &&
            workspaceIdentityByRootRef.current[path] === identityDescriptor,
          ownerKey: identityDescriptor ? nextOwnerKey : null,
          resolveOwnership: resolveDocumentSaveOwnership,
          rootPath: path,
        });
      lastLanguageServerCrashRef.current = null;
      restoreLanguageServerDiagnosticsForRoot(path, explicitRuntimeOwner);
      restoreJavaScriptTypeScriptDiagnosticsForRoot(path, explicitRuntimeOwner);

      if (cachedWorkspaceState) {
        const cachedWorkspaceSnapshot = cachedWorkspaceState;
        adoptCachedDirectoryProjection(path, cachedWorkspaceSnapshot);
        restoreCachedWorkspaceState(path, cachedWorkspaceSnapshot);
        activateCurrentDocumentSessionAuthority();
      } else {
        resetDirectoryExplorerLifecycle();
        setEntriesByDirectory({});
        setExpandedDirectories(new Set([path]));
        setManuallyCollapsedDirectories(new Set());
        resetEditorSurfaceState();
        setRecentFiles([]);
        setRecentLocations([]);
        setBookmarks([]);
        setGitBlameEnabledPaths(new Set());
        resetHistory();
        setSidebarView("files");
        setBottomPanelView("problems");
        setBottomPanelVisible(false);
        clearIndexWorkspaceState();
      }

      // The TODO panel is a transient, workspace-scoped overlay (not part of the
      // cached per-tab state). Always reset it on a switch so one project's TODOs
      // can never appear inside another project's tab.
      resetWorkspaceTodosRef.current();
      // The recent files switcher is a transient overlay too; close it on a
      // switch so it never shows another tab's MRU list mid-transition.
      setRecentFilesSwitcherOpen(false);
      // The recent locations panel is a transient overlay too; close it on a
      // switch so it never shows another tab's positions mid-transition. The
      // location list itself is cached/restored per tab above.
      setRecentLocationsPanelOpen(false);
      // The bookmarks panel is a transient overlay; close it on a switch so it
      // never shows another tab's bookmarks mid-transition. The bookmark list
      // itself is cached/restored per tab above.
      closeBookmarksPanelRef.current();

      setEditorRevealTarget(null);
      setLoadingDirectories(new Set());
      applyWorkspaceSettings(workspaceSettings);
      setIntelligenceMode(workspaceSettings.intelligenceMode);
      setWorkspaceDescriptor(null);
      setWorkspaceTrust(null);
      const cachedPhpStatus = cachedLanguageServerRuntimeStatusForOwner(
        languageServerRuntimeStatusByRootRef.current,
        admittedRuntimeOwner,
      );
      languageRuntimeProjectionCommands.prepareWorkspace(cachedPhpStatus, path);
      resetPhpOutlineState();
      resetGitStatusSurface(path);
      resetGitDiffWorkspaceState();
      resetJavaScriptTypeScriptFileStructure();
      setClassOpenOpen(false);
      setClassOpenQuery("");
      setClassOpenLoading(false);
      setClassOpenResults([]);
      setWorkspaceSymbolsOpen(false);
      setWorkspaceSymbolsQuery("");
      setWorkspaceSymbolsLoading(false);
      setWorkspaceSymbolsResults([]);
      resetSearchEverywhere();
      setQuickOpenOpen(false);
      resetTextSearchState();
      setFileStructureScope("current");
      setImplementationChooser(null);
      setCallHierarchyView(null);
      setTypeHierarchyView(null);
      setReferencesView(null);
      setMessage(null);
      setNotices([]);
      lastPhpFileOutlineRefreshKeyRef.current = null;
      lastPhpIdeReadinessSignatureRef.current = null;
      resetPhpFrameworkCachesRef.current();
      restoreIndexRoot(cachedWorkspaceState?.indexProgress.rootPath ?? null);
      autoStartedLanguageServerRootRef.current = null;
      phpLanguageServerAutostartAttemptsByRootRef.current = {};
      setInstallingManagedPhpactor(false);
      flushSync(() => {
        setInstallingManagedTypeScriptLanguageServer(false);
        autoStartedJavaScriptTypeScriptLanguageServerRootRef.current = null;
      });

      try {
        const nextWorkspaceTabs = workspaceTabsWithPath(
          appSettingsRef.current.workspaceTabs,
          path,
          identityAliasPaths,
        );
        const recentWorkspaceCandidates = (
          appSettingsRef.current.recentWorkspacePaths ?? []
        ).filter(
          (recentPath) =>
            !identityAliasPaths.some((aliasPath) => workspaceRootKeysEqual(aliasPath, recentPath)),
        );
        const recentWorkspacePaths = pushRecentWorkspacePath(recentWorkspaceCandidates, path);
        await persistAppSettings({
          ...appSettingsRef.current,
          recentWorkspacePath: recentWorkspacePaths[0] ?? null,
          recentWorkspacePaths,
          workspaceTabs: nextWorkspaceTabs,
        });
      } catch (error) {
        if (!isCurrentOpenWorkspaceRequest()) {
          return;
        }

        reportError("Settings", error);
      }

      if (!isCurrentOpenWorkspaceRequest()) {
        return;
      }

      let resolvedIntelligenceMode = workspaceSettings.intelligenceMode;

      try {
        if (openSmartModeIntent) {
          const smartMode = await openSmartModeIntent.setMode(smartModeGateway);

          if (isCurrentOpenWorkspaceSmartModeRequest() && openSmartModeIntent.claimEffects()) {
            resolvedIntelligenceMode = smartMode.mode;
            intelligenceModeRef.current = smartMode.mode;
            setIntelligenceMode(smartMode.mode);
          }
          if (isCurrentOpenWorkspaceOwnerRequest() && !isCurrentOpenWorkspaceSmartModeRequest()) {
            resolvedIntelligenceMode = intelligenceModeRef.current;
          }
        }
      } catch (error) {
        if (!isCurrentOpenWorkspaceOwnerRequest()) {
          return;
        }

        if (isCurrentOpenWorkspaceSmartModeRequest()) {
          reportError("IDE Mode", error);
        }
      }

      if (!isCurrentOpenWorkspaceRequest()) {
        return;
      }

      // Directory load, workspace trust, workspace detection and session
      // restore are all independent of one another, so they run concurrently.
      // Each sub-task keeps its own try/catch plus a post-await isolation guard
      // against the admitted owner and open request so that replacing a
      // workspace mid-flight, including at the same selected path, never lets
      // stale results mutate the active workspace state.
      const loadDirectoryTask = async () => {
        const entries = await loadCompleteWorkspaceDirectoryEntries(() =>
          loadDirectory(path, {
            isMutationOwnerCurrent: isCurrentOpenWorkspaceOwnerRequest,
            requireActiveRoot: true,
          }),
        );
        if (!entries) return;

        if (!isCurrentOpenWorkspaceOwnerRequest()) {
          return;
        }

        if (cachedWorkspaceState) {
          refreshCachedExpandedDirectories({
            isMutationOwnerCurrent: isCurrentOpenWorkspaceOwnerRequest,
            projection: cachedWorkspaceState,
            rootPath: path,
          });
        }

        await loadPackageScripts(path, entries ?? [], isCurrentOpenWorkspaceOwnerRequest);
      };

      const loadTrustTask = async () => {
        await loadWorkspaceTrustForOwner({
          gateway: workspaceTrustGateway,
          isCurrent: isCurrentOpenWorkspaceOwnerRequest,
          ownerId: admittedRuntimeOwner.ownerKey,
          publish: setWorkspaceTrust,
          reportError: (error) => reportErrorForActiveWorkspaceRoot(path, "Workspace Trust", error),
          revisionByOwnerRef: workspaceTrustRevisionByOwnerRef,
          rootPath: path,
        });
      };

      // Warmup: the phpactor handshake (composer/autoload scan) is the
      // dominant time-to-ready cost and is phpactor-internal, so the only safe
      // win is to start it sooner. The PHP probe (detectPhpTools -> plan ->
      // autostart) only needs the workspace descriptor to know the project is
      // PHP, so as soon as detection confirms a PHP project in IDE (full smart)
      // mode we fire the probe in parallel with the directory load and session
      // restore instead of serializing it behind them. The handshake then warms
      // up in the background while the user navigates. This is gated to IDE mode
      // (preserving the basic/light-mode defer) and is owner-isolated: the probe
      // captures the admitted runtime owner and re-checks it after its own
      // awaits, and detection drops stale requests before triggering it.
      let warmedUpPhpProbe = false;
      const detectWorkspaceTask = async (): Promise<WorkspaceDescriptor | null> => {
        try {
          const detected = await workspaceDetection.detectWorkspace(path);

          if (!isCurrentOpenWorkspaceOwnerRequest()) {
            // Stale: the active workspace changed while detection was in
            // flight. Return null (never the stale descriptor) so the PHP
            // setup branch only ever sees the descriptor of the still-active
            // open request.
            return null;
          }

          setWorkspaceDescriptor(detected);
          hasPhpWorkspaceByOwnerRef.current[admittedRuntimeOwner.ownerKey] = !!detected?.php;

          if (detected?.php && shouldStartLanguageServer(resolvedIntelligenceMode)) {
            warmedUpPhpProbe = true;
            void runPhpWorkspaceProbe(path, admittedRuntimeOwner);
          }

          return detected;
        } catch (error) {
          if (!isCurrentOpenWorkspaceOwnerRequest()) {
            return null;
          }

          reportErrorForActiveWorkspaceRoot(path, "Workspace Detection", error);
          return null;
        }
      };

      const restoreSessionTask = async () => {
        if (cachedWorkspaceState) {
          if (!isCurrentOpenWorkspaceOwnerRequest()) {
            return;
          }

          workspaceSessionRestoredRef.current = true;
          return;
        }

        if (
          !(await restorePersistedNavigationSession(
            path,
            () => currentWorkspaceRootRef.current,
            workspaceSettings.session,
            replacingOwnerAtSameRoot,
            restoreWorkspaceSession,
            isCurrentOpenWorkspaceOwnerRequest,
          ))
        ) {
          return;
        }

        activateCurrentDocumentSessionAuthority();
        workspaceSessionRestoredRef.current = true;
      };

      // Discover nested git repositories from the freshly loaded workspace
      // settings, sharing the isolated, re-entrancy-guarded discovery used by
      // the settings-save flow so both resolve mappings identically.
      const discoverGitRepositoriesTask = () => runGitRepositoryDiscovery(path, workspaceSettings);

      // Fire-and-forget plans/scans that already isolate themselves per root.
      void refreshJavaScriptTypeScriptLanguageServerPlan(path, undefined, explicitRuntimeOwner);

      if (
        shouldIndexWorkspace(resolvedIntelligenceMode) &&
        shouldRunInitialIndexScan(cachedWorkspaceState)
      ) {
        void startInitialIndexScan(path, isCurrentOpenWorkspaceOwnerRequest);
      }

      const [, , descriptor] = await Promise.all([
        loadDirectoryTask(),
        loadTrustTask(),
        detectWorkspaceTask(),
        restoreSessionTask(),
        discoverGitRepositoriesTask(),
      ]);

      if (!isCurrentOpenWorkspaceOwnerRequest()) {
        return;
      }

      if (!descriptor?.php) {
        setLanguageServerPlan(null);
        setNotices((current) => replaceWorkbenchNoticeGroup(current, `phpactor-setup:${path}`, []));
        return;
      }

      // The PHP language server only runs in IDE (full smart) mode, so in
      // basic/light mode the open-time PHP probe (detectPhpTools +
      // planPhpLanguageServer) is pure overhead. Defer it: keep the plan and
      // setup notice cleared and replay the probe when the user enables IDE
      // mode (setSmartMode) or, eventually, lazily on demand.
      if (!shouldStartLanguageServer(resolvedIntelligenceMode)) {
        setLanguageServerPlan(null);
        setNotices((current) => replaceWorkbenchNoticeGroup(current, `phpactor-setup:${path}`, []));
        return;
      }

      // The probe is fired eagerly during detection (warmup) for IDE-mode PHP
      // projects, so once it has warmed up there is nothing left to do here.
      if (warmedUpPhpProbe) {
        return;
      }

      if (!isCurrentOpenWorkspaceOwnerRequest()) {
        return;
      }

      await runPhpWorkspaceProbe(path, admittedRuntimeOwner);
    },
    [
      applyWorkspaceSettings,
      adoptCachedDirectoryProjection,
      cacheCurrentWorkspaceState,
      canonicalDocumentSaveRoot,
      closeBookmarksPanelRef,
      forgetCachedWorkspaceState,
      loadDirectory,
      loadPackageScripts,
      languageServerRuntimeStatusByRootRef,
      languageRuntimeProjectionCommands,
      ownedWorkspaceIdentityGenerationByIdRef,
      persistAppSettings,
      persistCurrentWorkspaceSession,
      primeCachedDirectoryEntries,
      refreshCachedExpandedDirectories,
      runPhpWorkspaceProbe,
      reportError,
      reportErrorForActiveWorkspaceRoot,
      releaseOwnedWorkspaceIdentity,
      retireWorkspaceRuntimeOwnerClaim,
      restoreLanguageServerDiagnosticsForRoot,
      coalesceWorkspaceStateCache,
      resolveCachedWorkspaceState,
      restoreCachedWorkspaceState,
      restorePersistedNavigationSession,
      restoreJavaScriptTypeScriptDiagnosticsForRoot,
      restoreWorkspaceSession,
      runGitRepositoryDiscovery,
      clearIndexWorkspaceState,
      resetActiveEditorPosition,
      resetDirectoryExplorerLifecycle,
      resetEditorSurfaceState,
      resetFilePrefetchState,
      resetGitDiffWorkspaceState,
      resetGitStatusSurface,
      resetHistory,
      resetJavaScriptTypeScriptFileStructure,
      resetSearchEverywhere,
      resetTextSearchState,
      resetWorkspaceTodosRef,
      resetJavaScriptTypeScriptLanguageServerDocuments,
      resetLanguageServerDocuments,
      runWithIssuedWriteDrainDelegate,
      restoreIndexRoot,
      clearJavaScriptTypeScriptLanguageServerDiagnostics,
      clearLanguageServerDiagnostics,
      clearPhpLocalDiagnostics,
      closeSyncedJavaScriptTypeScriptDocumentsForRoot,
      closeSyncedLanguageServerDocumentsForRoot,
      currentEditorSessionOwnerKeyRef,
      documentSessionAuthorityLifecycle,
      documentsRef,
      resolveDocumentSaveOwnership,
      settingsGateway,
      smartModeGateway,
      smartModeRequestGenerationRef,
      smartModeRequestIntentRef,
      startInitialIndexScan,
      stopBackgroundProjectRuntimes,
      workspaceDetection,
      workspaceSettingsByRoot,
      workspaceSettingsSaveCoordinator,
      workspaceTrustGateway,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerRef,
      refreshJavaScriptTypeScriptLanguageServerPlan,
      setCallHierarchyView,
      setClassOpenLoading,
      setClassOpenOpen,
      setClassOpenQuery,
      setClassOpenResults,
      setEditorRevealTarget,
      setExpandedDirectories,
      setImplementationChooser,
      setInstallingManagedTypeScriptLanguageServer,
      setLanguageServerPlan,
      setNotices,
      setInstallingManagedPhpactor,
      setQuickOpenOpen,
      resetPhpOutlineState,
      setRecentFiles,
      setRecentFilesSwitcherOpen,
      setRecentLocations,
      setRecentLocationsPanelOpen,
      setReferencesView,
      setTypeHierarchyView,
      setWorkspaceSymbolsLoading,
      setWorkspaceSymbolsOpen,
      setWorkspaceSymbolsQuery,
      setWorkspaceSymbolsResults,
      workspaceStateCacheRef,
      appSettingsRef,
      autoStartedJavaScriptTypeScriptLanguageServerRootRef,
      autoStartedLanguageServerRootRef,
      currentWorkspaceRootRef,
      hasPhpWorkspaceByOwnerRef,
      intelligenceModeRef,
      lastLanguageServerCrashRef,
      lastPhpFileOutlineRefreshKeyRef,
      lastPhpIdeReadinessSignatureRef,
      openFileRequestTokenRef,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      phpFrameworkNavigationGenerationRef,
      phpLanguageServerAutostartAttemptsByRootRef,
      resetPhpFrameworkCachesRef,
      setArtisanMakePaletteRoot,
      setBookmarks,
      setBottomPanelView,
      setBottomPanelVisible,
      setEntriesByDirectory,
      setFileStructureScope,
      setGitBlameEnabledPaths,
      setIntelligenceMode,
      setLoadingDirectories,
      setManuallyCollapsedDirectories,
      setMessage,
      setPackageScriptsByRoot,
      setSidebarView,
      setWorkspaceDescriptor,
      setWorkspaceIdentityDescriptor,
      setWorkspaceRoot,
      setWorkspaceTrust,
      workbenchMountedRef,
      workspaceDocumentCloseCoordinatorRef,
      workspaceIdentityByRootRef,
      workspaceIdentityDescriptorRef,
      workspaceRuntimeOwnerByTabRef,
      workspaceRuntimeRootByTabRef,
      workspaceSessionRestoredRef,
      workspaceSettingsLoadByRootRef,
      workspaceTrustRevisionByOwnerRef,
    ],
  );

  const {
    activateWorkspaceTab,
    beginStartupRestore,
    beginWorkspaceClose,
    openWorkspace,
    openWorkspacePath,
    openWorkspaceRoot,
  } = useWorkspaceOpenRequestLifecycle({
    completeDeferredIdentityCleanup: flushDeferredWorkspaceIdentityCleanup,
    currentWorkspaceRootRef,
    openWorkspaceRequestInFlightTokenRef,
    openWorkspaceRequestPathRef,
    openWorkspaceRequestTokenRef,
    ownedWorkspaceIdentityGenerationByIdRef,
    pendingWorkspaceIdentityRequestTokensRef,
    performOpenWorkspacePath,
    reportError,
    resolveCachedWorkspaceState,
    withManagedWorkspaceIdentityLease,
    workbenchMountedRef,
    workspaceCloseGenerationByRootRef,
    workspaceCloseOwnershipByKeyRef,
    workspaceCloseOwnershipGenerationRef,
    workspaceIdentityByRootRef,
    workspaceIdentityGateway,
    workspaceRoot,
  });

  useEffect(() => {
    workbenchMountedRef.current = true;
    const workspaceRuntimeOwnerClaims = workspaceRuntimeOwnerClaimsRef.current;
    const externallyRemovedDocumentRootByPath = externallyRemovedDocumentRootByPathRef.current;

    return () => {
      documentSessionAuthorityLifecycle.deactivate();
      workbenchMountedRef.current = false;
      openWorkspaceRequestTokenRef.current += 1;
      openWorkspaceRequestPathRef.current = null;
      openWorkspaceRequestInFlightTokenRef.current = null;
      openFileRequestTokenRef.current += 1;
      const workspaceIds = retireWorkspaceIdentityAuthority();
      workspaceIdentityByRootRef.current = {};
      workspaceRuntimeRootByTabRef.current = {};
      workspaceRuntimeOwnerByTabRef.current = {};
      workspaceRuntimeOwnerClaims.clear();
      disposeWorkspaceFileChanges(workspaceFileChangeGateway, externallyRemovedDocumentRootByPath);
      for (const workspaceId of workspaceIds) {
        void releaseOwnedWorkspaceIdentity(workspaceId).catch(() => undefined);
      }
    };
  }, [
    documentSessionAuthorityLifecycle,
    externallyRemovedDocumentRootByPathRef,
    releaseOwnedWorkspaceIdentity,
    retireWorkspaceIdentityAuthority,
    workspaceFileChangeGateway,
    openFileRequestTokenRef,
    openWorkspaceRequestInFlightTokenRef,
    openWorkspaceRequestPathRef,
    openWorkspaceRequestTokenRef,
    workbenchMountedRef,
    workspaceIdentityByRootRef,
    workspaceRuntimeOwnerByTabRef,
    workspaceRuntimeOwnerClaimsRef,
    workspaceRuntimeRootByTabRef,
  ]);

  return {
    activateWorkspaceTab,
    beginStartupRestore,
    beginWorkspaceClose,
    clearActiveWorkspace,
    closeBookmarksPanelRef,
    openWorkspace,
    openWorkspacePath,
    openWorkspaceRoot,
    resetWorkspaceTodosRef,
    runWithIssuedWriteDrainRef,
  };
}

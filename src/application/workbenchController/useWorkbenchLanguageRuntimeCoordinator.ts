import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  animationFrameDiagnosticsFlushScheduler,
  type DiagnosticsCoalescer,
  type DiagnosticsFlushScheduler,
} from "../../domain/diagnosticsCoalescer";
import type { LanguageServerDiagnostic } from "../../domain/languageServerDiagnostics";
import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import {
  shouldIndexWorkspace,
  shouldStartLanguageServer,
  type SmartModeGateway,
  type SmartModeSetRequest,
} from "../../domain/intelligence";
import type { WorkspaceSettings } from "../../domain/settings";
import type { AppSettings } from "../../domain/settings";
import {
  normalizedWorkspaceRootKey,
  workspaceDisplayName,
  workspaceRootKeysEqual,
} from "../../domain/workspaceRootKey";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import type { EditorDocument, IntelligenceMode } from "../../domain/workspace";
import type { WorkspaceDescriptor } from "../../domain/workspace";
import {
  replaceEslintDiagnosticsForRoot,
  type EslintDiagnosticsByRoot,
  type EslintFix,
} from "../../domain/eslintDiagnostics";
import {
  replacePhpstanDiagnosticsForRoot,
  type PhpstanDiagnosticsByRoot,
} from "../../domain/phpstanDiagnostics";
import {
  isLanguageServerSessionActiveForOwner,
  isRunningLanguageServerForWorkspace,
} from "./languageServerStatusPolicy";
import { isJavaScriptTypeScriptDocumentSyncableForRoot } from "./workspacePathPolicy";
import { useChangedDocumentSyncScheduling } from "../useChangedDocumentSyncScheduling";
import {
  runEslintFixAllInActiveFile,
  runEslintWorkspaceAnalysis,
  runPhpstanIgnoreAtCursor,
  runPhpstanWorkspaceAnalysis,
} from "../useWorkbenchCodeQualityDiagnostics";
import { runEslintDisableAtCursor } from "../workbenchEslintDisableCommand";
import { isCleanWritableDocument } from "../editorDocumentState";
import { useCursorCommandAvailability } from "../useCursorCommandAvailability";
import { joinWorkspacePath } from "../../domain/workspace";
import {
  EMPTY_ESLINT_DIAGNOSTICS,
  EMPTY_ESLINT_FIXES,
  EMPTY_PHPSTAN_DIAGNOSTICS,
} from "../workbenchEmptyProjections";

type ChangedDocumentSyncDependencies = Parameters<typeof useChangedDocumentSyncScheduling>[0];

type EslintWorkspaceAnalysisDependencies = Parameters<typeof runEslintWorkspaceAnalysis>[0];
type PhpstanWorkspaceAnalysisDependencies = Parameters<typeof runPhpstanWorkspaceAnalysis>[0];
type CursorCommandAvailabilityDependencies = Parameters<typeof useCursorCommandAvailability>[0];

export interface WorkbenchStaticAnalysisCoordinatorDependencies {
  readonly activeDocument: EditorDocument | null;
  readonly activeDocumentRef: { readonly current: EditorDocument | null };
  readonly activeEditorPositionRef: CursorCommandAvailabilityDependencies["positionRef"];
  readonly appWorkspaceTabs: AppSettings["workspaceTabs"];
  clearEslintDiagnosticsForRoot(rootPath: string): void;
  clearPhpstanDiagnosticsForRoot(rootPath: string): void;
  readonly currentWorkspaceRootRef: EslintWorkspaceAnalysisDependencies["currentWorkspaceRootRef"];
  readonly editorSurfaceBufferFixRunner: Parameters<
    typeof runEslintFixAllInActiveFile
  >[0]["runner"];
  readonly editorSurfaceEslintDisableRunner: Parameters<
    typeof runEslintDisableAtCursor
  >[0]["runner"];
  readonly editorSurfacePhpstanIgnoreRunner: Parameters<
    typeof runPhpstanIgnoreAtCursor
  >[0]["runner"];
  readonly eslintAnalysisInFlightRef: EslintWorkspaceAnalysisDependencies["inFlightRef"];
  readonly eslintAnalysisRunning: boolean;
  readonly eslintDiagnosticsByRoot: EslintDiagnosticsByRoot;
  readonly eslintDiagnosticsGateway: EslintWorkspaceAnalysisDependencies["gateway"];
  readonly eslintFixesByRoot: Record<string, Record<string, EslintFix[]>>;
  readonly eslintWorkspaceTabsRef: MutableRefObject<string[]>;
  readonly phpstanAnalysisInFlightRef: PhpstanWorkspaceAnalysisDependencies["inFlightRef"];
  readonly phpstanAnalysisRunning: boolean;
  readonly phpstanDiagnosticsByRoot: PhpstanDiagnosticsByRoot;
  readonly phpstanDiagnosticsGateway: PhpstanWorkspaceAnalysisDependencies["gateway"];
  readonly phpstanWorkspaceTabsRef: MutableRefObject<string[]>;
  readonly replaceEslintDiagnostics: EslintWorkspaceAnalysisDependencies["replaceEslintDiagnostics"];
  readonly replacePhpstanDiagnostics: PhpstanWorkspaceAnalysisDependencies["replacePhpstanDiagnostics"];
  readonly setEslintAnalysisRunning: EslintWorkspaceAnalysisDependencies["setRunning"];
  readonly setEslintDiagnosticsByRoot: Dispatch<SetStateAction<EslintDiagnosticsByRoot>>;
  readonly setEslintFixesByRoot: Dispatch<
    SetStateAction<Record<string, Record<string, EslintFix[]>>>
  >;
  readonly setMessage: EslintWorkspaceAnalysisDependencies["setMessage"];
  readonly setPhpstanAnalysisRunning: PhpstanWorkspaceAnalysisDependencies["setRunning"];
  readonly setPhpstanDiagnosticsByRoot: Dispatch<SetStateAction<PhpstanDiagnosticsByRoot>>;
  readonly workspaceDescriptor: WorkspaceDescriptor | null;
  readonly workspaceRoot: string | null;
  readonly workspaceSettingsRef: { readonly current: WorkspaceSettings };
  readonly workspaceTrusted: boolean;
}

export interface WorkbenchStaticAnalysisCoordinator {
  readonly activeEslintBufferClean: boolean;
  readonly activeEslintFixes: readonly EslintFix[];
  readonly activePhpstanBufferClean: boolean;
  readonly disableEslintRuleAtCursor: () => void;
  readonly fixAllEslintInActiveFile: () => void;
  readonly hasEslintDiagnosticAtCursor: () => boolean;
  readonly hasPhpstanDiagnosticAtCursor: () => boolean;
  readonly ignorePhpstanIssueAtCursor: () => void;
  readonly runEslintAnalysis: () => Promise<void>;
  readonly runEslintAnalysisOnSave: (rootPath: string) => void;
  readonly runPhpstanAnalysis: () => Promise<void>;
  readonly runPhpstanAnalysisOnSave: (rootPath: string) => void;
}

export function useWorkbenchStaticAnalysisCoordinator({
  activeDocument,
  activeDocumentRef,
  activeEditorPositionRef,
  appWorkspaceTabs,
  clearEslintDiagnosticsForRoot,
  clearPhpstanDiagnosticsForRoot,
  currentWorkspaceRootRef,
  editorSurfaceBufferFixRunner,
  editorSurfaceEslintDisableRunner,
  editorSurfacePhpstanIgnoreRunner,
  eslintAnalysisInFlightRef,
  eslintAnalysisRunning,
  eslintDiagnosticsByRoot,
  eslintDiagnosticsGateway,
  eslintFixesByRoot,
  eslintWorkspaceTabsRef,
  phpstanAnalysisInFlightRef,
  phpstanAnalysisRunning,
  phpstanDiagnosticsByRoot,
  phpstanDiagnosticsGateway,
  phpstanWorkspaceTabsRef,
  replaceEslintDiagnostics,
  replacePhpstanDiagnostics,
  setEslintAnalysisRunning,
  setEslintDiagnosticsByRoot,
  setEslintFixesByRoot,
  setMessage,
  setPhpstanAnalysisRunning,
  setPhpstanDiagnosticsByRoot,
  workspaceDescriptor,
  workspaceRoot,
  workspaceSettingsRef,
  workspaceTrusted,
}: WorkbenchStaticAnalysisCoordinatorDependencies): WorkbenchStaticAnalysisCoordinator {
  const runEslintAnalysisForRoot = useCallback(
    async (rootPath: string, showStartMessage: boolean) => {
      await runEslintWorkspaceAnalysis({
        rootPath,
        binaryPath: workspaceSettingsRef.current.eslintPath,
        currentWorkspaceRootRef,
        inFlightRef: eslintAnalysisInFlightRef,
        gateway: eslintDiagnosticsGateway,
        replaceEslintDiagnostics,
        replaceEslintFixes: (analysedRoot, result) => {
          const fixesByPath: Record<string, EslintFix[]> = {};
          if (result.status === "ok") {
            result.diagnostics.forEach((diagnostic) => {
              if (!diagnostic.fix) return;
              const path = joinWorkspacePath(analysedRoot, diagnostic.filePath);
              fixesByPath[path] = [...(fixesByPath[path] ?? []), diagnostic.fix];
            });
          }
          setEslintFixesByRoot((current) => ({ ...current, [analysedRoot]: fixesByPath }));
        },
        replaceEslintRetainedDiagnostics: (analysedRoot, result) => {
          setEslintDiagnosticsByRoot((current) =>
            replaceEslintDiagnosticsForRoot(current, analysedRoot, result),
          );
        },
        showStartMessage,
        setMessage,
        setRunning: setEslintAnalysisRunning,
        workspaceTrusted,
      });
    },
    [
      currentWorkspaceRootRef,
      eslintAnalysisInFlightRef,
      eslintDiagnosticsGateway,
      replaceEslintDiagnostics,
      setEslintAnalysisRunning,
      setEslintDiagnosticsByRoot,
      setEslintFixesByRoot,
      setMessage,
      workspaceSettingsRef,
      workspaceTrusted,
    ],
  );
  const runEslintAnalysis = useCallback(async () => {
    const rootPath = currentWorkspaceRootRef.current;
    if (!rootPath) return;
    await runEslintAnalysisForRoot(rootPath, true);
  }, [currentWorkspaceRootRef, runEslintAnalysisForRoot]);
  const activeEslintFixes =
    workspaceRoot && activeDocument
      ? (eslintFixesByRoot[workspaceRoot]?.[activeDocument.path] ?? EMPTY_ESLINT_FIXES)
      : EMPTY_ESLINT_FIXES;
  const activeEslintDiagnostics =
    workspaceRoot && activeDocument
      ? (eslintDiagnosticsByRoot[workspaceRoot]?.[activeDocument.path] ?? EMPTY_ESLINT_DIAGNOSTICS)
      : EMPTY_ESLINT_DIAGNOSTICS;
  const activeEslintBufferClean = isCleanWritableDocument(activeDocument);
  const disableEslintRuleAtCursor = useCallback(() => {
    const requestedRoot = workspaceRoot;
    const requestedDocument = activeDocumentRef.current;
    const lineNumber = activeEditorPositionRef.current?.lineNumber;
    const diagnostics =
      requestedRoot && requestedDocument
        ? (eslintDiagnosticsByRoot[requestedRoot]?.[requestedDocument.path] ?? [])
        : [];
    if (!lineNumber) return;
    runEslintDisableAtCursor({
      currentRoot: currentWorkspaceRootRef.current,
      requestedRoot,
      document: requestedDocument,
      lineNumber,
      diagnostics,
      runner: editorSurfaceEslintDisableRunner ?? null,
      setMessage,
      workspaceTrusted,
    });
  }, [
    activeDocumentRef,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    editorSurfaceEslintDisableRunner,
    eslintDiagnosticsByRoot,
    setMessage,
    workspaceRoot,
    workspaceTrusted,
  ]);
  const fixAllEslintInActiveFile = useCallback(() => {
    const requestedRoot = workspaceRoot;
    const requestedDocument = activeDocumentRef.current;
    const fixes =
      requestedRoot && requestedDocument
        ? (eslintFixesByRoot[requestedRoot]?.[requestedDocument.path] ?? [])
        : [];
    runEslintFixAllInActiveFile({
      currentRoot: currentWorkspaceRootRef.current,
      document: requestedDocument,
      fixes,
      requestedRoot,
      runner: editorSurfaceBufferFixRunner ?? null,
      setMessage,
      workspaceTrusted,
    });
  }, [
    activeDocumentRef,
    currentWorkspaceRootRef,
    editorSurfaceBufferFixRunner,
    eslintFixesByRoot,
    setMessage,
    workspaceRoot,
    workspaceTrusted,
  ]);
  const runEslintAnalysisOnSave = useCallback(
    (rootPath: string) => {
      if (!workspaceTrusted) return;
      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
        workspaceDescriptor?.javaScriptTypeScript?.hasPackageJson !== true ||
        eslintAnalysisRunning
      )
        return;
      void runEslintAnalysisForRoot(rootPath, false);
    },
    [
      currentWorkspaceRootRef,
      eslintAnalysisRunning,
      runEslintAnalysisForRoot,
      workspaceDescriptor?.javaScriptTypeScript?.hasPackageJson,
      workspaceTrusted,
    ],
  );
  useEffect(() => {
    eslintWorkspaceTabsRef.current.forEach((previousRoot) => {
      if (
        appWorkspaceTabs.some((currentRoot) => workspaceRootKeysEqual(currentRoot, previousRoot))
      ) {
        return;
      }
      clearEslintDiagnosticsForRoot(previousRoot);
      setEslintFixesByRoot((current) => {
        const next = { ...current };
        delete next[previousRoot];
        return next;
      });
      setEslintDiagnosticsByRoot((current) => {
        const next = { ...current };
        delete next[previousRoot];
        return next;
      });
    });
    eslintWorkspaceTabsRef.current = appWorkspaceTabs;
  }, [
    appWorkspaceTabs,
    clearEslintDiagnosticsForRoot,
    eslintWorkspaceTabsRef,
    setEslintDiagnosticsByRoot,
    setEslintFixesByRoot,
  ]);
  const runPhpstanAnalysisForRoot = useCallback(
    async (rootPath: string, showStartMessage: boolean) => {
      await runPhpstanWorkspaceAnalysis({
        rootPath,
        binaryPath: workspaceSettingsRef.current.phpstanPath,
        currentWorkspaceRootRef,
        inFlightRef: phpstanAnalysisInFlightRef,
        gateway: phpstanDiagnosticsGateway,
        replacePhpstanDiagnostics,
        replacePhpstanRetainedDiagnostics: (analysedRoot, result) => {
          setPhpstanDiagnosticsByRoot((current) =>
            replacePhpstanDiagnosticsForRoot(current, analysedRoot, result),
          );
        },
        showStartMessage,
        setMessage,
        setRunning: setPhpstanAnalysisRunning,
        workspaceTrusted,
      });
    },
    [
      currentWorkspaceRootRef,
      phpstanAnalysisInFlightRef,
      phpstanDiagnosticsGateway,
      replacePhpstanDiagnostics,
      setMessage,
      setPhpstanAnalysisRunning,
      setPhpstanDiagnosticsByRoot,
      workspaceSettingsRef,
      workspaceTrusted,
    ],
  );
  const runPhpstanAnalysis = useCallback(async () => {
    const rootPath = currentWorkspaceRootRef.current;
    if (!rootPath) return;
    await runPhpstanAnalysisForRoot(rootPath, true);
  }, [currentWorkspaceRootRef, runPhpstanAnalysisForRoot]);
  const activePhpstanDiagnostics =
    workspaceRoot && activeDocument
      ? (phpstanDiagnosticsByRoot[workspaceRoot]?.[activeDocument.path] ??
        EMPTY_PHPSTAN_DIAGNOSTICS)
      : EMPTY_PHPSTAN_DIAGNOSTICS;
  const activePhpstanBufferClean = isCleanWritableDocument(activeDocument);
  const { hasEslintDiagnosticAtCursor, hasPhpstanDiagnosticAtCursor } =
    useCursorCommandAvailability({
      activeDocument,
      eslintDiagnostics: activeEslintDiagnostics,
      phpstanDiagnostics: activePhpstanDiagnostics,
      positionRef: activeEditorPositionRef,
    });
  const ignorePhpstanIssueAtCursor = useCallback(() => {
    const requestedRoot = workspaceRoot;
    const requestedDocument = activeDocumentRef.current;
    const lineNumber = activeEditorPositionRef.current?.lineNumber;
    const diagnostics =
      requestedRoot && requestedDocument
        ? (phpstanDiagnosticsByRoot[requestedRoot]?.[requestedDocument.path] ?? [])
        : [];
    if (!lineNumber) return;
    runPhpstanIgnoreAtCursor({
      currentRoot: currentWorkspaceRootRef.current,
      requestedRoot,
      document: requestedDocument,
      lineNumber,
      diagnostics,
      runner: editorSurfacePhpstanIgnoreRunner ?? null,
      setMessage,
      workspaceTrusted,
    });
  }, [
    activeDocumentRef,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    editorSurfacePhpstanIgnoreRunner,
    phpstanDiagnosticsByRoot,
    setMessage,
    workspaceRoot,
    workspaceTrusted,
  ]);
  const runPhpstanAnalysisOnSave = useCallback(
    (rootPath: string) => {
      if (!workspaceTrusted) return;
      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
        !workspaceDescriptor?.php ||
        phpstanAnalysisRunning
      )
        return;
      void runPhpstanAnalysisForRoot(rootPath, false);
    },
    [
      currentWorkspaceRootRef,
      phpstanAnalysisRunning,
      runPhpstanAnalysisForRoot,
      workspaceDescriptor?.php,
      workspaceTrusted,
    ],
  );
  useEffect(() => {
    phpstanWorkspaceTabsRef.current.forEach((previousRoot) => {
      if (
        appWorkspaceTabs.some((currentRoot) => workspaceRootKeysEqual(currentRoot, previousRoot))
      ) {
        return;
      }
      clearPhpstanDiagnosticsForRoot(previousRoot);
      setPhpstanDiagnosticsByRoot((current) => {
        const next = { ...current };
        delete next[previousRoot];
        return next;
      });
    });
    phpstanWorkspaceTabsRef.current = appWorkspaceTabs;
  }, [
    appWorkspaceTabs,
    clearPhpstanDiagnosticsForRoot,
    phpstanWorkspaceTabsRef,
    setPhpstanDiagnosticsByRoot,
  ]);
  return {
    activeEslintBufferClean,
    activeEslintFixes,
    activePhpstanBufferClean,
    disableEslintRuleAtCursor,
    fixAllEslintInActiveFile,
    hasEslintDiagnosticAtCursor,
    hasPhpstanDiagnosticAtCursor,
    ignorePhpstanIssueAtCursor,
    runEslintAnalysis,
    runEslintAnalysisOnSave,
    runPhpstanAnalysis,
    runPhpstanAnalysisOnSave,
  };
}

export interface WorkbenchSmartModeCoordinatorDependencies {
  readonly autoStartedLanguageServerRootRef: { current: string | null };
  clearWorkspaceIndex(
    rootPath: string,
    message: string | undefined,
    requestIsCurrent: () => boolean,
  ): Promise<void>;
  readonly currentWorkspaceRootRef: { readonly current: string | null };
  readonly intelligenceMode: IntelligenceMode;
  readonly intelligenceModeRef: { current: IntelligenceMode };
  readonly phpLanguageServerAutostartAttemptsByRootRef: {
    current: Record<string, number>;
  };
  persistWorkspaceSettings(rootPath: string, settings: WorkspaceSettings): Promise<unknown>;
  reportErrorForActiveWorkspaceRoot(rootPath: string, source: string, error: unknown): void;
  runPhpWorkspaceProbe(rootPath: string, owner: WorkspaceRuntimeOwner): Promise<void>;
  readonly smartModeGateway: SmartModeGateway;
  readonly smartModeRequestGenerationRef: { current: number };
  readonly smartModeRequestIntentRef: { current: WorkbenchSmartModeIntentState | null };
  setIntelligenceMode(mode: IntelligenceMode): void;
  setMessage(message: string): void;
  startInitialIndexScan(rootPath: string, requestIsCurrent: () => boolean): Promise<void>;
  stopLanguageServerRuntime(rootPath: string, owner: WorkspaceRuntimeOwner): Promise<unknown>;
  readonly workspaceDescriptor: { readonly php: unknown } | null;
  readonly workspaceIdentityDescriptor: {
    readonly admissionToken?: number;
    readonly canonicalRoot: string;
    readonly workspaceId: string;
  } | null;
  readonly workspaceRoot: string | null;
  readonly workspaceRuntimeOwnerClaimsRef: {
    readonly current: { generationFor(ownerKey: string): number | null | undefined };
  };
  readonly workspaceRuntimeOwnerRef: { readonly current: WorkspaceRuntimeOwner | null };
  readonly workspaceSettingsRef: { readonly current: WorkspaceSettings };
}

export interface WorkbenchSmartModeIntent {
  claimEffects(): boolean;
  isCurrent(): boolean;
  ownerIsCurrent(): boolean;
  readonly request: SmartModeSetRequest;
  setMode(gateway: SmartModeGateway): ReturnType<SmartModeGateway["setMode"]>;
}

export interface WorkbenchSmartModeIntentState {
  readonly generation: number;
  readonly mode: IntelligenceMode;
  readonly owner: WorkspaceRuntimeOwner;
  readonly ownerGeneration: number;
  readonly rootPath: string;
}

export interface WorkbenchSmartModeIntentDependencies {
  readonly currentWorkspaceRootRef: { readonly current: string | null };
  readonly identity: WorkbenchSmartModeCoordinatorDependencies["workspaceIdentityDescriptor"];
  readonly intentGenerationRef: { current: number };
  readonly intentStateRef: { current: WorkbenchSmartModeIntentState | null };
  readonly mode: IntelligenceMode;
  readonly owner: WorkspaceRuntimeOwner | null;
  readonly rootPath: string | null;
  readonly workspaceRuntimeOwnerClaimsRef: {
    readonly current: { generationFor(ownerKey: string): number | null | undefined };
  };
  readonly workspaceRuntimeOwnerRef: { readonly current: WorkspaceRuntimeOwner | null };
}

const smartModeIntentSettlements = new WeakMap<
  WorkbenchSmartModeIntentState,
  ReturnType<SmartModeGateway["setMode"]>
>();
const claimedSmartModeIntentEffects = new WeakSet<WorkbenchSmartModeIntentState>();

export function beginWorkbenchSmartModeIntent({
  currentWorkspaceRootRef,
  identity,
  intentGenerationRef,
  intentStateRef,
  mode,
  owner,
  rootPath,
  workspaceRuntimeOwnerClaimsRef,
  workspaceRuntimeOwnerRef,
}: WorkbenchSmartModeIntentDependencies): WorkbenchSmartModeIntent | null {
  if (!owner || !rootPath || !workspaceRootKeysEqual(owner.executionRoot, rootPath)) return null;
  const request = createSmartModeSetRequest(identity, owner, mode);
  if (!request) return null;
  const ownerGeneration = workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey);
  if (ownerGeneration === null || ownerGeneration === undefined) return null;
  const currentIntent = intentStateRef.current;
  const reusesCurrentIntent =
    currentIntent?.mode === mode &&
    currentIntent.owner === owner &&
    currentIntent.ownerGeneration === ownerGeneration &&
    workspaceRootKeysEqual(currentIntent.rootPath, rootPath);
  const intentGeneration = reusesCurrentIntent
    ? currentIntent.generation
    : intentGenerationRef.current + 1;
  let intentState = currentIntent;
  if (!reusesCurrentIntent) {
    intentGenerationRef.current = intentGeneration;
    intentState = Object.freeze({
      generation: intentGeneration,
      mode,
      owner,
      ownerGeneration,
      rootPath,
    });
    intentStateRef.current = intentState;
  }
  if (!intentState) return null;
  const ownerIsCurrent = () =>
    workspaceRuntimeOwnerRef.current === owner &&
    workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey) === ownerGeneration &&
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath);
  return Object.freeze({
    claimEffects: () => {
      if (claimedSmartModeIntentEffects.has(intentState)) return false;
      claimedSmartModeIntentEffects.add(intentState);
      return true;
    },
    isCurrent: () => intentStateRef.current?.generation === intentGeneration && ownerIsCurrent(),
    ownerIsCurrent,
    request,
    setMode: (gateway: SmartModeGateway) => {
      const currentSettlement = smartModeIntentSettlements.get(intentState);
      if (currentSettlement) return currentSettlement;
      const settlement = gateway.setMode(request).finally(() => {
        if (smartModeIntentSettlements.get(intentState) !== settlement) return;
        smartModeIntentSettlements.delete(intentState);
      });
      smartModeIntentSettlements.set(intentState, settlement);
      return settlement;
    },
  });
}

export function useWorkbenchSmartModeCoordinator({
  autoStartedLanguageServerRootRef,
  clearWorkspaceIndex,
  currentWorkspaceRootRef,
  intelligenceMode,
  intelligenceModeRef,
  phpLanguageServerAutostartAttemptsByRootRef,
  persistWorkspaceSettings,
  reportErrorForActiveWorkspaceRoot,
  runPhpWorkspaceProbe,
  setIntelligenceMode,
  setMessage,
  smartModeGateway,
  smartModeRequestGenerationRef,
  smartModeRequestIntentRef,
  startInitialIndexScan,
  stopLanguageServerRuntime,
  workspaceDescriptor,
  workspaceIdentityDescriptor,
  workspaceRoot,
  workspaceRuntimeOwnerClaimsRef,
  workspaceRuntimeOwnerRef,
  workspaceSettingsRef,
}: WorkbenchSmartModeCoordinatorDependencies) {
  return useCallback(
    async (mode: IntelligenceMode) => {
      const requestedRoot = workspaceRoot;
      const requestedOwner = workspaceRuntimeOwnerRef.current;
      const intent = beginWorkbenchSmartModeIntent({
        currentWorkspaceRootRef,
        identity: workspaceIdentityDescriptor,
        intentGenerationRef: smartModeRequestGenerationRef,
        intentStateRef: smartModeRequestIntentRef,
        mode,
        owner: requestedOwner,
        rootPath: requestedRoot,
        workspaceRuntimeOwnerClaimsRef,
        workspaceRuntimeOwnerRef,
      });
      if (!requestedRoot || !requestedOwner || !intent) return;
      const requestIsCurrent = intent.isCurrent;
      if (mode === intelligenceMode) return;

      try {
        const previousMode = intelligenceMode;
        const state = await intent.setMode(smartModeGateway);
        if (!requestIsCurrent()) return;
        if (!intent.claimEffects()) return;
        const nextMode = state.mode;

        if (shouldStartLanguageServer(previousMode) && !shouldStartLanguageServer(nextMode)) {
          intelligenceModeRef.current = nextMode;
          setIntelligenceMode(nextMode);
          autoStartedLanguageServerRootRef.current = requestedOwner.ownerKey;
          setMessage(`Stopping PHPactor + index for ${workspaceDisplayName(requestedRoot)}`);
          await stopLanguageServerRuntime(requestedRoot, requestedOwner);
          if (!requestIsCurrent()) return;
        }

        if (!shouldStartLanguageServer(previousMode) && shouldStartLanguageServer(nextMode)) {
          autoStartedLanguageServerRootRef.current = null;
          delete phpLanguageServerAutostartAttemptsByRootRef.current[requestedOwner.ownerKey];
          if (workspaceDescriptor?.php) {
            void runPhpWorkspaceProbe(requestedRoot, requestedOwner);
          }
        }

        intelligenceModeRef.current = nextMode;
        setIntelligenceMode(nextMode);
        await persistWorkspaceSettings(requestedRoot, {
          ...workspaceSettingsRef.current,
          intelligenceMode: nextMode,
        });
        if (!requestIsCurrent()) return;

        if (shouldIndexWorkspace(nextMode)) {
          setMessage(state.message);
          await startInitialIndexScan(requestedRoot, requestIsCurrent);
          if (!requestIsCurrent()) return;
          return;
        }

        await clearWorkspaceIndex(requestedRoot, state.message, requestIsCurrent);
        if (!requestIsCurrent()) return;
      } catch (error) {
        if (!requestIsCurrent()) return;
        reportErrorForActiveWorkspaceRoot(requestedRoot, "IDE Mode", error);
      }
    },
    [
      autoStartedLanguageServerRootRef,
      clearWorkspaceIndex,
      currentWorkspaceRootRef,
      intelligenceMode,
      intelligenceModeRef,
      persistWorkspaceSettings,
      phpLanguageServerAutostartAttemptsByRootRef,
      reportErrorForActiveWorkspaceRoot,
      runPhpWorkspaceProbe,
      setIntelligenceMode,
      setMessage,
      smartModeGateway,
      smartModeRequestGenerationRef,
      smartModeRequestIntentRef,
      startInitialIndexScan,
      stopLanguageServerRuntime,
      workspaceDescriptor,
      workspaceIdentityDescriptor,
      workspaceRoot,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerRef,
      workspaceSettingsRef,
    ],
  );
}

export function createSmartModeSetRequest(
  identity: WorkbenchSmartModeCoordinatorDependencies["workspaceIdentityDescriptor"],
  owner: WorkspaceRuntimeOwner,
  mode: IntelligenceMode,
): SmartModeSetRequest | null {
  const admissionToken = identity?.admissionToken;
  if (!identity || identity.workspaceId !== owner.ownerKey) return null;
  if (typeof admissionToken !== "number" || !Number.isSafeInteger(admissionToken)) return null;
  if (admissionToken <= 0) return null;
  return Object.freeze({
    admissionToken,
    mode,
    rootPath: identity.canonicalRoot,
    workspaceId: identity.workspaceId,
  });
}

export interface WorkbenchLanguageRuntimeOwnershipDependencies {
  readonly javaScriptTypeScriptRuntimeStatusByRootRef: {
    readonly current: Record<string, LanguageServerRuntimeStatus>;
  };
  readonly javaScriptTypeScriptTrustAutostartRef: {
    current: {
      readonly owner: WorkspaceRuntimeOwner;
      readonly promise: Promise<void>;
      readonly revision: number;
      readonly trustRevision: number;
      readonly typeScriptVersionPreference: WorkspaceSettings["javaScriptTypeScriptVersion"];
    } | null;
  };
  readonly languageServerRuntimeStatusByRootRef: {
    readonly current: Record<string, LanguageServerRuntimeStatus>;
  };
  readonly openWorkspaceRequestTokenRef: { readonly current: number };
  refreshJavaScriptTypeScriptLanguageServerPlan(
    rootPath: string,
    typeScriptVersionPreference: WorkspaceSettings["javaScriptTypeScriptVersion"],
    owner: WorkspaceRuntimeOwner,
    requestIsValid: () => boolean,
  ): Promise<unknown>;
  resolveCurrentWorkspaceRuntimeOwner(): WorkspaceRuntimeOwner | null;
  isLegacyJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
    rootPath: string,
    sessionId: number,
  ): boolean;
  isLegacyLanguageServerSessionActiveForRoot(rootPath: string, sessionId: number): boolean;
  stopJavaScriptTypeScriptLanguageServerRuntime(
    rootPath: string,
    owner: WorkspaceRuntimeOwner,
  ): Promise<unknown>;
  stopLanguageServerRuntime(rootPath: string, owner: WorkspaceRuntimeOwner): Promise<unknown>;
  readonly workspaceTrustRevisionByOwnerRef: { readonly current: Record<string, number> };
  readonly workspaceRuntimeOwnerClaimsRef: {
    readonly current: { generationFor(ownerKey: string): number | null | undefined };
  };
  readonly workspaceTrustRevocationByOwnerRef: {
    current: Record<
      string,
      {
        readonly generation: number | null | undefined;
        readonly owner: WorkspaceRuntimeOwner;
        readonly promise: Promise<void>;
      }
    >;
  };
}

export function useWorkbenchLanguageRuntimeOwnership({
  isLegacyJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
  isLegacyLanguageServerSessionActiveForRoot,
  javaScriptTypeScriptRuntimeStatusByRootRef,
  javaScriptTypeScriptTrustAutostartRef,
  languageServerRuntimeStatusByRootRef,
  openWorkspaceRequestTokenRef,
  refreshJavaScriptTypeScriptLanguageServerPlan,
  resolveCurrentWorkspaceRuntimeOwner,
  stopJavaScriptTypeScriptLanguageServerRuntime,
  stopLanguageServerRuntime,
  workspaceTrustRevisionByOwnerRef,
  workspaceTrustRevocationByOwnerRef,
  workspaceRuntimeOwnerClaimsRef,
}: WorkbenchLanguageRuntimeOwnershipDependencies) {
  const stopProjectLanguageServersAfterTrustRevocation = useCallback(
    async (requestedOwner: WorkspaceRuntimeOwner) => {
      const requestedGeneration = workspaceRuntimeOwnerClaimsRef.current.generationFor(
        requestedOwner.ownerKey,
      );
      if (requestedGeneration === null || requestedGeneration === undefined) return;
      const inFlight = workspaceTrustRevocationByOwnerRef.current[requestedOwner.ownerKey];
      if (inFlight?.owner === requestedOwner && inFlight.generation === requestedGeneration) {
        await inFlight.promise;
        return;
      }

      const promise = Promise.all([
        stopLanguageServerRuntime(requestedOwner.executionRoot, requestedOwner),
        stopJavaScriptTypeScriptLanguageServerRuntime(requestedOwner.executionRoot, requestedOwner),
      ]).then(() => undefined);
      workspaceTrustRevocationByOwnerRef.current[requestedOwner.ownerKey] = {
        generation: requestedGeneration,
        owner: requestedOwner,
        promise,
      };
      try {
        await promise;
      } finally {
        if (
          workspaceTrustRevocationByOwnerRef.current[requestedOwner.ownerKey]?.promise === promise
        ) {
          delete workspaceTrustRevocationByOwnerRef.current[requestedOwner.ownerKey];
        }
      }
    },
    [
      stopJavaScriptTypeScriptLanguageServerRuntime,
      stopLanguageServerRuntime,
      workspaceTrustRevocationByOwnerRef,
      workspaceRuntimeOwnerClaimsRef,
    ],
  );

  const refreshJavaScriptTypeScriptPlanAfterTrustGrant = useCallback(
    async (
      requestedOwner: WorkspaceRuntimeOwner,
      requestedRevision: number,
      requestedTrustRevision: number,
      typeScriptVersionPreference: WorkspaceSettings["javaScriptTypeScriptVersion"],
    ) => {
      const requestedGeneration = workspaceRuntimeOwnerClaimsRef.current.generationFor(
        requestedOwner.ownerKey,
      );
      if (requestedGeneration === null || requestedGeneration === undefined) return;
      const requestIsCurrent = () => {
        const currentOwner = resolveCurrentWorkspaceRuntimeOwner();
        return (
          openWorkspaceRequestTokenRef.current === requestedRevision &&
          currentOwner === requestedOwner &&
          workspaceRuntimeOwnerClaimsRef.current.generationFor(requestedOwner.ownerKey) ===
            requestedGeneration &&
          (workspaceTrustRevisionByOwnerRef.current[requestedOwner.ownerKey] ?? 0) ===
            requestedTrustRevision
        );
      };
      if (!requestIsCurrent()) return;

      const inFlight = javaScriptTypeScriptTrustAutostartRef.current;
      if (
        inFlight?.owner === requestedOwner &&
        inFlight.revision === requestedRevision &&
        inFlight.trustRevision === requestedTrustRevision &&
        inFlight.typeScriptVersionPreference === typeScriptVersionPreference
      ) {
        await inFlight.promise;
        return;
      }

      const request = { promise: null as Promise<void> | null };
      const promise = (async () => {
        if (!requestIsCurrent()) return;
        await refreshJavaScriptTypeScriptLanguageServerPlan(
          requestedOwner.executionRoot,
          typeScriptVersionPreference,
          requestedOwner,
          () =>
            requestIsCurrent() &&
            javaScriptTypeScriptTrustAutostartRef.current?.promise === request.promise,
        );
      })();
      request.promise = promise;
      javaScriptTypeScriptTrustAutostartRef.current = {
        owner: requestedOwner,
        promise,
        revision: requestedRevision,
        trustRevision: requestedTrustRevision,
        typeScriptVersionPreference,
      };
      try {
        await promise;
      } finally {
        if (javaScriptTypeScriptTrustAutostartRef.current?.promise === promise) {
          javaScriptTypeScriptTrustAutostartRef.current = null;
        }
      }
    },
    [
      javaScriptTypeScriptTrustAutostartRef,
      openWorkspaceRequestTokenRef,
      refreshJavaScriptTypeScriptLanguageServerPlan,
      resolveCurrentWorkspaceRuntimeOwner,
      workspaceTrustRevisionByOwnerRef,
      workspaceRuntimeOwnerClaimsRef,
    ],
  );

  const isLanguageServerSessionActiveForRoot = useCallback(
    (rootPath: string, sessionId: number, owner?: WorkspaceRuntimeOwner) =>
      owner
        ? isLanguageServerSessionActiveForOwner(
            languageServerRuntimeStatusByRootRef.current,
            owner,
            rootPath,
            sessionId,
          )
        : isLegacyLanguageServerSessionActiveForRoot(rootPath, sessionId),
    [isLegacyLanguageServerSessionActiveForRoot, languageServerRuntimeStatusByRootRef],
  );

  const isJavaScriptTypeScriptLanguageServerSessionActiveForRoot = useCallback(
    (rootPath: string, sessionId: number, owner?: WorkspaceRuntimeOwner) =>
      owner
        ? isLanguageServerSessionActiveForOwner(
            javaScriptTypeScriptRuntimeStatusByRootRef.current,
            owner,
            rootPath,
            sessionId,
          )
        : isLegacyJavaScriptTypeScriptLanguageServerSessionActiveForRoot(rootPath, sessionId),
    [
      isLegacyJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptRuntimeStatusByRootRef,
    ],
  );

  return {
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    isLanguageServerSessionActiveForRoot,
    refreshJavaScriptTypeScriptPlanAfterTrustGrant,
    stopProjectLanguageServersAfterTrustRevocation,
  };
}

export interface WorkbenchLanguageRuntimeOwnerRefs {
  readonly languageServerDiagnosticsByRootRef: {
    current: Record<string, Record<string, LanguageServerDiagnostic[]>>;
  };
  readonly languageServerRuntimeStatusByRootRef: {
    current: Record<string, LanguageServerRuntimeStatus>;
  };
}

export function useWorkbenchLanguageRuntimeOwnerRefs(): WorkbenchLanguageRuntimeOwnerRefs {
  const languageServerRuntimeStatusByRootRef = useRef<Record<string, LanguageServerRuntimeStatus>>(
    {},
  );
  const languageServerDiagnosticsByRootRef = useRef<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >({});
  return { languageServerDiagnosticsByRootRef, languageServerRuntimeStatusByRootRef };
}

export interface WorkbenchLanguageRuntimeChannelRefs {
  readonly diagnosticsFlushSchedulerRef: { current: DiagnosticsFlushScheduler };
  readonly javaScriptTypeScriptDiagnosticsByRootRef: {
    current: Record<string, Record<string, LanguageServerDiagnostic[]>>;
  };
  readonly javaScriptTypeScriptDiagnosticsCoalescerRef: {
    current: DiagnosticsCoalescer | null;
  };
  readonly javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
    current: LanguageServerRuntimeStatus | null;
  };
  readonly javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: {
    current: string | null;
  };
  readonly javaScriptTypeScriptRuntimeStatusByRootRef: {
    current: Record<string, LanguageServerRuntimeStatus>;
  };
  readonly languageServerDiagnosticsCoalescerRef: { current: DiagnosticsCoalescer | null };
  readonly languageServerRuntimeStatusRef: { current: LanguageServerRuntimeStatus | null };
  readonly languageServerRuntimeStatusRootRef: { current: string | null };
}

export function useWorkbenchLanguageRuntimeChannelRefs(
  diagnosticsFlushScheduler?: DiagnosticsFlushScheduler,
): WorkbenchLanguageRuntimeChannelRefs {
  const languageServerDiagnosticsCoalescerRef = useRef<DiagnosticsCoalescer | null>(null);
  const javaScriptTypeScriptDiagnosticsCoalescerRef = useRef<DiagnosticsCoalescer | null>(null);
  const diagnosticsFlushSchedulerRef = useRef<DiagnosticsFlushScheduler>(
    diagnosticsFlushScheduler ?? animationFrameDiagnosticsFlushScheduler(),
  );
  const javaScriptTypeScriptRuntimeStatusByRootRef = useRef<
    Record<string, LanguageServerRuntimeStatus>
  >({});
  const javaScriptTypeScriptDiagnosticsByRootRef = useRef<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >({});
  const languageServerRuntimeStatusRef = useRef<LanguageServerRuntimeStatus | null>(null);
  const languageServerRuntimeStatusRootRef = useRef<string | null>(null);
  const javaScriptTypeScriptLanguageServerRuntimeStatusRef =
    useRef<LanguageServerRuntimeStatus | null>(null);
  const javaScriptTypeScriptLanguageServerRuntimeStatusRootRef = useRef<string | null>(null);

  return {
    diagnosticsFlushSchedulerRef,
    javaScriptTypeScriptDiagnosticsByRootRef,
    javaScriptTypeScriptDiagnosticsCoalescerRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    languageServerDiagnosticsCoalescerRef,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRootRef,
  };
}

interface RuntimeDocumentSync {
  readonly activePath: string | null;
  readonly documentSyncRuntimeSignatureRef: { current: string | null };
  readonly documentsRef: { readonly current: Record<string, EditorDocument> };
  readonly languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  readonly languageServerRuntimeStatusRoot: string | null;
  readonly openDocumentPaths: readonly string[];
  resetLanguageServerDocuments(): void;
  readonly runtimeGeneration: number | null;
  readonly runtimeOwner: WorkspaceRuntimeOwner | null;
  syncOpenDocument(document: EditorDocument): Promise<void>;
  readonly workspaceRoot: string | null;
}

interface JavaScriptTypeScriptRuntimeDocumentSync {
  readonly activePath: string | null;
  readonly documentSyncRuntimeSignatureRef: { current: string | null };
  readonly documentsRef: { readonly current: Record<string, EditorDocument> };
  readonly languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  readonly languageServerRuntimeStatusRoot: string | null;
  readonly openDocumentPaths: readonly string[];
  resetLanguageServerDocuments(): void;
  readonly runtimeGeneration: number | null;
  readonly runtimeOwner: WorkspaceRuntimeOwner | null;
  syncOpenDocument(document: EditorDocument): Promise<void>;
  readonly workspaceRoot: string | null;
}

export interface WorkbenchLanguageRuntimeEffectsDependencies {
  readonly changedDocumentSync: ChangedDocumentSyncDependencies;
  readonly javaScriptTypeScript: JavaScriptTypeScriptRuntimeDocumentSync;
  readonly php: RuntimeDocumentSync;
}

export function useWorkbenchLanguageRuntimeEffects({
  changedDocumentSync,
  javaScriptTypeScript,
  php,
}: WorkbenchLanguageRuntimeEffectsDependencies): void {
  const phpDocumentSyncRuntimeOwnerRef = useRef<WorkspaceRuntimeOwner | null>(null);
  const javaScriptTypeScriptDocumentSyncRuntimeOwnerRef = useRef<WorkspaceRuntimeOwner | null>(
    null,
  );

  const {
    activePath: phpActivePath,
    documentSyncRuntimeSignatureRef,
    documentsRef,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    openDocumentPaths,
    resetLanguageServerDocuments,
    runtimeGeneration,
    runtimeOwner,
    syncOpenDocument,
    workspaceRoot,
  } = php;
  const {
    activePath: javaScriptTypeScriptActivePath,
    documentSyncRuntimeSignatureRef: javaScriptTypeScriptDocumentSyncRuntimeSignatureRef,
    languageServerRuntimeStatus: javaScriptTypeScriptLanguageServerRuntimeStatus,
    languageServerRuntimeStatusRoot: javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    resetLanguageServerDocuments: resetJavaScriptTypeScriptLanguageServerDocuments,
    runtimeGeneration: javaScriptTypeScriptRuntimeGeneration,
    runtimeOwner: javaScriptTypeScriptRuntimeOwner,
    syncOpenDocument: syncOpenJavaScriptTypeScriptDocument,
  } = javaScriptTypeScript;

  useEffect(() => {
    const runtimeSignature = languageRuntimeDocumentSyncSignature(
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      workspaceRoot,
      runtimeOwner,
      runtimeGeneration,
    );
    if (!runtimeSignature || !runtimeOwner) {
      phpDocumentSyncRuntimeOwnerRef.current = null;
      resetLanguageServerDocuments();
      return;
    }

    if (
      languageRuntimeDocumentSyncAuthorityChanged(
        documentSyncRuntimeSignatureRef.current,
        runtimeSignature,
        phpDocumentSyncRuntimeOwnerRef.current,
        runtimeOwner,
      )
    ) {
      resetLanguageServerDocuments();
      documentSyncRuntimeSignatureRef.current = runtimeSignature;
      phpDocumentSyncRuntimeOwnerRef.current = runtimeOwner;
    }

    openDocumentsForSync({
      activePath: phpActivePath,
      documentsRef,
      openDocumentPaths,
    }).forEach((document) => {
      void syncOpenDocument(document);
    });
  }, [
    documentSyncRuntimeSignatureRef,
    documentsRef,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    openDocumentPaths,
    phpActivePath,
    resetLanguageServerDocuments,
    runtimeGeneration,
    runtimeOwner,
    syncOpenDocument,
    workspaceRoot,
  ]);

  useEffect(() => {
    const runtimeSignature = languageRuntimeDocumentSyncSignature(
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      workspaceRoot,
      javaScriptTypeScriptRuntimeOwner,
      javaScriptTypeScriptRuntimeGeneration,
    );
    if (!runtimeSignature || !workspaceRoot || !javaScriptTypeScriptRuntimeOwner) {
      javaScriptTypeScriptDocumentSyncRuntimeOwnerRef.current = null;
      resetJavaScriptTypeScriptLanguageServerDocuments();
      return;
    }

    if (
      languageRuntimeDocumentSyncAuthorityChanged(
        javaScriptTypeScriptDocumentSyncRuntimeSignatureRef.current,
        runtimeSignature,
        javaScriptTypeScriptDocumentSyncRuntimeOwnerRef.current,
        javaScriptTypeScriptRuntimeOwner,
      )
    ) {
      resetJavaScriptTypeScriptLanguageServerDocuments();
      javaScriptTypeScriptDocumentSyncRuntimeSignatureRef.current = runtimeSignature;
      javaScriptTypeScriptDocumentSyncRuntimeOwnerRef.current = javaScriptTypeScriptRuntimeOwner;
    }

    openDocumentsForSync({
      activePath: javaScriptTypeScriptActivePath,
      documentsRef,
      openDocumentPaths,
    })
      .filter((document) => isJavaScriptTypeScriptDocumentSyncableForRoot(workspaceRoot, document))
      .forEach((document) => {
        void syncOpenJavaScriptTypeScriptDocument(document);
      });
  }, [
    documentsRef,
    javaScriptTypeScriptActivePath,
    javaScriptTypeScriptDocumentSyncRuntimeSignatureRef,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    openDocumentPaths,
    resetJavaScriptTypeScriptLanguageServerDocuments,
    javaScriptTypeScriptRuntimeGeneration,
    javaScriptTypeScriptRuntimeOwner,
    syncOpenJavaScriptTypeScriptDocument,
    workspaceRoot,
  ]);

  useChangedDocumentSyncScheduling(changedDocumentSync);

  useEffect(
    () => () => {
      resetLanguageServerDocuments();
      resetJavaScriptTypeScriptLanguageServerDocuments();
    },
    [resetJavaScriptTypeScriptLanguageServerDocuments, resetLanguageServerDocuments],
  );
}

export function languageRuntimeDocumentSyncSignature(
  runtimeStatus: LanguageServerRuntimeStatus | null,
  runtimeStatusRoot: string | null,
  workspaceRoot: string | null,
  runtimeOwner: WorkspaceRuntimeOwner | null,
  runtimeGeneration: number | null,
): string | null {
  if (
    !runtimeOwner ||
    runtimeGeneration === null ||
    !workspaceRootKeysEqual(runtimeOwner.executionRoot, workspaceRoot) ||
    !isRunningLanguageServerForWorkspace(runtimeStatus, runtimeStatusRoot, workspaceRoot)
  ) {
    return null;
  }
  const runtimeRoot = runtimeStatus.rootPath ?? runtimeStatusRoot ?? workspaceRoot;
  return [
    normalizedWorkspaceRootKey(runtimeRoot),
    runtimeOwner.ownerKey,
    runtimeGeneration,
    runtimeStatus.sessionId,
  ].join(":");
}

export function languageRuntimeDocumentSyncAuthorityChanged(
  previousSignature: string | null,
  currentSignature: string,
  previousOwner: WorkspaceRuntimeOwner | null,
  currentOwner: WorkspaceRuntimeOwner,
): boolean {
  return previousSignature !== currentSignature || previousOwner !== currentOwner;
}

function openDocumentsForSync({
  activePath,
  documentsRef,
  openDocumentPaths,
}: Pick<RuntimeDocumentSync, "activePath" | "documentsRef" | "openDocumentPaths">) {
  const documents = openDocumentPaths
    .map((path) => documentsRef.current[path])
    .filter((document): document is EditorDocument => Boolean(document));
  const activeDocument = activePath ? documentsRef.current[activePath] : null;
  if (activeDocument && !documents.some((document) => document.path === activePath)) {
    documents.push(activeDocument);
  }
  return documents;
}

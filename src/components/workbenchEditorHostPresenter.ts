import { useLayoutEffect, useMemo, useRef, type ComponentProps, type RefObject } from "react";
import type { useWorkbenchController } from "../application/useWorkbenchController";
import type { EditorGroupId } from "../domain/editorGroups";
import type { JsTestEditorSurfaceSource } from "./jsTestEditorSurfaceProps";
import type { WorkbenchEditorHost } from "./WorkbenchEditorHost";

type Workbench = ReturnType<typeof useWorkbenchController>;
type DebugSession = Workbench["debugSession"];
type FrameworkProviders = NonNullable<Workbench["frameworkIntelligenceProviders"]>;
type AnyCallback = (...args: never[]) => unknown;
type FunctionPropertyName<T> = {
  [Key in keyof T]-?: T[Key] extends (...args: never[]) => unknown ? Key : never;
}[keyof T];

const EMPTY_EDITOR_CONFIG = Object.freeze({}) as Workbench["activeEditorConfig"];
const EMPTY_VIEW_STATES = Object.freeze({}) as Workbench["restoredEditorViewStates"];
const EMPTY_VIEW_STATES_BY_GROUP = Object.freeze(
  {},
) as Workbench["restoredEditorViewStatesByGroup"];
const WORKBENCH_ACTION_KEYS = [
  "activateEditorGroup",
  "activateEditorGroupTab",
  "applyJavaScriptTypeScriptLanguageServerWorkspaceEdit",
  "applyPhpCodeActionNewFile",
  "applyPhpLanguageServerWorkspaceEdit",
  "attachEditorGroupLiveDocument",
  "canRevertGitChange",
  "clearEditorRevealTarget",
  "clearLanguageServerDiagnosticsForPath",
  "closeDocument",
  "closeDocumentInEditorGroup",
  "closeFloatingSurface",
  "flushPendingJavaScriptTypeScriptLanguageServerDocument",
  "flushPendingLanguageServerDocument",
  "getJavaScriptTypeScriptDocumentSyncVersion",
  "getLanguageServerDocumentLifecycleIdentity",
  "isEditorGroupDocumentSessionAuthorityCurrent",
  "isLanguageServerDocumentRequestLeaseCurrent",
  "isLanguageServerDocumentSynced",
  "loadGitFileHunks",
  "moveEditorGroupTab",
  "navigateBackward",
  "navigateForwardInHistory",
  "onActiveLiveDocumentSaveBindingChange",
  "goToDefinition",
  "goToImplementationAt",
  "goToSuperMethod",
  "openFileStructure",
  "openWorkspaceFile",
  "openWorkspaceRoot",
  "pinEditorGroupTab",
  "provideGitBlame",
  "providePhpCodeActions",
  "providePhpFrameworkDefinition",
  "providePhpMethodCompletions",
  "providePhpMethodSignature",
  "providePhpParameterInlayHints",
  "readWorkspaceFile",
  "recordCompletionLatency",
  "reorderEditorGroupTab",
  "reportCommandError",
  "reportLanguageServerError",
  "requestLanguageServerDocumentLease",
  "resolveEditorGroupDocumentSessionAuthority",
  "resizeEditorSplit",
  "revertActiveEditorChangeHunk",
  "revertGitChanges",
  "revertGitHunk",
  "runCommand",
  "runTestAt",
  "setActivePath",
  "setClassOpenOpen",
  "setQuickOpenOpen",
  "stageGitHunk",
  "toggleBookmarkAtLine",
  "toggleGitBlame",
  "unstageGitHunk",
  "updateActiveDocument",
  "updateActiveEditorPosition",
  "updateEditorGroupViewState",
  "updateEditorViewState",
  "updateLocalPhpDiagnostics",
] as const satisfies readonly FunctionPropertyName<Workbench>[];
const BREAKPOINT_ACTION_KEYS = [
  "addInlineBreakpoint",
  "disableAllBreakpoints",
  "enableAllBreakpoints",
  "relocateBreakpoint",
  "removeAllBreakpoints",
  "removeBreakpoint",
  "restoreBreakpoints",
  "setBreakpointCondition",
  "setBreakpointEnabled",
  "setBreakpointHitCondition",
  "setBreakpointLogMessage",
  "toggleBreakpoint",
] as const satisfies readonly FunctionPropertyName<DebugSession>[];
const FRAMEWORK_PROVIDER_KEYS = [
  "provideBladeCodeActions",
  "provideBladeCompletions",
  "provideBladeDefinition",
  "provideLatteCodeActions",
  "provideLatteCompletions",
  "provideLatteDefinition",
  "provideNeonCompletions",
  "provideNeonDefinition",
  "providePhpPresenterLinkCompletions",
  "isPhpPresenterLinkCompletionContext",
  "providePhpPresenterLinkDefinition",
  "isPhpFrameworkStringCompletionContext",
] as const satisfies readonly FunctionPropertyName<FrameworkProviders>[];

function createRevisionToken(...dependencies: readonly unknown[]): Readonly<Record<string, never>> {
  void dependencies;
  return Object.freeze({});
}

export function useWorkbenchEditorHostPresenter(workbench: Workbench) {
  const workbenchRef = useRef(workbench);
  const debugSessionRef = useRef(workbench.debugSession);
  const frameworkProvidersRef = useRef(workbench.frameworkIntelligenceProviders);
  useLayoutEffect(() => {
    workbenchRef.current = workbench;
    debugSessionRef.current = workbench.debugSession;
    frameworkProvidersRef.current = workbench.frameworkIntelligenceProviders;
  }, [workbench]);
  const actions = useMemo(() => createStableMethodAdapter(workbenchRef, WORKBENCH_ACTION_KEYS), []);
  const breakpointActions = useMemo(
    () => createStableMethodAdapter(debugSessionRef, BREAKPOINT_ACTION_KEYS),
    [],
  );
  const frameworkIntelligenceProviders = useMemo(
    () => createStableMethodAdapter(frameworkProvidersRef, FRAMEWORK_PROVIDER_KEYS),
    [],
  );
  const activeEditorConfig =
    Object.keys(workbench.activeEditorConfig).length === 0
      ? EMPTY_EDITOR_CONFIG
      : workbench.activeEditorConfig;
  const restoredEditorViewStates =
    Object.keys(workbench.restoredEditorViewStates).length === 0
      ? EMPTY_VIEW_STATES
      : workbench.restoredEditorViewStates;
  const restoredEditorViewStatesByGroup =
    Object.keys(workbench.restoredEditorViewStatesByGroup).length === 0
      ? EMPTY_VIEW_STATES_BY_GROUP
      : workbench.restoredEditorViewStatesByGroup;
  const data = useMemo(
    () => ({
      activeEditorConfig,
      appSettings: workbench.appSettings,
      breakpoints: workbench.debugSession.breakpoints,
      debugHover: workbench.debugSession.debugHover,
      debugInlineValueContext: workbench.debugSession.inlineValueContext,
      debugStoppedLocation: workbench.debugStoppedLocation,
      documentSessionAuthorityRevision: workbench.documentSessionAuthorityRevision,
      editorRevealTarget: workbench.editorRevealTarget,
      frameworkIntelligenceProviders,
      gitDiffDocuments: workbench.gitDiffDocuments,
      gitOperationLoading: workbench.gitOperationLoading,
      isActiveDocumentGitBlameEnabled: workbench.isActiveDocumentGitBlameEnabled,
      isActiveDocumentJsTest: workbench.isActiveDocumentJsTest,
      isActiveDocumentPhpTest: workbench.isActiveDocumentPhpTest,
      isOpeningFile: workbench.isOpeningFile,
      javaScriptTypeScriptIncrementalSync: workbench.javaScriptTypeScriptIncrementalSync,
      javaScriptTypeScriptLanguageServerRuntimeStatus:
        workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
      languageServerDiagnosticsByPath: workbench.languageServerDiagnosticsByPath,
      languageServerRuntimeStatus: workbench.languageServerRuntimeStatus,
      markdownPreviewTabs: workbench.markdownPreviewTabs,
      phpIdeReadinessVersion: workbench.phpIdeReadinessVersion,
      restoredEditorViewStateRevision: workbench.restoredEditorViewStateRevision,
      restoredEditorViewStates,
      restoredEditorViewStatesByGroup,
      workspaceIdentityDescriptor: workbench.workspaceIdentityDescriptor,
      workspaceRoot: workbench.workspaceRoot,
      workspaceSettings: workbench.workspaceSettings,
    }),
    [
      activeEditorConfig,
      frameworkIntelligenceProviders,
      restoredEditorViewStates,
      restoredEditorViewStatesByGroup,
      workbench.appSettings,
      workbench.debugSession.breakpoints,
      workbench.debugSession.debugHover,
      workbench.debugSession.inlineValueContext,
      workbench.debugStoppedLocation,
      workbench.documentSessionAuthorityRevision,
      workbench.editorRevealTarget,
      workbench.gitDiffDocuments,
      workbench.gitOperationLoading,
      workbench.isActiveDocumentGitBlameEnabled,
      workbench.isActiveDocumentJsTest,
      workbench.isActiveDocumentPhpTest,
      workbench.isOpeningFile,
      workbench.javaScriptTypeScriptIncrementalSync,
      workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
      workbench.languageServerDiagnosticsByPath,
      workbench.languageServerRuntimeStatus,
      workbench.markdownPreviewTabs,
      workbench.phpIdeReadinessVersion,
      workbench.restoredEditorViewStateRevision,
      workbench.workspaceIdentityDescriptor,
      workbench.workspaceRoot,
      workbench.workspaceSettings,
    ],
  );
  const inactiveContentRevision = useMemo(
    () =>
      createRevisionToken(
        actions,
        breakpointActions,
        frameworkIntelligenceProviders,
        restoredEditorViewStates,
        restoredEditorViewStatesByGroup,
        workbench.appSettings,
        workbench.debugSession.breakpoints,
        workbench.debugSession.inlineValueContext,
        workbench.debugStoppedLocation,
        workbench.gitDiffDocuments,
        workbench.gitOperationLoading,
        workbench.isOpeningFile,
        workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
        workbench.languageServerDiagnosticsByPath,
        workbench.languageServerRuntimeStatus,
        workbench.markdownPreviewTabs,
        workbench.phpIdeReadinessVersion,
        workbench.restoredEditorViewStateRevision,
        workbench.workspaceIdentityDescriptor,
        workbench.workspaceRoot,
        workbench.workspaceSettings,
      ),
    [
      actions,
      breakpointActions,
      frameworkIntelligenceProviders,
      restoredEditorViewStates,
      restoredEditorViewStatesByGroup,
      workbench.appSettings,
      workbench.debugSession.breakpoints,
      workbench.debugSession.inlineValueContext,
      workbench.debugStoppedLocation,
      workbench.gitDiffDocuments,
      workbench.gitOperationLoading,
      workbench.isOpeningFile,
      workbench.javaScriptTypeScriptLanguageServerRuntimeStatus,
      workbench.languageServerDiagnosticsByPath,
      workbench.languageServerRuntimeStatus,
      workbench.markdownPreviewTabs,
      workbench.phpIdeReadinessVersion,
      workbench.restoredEditorViewStateRevision,
      workbench.workspaceIdentityDescriptor,
      workbench.workspaceRoot,
      workbench.workspaceSettings,
    ],
  );
  const activeContentRevision = useMemo(
    () =>
      createRevisionToken(
        activeEditorConfig,
        inactiveContentRevision,
        workbench.editorRevealTarget,
        workbench.isActiveDocumentGitBlameEnabled,
        workbench.isActiveDocumentJsTest,
        workbench.isActiveDocumentPhpTest,
      ),
    [
      activeEditorConfig,
      inactiveContentRevision,
      workbench.editorRevealTarget,
      workbench.isActiveDocumentGitBlameEnabled,
      workbench.isActiveDocumentJsTest,
      workbench.isActiveDocumentPhpTest,
    ],
  );

  return useMemo(
    () => ({
      ...actions,
      ...data,
      activeContentRevision,
      breakpointActions,
      inactiveContentRevision,
    }),
    [actions, activeContentRevision, breakpointActions, data, inactiveContentRevision],
  );
}

export function useStableJsTestEditorSurfaceSource(
  source: JsTestEditorSurfaceSource,
): JsTestEditorSurfaceSource {
  return useMemo(
    () => ({
      coverageReport: source.coverageReport,
      currentFileIdentity: source.currentFileIdentity,
      problemSnapshot: source.problemSnapshot,
    }),
    [source.coverageReport, source.currentFileIdentity, source.problemSnapshot],
  );
}

export function useStableLatestCallback<Callback extends AnyCallback>(
  callback: Callback,
): Callback {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useMemo(
    () =>
      ((...args: Parameters<Callback>) =>
        Reflect.apply(callbackRef.current, undefined, args)) as Callback,
    [],
  );
}

export function useEditorGroupContentRevisionPresenter({
  activeBookmarkedLineNumbers,
  activeChangeHunks,
  activeContentReadyPaths,
  activeGroupId,
  activeHostRevision,
  gitHistoryDocuments,
  inactiveHostRevision,
  jsTestSource,
  monacoTheme,
  navigationHistoryPaths,
  openDocumentPaths,
  phpCoverageProjection,
  transientWidgetDismissKey,
  workspaceTrusted,
}: {
  activeBookmarkedLineNumbers: readonly number[];
  activeChangeHunks: readonly unknown[];
  activeContentReadyPaths: ReadonlySet<string>;
  activeGroupId: EditorGroupId;
  activeHostRevision: unknown;
  gitHistoryDocuments: unknown;
  inactiveHostRevision: unknown;
  jsTestSource: unknown;
  monacoTheme: unknown;
  navigationHistoryPaths: readonly string[];
  openDocumentPaths: readonly string[];
  phpCoverageProjection: unknown;
  transientWidgetDismissKey: string;
  workspaceTrusted: boolean;
}): (groupId: EditorGroupId) => unknown {
  const inactiveRevision = useMemo(
    () =>
      createRevisionToken(
        gitHistoryDocuments,
        inactiveHostRevision,
        monacoTheme,
        navigationHistoryPaths,
        openDocumentPaths,
        transientWidgetDismissKey,
        workspaceTrusted,
      ),
    [
      gitHistoryDocuments,
      inactiveHostRevision,
      monacoTheme,
      navigationHistoryPaths,
      openDocumentPaths,
      transientWidgetDismissKey,
      workspaceTrusted,
    ],
  );
  const activeRevision = useMemo(
    () =>
      createRevisionToken(
        activeBookmarkedLineNumbers,
        activeChangeHunks,
        activeContentReadyPaths,
        activeHostRevision,
        inactiveRevision,
        jsTestSource,
        phpCoverageProjection,
      ),
    [
      activeBookmarkedLineNumbers,
      activeChangeHunks,
      activeContentReadyPaths,
      activeHostRevision,
      inactiveRevision,
      jsTestSource,
      phpCoverageProjection,
    ],
  );
  return useMemo(
    () => (groupId: EditorGroupId) =>
      groupId === activeGroupId ? activeRevision : inactiveRevision,
    [activeGroupId, activeRevision, inactiveRevision],
  );
}

type EditorHostProps = ComponentProps<typeof WorkbenchEditorHost>;
type EditorHostWiring = Pick<
  EditorHostProps,
  | "activeGroupId"
  | "contentRevisionForGroup"
  | "documents"
  | "editorSessionOwnerKey"
  | "fileStatusesByPath"
  | "liveDocumentRuntime"
  | "onActiveLiveDocumentBindingChange"
  | "onGroupFocusRunnerChange"
  | "renderContent"
  | "state"
>;

export function workbenchEditorHostProps({
  editorHost,
  ...wiring
}: EditorHostWiring & {
  editorHost: WorkbenchEditorHostPresenter;
}): EditorHostProps {
  return {
    ...wiring,
    attachEditorGroupLiveDocument: editorHost.attachEditorGroupLiveDocument,
    javaScriptTypeScriptIncrementalSync: editorHost.javaScriptTypeScriptIncrementalSync,
    debugHover: editorHost.debugHover,
    documentSessionAuthorityRevision: editorHost.documentSessionAuthorityRevision,
    isEditorGroupDocumentSessionAuthorityCurrent:
      editorHost.isEditorGroupDocumentSessionAuthorityCurrent,
    onActiveLiveDocumentSaveBindingChange: editorHost.onActiveLiveDocumentSaveBindingChange,
    onActivateGroup: editorHost.activateEditorGroup,
    onActivateTab: editorHost.activateEditorGroupTab,
    onCloseDocument: editorHost.closeDocument,
    onCloseTab: editorHost.closeDocumentInEditorGroup,
    onMoveTab: editorHost.moveEditorGroupTab,
    onPinTab: editorHost.pinEditorGroupTab,
    onReorderTab: editorHost.reorderEditorGroupTab,
    onResizeSplit: editorHost.resizeEditorSplit,
    onSetActivePath: editorHost.setActivePath,
    projectId: editorHost.workspaceRoot ?? "no-workspace",
    resolveEditorGroupDocumentSessionAuthority:
      editorHost.resolveEditorGroupDocumentSessionAuthority,
  };
}

function createStableMethodAdapter<
  Target extends object,
  const Keys extends readonly FunctionPropertyName<Target>[],
>(targetRef: RefObject<Target>, keys: Keys): Pick<Target, Keys[number]> {
  const adapter = {} as Pick<Target, Keys[number]>;
  for (const key of keys) {
    Object.defineProperty(adapter, key, {
      enumerable: true,
      value: (...args: unknown[]) => {
        const method = targetRef.current[key] as unknown as (...values: unknown[]) => unknown;
        return method(...args);
      },
    });
  }
  return Object.freeze(adapter);
}

export type WorkbenchEditorHostPresenter = ReturnType<typeof useWorkbenchEditorHostPresenter>;

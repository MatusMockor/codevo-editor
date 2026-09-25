import { useMemo } from "react";
import type {
  EditorCursorAuthority,
  EditorCursorStorePort,
} from "../../application/editorCursorStore";
import type { EditorOwnerDirtyCountProjection } from "../../application/editorSessionDirtyProjection";
import { useEditorOwnerDirtyCountSnapshot } from "../../application/useEditorSessionDirtyProjection";
import { presentOptionalNodeRunWithoutDebugging } from "../../application/nodeRunWithoutDebuggingPresentation";
import type { useWorkbenchController } from "../../application/useWorkbenchController";
import { detectKeymapPlatform, shortcutForCommand } from "../../domain/keymap";
import { shortcutSequenceForPlatform } from "../../domain/shortcutSequence";
import type { LargeSmartDocumentStatus } from "../../domain/largeDocumentPolicy";
import {
  useEditorStatusPresentation,
  type EditorStatusWorkbench,
} from "../useEditorStatusPresentation";
import type { EditorChrome, EditorChromeShortcuts } from "./EditorChromeContext";
import { useEditorChromeValue, type EditorChromeActions } from "./useEditorChromeValue";

type Workbench = ReturnType<typeof useWorkbenchController>;

export type EditorChromeWorkbench = EditorStatusWorkbench &
  Pick<
    Workbench,
    | "activeDocument"
    | "agentWorkbench"
    | "appSettings"
    | "bottomPanelView"
    | "bottomPanelVisible"
    | "diagnosticsSummary"
    | "dirtyCount"
    | "documentSessionAuthorityRevision"
    | "gitBranch"
    | "gitBranchRepositoryLabel"
    | "gitStatus"
    | "hideBottomPanel"
    | "intelligenceMode"
    | "nodeRunWithoutDebugging"
    | "openGitBranchPanel"
    | "runCommand"
    | "showBottomPanelView"
    | "workspaceRoot"
    | "workspaceSettings"
    | "workspaceTrust"
  >;

export interface WorkbenchEditorChromeOptions {
  readonly activeGroupId: string | null;
  readonly largeDocumentStatus: LargeSmartDocumentStatus | null;
  readonly cursorStore: EditorCursorStorePort | null;
  readonly cursorAuthority: EditorCursorAuthority | null;
  readonly debugToolbarVisible: boolean;
  showGoToLine(): void;
  markActiveFileReveal(): void;
}

const FIND_SHORTCUT = "Cmd+F";

export function useWorkbenchEditorChrome(
  workbench: EditorChromeWorkbench,
  options: WorkbenchEditorChromeOptions,
): EditorChrome {
  const keymap = workbench.appSettings.keymap;
  const shortcuts = useMemo<EditorChromeShortcuts>(
    () => ({
      problems: shortcutForCommand(keymap, "panel.showProblems"),
      find: shortcutSequenceForPlatform(FIND_SHORTCUT, detectKeymapPlatform()),
      split: shortcutForCommand(keymap, "editor.splitRight"),
      debugStart: shortcutForCommand(keymap, "debug.start"),
      runWithoutDebugging: shortcutForCommand(keymap, "debug.runWithoutDebugging"),
    }),
    [keymap],
  );
  const { dispatch } = workbench.agentWorkbench;
  const actions: EditorChromeActions = {
    showBottomPanelView: workbench.showBottomPanelView,
    hideBottomPanel: workbench.hideBottomPanel,
    maximizePanel: () => dispatch({ kind: "maximizeRightPanel" }),
    showGoToLine: options.showGoToLine,
    stopNodeRun: workbench.nodeRunWithoutDebugging.stop,
    runCommand: (id) => void workbench.runCommand(id),
    toggleIdeMode: () => void workbench.runCommand("smart.toggle"),
    trustWorkspace: () => void workbench.runCommand("workspace.trust"),
    revealInFiles: () => {
      dispatch({ kind: "openSurface", surface: "files" });
      options.markActiveFileReveal();
    },
    openBranches: workbench.openGitBranchPanel,
  };
  const nodeRunState = workbench.nodeRunWithoutDebugging.state;
  const nodeRun = useMemo(
    () => presentOptionalNodeRunWithoutDebugging(nodeRunState),
    [nodeRunState],
  );
  const workspaceRoot = workbench.workspaceRoot;
  const workspaceTrusted = workbench.workspaceTrust?.trusted === true;
  const activeLanguage = workbench.activeDocument?.language ?? null;
  const status = useEditorStatusPresentation(workbench, activeLanguage);
  const dirtyCount = useLiveDirtyCount(
    workbench.dirtyCount,
    workbench.documentSessionAuthorityRevision.ownerDirtyCountProjection,
  );
  return useEditorChromeValue({
    activeGroupId: options.activeGroupId,
    diagnostics: workbench.diagnosticsSummary,
    panelView: workbench.bottomPanelView,
    panelVisible: workbench.bottomPanelVisible,
    statusBar: workbench.workspaceSettings.statusBar,
    status,
    activeLanguage,
    gitBranch: workbench.gitBranch ?? workbench.gitStatus?.branch ?? null,
    branchRepositoryLabel: workbench.gitBranchRepositoryLabel ?? null,
    intelligenceMode: workbench.intelligenceMode,
    largeDocumentStatus: options.largeDocumentStatus,
    dirtyCount,
    workspaceTrustLabel: workspaceTrustLabel(workspaceRoot, workspaceTrusted),
    workspaceRoot,
    workspaceTrusted,
    nodeRun,
    debugToolbarVisible: options.debugToolbarVisible,
    cursorStore: options.cursorStore,
    cursorAuthority: options.cursorAuthority,
    shortcuts,
    actions,
  });
}

function useLiveDirtyCount(
  legacyDirtyCount: number,
  projection: EditorOwnerDirtyCountProjection | null,
): number {
  const snapshot = useEditorOwnerDirtyCountSnapshot(projection);
  if (snapshot.status !== "available") return legacyDirtyCount;
  return Math.max(legacyDirtyCount, snapshot.dirtyCount);
}

function workspaceTrustLabel(workspaceRoot: string | null, trusted: boolean): string | null {
  if (workspaceRoot === null) return null;
  return trusted ? "Trusted" : "Untrusted";
}

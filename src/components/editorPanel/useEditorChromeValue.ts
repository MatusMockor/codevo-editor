import { useMemo, useRef } from "react";
import type {
  EditorCursorAuthority,
  EditorCursorStorePort,
} from "../../application/editorCursorStore";
import type { NodeRunStatusPresentation } from "../../application/nodeRunWithoutDebuggingPresentation";
import type { WorkbenchBottomPanelView } from "../../domain/artisanRoutes";
import { workbenchPanelPlacement } from "../../domain/editorDrawer";
import type { LargeSmartDocumentStatus } from "../../domain/largeDocumentPolicy";
import type { StatusBarItemVisibility } from "../../domain/settings";
import type { IntelligenceMode } from "../../domain/workspace";
import type { EditorStatusPresentation } from "../useEditorStatusPresentation";
import type {
  EditorChrome,
  EditorChromeActivity,
  EditorChromeShortcuts,
  EditorDebugEntry,
  EditorStatusRow,
} from "./EditorChromeContext";
import { editorStatusRows, type EditorStatusRowsInput } from "./editorStatusRows";

export interface EditorChromeActions {
  showBottomPanelView(view: WorkbenchBottomPanelView): void;
  hideBottomPanel(): void;
  maximizePanel(): void;
  showGoToLine(): void;
  stopNodeRun(): void;
  runCommand(id: string): void;
  toggleIdeMode(): void;
  trustWorkspace(): void;
  revealInFiles(): void;
  openBranches(): void;
}

export interface EditorChromeInput {
  readonly activeGroupId: string | null;
  readonly diagnostics: { readonly errors: number; readonly warnings: number };
  readonly panelView: WorkbenchBottomPanelView;
  readonly panelVisible: boolean;
  readonly statusBar: StatusBarItemVisibility;
  readonly status: EditorStatusPresentation;
  readonly activeLanguage: string | null;
  readonly gitBranch: string | null;
  readonly branchRepositoryLabel: string | null;
  readonly intelligenceMode: IntelligenceMode;
  readonly largeDocumentStatus: LargeSmartDocumentStatus | null;
  readonly dirtyCount: number;
  readonly workspaceTrustLabel: string | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly nodeRun: NodeRunStatusPresentation | null;
  readonly debugToolbarVisible: boolean;
  readonly cursorStore: EditorCursorStorePort | null;
  readonly cursorAuthority: EditorCursorAuthority | null;
  readonly shortcuts: EditorChromeShortcuts;
  readonly actions: EditorChromeActions;
}

type EditorDebugCommandEntry = Exclude<EditorDebugEntry, "showViews">;

const DEBUG_COMMANDS: Readonly<Record<EditorDebugCommandEntry, string>> = {
  start: "debug.start",
  runWithoutDebugging: "debug.runWithoutDebugging",
  launchConfigurations: "debug.configureNodeLaunchConfigurations",
  attach: "debug.attachNode",
};

export function useEditorChromeValue(input: EditorChromeInput): EditorChrome {
  const actionsRef = useRef(input.actions);
  actionsRef.current = input.actions;
  const problemsOpen =
    workbenchPanelPlacement(input.panelView, input.panelVisible).drawer === "problems";
  const activity = useStableActivity(input.status, input.statusBar);
  const statusRows = useStableStatusRows({
    activeLanguage: input.activeLanguage,
    workspaceLabel: input.status.workspaceLabel,
    gitBranch: input.gitBranch,
    branchRepositoryLabel: input.branchRepositoryLabel,
    workspaceTrustLabel: input.workspaceTrustLabel,
    intelligenceMode: input.intelligenceMode,
    largeDocumentStatus: input.largeDocumentStatus,
    dirtyCount: input.dirtyCount,
  });
  const shortcuts = useStableShortcuts(input.shortcuts);
  const { errors, warnings } = input.diagnostics;
  const {
    activeGroupId,
    cursorAuthority,
    cursorStore,
    debugToolbarVisible,
    intelligenceMode,
    nodeRun,
    workspaceRoot,
    workspaceTrusted,
  } = input;
  const cursorVisible = input.statusBar.cursorPosition;
  return useMemo<EditorChrome>(
    () => ({
      activeGroupId,
      diagnostics: { errors, warnings },
      problemsOpen,
      cursorVisible,
      cursorStore,
      cursorAuthority,
      activity,
      nodeRun,
      debugToolbarVisible,
      statusRows,
      ideModeOn: intelligenceMode === "fullSmart",
      trustNeeded: workspaceRoot !== null && !workspaceTrusted,
      shortcuts,
      toggleProblems: () => {
        if (problemsOpen) {
          actionsRef.current.hideBottomPanel();
          return;
        }
        actionsRef.current.showBottomPanelView("problems");
      },
      showGoToLine: () => actionsRef.current.showGoToLine(),
      openRuntimeView: () => actionsRef.current.showBottomPanelView("runtime"),
      stopNodeRun: () => actionsRef.current.stopNodeRun(),
      splitRight: () => actionsRef.current.runCommand("editor.splitRight"),
      splitDown: () => actionsRef.current.runCommand("editor.splitDown"),
      toggleIdeMode: () => actionsRef.current.toggleIdeMode(),
      trustWorkspace: () => actionsRef.current.trustWorkspace(),
      revealInFiles: () => actionsRef.current.revealInFiles(),
      openBranches: () => actionsRef.current.openBranches(),
      runDebugEntry: (entry) => runDebugEntry(actionsRef.current, entry),
    }),
    [
      activeGroupId,
      activity,
      cursorAuthority,
      cursorStore,
      cursorVisible,
      debugToolbarVisible,
      errors,
      intelligenceMode,
      nodeRun,
      problemsOpen,
      shortcuts,
      statusRows,
      warnings,
      workspaceRoot,
      workspaceTrusted,
    ],
  );
}

function useStableActivity(
  status: EditorStatusPresentation,
  statusBar: StatusBarItemVisibility,
): EditorChromeActivity | null {
  const summary = status.ideActivitySummary;
  const visible = summary !== null && (statusBar.index || statusBar.languageServer);
  const kind = visible ? summary.kind : null;
  const text = summary?.text ?? "";
  const reason = summary?.kind === "problem" ? summary.reason : null;
  const title = [text, reason, status.ideActivityDetail]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  return useMemo(() => (kind === null ? null : { kind, text, title }), [kind, text, title]);
}

function useStableShortcuts(shortcuts: EditorChromeShortcuts): EditorChromeShortcuts {
  const { debugStart, find, problems, runWithoutDebugging, split } = shortcuts;
  return useMemo(
    () => ({ debugStart, find, problems, runWithoutDebugging, split }),
    [debugStart, find, problems, runWithoutDebugging, split],
  );
}

function useStableStatusRows(rowsInput: EditorStatusRowsInput): ReadonlyArray<EditorStatusRow> {
  const {
    activeLanguage,
    branchRepositoryLabel,
    dirtyCount,
    gitBranch,
    intelligenceMode,
    largeDocumentStatus,
    workspaceLabel,
    workspaceTrustLabel,
  } = rowsInput;
  const largeFileLabel = largeDocumentStatus?.label ?? null;
  return useMemo(
    () =>
      editorStatusRows({
        activeLanguage,
        branchRepositoryLabel,
        dirtyCount,
        gitBranch,
        intelligenceMode,
        largeDocumentStatus: largeFileLabel === null ? null : { label: largeFileLabel, title: "" },
        workspaceLabel,
        workspaceTrustLabel,
      }),
    [
      activeLanguage,
      branchRepositoryLabel,
      dirtyCount,
      gitBranch,
      intelligenceMode,
      largeFileLabel,
      workspaceLabel,
      workspaceTrustLabel,
    ],
  );
}

function runDebugEntry(actions: EditorChromeActions, entry: EditorDebugEntry): void {
  if (entry === "showViews") {
    actions.showBottomPanelView("debug");
    actions.maximizePanel();
    return;
  }
  actions.runCommand(DEBUG_COMMANDS[entry]);
}

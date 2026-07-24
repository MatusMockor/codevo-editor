import { useCallback, useRef, useState } from "react";
import type {
  EditorSurfaceBufferFixRunner,
  EditorSurfacePhpstanIgnoreRunner,
} from "./useWorkbenchCodeQualityDiagnostics";
import type { EditorSurfaceEslintDisableRunner } from "./workbenchEslintDisableCommand";
import type { EditorMenuCommandRunner } from "../domain/editorMenuCommand";
import type { EditorSurfaceCommandRunner } from "../domain/editorSurfaceCommand";
import type { DebugWatchAtCursorCaptureReader } from "../domain/debugWatchAtCursorCapture";
import type { DebugEvaluateInConsoleCaptureReader } from "../domain/debugEvaluateInConsoleCapture";
import type { DebugBreakpointNavigationCaptureReader } from "../domain/debugBreakpointNavigationCapture";
import type { DebugInlineBreakpointCaptureReader } from "../domain/debugInlineBreakpointCapture";
import { MAX_DEBUG_INLINE_BREAKPOINT_FOCUS_EPOCH } from "../domain/debugInlineBreakpointCapture";

export interface EditorSurfaceRunners {
  bufferFix: EditorSurfaceBufferFixRunner | null;
  command: EditorSurfaceCommandRunner | null;
  debugWatchAtCursorCapture: DebugWatchAtCursorCaptureReader | null;
  debugEvaluateInConsoleCapture: DebugEvaluateInConsoleCaptureReader | null;
  debugBreakpointNavigationCapture: DebugBreakpointNavigationCaptureReader | null;
  debugInlineBreakpointCapture: DebugInlineBreakpointCaptureReader | null;
  eslintDisable: EditorSurfaceEslintDisableRunner | null;
  menu: EditorMenuCommandRunner | null;
  phpstanIgnore: EditorSurfacePhpstanIgnoreRunner | null;
}

const emptyRunners = (): EditorSurfaceRunners => ({
  bufferFix: null,
  command: null,
  debugWatchAtCursorCapture: null,
  debugEvaluateInConsoleCapture: null,
  debugBreakpointNavigationCapture: null,
  debugInlineBreakpointCapture: null,
  eslintDisable: null,
  menu: null,
  phpstanIgnore: null,
});

export function nextDebugInlineBreakpointFocusEpoch(current: number): number | null {
  if (
    !Number.isSafeInteger(current) ||
    current < 1 ||
    current >= MAX_DEBUG_INLINE_BREAKPOINT_FOCUS_EPOCH
  ) {
    return null;
  }
  return current + 1;
}

export function useScopedEditorSurfaceRunners(
  initialGroupId: string,
  initialDebugInlineBreakpointFocusEpoch = 1,
) {
  const runnersByGroupRef = useRef<Record<string, EditorSurfaceRunners>>({});
  const activeGroupIdRef = useRef(initialGroupId);
  const focusEpochRef = useRef(initialDebugInlineBreakpointFocusEpoch);
  const focusEpochExhaustedRef = useRef(
    !Number.isSafeInteger(initialDebugInlineBreakpointFocusEpoch) ||
      initialDebugInlineBreakpointFocusEpoch < 1 ||
      initialDebugInlineBreakpointFocusEpoch > MAX_DEBUG_INLINE_BREAKPOINT_FOCUS_EPOCH,
  );
  const [activeRunners, setActiveRunners] = useState<EditorSurfaceRunners>(emptyRunners);

  const runnersForActiveFocus = useCallback((runners: EditorSurfaceRunners) => {
    const reader = runners.debugInlineBreakpointCapture;
    if (!reader) return runners;
    if (focusEpochExhaustedRef.current) {
      return { ...runners, debugInlineBreakpointCapture: null };
    }
    const focusEpoch = focusEpochRef.current;
    return {
      ...runners,
      debugInlineBreakpointCapture: {
        readDebugInlineBreakpointCapture: () => {
          const capture = reader.readDebugInlineBreakpointCapture();
          if (!capture || focusEpochRef.current !== focusEpoch) return null;
          return Object.freeze({ ...capture, focusEpoch });
        },
      },
    };
  }, []);

  const advanceFocusEpoch = useCallback(() => {
    if (focusEpochExhaustedRef.current) return false;
    const next = nextDebugInlineBreakpointFocusEpoch(focusEpochRef.current);
    if (next === null) {
      focusEpochExhaustedRef.current = true;
      return false;
    }
    focusEpochRef.current = next;
    return true;
  }, []);

  const publishActiveGroup = useCallback(
    (groupId: string) => {
      const runners = runnersByGroupRef.current[groupId] ?? emptyRunners();
      setActiveRunners(runnersForActiveFocus(runners));
    },
    [runnersForActiveFocus],
  );

  const updateRunner = useCallback(
    <Key extends keyof EditorSurfaceRunners>(
      groupId: string,
      key: Key,
      runner: EditorSurfaceRunners[Key],
    ) => {
      const current = runnersByGroupRef.current[groupId] ?? emptyRunners();
      if (current[key] === runner) {
        return;
      }
      const next = { ...current, [key]: runner };
      runnersByGroupRef.current[groupId] = next;
      if (activeGroupIdRef.current !== groupId) {
        return;
      }
      if (key === "debugInlineBreakpointCapture" && !advanceFocusEpoch()) {
        setActiveRunners({ ...next, debugInlineBreakpointCapture: null });
        return;
      }
      setActiveRunners(runnersForActiveFocus(next));
    },
    [advanceFocusEpoch, runnersForActiveFocus],
  );

  const activateGroup = useCallback(
    (groupId: string) => {
      if (activeGroupIdRef.current === groupId) {
        return;
      }
      if (!advanceFocusEpoch()) {
        setActiveRunners(emptyRunners());
        return;
      }
      activeGroupIdRef.current = groupId;
      publishActiveGroup(groupId);
    },
    [advanceFocusEpoch, publishActiveGroup],
  );

  const focusGroup = useCallback(
    (groupId: string) => {
      if (!advanceFocusEpoch()) {
        setActiveRunners(emptyRunners());
        return;
      }
      activeGroupIdRef.current = groupId;
      publishActiveGroup(groupId);
    },
    [advanceFocusEpoch, publishActiveGroup],
  );

  const updateBufferFix = useCallback(
    (groupId: string, runner: EditorSurfaceBufferFixRunner | null) =>
      updateRunner(groupId, "bufferFix", runner),
    [updateRunner],
  );
  const updateCommand = useCallback(
    (groupId: string, runner: EditorSurfaceCommandRunner | null) =>
      updateRunner(groupId, "command", runner),
    [updateRunner],
  );
  const updateDebugWatchAtCursorCapture = useCallback(
    (groupId: string, reader: DebugWatchAtCursorCaptureReader | null) =>
      updateRunner(groupId, "debugWatchAtCursorCapture", reader),
    [updateRunner],
  );
  const updateDebugEvaluateInConsoleCapture = useCallback(
    (groupId: string, reader: DebugEvaluateInConsoleCaptureReader | null) =>
      updateRunner(groupId, "debugEvaluateInConsoleCapture", reader),
    [updateRunner],
  );
  const updateDebugBreakpointNavigationCapture = useCallback(
    (groupId: string, reader: DebugBreakpointNavigationCaptureReader | null) =>
      updateRunner(groupId, "debugBreakpointNavigationCapture", reader),
    [updateRunner],
  );
  const updateDebugInlineBreakpointCapture = useCallback(
    (groupId: string, reader: DebugInlineBreakpointCaptureReader | null) =>
      updateRunner(groupId, "debugInlineBreakpointCapture", reader),
    [updateRunner],
  );
  const updateEslintDisable = useCallback(
    (groupId: string, runner: EditorSurfaceEslintDisableRunner | null) =>
      updateRunner(groupId, "eslintDisable", runner),
    [updateRunner],
  );
  const updateMenu = useCallback(
    (groupId: string, runner: EditorMenuCommandRunner | null) =>
      updateRunner(groupId, "menu", runner),
    [updateRunner],
  );
  const updatePhpstanIgnore = useCallback(
    (groupId: string, runner: EditorSurfacePhpstanIgnoreRunner | null) =>
      updateRunner(groupId, "phpstanIgnore", runner),
    [updateRunner],
  );

  return {
    activateGroup,
    focusGroup,
    activeRunners,
    updateBufferFix,
    updateCommand,
    updateDebugWatchAtCursorCapture,
    updateDebugEvaluateInConsoleCapture,
    updateDebugBreakpointNavigationCapture,
    updateDebugInlineBreakpointCapture,
    updateEslintDisable,
    updateMenu,
    updatePhpstanIgnore,
  };
}

import { memo, useCallback, useMemo } from "react";
import type {
  EditorSurfaceBufferFixRunner,
  EditorSurfacePhpstanIgnoreRunner,
} from "../application/useWorkbenchCodeQualityDiagnostics";
import type { EditorSurfaceEslintDisableRunner } from "../application/workbenchEslintDisableCommand";
import type { EditorGroup, EditorGroupId } from "../domain/editorGroups";
import { editorGroupVisiblePaths } from "../domain/editorGroups";
import type { EditorMenuCommandRunner } from "../domain/editorMenuCommand";
import type { EditorSurfaceCommandRunner } from "../domain/editorSurfaceCommand";
import type { DebugWatchAtCursorCaptureReader } from "../domain/debugWatchAtCursorCapture";
import type { DebugEvaluateInConsoleCaptureReader } from "../domain/debugEvaluateInConsoleCapture";
import type { DebugBreakpointNavigationCaptureReader } from "../domain/debugBreakpointNavigationCapture";
import type { DebugInlineBreakpointCaptureReader } from "../domain/debugInlineBreakpointCapture";
import { EditorSurface, type EditorSurfaceProps } from "./EditorSurface";

type RunnerProps =
  | "onEditorMenuCommandRunnerChange"
  | "onEditorSurfaceBufferFixRunnerChange"
  | "onEditorSurfaceCommandRunnerChange"
  | "onDebugWatchAtCursorCaptureReaderChange"
  | "onDebugEvaluateInConsoleCaptureReaderChange"
  | "onDebugBreakpointNavigationCaptureReaderChange"
  | "onDebugInlineBreakpointCaptureReaderChange"
  | "onEditorSurfaceEslintDisableRunnerChange"
  | "onEditorSurfacePhpstanIgnoreRunnerChange"
  | "runtimeMembership";

interface ScopedEditorSurfaceProps extends Omit<EditorSurfaceProps, RunnerProps> {
  group: EditorGroup | undefined;
  groupId: EditorGroupId;
  onBufferFixRunnerChange(
    groupId: EditorGroupId,
    runner: EditorSurfaceBufferFixRunner | null,
  ): void;
  onCommandRunnerChange(groupId: EditorGroupId, runner: EditorSurfaceCommandRunner | null): void;
  onDebugWatchAtCursorCaptureReaderChange(
    groupId: EditorGroupId,
    reader: DebugWatchAtCursorCaptureReader | null,
  ): void;
  onDebugEvaluateInConsoleCaptureReaderChange(
    groupId: EditorGroupId,
    reader: DebugEvaluateInConsoleCaptureReader | null,
  ): void;
  onDebugBreakpointNavigationCaptureReaderChange(
    groupId: EditorGroupId,
    reader: DebugBreakpointNavigationCaptureReader | null,
  ): void;
  onDebugInlineBreakpointCaptureReaderChange(
    groupId: EditorGroupId,
    reader: DebugInlineBreakpointCaptureReader | null,
  ): void;
  onEslintDisableRunnerChange(
    groupId: EditorGroupId,
    runner: EditorSurfaceEslintDisableRunner | null,
  ): void;
  onMenuCommandRunnerChange(groupId: EditorGroupId, runner: EditorMenuCommandRunner | null): void;
  onPhpstanIgnoreRunnerChange(
    groupId: EditorGroupId,
    runner: EditorSurfacePhpstanIgnoreRunner | null,
  ): void;
}

export const ScopedEditorSurface = memo(function ScopedEditorSurface({
  group,
  groupId,
  onBufferFixRunnerChange,
  onCommandRunnerChange,
  onDebugWatchAtCursorCaptureReaderChange,
  onDebugEvaluateInConsoleCaptureReaderChange,
  onDebugBreakpointNavigationCaptureReaderChange,
  onDebugInlineBreakpointCaptureReaderChange,
  onEslintDisableRunnerChange,
  onMenuCommandRunnerChange,
  onPhpstanIgnoreRunnerChange,
  ...props
}: ScopedEditorSurfaceProps) {
  const runtimeMembership = useMemo(
    () => ({
      groupId,
      retainPaths: group ? editorGroupVisiblePaths(group) : [],
    }),
    [group, groupId],
  );
  const updateBufferFixRunner = useCallback(
    (runner: EditorSurfaceBufferFixRunner | null) => onBufferFixRunnerChange(groupId, runner),
    [groupId, onBufferFixRunnerChange],
  );
  const updateCommandRunner = useCallback(
    (runner: EditorSurfaceCommandRunner | null) => onCommandRunnerChange(groupId, runner),
    [groupId, onCommandRunnerChange],
  );
  const updateDebugWatchAtCursorCaptureReader = useCallback(
    (reader: DebugWatchAtCursorCaptureReader | null) =>
      onDebugWatchAtCursorCaptureReaderChange(groupId, reader),
    [groupId, onDebugWatchAtCursorCaptureReaderChange],
  );
  const updateDebugEvaluateInConsoleCaptureReader = useCallback(
    (reader: DebugEvaluateInConsoleCaptureReader | null) =>
      onDebugEvaluateInConsoleCaptureReaderChange(groupId, reader),
    [groupId, onDebugEvaluateInConsoleCaptureReaderChange],
  );
  const updateDebugBreakpointNavigationCaptureReader = useCallback(
    (reader: DebugBreakpointNavigationCaptureReader | null) =>
      onDebugBreakpointNavigationCaptureReaderChange(groupId, reader),
    [groupId, onDebugBreakpointNavigationCaptureReaderChange],
  );
  const updateDebugInlineBreakpointCaptureReader = useCallback(
    (reader: DebugInlineBreakpointCaptureReader | null) =>
      onDebugInlineBreakpointCaptureReaderChange(groupId, reader),
    [groupId, onDebugInlineBreakpointCaptureReaderChange],
  );
  const updateEslintDisableRunner = useCallback(
    (runner: EditorSurfaceEslintDisableRunner | null) =>
      onEslintDisableRunnerChange(groupId, runner),
    [groupId, onEslintDisableRunnerChange],
  );
  const updateMenuCommandRunner = useCallback(
    (runner: EditorMenuCommandRunner | null) => onMenuCommandRunnerChange(groupId, runner),
    [groupId, onMenuCommandRunnerChange],
  );
  const updatePhpstanIgnoreRunner = useCallback(
    (runner: EditorSurfacePhpstanIgnoreRunner | null) =>
      onPhpstanIgnoreRunnerChange(groupId, runner),
    [groupId, onPhpstanIgnoreRunnerChange],
  );

  return (
    <EditorSurface
      {...props}
      onEditorMenuCommandRunnerChange={updateMenuCommandRunner}
      onEditorSurfaceBufferFixRunnerChange={updateBufferFixRunner}
      onEditorSurfaceCommandRunnerChange={updateCommandRunner}
      onDebugWatchAtCursorCaptureReaderChange={updateDebugWatchAtCursorCaptureReader}
      onDebugEvaluateInConsoleCaptureReaderChange={updateDebugEvaluateInConsoleCaptureReader}
      onDebugBreakpointNavigationCaptureReaderChange={updateDebugBreakpointNavigationCaptureReader}
      onDebugInlineBreakpointCaptureReaderChange={updateDebugInlineBreakpointCaptureReader}
      onEditorSurfaceEslintDisableRunnerChange={updateEslintDisableRunner}
      onEditorSurfacePhpstanIgnoreRunnerChange={updatePhpstanIgnoreRunner}
      runtimeMembership={runtimeMembership}
    />
  );
});

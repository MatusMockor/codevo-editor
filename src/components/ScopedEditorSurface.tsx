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
import type { EditorCursorCaptureReader } from "../domain/editorCursorCapture";
import { EditorSurface, type EditorSurfaceProps } from "./EditorSurface";

type RunnerProps =
  | "onEditorMenuCommandRunnerChange"
  | "onEditorSurfaceBufferFixRunnerChange"
  | "onEditorSurfaceCommandRunnerChange"
  | "onEditorCursorCaptureReaderChange"
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
  onCursorCaptureReaderChange(
    groupId: EditorGroupId,
    reader: EditorCursorCaptureReader | null,
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
  onCursorCaptureReaderChange,
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
  const updateCursorCaptureReader = useCallback(
    (reader: EditorCursorCaptureReader | null) => onCursorCaptureReaderChange(groupId, reader),
    [groupId, onCursorCaptureReaderChange],
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
      onEditorCursorCaptureReaderChange={updateCursorCaptureReader}
      onEditorSurfaceEslintDisableRunnerChange={updateEslintDisableRunner}
      onEditorSurfacePhpstanIgnoreRunnerChange={updatePhpstanIgnoreRunner}
      runtimeMembership={runtimeMembership}
    />
  );
});

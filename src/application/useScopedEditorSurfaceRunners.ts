import { useCallback, useRef, useState } from "react";
import type {
  EditorSurfaceBufferFixRunner,
  EditorSurfacePhpstanIgnoreRunner,
} from "./useWorkbenchCodeQualityDiagnostics";
import type { EditorSurfaceEslintDisableRunner } from "./workbenchEslintDisableCommand";
import type { EditorMenuCommandRunner } from "../domain/editorMenuCommand";
import type { EditorSurfaceCommandRunner } from "../domain/editorSurfaceCommand";

export interface EditorSurfaceRunners {
  bufferFix: EditorSurfaceBufferFixRunner | null;
  command: EditorSurfaceCommandRunner | null;
  eslintDisable: EditorSurfaceEslintDisableRunner | null;
  menu: EditorMenuCommandRunner | null;
  phpstanIgnore: EditorSurfacePhpstanIgnoreRunner | null;
}

const emptyRunners = (): EditorSurfaceRunners => ({
  bufferFix: null,
  command: null,
  eslintDisable: null,
  menu: null,
  phpstanIgnore: null,
});

export function useScopedEditorSurfaceRunners(initialGroupId: string) {
  const runnersByGroupRef = useRef<Record<string, EditorSurfaceRunners>>({});
  const activeGroupIdRef = useRef(initialGroupId);
  const [activeRunners, setActiveRunners] = useState<EditorSurfaceRunners>(
    emptyRunners,
  );

  const updateRunner = useCallback(<Key extends keyof EditorSurfaceRunners>(
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
    setActiveRunners(next);
  }, []);

  const activateGroup = useCallback((groupId: string) => {
    if (activeGroupIdRef.current === groupId) {
      return;
    }
    activeGroupIdRef.current = groupId;
    setActiveRunners(runnersByGroupRef.current[groupId] ?? emptyRunners());
  }, []);

  const updateBufferFix = useCallback((
    groupId: string,
    runner: EditorSurfaceBufferFixRunner | null,
  ) => updateRunner(groupId, "bufferFix", runner), [updateRunner]);
  const updateCommand = useCallback((
    groupId: string,
    runner: EditorSurfaceCommandRunner | null,
  ) => updateRunner(groupId, "command", runner), [updateRunner]);
  const updateEslintDisable = useCallback((
    groupId: string,
    runner: EditorSurfaceEslintDisableRunner | null,
  ) => updateRunner(groupId, "eslintDisable", runner), [updateRunner]);
  const updateMenu = useCallback((
    groupId: string,
    runner: EditorMenuCommandRunner | null,
  ) => updateRunner(groupId, "menu", runner), [updateRunner]);
  const updatePhpstanIgnore = useCallback((
    groupId: string,
    runner: EditorSurfacePhpstanIgnoreRunner | null,
  ) => updateRunner(groupId, "phpstanIgnore", runner), [updateRunner]);

  return {
    activateGroup,
    activeRunners,
    updateBufferFix,
    updateCommand,
    updateEslintDisable,
    updateMenu,
    updatePhpstanIgnore,
  };
}

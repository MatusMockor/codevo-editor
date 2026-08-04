import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { BottomPanelView } from "../domain/bottomPanel";
import type { EditorGroupId, EditorGroupsState } from "../domain/editorGroups";
import type {
  WorkspaceSessionState,
  WorkspaceSessionViewState,
  WorkspaceSettings,
} from "../domain/settings";
import type { EditorDocument } from "../domain/workspace";
import type { EditorSurfaceSnapshot } from "../domain/workspaceSessionSnapshot";
import {
  currentWorkspaceSessionForEditorGroups,
  workspaceSessionsEqual,
} from "./documentSessionState";
import type { SidebarView } from "./useWorkbenchController";
import {
  isActivationOnlyWorkspaceSessionChange,
  mergeActivationOnlyWorkspaceSession,
} from "./workspaceSessionActivationChange";
import type { WorkspaceSettingsSaveCoordinator } from "./workspaceSettingsSaveCoordinator";

interface NavigationSessionPersistenceDependencies {
  bottomPanelView: BottomPanelView;
  editorSessionOwnerKeyForRoot: (rootPath: string) => string;
  persistWorkspaceSettings: (rootPath: string, nextSettings: WorkspaceSettings) => Promise<void>;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
  sidebarView: SidebarView;
  snapshotEditorSurface: (rootPath: string) => EditorSurfaceSnapshot;
  snapshotPersistedWorkspaceSession: (
    rootPath: string,
    session: WorkspaceSessionState,
    previousSession: WorkspaceSessionState,
  ) => WorkspaceSessionState | null;
  workspaceEditorViewStatesRef: MutableRefObject<
    Record<string, Record<EditorGroupId, Record<string, WorkspaceSessionViewState>>>
  >;
  workspaceSessionRestoredRef: MutableRefObject<boolean>;
  workspaceSettingsRef: MutableRefObject<WorkspaceSettings>;
  workspaceSettingsSaveCoordinator: WorkspaceSettingsSaveCoordinator;
}

interface NavigationSessionChangeDependencies extends Omit<
  NavigationSessionPersistenceDependencies,
  "snapshotEditorSurface"
> {
  documents: Record<string, EditorDocument>;
  editorGroups: EditorGroupsState;
  workspaceRoot: string | null;
}

export function usePersistCurrentWorkspaceSession({
  bottomPanelView,
  editorSessionOwnerKeyForRoot,
  persistWorkspaceSettings,
  reportErrorForActiveWorkspaceRoot,
  sidebarView,
  snapshotEditorSurface,
  snapshotPersistedWorkspaceSession,
  workspaceEditorViewStatesRef,
  workspaceSessionRestoredRef,
  workspaceSettingsRef,
  workspaceSettingsSaveCoordinator,
}: NavigationSessionPersistenceDependencies): (rootPath: string) => Promise<void> {
  return useCallback(
    async (rootPath: string) => {
      if (workspaceSettingsSaveCoordinator.hasScheduledNavigationSave(rootPath)) {
        await workspaceSettingsSaveCoordinator.flushNavigationSave(rootPath);
      }

      if (!workspaceSessionRestoredRef.current) {
        return;
      }

      const editorSurface = snapshotEditorSurface(rootPath);
      if (!editorSurface.editorGroups) {
        return;
      }

      const session = snapshotPersistedWorkspaceSession(
        rootPath,
        currentWorkspaceSessionForEditorGroups(
          rootPath,
          editorSurface.editorGroups,
          sidebarView,
          bottomPanelView,
          workspaceEditorViewStatesRef.current[editorSessionOwnerKeyForRoot(rootPath)] ?? {},
          new Set(Object.keys(editorSurface.documents)),
        ),
        workspaceSettingsRef.current.session,
      );

      if (!session) {
        return;
      }

      if (workspaceSessionsEqual(workspaceSettingsRef.current.session, session)) {
        workspaceSettingsSaveCoordinator.scheduleNavigationSave(rootPath, async () => {
          try {
            await persistWorkspaceSettings(rootPath, {
              ...workspaceSettingsRef.current,
              session: {
                ...workspaceSettingsRef.current.session,
                navigation: session.navigation,
              },
            });
          } catch (error) {
            reportErrorForActiveWorkspaceRoot(rootPath, "Session", error);
          }
        });
        await workspaceSettingsSaveCoordinator.flushNavigationSave(rootPath);
        return;
      }

      await persistWorkspaceSettings(rootPath, {
        ...workspaceSettingsRef.current,
        session,
      });
    },
    [
      bottomPanelView,
      editorSessionOwnerKeyForRoot,
      persistWorkspaceSettings,
      reportErrorForActiveWorkspaceRoot,
      sidebarView,
      snapshotPersistedWorkspaceSession,
      snapshotEditorSurface,
      workspaceEditorViewStatesRef,
      workspaceSessionRestoredRef,
      workspaceSettingsRef,
      workspaceSettingsSaveCoordinator,
    ],
  );
}

export function usePersistWorkspaceNavigationSession({
  bottomPanelView,
  documents,
  editorGroups,
  editorSessionOwnerKeyForRoot,
  persistWorkspaceSettings,
  reportErrorForActiveWorkspaceRoot,
  sidebarView,
  snapshotPersistedWorkspaceSession,
  workspaceEditorViewStatesRef,
  workspaceRoot,
  workspaceSessionRestoredRef,
  workspaceSettingsRef,
  workspaceSettingsSaveCoordinator,
}: NavigationSessionChangeDependencies): void {
  const navigationSaveGenerationByRootRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    if (!workspaceSessionRestoredRef.current) {
      return;
    }

    const session = snapshotPersistedWorkspaceSession(
      workspaceRoot,
      currentWorkspaceSessionForEditorGroups(
        workspaceRoot,
        editorGroups,
        sidebarView,
        bottomPanelView,
        workspaceEditorViewStatesRef.current[editorSessionOwnerKeyForRoot(workspaceRoot)] ?? {},
        new Set(Object.keys(documents)),
      ),
      workspaceSettingsRef.current.session,
    );

    if (!session) {
      return;
    }

    const requestedRoot = workspaceRoot;
    const navigationSaveGeneration =
      (navigationSaveGenerationByRootRef.current.get(requestedRoot) ?? 0) + 1;
    navigationSaveGenerationByRootRef.current.set(requestedRoot, navigationSaveGeneration);
    const isCurrentNavigationSave = () =>
      navigationSaveGenerationByRootRef.current.get(requestedRoot) === navigationSaveGeneration;
    const committedSession = workspaceSettingsRef.current.session;
    const isDeferrableSessionChange =
      workspaceSessionsEqual(committedSession, session) ||
      isActivationOnlyWorkspaceSessionChange(committedSession, session);

    if (!isDeferrableSessionChange) {
      workspaceSettingsSaveCoordinator.cancelNavigationSave(requestedRoot);
      void persistWorkspaceSettings(requestedRoot, {
        ...workspaceSettingsRef.current,
        session,
      }).catch((error) => reportErrorForActiveWorkspaceRoot(requestedRoot, "Session", error));
      return;
    }

    const scheduledSettings = workspaceSettingsRef.current;

    workspaceSettingsSaveCoordinator.scheduleNavigationSave(requestedRoot, async () => {
      try {
        let pendingSettingsSave = workspaceSettingsSaveCoordinator.waitForIdle(requestedRoot);
        while (pendingSettingsSave) {
          await pendingSettingsSave;
          if (!isCurrentNavigationSave()) {
            return;
          }
          pendingSettingsSave = workspaceSettingsSaveCoordinator.waitForIdle(requestedRoot);
        }

        if (!isCurrentNavigationSave()) {
          return;
        }

        const latestSettingsForRequestedRoot =
          workspaceSettingsSaveCoordinator.committed(requestedRoot) ?? scheduledSettings;
        if (
          !isActivationOnlyWorkspaceSessionChange(
            latestSettingsForRequestedRoot.session,
            session,
          ) &&
          !workspaceSessionsEqual(latestSettingsForRequestedRoot.session, session)
        ) {
          return;
        }

        if (!isCurrentNavigationSave()) {
          return;
        }
        await persistWorkspaceSettings(requestedRoot, {
          ...latestSettingsForRequestedRoot,
          session: mergeActivationOnlyWorkspaceSession(
            latestSettingsForRequestedRoot.session,
            session,
          ),
        });
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Session", error);
      }
    });
  }, [
    bottomPanelView,
    editorSessionOwnerKeyForRoot,
    documents,
    editorGroups,
    persistWorkspaceSettings,
    reportErrorForActiveWorkspaceRoot,
    sidebarView,
    snapshotPersistedWorkspaceSession,
    workspaceEditorViewStatesRef,
    workspaceSessionRestoredRef,
    workspaceSettingsRef,
    workspaceSettingsSaveCoordinator,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    const requestedRoot = workspaceRoot;
    const navigationSaveGenerationByRoot = navigationSaveGenerationByRootRef.current;
    const cleanupGeneration = navigationSaveGenerationByRoot.get(requestedRoot);

    return () => {
      void workspaceSettingsSaveCoordinator
        .flushNavigationSave(requestedRoot)
        .catch((error) => reportErrorForActiveWorkspaceRoot(requestedRoot, "Session", error))
        .finally(() => {
          if (navigationSaveGenerationByRoot.get(requestedRoot) === cleanupGeneration) {
            navigationSaveGenerationByRoot.delete(requestedRoot);
          }
        });
    };
  }, [reportErrorForActiveWorkspaceRoot, workspaceRoot, workspaceSettingsSaveCoordinator]);
}

export function useFlushWorkspaceNavigationSessionOnBlur(
  persistCurrentWorkspaceSession: (rootPath: string) => Promise<void>,
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void,
  workspaceRoot: string | null,
): void {
  useEffect(() => {
    const flushSessionOnBlur = () => {
      if (!workspaceRoot) {
        return;
      }

      void persistCurrentWorkspaceSession(workspaceRoot).catch((error) =>
        reportErrorForActiveWorkspaceRoot(workspaceRoot, "Session", error),
      );
    };

    window.addEventListener("blur", flushSessionOnBlur);
    return () => window.removeEventListener("blur", flushSessionOnBlur);
  }, [persistCurrentWorkspaceSession, reportErrorForActiveWorkspaceRoot, workspaceRoot]);
}

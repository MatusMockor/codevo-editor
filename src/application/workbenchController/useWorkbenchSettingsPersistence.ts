import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  defaultEditorFontSize,
  normalizeEditorFontSize,
  type AppSettings,
  type SettingsGateway,
  type WorkspaceSettings,
} from "../../domain/settings";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import type { WorkspaceSettingsByRootSnapshot } from "../workspaceSettingsForRoot";
import type { WorkspaceSettingsSaveCoordinator } from "../workspaceSettingsSaveCoordinator";
import { workspaceSettingsIdentity } from "./workspaceIdentityPolicy";

interface UseWorkbenchSettingsPersistenceOptions {
  readonly appSettingsRef: MutableRefObject<AppSettings>;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setAppSettings: Dispatch<SetStateAction<AppSettings>>;
  readonly setWorkspaceSettings: Dispatch<SetStateAction<WorkspaceSettings>>;
  readonly settingsGateway: SettingsGateway;
  readonly workspaceIdentityByRootRef: MutableRefObject<
    Record<string, WorkspaceIdentityDescriptor>
  >;
  readonly workspaceSettingsByRoot: WorkspaceSettingsByRootSnapshot;
  readonly workspaceSettingsRef: MutableRefObject<WorkspaceSettings>;
  readonly workspaceSettingsSaveCoordinator: WorkspaceSettingsSaveCoordinator;
}

export function useWorkbenchSettingsPersistence({
  appSettingsRef,
  currentWorkspaceRootRef,
  reportError,
  setAppSettings,
  setWorkspaceSettings,
  settingsGateway,
  workspaceIdentityByRootRef,
  workspaceSettingsByRoot,
  workspaceSettingsRef,
  workspaceSettingsSaveCoordinator,
}: UseWorkbenchSettingsPersistenceOptions) {
  const applyAppSettings = useCallback(
    (settings: AppSettings) => {
      appSettingsRef.current = settings;
      setAppSettings(settings);
    },
    [appSettingsRef, setAppSettings],
  );

  const applyWorkspaceSettings = useCallback(
    (settings: WorkspaceSettings) => {
      workspaceSettingsRef.current = settings;
      setWorkspaceSettings(settings);
    },
    [setWorkspaceSettings, workspaceSettingsRef],
  );

  const persistAppSettings = useCallback(
    async (nextSettings: AppSettings) => {
      const previousSettings = appSettingsRef.current;
      applyAppSettings(nextSettings);

      try {
        await settingsGateway.saveAppSettings(nextSettings);
      } catch (error) {
        applyAppSettings(previousSettings);
        throw error;
      }
    },
    [appSettingsRef, applyAppSettings, settingsGateway],
  );

  const setEditorFontSize = useCallback(
    (nextFontSize: number) => {
      const currentSettings = appSettingsRef.current;
      const editorFontSize = normalizeEditorFontSize(nextFontSize);

      if (editorFontSize === currentSettings.editorFontSize) {
        return;
      }

      void persistAppSettings({
        ...currentSettings,
        editorFontSize,
      }).catch((error) => reportError("Settings", error));
    },
    [appSettingsRef, persistAppSettings, reportError],
  );

  const zoomEditorFontIn = useCallback(() => {
    setEditorFontSize(appSettingsRef.current.editorFontSize + 1);
  }, [appSettingsRef, setEditorFontSize]);

  const zoomEditorFontOut = useCallback(() => {
    setEditorFontSize(appSettingsRef.current.editorFontSize - 1);
  }, [appSettingsRef, setEditorFontSize]);

  const resetEditorFontSize = useCallback(() => {
    setEditorFontSize(defaultEditorFontSize);
  }, [setEditorFontSize]);

  const toggleEditorFontLigatures = useCallback(() => {
    const currentSettings = appSettingsRef.current;

    void persistAppSettings({
      ...currentSettings,
      editorFontLigatures: !currentSettings.editorFontLigatures,
    }).catch((error) => reportError("Settings", error));
  }, [appSettingsRef, persistAppSettings, reportError]);

  const persistWorkspaceSettings = useCallback(
    async (rootPath: string, nextSettings: WorkspaceSettings) => {
      const identityDescriptor = workspaceIdentityByRootRef.current[rootPath];
      const canonicalKey = identityDescriptor?.canonicalRoot ?? rootPath;
      const settingsIdentity = identityDescriptor
        ? workspaceSettingsIdentity(canonicalKey, identityDescriptor.selectedPath)
        : rootPath;
      const isRootActive = () => workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath);
      const previousSettings =
        workspaceSettingsByRoot.resolve(canonicalKey) ??
        (isRootActive() ? workspaceSettingsRef.current : null);

      const saveRevision = workspaceSettingsByRoot.capture(canonicalKey, nextSettings);

      if (isRootActive()) {
        applyWorkspaceSettings(nextSettings);
      }

      try {
        await workspaceSettingsSaveCoordinator.save(
          canonicalKey,
          previousSettings,
          nextSettings,
          () => settingsGateway.saveWorkspaceSettings(settingsIdentity, nextSettings),
        );
      } catch (error) {
        if (workspaceSettingsByRoot.revision(canonicalKey) !== saveRevision) {
          throw error;
        }

        const committedSettings = workspaceSettingsSaveCoordinator.committed(canonicalKey);
        if (committedSettings) {
          workspaceSettingsByRoot.capture(canonicalKey, committedSettings);
        } else {
          workspaceSettingsByRoot.forget(canonicalKey);
        }
        if (isRootActive() && committedSettings) {
          applyWorkspaceSettings(committedSettings);
        }

        throw error;
      }
    },
    [
      applyWorkspaceSettings,
      currentWorkspaceRootRef,
      settingsGateway,
      workspaceIdentityByRootRef,
      workspaceSettingsByRoot,
      workspaceSettingsRef,
      workspaceSettingsSaveCoordinator,
    ],
  );

  return {
    applyAppSettings,
    applyWorkspaceSettings,
    persistAppSettings,
    persistWorkspaceSettings,
    resetEditorFontSize,
    toggleEditorFontLigatures,
    zoomEditorFontIn,
    zoomEditorFontOut,
  };
}

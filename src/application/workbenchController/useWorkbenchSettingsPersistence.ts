import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
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
import { appSettingsSaveCoordinatorFor } from "../appSettingsSaveCoordinator";
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
  const appSettingsSaveCoordinator = appSettingsSaveCoordinatorFor(settingsGateway);
  const appSettingsSaveCoordinatorRef = useRef(appSettingsSaveCoordinator);
  if (appSettingsSaveCoordinatorRef.current !== appSettingsSaveCoordinator) {
    const previousCommitted = appSettingsSaveCoordinatorRef.current.committedSnapshot();
    if (previousCommitted) {
      appSettingsSaveCoordinator.initializeCommittedSnapshot(previousCommitted);
    }
  }
  appSettingsSaveCoordinatorRef.current = appSettingsSaveCoordinator;
  const applyAppSettings = useCallback(
    (settings: AppSettings) => {
      appSettingsSaveCoordinatorRef.current.initializeCommittedSnapshot(settings);
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
      appSettingsSaveCoordinatorRef.current.initializeCommittedSnapshot(previousSettings);
      applyAppSettings(nextSettings);

      const coordinator = appSettingsSaveCoordinatorRef.current;
      const save = coordinator.save(previousSettings, (committed) =>
        mergeAppSettingsIntent(committed, previousSettings, nextSettings),
      );
      return save.then(
        () => undefined,
        (error: unknown) => {
          applyAppSettings(
            rollbackAppSettingsIntent(
              appSettingsRef.current,
              coordinator.committedSnapshot() ?? previousSettings,
              previousSettings,
              nextSettings,
            ),
          );
          throw error;
        },
      );
    },
    [appSettingsRef, applyAppSettings],
  );

  const persistAppUpdaterSkippedVersion = useCallback(
    (version: string) =>
      persistAppSettings({
        ...appSettingsRef.current,
        appUpdaterSkippedVersion: version,
      }),
    [appSettingsRef, persistAppSettings],
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
    persistAppUpdaterSkippedVersion,
    persistWorkspaceSettings,
    resetEditorFontSize,
    toggleEditorFontLigatures,
    zoomEditorFontIn,
    zoomEditorFontOut,
  };
}

function mergeAppSettingsIntent(
  committed: AppSettings,
  previous: AppSettings,
  next: AppSettings,
): AppSettings {
  const merged = { ...committed };
  for (const key of Object.keys(next) as ReadonlyArray<keyof AppSettings>) {
    if (Object.is(previous[key], next[key])) continue;
    Reflect.set(merged, key, next[key]);
  }
  return merged;
}

function rollbackAppSettingsIntent(
  current: AppSettings,
  committed: AppSettings,
  previous: AppSettings,
  attempted: AppSettings,
): AppSettings {
  const rolledBack = { ...current };
  for (const key of Object.keys(attempted) as ReadonlyArray<keyof AppSettings>) {
    if (Object.is(previous[key], attempted[key]) || !Object.is(current[key], attempted[key])) {
      continue;
    }
    Reflect.set(rolledBack, key, committed[key]);
  }
  return rolledBack;
}

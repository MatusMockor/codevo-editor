import type { WorkspaceSettings } from "../domain/settings";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

interface WorkspaceSettingsSaveState {
  committedSettings: WorkspaceSettings | null;
  pendingSaves: number;
  tail: Promise<void>;
}

export interface WorkspaceSettingsSaveCoordinator {
  captureCommitted(rootPath: string, settings: WorkspaceSettings): void;
  committed(rootPath: string): WorkspaceSettings | null;
  save(
    rootPath: string,
    initialCommittedSettings: WorkspaceSettings | null,
    nextSettings: WorkspaceSettings,
    persist: () => Promise<void>,
  ): Promise<void>;
  waitForIdle(rootPath: string): Promise<void> | null;
}

export function createWorkspaceSettingsSaveCoordinator(): WorkspaceSettingsSaveCoordinator {
  const stateByRoot = new Map<string, WorkspaceSettingsSaveState>();

  const stateForRoot = (
    rootPath: string,
    initialCommittedSettings: WorkspaceSettings | null,
  ): WorkspaceSettingsSaveState | null => {
    const rootKey = normalizedWorkspaceRootKey(rootPath);
    if (!rootKey) {
      return null;
    }

    const existing = stateByRoot.get(rootKey);
    if (existing) {
      return existing;
    }

    const created: WorkspaceSettingsSaveState = {
      committedSettings: initialCommittedSettings,
      pendingSaves: 0,
      tail: Promise.resolve(),
    };
    stateByRoot.set(rootKey, created);
    return created;
  };

  return {
    captureCommitted(rootPath, settings) {
      const state = stateForRoot(rootPath, settings);
      if (!state) {
        return;
      }
      state.committedSettings = settings;
    },
    committed(rootPath) {
      return stateForRoot(rootPath, null)?.committedSettings ?? null;
    },
    save(rootPath, initialCommittedSettings, nextSettings, persist) {
      const state = stateForRoot(rootPath, initialCommittedSettings);
      if (!state) {
        return Promise.reject(new Error("Workspace root is required."));
      }

      const previousTail = state.tail;
      state.pendingSaves += 1;
      const operation = previousTail.then(async () => {
        await persist();
        state.committedSettings = nextSettings;
      });
      state.tail = operation.then(
        () => {
          state.pendingSaves -= 1;
        },
        () => {
          state.pendingSaves -= 1;
        },
      );
      return operation;
    },
    waitForIdle(rootPath) {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      if (!rootKey) {
        return null;
      }
      const state = stateByRoot.get(rootKey);
      if (!state || state.pendingSaves === 0) {
        return null;
      }
      return state.tail;
    },
  };
}

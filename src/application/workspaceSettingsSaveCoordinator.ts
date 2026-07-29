import type { WorkspaceSettings } from "../domain/settings";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

interface WorkspaceSettingsSaveState {
  committedSettings: WorkspaceSettings | null;
  pendingSaves: number;
  tail: Promise<void>;
}

interface ScheduledNavigationSave {
  activeTasks: number;
  running: Promise<void>;
  task: (() => Promise<void>) | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export const WORKSPACE_SETTINGS_NAVIGATION_SAVE_DEBOUNCE_MS = 250;

export interface WorkspaceSettingsSaveCoordinator {
  captureCommitted(rootPath: string, settings: WorkspaceSettings): void;
  committed(rootPath: string): WorkspaceSettings | null;
  save(
    rootPath: string,
    initialCommittedSettings: WorkspaceSettings | null,
    nextSettings: WorkspaceSettings,
    persist: () => Promise<void>,
  ): Promise<void>;
  cancelNavigationSave(rootPath: string): boolean;
  hasScheduledNavigationSave(rootPath: string): boolean;
  scheduleNavigationSave(rootPath: string, task: () => Promise<void>): void;
  flushNavigationSave(rootPath: string): Promise<boolean>;
  waitForIdle(rootPath: string): Promise<void> | null;
}

export function createWorkspaceSettingsSaveCoordinator(): WorkspaceSettingsSaveCoordinator {
  const stateByRoot = new Map<string, WorkspaceSettingsSaveState>();
  const navigationSaveByRoot = new Map<string, ScheduledNavigationSave>();

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

  const scheduledNavigationSaveForRoot = (rootPath: string): ScheduledNavigationSave | null => {
    const rootKey = normalizedWorkspaceRootKey(rootPath);
    if (!rootKey) {
      return null;
    }

    const existing = navigationSaveByRoot.get(rootKey);
    if (existing) {
      return existing;
    }

    const created: ScheduledNavigationSave = {
      activeTasks: 0,
      running: Promise.resolve(),
      task: null,
      timer: null,
    };
    navigationSaveByRoot.set(rootKey, created);
    return created;
  };

  const removeIdleNavigationSave = (
    rootPath: string,
    scheduled: ScheduledNavigationSave,
  ): void => {
    if (scheduled.activeTasks > 0 || scheduled.task || scheduled.timer) {
      return;
    }

    const rootKey = normalizedWorkspaceRootKey(rootPath);
    if (!rootKey) {
      return;
    }

    if (navigationSaveByRoot.get(rootKey) !== scheduled) {
      return;
    }

    navigationSaveByRoot.delete(rootKey);
  };

  const flushNavigationSave = async (rootPath: string): Promise<boolean> => {
    const rootKey = normalizedWorkspaceRootKey(rootPath);
    if (!rootKey) {
      return false;
    }

    const scheduled = navigationSaveByRoot.get(rootKey);
    if (!scheduled) {
      return false;
    }

    if (scheduled.timer) {
      clearTimeout(scheduled.timer);
      scheduled.timer = null;
    }

    const task = scheduled.task;
    scheduled.task = null;
    if (!task) {
      if (scheduled.activeTasks === 0) {
        return false;
      }
      await scheduled.running;
      return true;
    }

    scheduled.running = scheduled.running.then(task);
    const running = scheduled.running;
    scheduled.activeTasks += 1;
    try {
      await running;
    } finally {
      scheduled.activeTasks -= 1;
      removeIdleNavigationSave(rootPath, scheduled);
    }
    return true;
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
    cancelNavigationSave(rootPath) {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      if (!rootKey) {
        return false;
      }

      const scheduled = navigationSaveByRoot.get(rootKey);
      if (!scheduled?.task) {
        return false;
      }

      scheduled.task = null;
      if (scheduled.timer) {
        clearTimeout(scheduled.timer);
        scheduled.timer = null;
      }
      removeIdleNavigationSave(rootPath, scheduled);
      return true;
    },
    hasScheduledNavigationSave(rootPath) {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      if (!rootKey) {
        return false;
      }
      const scheduled = navigationSaveByRoot.get(rootKey);
      return Boolean(scheduled?.task || scheduled?.activeTasks);
    },
    scheduleNavigationSave(rootPath, task) {
      const scheduled = scheduledNavigationSaveForRoot(rootPath);
      if (!scheduled) {
        return;
      }

      scheduled.task = task;
      if (scheduled.timer) {
        clearTimeout(scheduled.timer);
      }
      scheduled.timer = setTimeout(() => {
        scheduled.timer = null;
        void flushNavigationSave(rootPath).catch(() => undefined);
      }, WORKSPACE_SETTINGS_NAVIGATION_SAVE_DEBOUNCE_MS);
    },
    flushNavigationSave,
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

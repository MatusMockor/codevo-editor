import type { WorkspaceSettings } from "../domain/settings";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

export type WorkspaceSettingsForRoot = (
  rootPath: string,
) => WorkspaceSettings | null;

export interface WorkspaceSettingsByRootSnapshot {
  capture(rootPath: string | null, settings: WorkspaceSettings): number;
  captureIfRevision(
    rootPath: string | null,
    expectedRevision: number,
    settings: WorkspaceSettings,
  ): boolean;
  forget(rootPath: string | null): number;
  revision(rootPath: string | null): number;
  resolve: WorkspaceSettingsForRoot;
}

export function createWorkspaceSettingsByRootSnapshot(): WorkspaceSettingsByRootSnapshot {
  const settingsByRoot = new Map<string, WorkspaceSettings>();
  const revisionsByRoot = new Map<string, number>();

  const nextRevision = (rootKey: string): number => {
    const revision = (revisionsByRoot.get(rootKey) ?? 0) + 1;
    revisionsByRoot.set(rootKey, revision);
    return revision;
  };

  return {
    capture(rootPath, settings) {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      if (!rootKey) {
        return 0;
      }
      settingsByRoot.set(rootKey, settings);
      return nextRevision(rootKey);
    },
    captureIfRevision(rootPath, expectedRevision, settings) {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      if (!rootKey) {
        return false;
      }
      if ((revisionsByRoot.get(rootKey) ?? 0) !== expectedRevision) {
        return false;
      }

      settingsByRoot.set(rootKey, settings);
      nextRevision(rootKey);
      return true;
    },
    forget(rootPath) {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      if (!rootKey) {
        return 0;
      }
      settingsByRoot.delete(rootKey);
      return nextRevision(rootKey);
    },
    revision(rootPath) {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      if (!rootKey) {
        return 0;
      }
      return revisionsByRoot.get(rootKey) ?? 0;
    },
    resolve(rootPath) {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      if (!rootKey) {
        return null;
      }
      return settingsByRoot.get(rootKey) ?? null;
    },
  };
}

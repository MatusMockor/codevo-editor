import type { MutableRefObject } from "react";
import {
  defaultWorkspaceSettings,
  type SettingsGateway,
  type WorkspaceSettings,
  type WorkspaceSettingsIdentity,
} from "../../domain/settings";
import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";
import { workspaceSettingsIdentity } from "../workspace/workspaceIdentityPolicy";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import type { WorkspaceSettingsByRootSnapshot } from "../workspaceSettingsForRoot";
import type { WorkspaceSettingsSaveCoordinator } from "../workspaceSettingsSaveCoordinator";
import {
  PendingWorkspaceSettingsLoadCapacityError,
  type BoundedPendingWorkspaceSettingsLoads,
  type PendingWorkspaceSettingsLoad,
} from "../appController/boundedPendingWorkspaceSettingsLoads";

export interface AgentWorkspaceSettingsLoadPorts {
  readonly reportError: (source: string, error: unknown) => void;
  readonly settingsGateway: Pick<SettingsGateway, "loadWorkspaceSettings">;
  readonly workspaceSettingsByRoot: WorkspaceSettingsByRootSnapshot;
  readonly workspaceSettingsLoadByRootRef: MutableRefObject<BoundedPendingWorkspaceSettingsLoads>;
  readonly workspaceSettingsSaveCoordinator: WorkspaceSettingsSaveCoordinator;
}

export async function loadAgentWorkspaceSettings(
  ports: AgentWorkspaceSettingsLoadPorts,
  path: string,
  identity: WorkspaceIdentityDescriptor | null,
  isCurrent: () => boolean,
): Promise<WorkspaceSettings | null> {
  const { reportError, workspaceSettingsByRoot, workspaceSettingsSaveCoordinator } = ports;
  const canonicalKey = identity?.canonicalRoot ?? path;
  const pendingSave = workspaceSettingsSaveCoordinator.waitForIdle(canonicalKey);
  if (pendingSave) await pendingSave;
  if (!isCurrent()) return null;

  const revisionAtLoad = workspaceSettingsByRoot.revision(canonicalKey);
  let pendingLoad: PendingWorkspaceSettingsLoad | null = null;
  try {
    pendingLoad = trackWorkspaceSettingsLoad({
      identity: identity ? workspaceSettingsIdentity(canonicalKey, path) : path,
      isCurrent,
      key: normalizedWorkspaceRootKey(canonicalKey),
      load: (settingsIdentity) => ports.settingsGateway.loadWorkspaceSettings(settingsIdentity),
      loads: ports.workspaceSettingsLoadByRootRef.current,
    });
  } catch (error) {
    reportError("Settings", error);
    if (error instanceof PendingWorkspaceSettingsLoadCapacityError) return null;
  }

  let loaded = defaultWorkspaceSettings();
  try {
    if (pendingLoad) loaded = await pendingLoad.promise;
  } catch (error) {
    if (!isCurrent()) return null;
    reportError("Settings", error);
    if (error instanceof PendingWorkspaceSettingsLoadCapacityError) return null;
  }
  if (!isCurrent()) return null;

  if (workspaceSettingsByRoot.captureIfRevision(canonicalKey, revisionAtLoad, loaded)) {
    workspaceSettingsSaveCoordinator.captureCommitted(canonicalKey, loaded);
    return loaded;
  }
  return workspaceSettingsByRoot.resolve(canonicalKey) ?? loaded;
}

export type WorkspaceSettingsLoadIdentity = string | WorkspaceSettingsIdentity;

export function settingsLegacyRawKeys(identity: WorkspaceSettingsLoadIdentity): readonly string[] {
  if (typeof identity === "string") return [identity];
  return identity.legacyRawKeys ?? [];
}

export interface WorkspaceSettingsLoadRequest {
  readonly identity: WorkspaceSettingsLoadIdentity;
  readonly isCurrent: () => boolean;
  readonly key: string;
  readonly load: (identity: WorkspaceSettingsLoadIdentity) => Promise<WorkspaceSettings>;
  readonly loads: BoundedPendingWorkspaceSettingsLoads;
}

export function trackWorkspaceSettingsLoad({
  identity,
  isCurrent,
  key,
  load,
  loads,
}: WorkspaceSettingsLoadRequest): PendingWorkspaceSettingsLoad {
  const legacyRawKeys = settingsLegacyRawKeys(identity);
  const existing = loads.get(key) ?? loads.track(key, legacyRawKeys, () => load(identity));
  if (legacyRawKeys.every((legacyRawKey) => existing.legacyRawKeys.includes(legacyRawKey))) {
    return existing;
  }
  const continueWithWinningAlias = () =>
    isCurrent() ? load(identity) : Promise.resolve(defaultWorkspaceSettings());
  return loads.track(key, [...new Set([...existing.legacyRawKeys, ...legacyRawKeys])], () =>
    existing.promise.then(continueWithWinningAlias, continueWithWinningAlias),
  );
}

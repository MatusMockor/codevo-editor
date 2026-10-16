import {
  createWorkspaceSessionOwnerKey,
  createLegacyWorkspaceSessionOwnerKey,
} from "../../domain/workspaceSessionOwnerKey";
import { pushRecentWorkspacePath, type AppSettings } from "../../domain/settings";
import { recordRecentWorkspaceOpenedAt } from "../../domain/projectOnboardingSettings";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";

export function workspaceOwnerKeyFor(
  rootPath: string,
  identity: WorkspaceIdentityDescriptor | null,
): string {
  if (identity) return createWorkspaceSessionOwnerKey(identity.workspaceId, identity.canonicalRoot);
  return createLegacyWorkspaceSessionOwnerKey(rootPath);
}

export function workspaceIdentityAliasPaths(
  identities: Readonly<Record<string, WorkspaceIdentityDescriptor>>,
  descriptor: WorkspaceIdentityDescriptor,
): string[] {
  const aliases = [descriptor.selectedPath, descriptor.canonicalRoot];
  for (const [rootPath, registered] of Object.entries(identities)) {
    if (registered.workspaceId !== descriptor.workspaceId) continue;
    aliases.push(rootPath, registered.selectedPath, registered.canonicalRoot);
  }
  return [...new Set(aliases)];
}

export function workspaceTabsWithPath(
  tabs: readonly string[],
  path: string,
  identityAliasPaths: readonly string[],
): string[] {
  const isAlias = (tabPath: string) =>
    identityAliasPaths.some((aliasPath) => workspaceRootKeysEqual(aliasPath, tabPath));
  const replacedTabIndex = tabs.findIndex(isAlias);
  if (replacedTabIndex >= 0) {
    const nextTabs = tabs.filter((tabPath) => !isAlias(tabPath));
    nextTabs.splice(Math.min(replacedTabIndex, nextTabs.length), 0, path);
    return nextTabs;
  }
  if (tabs.some((tabPath) => workspaceRootKeysEqual(tabPath, path))) return [...tabs];
  return [...tabs, path];
}

export function appSettingsWithOpenedWorkspace(
  settings: AppSettings,
  path: string,
  identityAliasPaths: readonly string[],
  openedAt: number,
): AppSettings {
  const recentCandidates = (settings.recentWorkspacePaths ?? []).filter(
    (recentPath) =>
      !identityAliasPaths.some((aliasPath) => workspaceRootKeysEqual(aliasPath, recentPath)),
  );
  const recentWorkspacePaths = pushRecentWorkspacePath(recentCandidates, path);
  return {
    ...settings,
    recentWorkspacePath: recentWorkspacePaths[0] ?? null,
    recentWorkspacePaths,
    recentWorkspaceOpenedAt: recordRecentWorkspaceOpenedAt(
      settings.recentWorkspaceOpenedAt,
      recentWorkspacePaths,
      path,
      openedAt,
    ),
    workspaceTabs: workspaceTabsWithPath(settings.workspaceTabs, path, identityAliasPaths),
  };
}

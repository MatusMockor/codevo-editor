import {
  phpFrameworkConfigKeysFromSource,
  phpFrameworkConfigTargetFromSource,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import {
  phpLaravelConfigFileNameFromRelativePath,
  phpLaravelConfigKeyCandidateRelativePath,
  type PhpLaravelConfigTarget,
} from "../domain/phpLaravelConfig";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  createWorkspaceTargetCollector,
  type WorkspaceTargetCollectorDeps,
} from "./phpWorkspaceTargetCollector";
import { phpFrameworkSupportsCapability } from "./phpFrameworkCapabilityGuards";

export interface PhpLaravelConfigTargetResolverDeps {
  currentWorkspaceRootRef: { readonly current: string | null };
  workspaceRoot: string | null;
  phpFrameworkProviders: readonly PhpFrameworkProvider[];
  workspaceTargetCollectorDeps: WorkspaceTargetCollectorDeps;
  readNavigationFileContent: (path: string) => Promise<string>;
  joinWorkspacePath: (workspaceRoot: string, relativePath: string) => string;
  readCachedConfigTargets: (
    workspaceRoot: string,
  ) => PhpLaravelConfigTarget[] | null;
  writeCachedConfigTargets: (
    workspaceRoot: string,
    targets: PhpLaravelConfigTarget[],
  ) => void;
}

export interface PhpLaravelConfigTargetResolver {
  collect: () => Promise<PhpLaravelConfigTarget[]>;
  find: (configKey: string) => Promise<PhpLaravelConfigTarget | null>;
}

function isWorkspaceRootActive(
  deps: PhpLaravelConfigTargetResolverDeps,
  requestedRoot: string | null,
): boolean {
  return workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);
}

function supportsConfig(deps: PhpLaravelConfigTargetResolverDeps): boolean {
  return phpFrameworkSupportsCapability(deps.phpFrameworkProviders, "config");
}

async function collectPhpLaravelConfigTargets(
  deps: PhpLaravelConfigTargetResolverDeps,
): Promise<PhpLaravelConfigTarget[]> {
  const collect = createWorkspaceTargetCollector<PhpLaravelConfigTarget>(
    deps.workspaceTargetCollectorDeps,
    {
      kind: "directoryScan",
      isEnabled: () => supportsConfig(deps),
      roots: ["config"],
      readsContent: true,
      // A flat config scan never memoizes an unreadable `config/`; it
      // re-attempts the scan on the next call (matches the pre-extraction
      // early return before the cache write).
      rescanAfterDirectoryReadFailure: true,
      parseEntry: ({ path, relativePath, content }) => {
        const fileName = phpLaravelConfigFileNameFromRelativePath(relativePath);

        if (!fileName) {
          return [];
        }

        // The file-level target is recorded before the file is read so it
        // survives a read failure.
        const fileTarget: PhpLaravelConfigTarget = {
          key: fileName,
          path,
          position: { column: 1, lineNumber: 1 },
          relativePath,
        };

        if (content === undefined) {
          return [fileTarget];
        }

        return [
          fileTarget,
          ...phpFrameworkConfigKeysFromSource(
            content,
            fileName,
            deps.phpFrameworkProviders,
          ).map((target) => ({
            ...target,
            path,
            relativePath,
          })),
        ];
      },
      dedupKey: (target) => target.key.toLowerCase(),
      compareTargets: (left, right) => left.key.localeCompare(right.key),
      cache: {
        read: deps.readCachedConfigTargets,
        write: deps.writeCachedConfigTargets,
      },
    },
  );

  return collect({ workspaceRoot: deps.workspaceRoot });
}

async function findPhpLaravelConfigTarget(
  deps: PhpLaravelConfigTargetResolverDeps,
  configKey: string,
): Promise<PhpLaravelConfigTarget | null> {
  const requestedRoot = deps.workspaceRoot;

  if (!supportsConfig(deps) || !requestedRoot) {
    return null;
  }

  const relativePath = phpLaravelConfigKeyCandidateRelativePath(configKey);

  if (!relativePath) {
    return null;
  }

  const fileName = phpLaravelConfigFileNameFromRelativePath(relativePath);

  if (!fileName) {
    return null;
  }

  const path = deps.joinWorkspacePath(requestedRoot, relativePath);

  try {
    const content = await deps.readNavigationFileContent(path);

    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return null;
    }

    const target = phpFrameworkConfigTargetFromSource(
      content,
      fileName,
      configKey,
      deps.phpFrameworkProviders,
    );

    if (!target) {
      return null;
    }

    return {
      ...target,
      path,
      relativePath,
    };
  } catch {
    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return null;
    }

    return null;
  }
}

export function createPhpLaravelConfigTargetResolver(
  deps: PhpLaravelConfigTargetResolverDeps,
): PhpLaravelConfigTargetResolver {
  return {
    collect: () => collectPhpLaravelConfigTargets(deps),
    find: (configKey) => findPhpLaravelConfigTarget(deps, configKey),
  };
}

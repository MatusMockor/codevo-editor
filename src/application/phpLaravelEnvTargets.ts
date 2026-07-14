import {
  phpLaravelEnvTargetFromSource,
  type PhpLaravelEnvTarget,
} from "../domain/phpLaravelEnv";
import { phpFrameworkEnvEntriesFromSource } from "../domain/phpFrameworkProviders";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  createWorkspaceTargetCollector,
  type WorkspaceTargetCollectorDeps,
} from "./phpWorkspaceTargetCollector";

export interface PhpLaravelEnvTargetResolverDeps {
  workspaceRoot: string | null;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  workspaceTargetCollectorDeps: WorkspaceTargetCollectorDeps;
}

export interface PhpLaravelEnvTargetResolver {
  collect: () => Promise<PhpLaravelEnvTarget[]>;
  find: (envName: string) => Promise<PhpLaravelEnvTarget | null>;
}

function supportsEnv(deps: PhpLaravelEnvTargetResolverDeps): boolean {
  return (
    deps.frameworkRuntime.hasProvider("laravel") &&
    deps.frameworkRuntime.supports("env")
  );
}

async function collectPhpLaravelEnvTargets(
  deps: PhpLaravelEnvTargetResolverDeps,
): Promise<PhpLaravelEnvTarget[]> {
  const collect = createWorkspaceTargetCollector<PhpLaravelEnvTarget>(
    deps.workspaceTargetCollectorDeps,
    {
      kind: "knownFiles",
      isEnabled: () => supportsEnv(deps),
      relativePaths: [".env", ".env.example"],
      parseTargets: ({ content, path, relativePath }) =>
        phpFrameworkEnvEntriesFromSource(
          content,
          deps.frameworkRuntime.providers,
        ).map((entry) => ({
          ...entry,
          path,
          relativePath,
        })),
    },
  );

  return collect({ workspaceRoot: deps.workspaceRoot });
}

async function findPhpLaravelEnvTarget(
  deps: PhpLaravelEnvTargetResolverDeps,
  envName: string,
): Promise<PhpLaravelEnvTarget | null> {
  const requestedRoot = deps.workspaceRoot;
  const isRequestedRootActive = () =>
    workspaceRootKeysEqual(
      deps.workspaceTargetCollectorDeps.currentWorkspaceRootRef.current,
      requestedRoot,
    );

  if (!supportsEnv(deps) || !requestedRoot) {
    return null;
  }

  for (const relativePath of [".env", ".env.example"]) {
    if (!isRequestedRootActive()) {
      return null;
    }

    const path = deps.workspaceTargetCollectorDeps.joinWorkspacePath(
      requestedRoot,
      relativePath,
    );

    try {
      const content = await deps.workspaceTargetCollectorDeps.readFileContent(path);

      if (!isRequestedRootActive()) {
        return null;
      }

      const target = phpLaravelEnvTargetFromSource(content, envName);

      if (!target) {
        continue;
      }

      return {
        ...target,
        path,
        relativePath,
      };
    } catch {
      if (!isRequestedRootActive()) {
        return null;
      }
    }
  }

  return null;
}

export function createPhpLaravelEnvTargetResolver(
  deps: PhpLaravelEnvTargetResolverDeps,
): PhpLaravelEnvTargetResolver {
  return {
    collect: () => collectPhpLaravelEnvTargets(deps),
    find: (envName) => findPhpLaravelEnvTarget(deps, envName),
  };
}

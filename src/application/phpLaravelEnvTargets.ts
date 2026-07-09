import {
  phpFrameworkEnvEntriesFromSource,
} from "../domain/phpFrameworkProviders";
import type { PhpLaravelEnvTarget } from "../domain/phpLaravelEnv";
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
}

function supportsEnv(deps: PhpLaravelEnvTargetResolverDeps): boolean {
  return deps.frameworkRuntime.supports("env");
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

export function createPhpLaravelEnvTargetResolver(
  deps: PhpLaravelEnvTargetResolverDeps,
): PhpLaravelEnvTargetResolver {
  return {
    collect: () => collectPhpLaravelEnvTargets(deps),
  };
}

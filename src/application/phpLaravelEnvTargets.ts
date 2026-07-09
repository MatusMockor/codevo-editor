import {
  phpFrameworkEnvEntriesFromSource,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { PhpLaravelEnvTarget } from "../domain/phpLaravelEnv";
import { phpFrameworkSupportsCapability } from "./phpFrameworkCapabilityGuards";
import {
  createWorkspaceTargetCollector,
  type WorkspaceTargetCollectorDeps,
} from "./phpWorkspaceTargetCollector";

export interface PhpLaravelEnvTargetResolverDeps {
  workspaceRoot: string | null;
  phpFrameworkProviders: readonly PhpFrameworkProvider[];
  workspaceTargetCollectorDeps: WorkspaceTargetCollectorDeps;
}

export interface PhpLaravelEnvTargetResolver {
  collect: () => Promise<PhpLaravelEnvTarget[]>;
}

function supportsEnv(deps: PhpLaravelEnvTargetResolverDeps): boolean {
  return phpFrameworkSupportsCapability(deps.phpFrameworkProviders, "env");
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
          deps.phpFrameworkProviders,
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

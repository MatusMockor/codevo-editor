import { useCallback, type MutableRefObject } from "react";
import {
  phpLaravelEnvTargetFromSource,
  type PhpLaravelEnvTarget,
} from "../domain/phpLaravelEnv";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpLaravelEnvTargetResolverDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  joinWorkspacePath: (workspaceRoot: string, relativePath: string) => string;
  readNavigationFileContent: (path: string) => Promise<string>;
  workspaceRoot: string | null;
}

export type PhpLaravelEnvTargetResolver = (
  envName: string,
) => Promise<PhpLaravelEnvTarget | null>;

export function usePhpLaravelEnvTargetResolver({
  currentWorkspaceRootRef,
  frameworkRuntime,
  joinWorkspacePath,
  readNavigationFileContent,
  workspaceRoot,
}: PhpLaravelEnvTargetResolverDependencies): PhpLaravelEnvTargetResolver {
  return useCallback(
    async (envName: string): Promise<PhpLaravelEnvTarget | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!frameworkRuntime.hasProvider("laravel") || !requestedRoot) {
        return null;
      }

      for (const relativePath of [".env", ".env.example"]) {
        if (!isRequestedRootActive()) {
          return null;
        }

        const path = joinWorkspacePath(requestedRoot, relativePath);

        try {
          const content = await readNavigationFileContent(path);

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
    },
    [
      currentWorkspaceRootRef,
      frameworkRuntime,
      joinWorkspacePath,
      readNavigationFileContent,
      workspaceRoot,
    ],
  );
}

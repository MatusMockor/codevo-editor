import { useCallback, useMemo, type MutableRefObject } from "react";
import {
  phpFrameworkRouteDefinitionsFromSource,
  phpFrameworkRouteSearchQueries,
  phpFrameworkSupportsRoutes,
  type PhpFrameworkProvider,
  type PhpFrameworkRouteDefinition,
} from "../domain/phpFrameworkProviders";
import {
  phpLaravelGateAbilityDefinitions,
  type PhpLaravelGateAbilityDefinition,
} from "../domain/phpLaravelAuthorization";
import {
  phpLaravelMiddlewareAliasDefinitions,
  type PhpLaravelMiddlewareAliasDefinition,
} from "../domain/phpLaravelMiddleware";
import {
  phpLaravelEnvEntriesFromSource,
  type PhpLaravelEnvTarget,
} from "../domain/phpLaravelEnv";
import type { TextSearchGateway } from "../domain/workspace";
import {
  createWorkspaceTargetCollector,
  type WorkspaceFileTarget,
  type WorkspaceTargetCollectorDeps,
} from "./phpWorkspaceTargetCollector";

export type PhpLaravelNamedRouteTarget =
  WorkspaceFileTarget<PhpFrameworkRouteDefinition>;
export type PhpLaravelGateAbilityTarget =
  WorkspaceFileTarget<PhpLaravelGateAbilityDefinition>;
export type PhpLaravelMiddlewareAliasTarget =
  WorkspaceFileTarget<PhpLaravelMiddlewareAliasDefinition>;

/**
 * Collaborators the Laravel target collectors need from the workbench shell.
 * Every collaborator is a shared shell primitive (the file/search gateways, the
 * active-root ref/value, the path helpers, the active framework providers) - the
 * hook owns no state of its own, it only wires the shared isolation-guarded
 * target-collection engine to Laravel's parsers.
 */
export interface LaravelTargetsDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRoot: string | null;
  textSearch: Pick<TextSearchGateway, "searchText">;
  readNavigationFileContent: (path: string) => Promise<string>;
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
  joinWorkspacePath: (workspaceRoot: string, relativePath: string) => string;
  isPhpPath: (path: string) => boolean;
  activePhpFrameworkProviders: readonly PhpFrameworkProvider[];
  isLaravelFrameworkActive: boolean;
}

export interface LaravelTargets {
  collectPhpLaravelNamedRouteTargets: (
    currentSource: string,
    currentPath: string,
  ) => Promise<PhpLaravelNamedRouteTarget[]>;
  collectPhpLaravelGateAbilityTargets: (
    currentSource: string,
    currentPath: string,
  ) => Promise<PhpLaravelGateAbilityTarget[]>;
  collectPhpLaravelMiddlewareAliasTargets: (
    currentSource: string,
    currentPath: string,
  ) => Promise<PhpLaravelMiddlewareAliasTarget[]>;
  collectPhpLaravelEnvTargets: () => Promise<PhpLaravelEnvTarget[]>;
}

/**
 * Laravel workspace target collectors (named routes, gate abilities, middleware
 * aliases, `.env` entries) built on the shared, isolation-guarded
 * `createWorkspaceTargetCollector` engine. Each collector is a few lines of
 * declarative config - its parser plus its search queries (or its dotenv file
 * list) - so the copy-pasted search/read/parse/dedup/isolation skeleton lives in
 * one place. Behaviour (outputs, dedup key, sort order, `.env`-first-wins,
 * per-project isolation) is identical to the pre-extraction inline collectors.
 */
export function useLaravelTargets(
  dependencies: LaravelTargetsDependencies,
): LaravelTargets {
  const {
    currentWorkspaceRootRef,
    workspaceRoot,
    textSearch,
    readNavigationFileContent,
    relativeWorkspacePath,
    joinWorkspacePath,
    isPhpPath,
    activePhpFrameworkProviders,
    isLaravelFrameworkActive,
  } = dependencies;

  const engineDeps = useMemo<WorkspaceTargetCollectorDeps>(
    () => ({
      currentWorkspaceRootRef,
      textSearch,
      readFileContent: readNavigationFileContent,
      relativeWorkspacePath,
      joinWorkspacePath,
      isPhpPath,
    }),
    [
      currentWorkspaceRootRef,
      textSearch,
      readNavigationFileContent,
      relativeWorkspacePath,
      joinWorkspacePath,
      isPhpPath,
    ],
  );

  const collectPhpLaravelNamedRouteTargets = useCallback(
    (
      currentSource: string,
      currentPath: string,
    ): Promise<PhpLaravelNamedRouteTarget[]> => {
      const collect = createWorkspaceTargetCollector(engineDeps, {
        kind: "textSearch",
        isEnabled: () => phpFrameworkSupportsRoutes(activePhpFrameworkProviders),
        queries: () => phpFrameworkRouteSearchQueries(activePhpFrameworkProviders),
        parseDefinitions: (source) =>
          phpFrameworkRouteDefinitionsFromSource(
            source,
            activePhpFrameworkProviders,
          ),
      });

      return collect({
        workspaceRoot,
        currentDocument: { content: currentSource, path: currentPath },
      });
    },
    [engineDeps, activePhpFrameworkProviders, workspaceRoot],
  );

  const collectPhpLaravelGateAbilityTargets = useCallback(
    (
      currentSource: string,
      currentPath: string,
    ): Promise<PhpLaravelGateAbilityTarget[]> => {
      const collect = createWorkspaceTargetCollector(engineDeps, {
        kind: "textSearch",
        isEnabled: () => isLaravelFrameworkActive,
        queries: () => ["Gate::define"],
        parseDefinitions: phpLaravelGateAbilityDefinitions,
      });

      return collect({
        workspaceRoot,
        currentDocument: { content: currentSource, path: currentPath },
      });
    },
    [engineDeps, isLaravelFrameworkActive, workspaceRoot],
  );

  const collectPhpLaravelMiddlewareAliasTargets = useCallback(
    (
      currentSource: string,
      currentPath: string,
    ): Promise<PhpLaravelMiddlewareAliasTarget[]> => {
      const collect = createWorkspaceTargetCollector(engineDeps, {
        kind: "textSearch",
        isEnabled: () => isLaravelFrameworkActive,
        queries: () => ["middlewareAliases", "routeMiddleware"],
        parseDefinitions: phpLaravelMiddlewareAliasDefinitions,
      });

      return collect({
        workspaceRoot,
        currentDocument: { content: currentSource, path: currentPath },
      });
    },
    [engineDeps, isLaravelFrameworkActive, workspaceRoot],
  );

  const collectPhpLaravelEnvTargets = useCallback((): Promise<
    PhpLaravelEnvTarget[]
  > => {
    const collect = createWorkspaceTargetCollector<PhpLaravelEnvTarget>(
      engineDeps,
      {
        kind: "knownFiles",
        isEnabled: () => isLaravelFrameworkActive,
        relativePaths: [".env", ".env.example"],
        parseTargets: ({ content, path, relativePath }) =>
          phpLaravelEnvEntriesFromSource(content).map((entry) => ({
            ...entry,
            path,
            relativePath,
          })),
      },
    );

    return collect({ workspaceRoot });
  }, [engineDeps, isLaravelFrameworkActive, workspaceRoot]);

  return {
    collectPhpLaravelNamedRouteTargets,
    collectPhpLaravelGateAbilityTargets,
    collectPhpLaravelMiddlewareAliasTargets,
    collectPhpLaravelEnvTargets,
  };
}

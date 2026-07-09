import {
  phpFrameworkAuthorizationAbilityDefinitionsFromSource,
  phpFrameworkAuthorizationAbilitySearchQueries,
  phpFrameworkMiddlewareAliasDefinitionsFromSource,
  phpFrameworkMiddlewareAliasSearchQueries,
  phpFrameworkRouteDefinitionsFromSource,
  phpFrameworkRouteSearchQueries,
  type PhpFrameworkAuthorizationAbilityDefinition,
  type PhpFrameworkMiddlewareAliasDefinition,
  type PhpFrameworkRouteDefinition,
} from "../domain/phpFrameworkProviders";
import {
  createWorkspaceTargetCollector,
  type TextSearchCollectRequest,
  type WorkspaceFileTarget,
  type WorkspaceTargetCollectorDeps,
} from "./phpWorkspaceTargetCollector";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export type PhpLaravelNamedRouteTarget =
  WorkspaceFileTarget<PhpFrameworkRouteDefinition>;
export type PhpLaravelGateAbilityTarget =
  WorkspaceFileTarget<PhpFrameworkAuthorizationAbilityDefinition>;
export type PhpLaravelMiddlewareAliasTarget =
  WorkspaceFileTarget<PhpFrameworkMiddlewareAliasDefinition>;

export interface PhpLaravelTextSearchTargetCollectorDeps {
  workspaceRoot: string | null;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  workspaceTargetCollectorDeps: WorkspaceTargetCollectorDeps;
}

export interface PhpLaravelTextSearchTargetCollectors {
  collectNamedRoutes: (
    currentSource: string,
    currentPath: string,
  ) => Promise<PhpLaravelNamedRouteTarget[]>;
  collectGateAbilities: (
    currentSource: string,
    currentPath: string,
  ) => Promise<PhpLaravelGateAbilityTarget[]>;
  collectMiddlewareAliases: (
    currentSource: string,
    currentPath: string,
  ) => Promise<PhpLaravelMiddlewareAliasTarget[]>;
}

function collectWithCurrentDocument<Target>(
  deps: PhpLaravelTextSearchTargetCollectorDeps,
  collect: (request: TextSearchCollectRequest) => Promise<Target[]>,
  currentSource: string,
  currentPath: string,
): Promise<Target[]> {
  return collect({
    workspaceRoot: deps.workspaceRoot,
    currentDocument: { content: currentSource, path: currentPath },
  });
}

export function createPhpLaravelTextSearchTargetCollectors(
  deps: PhpLaravelTextSearchTargetCollectorDeps,
): PhpLaravelTextSearchTargetCollectors {
  const collectNamedRoutes =
    createWorkspaceTargetCollector(deps.workspaceTargetCollectorDeps, {
      kind: "textSearch",
      isEnabled: () => deps.frameworkRuntime.supports("routes"),
      queries: () =>
        phpFrameworkRouteSearchQueries(deps.frameworkRuntime.providers),
      parseDefinitions: (source) =>
        phpFrameworkRouteDefinitionsFromSource(
          source,
          deps.frameworkRuntime.providers,
        ),
    });

  const collectGateAbilities =
    createWorkspaceTargetCollector(deps.workspaceTargetCollectorDeps, {
      kind: "textSearch",
      isEnabled: () =>
        deps.frameworkRuntime.supports("authorizationAbilities"),
      queries: () =>
        phpFrameworkAuthorizationAbilitySearchQueries(
          deps.frameworkRuntime.providers,
        ),
      parseDefinitions: (source) =>
        phpFrameworkAuthorizationAbilityDefinitionsFromSource(
          source,
          deps.frameworkRuntime.providers,
        ),
    });

  const collectMiddlewareAliases =
    createWorkspaceTargetCollector(deps.workspaceTargetCollectorDeps, {
      kind: "textSearch",
      isEnabled: () => deps.frameworkRuntime.supports("middlewareAliases"),
      queries: () =>
        phpFrameworkMiddlewareAliasSearchQueries(
          deps.frameworkRuntime.providers,
        ),
      parseDefinitions: (source) =>
        phpFrameworkMiddlewareAliasDefinitionsFromSource(
          source,
          deps.frameworkRuntime.providers,
        ),
    });

  return {
    collectNamedRoutes: (currentSource, currentPath) =>
      collectWithCurrentDocument(
        deps,
        collectNamedRoutes,
        currentSource,
        currentPath,
      ),
    collectGateAbilities: (currentSource, currentPath) =>
      collectWithCurrentDocument(
        deps,
        collectGateAbilities,
        currentSource,
        currentPath,
      ),
    collectMiddlewareAliases: (currentSource, currentPath) =>
      collectWithCurrentDocument(
        deps,
        collectMiddlewareAliases,
        currentSource,
        currentPath,
      ),
  };
}

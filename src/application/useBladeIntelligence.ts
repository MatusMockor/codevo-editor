/**
 * Blade (Laravel) navigation + completion intelligence, extracted VERBATIM from
 * the workbench controller as a sibling strangler module (mirrors
 * `useLatteIntelligence` / `useNeonIntelligence`): the controller keeps only a
 * thin mount that injects the shared collaborators, while every Blade decision
 * lives here behind a small, injected dependency surface so the logic is
 * unit-testable WITHOUT the controller.
 *
 * Responsibilities (unchanged from the controller):
 *   - `provideBladeCompletions`: @directive names, view names, `<x-...>`
 *     component tags, `$variable` view-data / `@foreach` loop variables, typed
 *     `$var->member` completions, and `route()`/`config()`/`trans()`/`__()`
 *     helper literals.
 *   - `provideBladeCodeActions`: the "create missing view" quickfix.
 *   - `provideBladeDefinition` (Cmd+B): view / component navigation plus Laravel
 *     helper-literal and typed view-data member jumps.
 *   - the per-root view-data / component-name caches and their invalidation.
 *
 * ISOLATION (project rule): each async flow captures the requested workspace
 * root up front and re-checks the LIVE root after every await, dropping stale
 * results so nothing leaks across project tabs. The heavy PHP/Laravel resolvers,
 * target collectors and navigation primitives are injected (pass-through) so the
 * expensive engines are owned by the controller and merely wired here.
 */
import { useCallback, useMemo, useRef } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  bladeComponentNavigationCandidateRelativePaths,
  bladeViewCandidateRelativePaths,
  detectBladeReferenceAt,
  isInsideBladeComment,
} from "../domain/bladeNavigation";
import {
  bladeLaravelStringLiteralHelperAt,
} from "../domain/bladeLaravelHelperCompletions";
import type { BladeViewDataEntry } from "../domain/bladeViewVariables";
import {
  resolveLaravelConfigTarget,
  resolveLaravelTransTarget,
  resolveLaravelViewTarget,
} from "../domain/laravelPathResolution";
import { phpIdentifierContextAt } from "../domain/phpNavigation";
import { phpLaravelViewNameFromRelativePath } from "../domain/phpLaravelViews";
import { joinWorkspacePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  BladeCompletionItem,
  BladeIntelligence,
  BladeIntelligenceDependencies,
} from "./bladeIntelligenceContracts";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";
import {
  provideBladeCodeActions as provideBladeCodeActionsFromProvider,
} from "./bladeCodeActionProvider";
import {
  collectBladeComponentNames as collectBladeComponentNamesFromWorkspace,
  invalidateBladeComponentNamesForPath as invalidateBladeComponentNamesForCachePath,
} from "./bladeComponentDiscovery";
import { editorPositionAtOffset } from "./bladePhpCompletionContext";
import { createBladeViewVariableResolver } from "./bladeViewVariableResolver";
import {
  ensureBladeViewDataEntriesLoaded as loadBladeViewDataEntries,
  invalidateBladeViewDataEntriesForPath as invalidateBladeViewDataEntriesForCachePath,
} from "./bladeViewDataCache";
import {
  provideBladeCompletions as provideBladeCompletionsFromProvider,
} from "./bladeCompletionProvider";

export type {
  BladeCompletionItem,
  BladeIntelligence,
  BladeIntelligenceDependencies,
} from "./bladeIntelligenceContracts";

export function useBladeIntelligence(
  deps: BladeIntelligenceDependencies,
): BladeIntelligence {
  const {
    activeDocument,
    collectPhpLaravelConfigTargets,
    collectPhpLaravelNamedRouteTargets,
    collectPhpLaravelTranslationTargets,
    collectPhpLaravelViewTargets,
    createMissingBladeViewCodeAction,
    currentWorkspaceRootRef,
    ensurePhpLaravelMigrationSourcesLoaded,
    ensurePhpLaravelProviderSourcesLoaded,
    findPhpLaravelConfigTarget,
    findPhpLaravelTranslationTarget,
    findPhpLaravelViewTarget,
    frameworkIntelligence,
    openDirectPhpMethodTarget,
    openDirectPhpPropertyTarget,
    openNavigationTarget,
    openPhpLaravelModelAttributeTarget,
    readNavigationFileContent,
    relativeWorkspacePath,
    resolvePhpClassPropertyOrRelationType,
    resolvePhpDeclaredType,
    resolvePhpExpressionType,
    resolvePhpReceiverMethodCompletions,
    textSearch,
    workspaceFiles,
    workspaceRoot,
  } = deps;
  const activePhpFrameworkProviders = frameworkIntelligence.providers;
  const isLaravelFrameworkActive = frameworkIntelligence.isLaravel;

  // Per-root cache of controller view-data entries (`view('x', [...])`,
  // `View::make`, `->with(...)`, `compact(...)` sources) feeding Blade variable
  // and member completions. Keyed by workspace root and reset on workspace
  // switch / reindex like the migration/provider caches, and invalidated when
  // any PHP file in the root changes, so the blade completion hot path never
  // re-runs the workspace text search. The in-flight map dedupes concurrent
  // loads; a load only writes the cache while it is still the registered load
  // for its root (mid-load invalidation drops the result).
  const bladeViewDataEntriesByRootRef = useRef<
    Record<string, BladeViewDataEntry[]>
  >({});
  const bladeViewDataEntriesLoadInFlightRef = useRef<
    Map<string, Promise<BladeViewDataEntry[] | null>>
  >(new Map());
  // Per-root cache of Blade component tag names (anonymous blade views under
  // resources/views/components plus class-based components under
  // app/View/Components) fed into `<x-` completion. Keyed by workspace root,
  // reset on workspace switch / reindex and invalidated when a file under
  // either component directory changes, so names never leak across project
  // tabs and never go stale after a component is added/removed.
  const bladeComponentNamesByRootRef = useRef<Record<string, string[]>>({});

  // Loads (and caches per root) the controller sources that pass data to Blade
  // views: one workspace text search per query, each hit parsed once into its
  // view-data bindings. The hot completion path then works from the in-memory
  // entries. Per-project isolation: the requested root is captured up front and
  // re-checked after EVERY await; a stale root drops the result and never
  // writes the cache. Concurrent callers share the same in-flight promise.
  const ensureBladeViewDataEntriesLoaded = useCallback(
    async (requestedRoot: string): Promise<BladeViewDataEntry[] | null> => {
      return loadBladeViewDataEntries(requestedRoot, {
        currentWorkspaceRootRef,
        entriesByRootRef: bladeViewDataEntriesByRootRef,
        frameworkProviders: activePhpFrameworkProviders,
        loadInFlightRef: bladeViewDataEntriesLoadInFlightRef,
        readNavigationFileContent,
        textSearch,
      });
    },
    [
      activePhpFrameworkProviders,
      currentWorkspaceRootRef,
      readNavigationFileContent,
      textSearch,
    ],
  );

  // Drops the cached view-data entries for `root` when any PHP file changes
  // (controllers can live anywhere - app/, routes/, modules/ - so the
  // invalidation is deliberately broad). The next Blade completion reloads
  // lazily; deleting the in-flight entry also prevents a racing load from
  // caching pre-change sources.
  const invalidateBladeViewDataEntriesForPath = useCallback(
    (root: string, path: string): void => {
      invalidateBladeViewDataEntriesForCachePath(
        bladeViewDataEntriesByRootRef,
        bladeViewDataEntriesLoadInFlightRef,
        root,
        path,
      );
    },
    [],
  );

  const {
    collectBladeForeachLoopVariables,
    collectBladeViewVariablesWithDisplayTypes,
    resolveBladeForeachElementTypeForVariable,
    resolveBladeViewVariableTypeForView,
  } = useMemo(
    () =>
      createBladeViewVariableResolver({
        currentWorkspaceRootRef,
        ensureBladeViewDataEntriesLoaded,
        resolvePhpClassPropertyOrRelationType,
        resolvePhpDeclaredType,
        resolvePhpExpressionType,
        workspaceRoot,
      }),
    [
      currentWorkspaceRootRef,
      ensureBladeViewDataEntriesLoaded,
      resolvePhpClassPropertyOrRelationType,
      resolvePhpDeclaredType,
      resolvePhpExpressionType,
      workspaceRoot,
    ],
  );

  // Returns the workspace's Blade component tag names for `<x-` completion:
  // anonymous blade views under resources/views/components (dotted names
  // without the `.blade.php` / `/index.blade.php` suffix) merged with
  // class-based components under app/View/Components (PascalCase segments
  // kebab-cased, Laravel convention). The scan result is cached per workspace
  // root (see bladeComponentNamesByRootRef) so the completion hot path stays
  // off the file system; the walk re-checks the active workspace after each
  // readDirectory await and before the cache write, so a tab switch drops
  // in-flight results (per-project isolation).
  const collectBladeComponentNames = useCallback(async (): Promise<string[]> => {
    return collectBladeComponentNamesFromWorkspace({
      cacheRef: bladeComponentNamesByRootRef,
      currentWorkspaceRootRef,
      relativeWorkspacePath,
      workspaceFiles,
      workspaceRoot,
    });
  }, [
    currentWorkspaceRootRef,
    relativeWorkspacePath,
    workspaceFiles,
    workspaceRoot,
  ]);

  // Drops the cached component names for `root` when a file under either Blade
  // component directory changes so the next `<x-` completion re-scans. Mirrors
  // invalidatePhpLaravelMigrationSourcesForPath.
  const invalidateBladeComponentNamesForPath = useCallback(
    (root: string, path: string): void => {
      invalidateBladeComponentNamesForCachePath(
        bladeComponentNamesByRootRef,
        root,
        path,
      );
    },
    [],
  );

  // Completion for `.blade.php` documents: `@directive` names, view names,
  // `<x-...>` component names, Blade variables, and Laravel helper literals.
  const provideBladeCompletions = useCallback(
    async (
      source: string,
      position: EditorPosition,
    ): Promise<BladeCompletionItem[]> => {
      return provideBladeCompletionsFromProvider(source, position, {
        activeDocument,
        collectBladeComponentNames,
        collectBladeForeachLoopVariables,
        collectBladeViewVariablesWithDisplayTypes,
        collectPhpLaravelConfigTargets,
        collectPhpLaravelNamedRouteTargets,
        collectPhpLaravelTranslationTargets,
        collectPhpLaravelViewTargets,
        currentWorkspaceRootRef,
        ensurePhpLaravelMigrationSourcesLoaded,
        ensurePhpLaravelProviderSourcesLoaded,
        isLaravelFrameworkActive,
        relativeWorkspacePath,
        resolveBladeForeachElementTypeForVariable,
        resolveBladeViewVariableTypeForView,
        resolvePhpReceiverMethodCompletions,
        workspaceRoot,
      });
    },
    [
      activeDocument,
      collectBladeComponentNames,
      collectBladeForeachLoopVariables,
      collectBladeViewVariablesWithDisplayTypes,
      collectPhpLaravelConfigTargets,
      collectPhpLaravelNamedRouteTargets,
      collectPhpLaravelTranslationTargets,
      collectPhpLaravelViewTargets,
      currentWorkspaceRootRef,
      ensurePhpLaravelMigrationSourcesLoaded,
      ensurePhpLaravelProviderSourcesLoaded,
      isLaravelFrameworkActive,
      relativeWorkspacePath,
      resolveBladeForeachElementTypeForVariable,
      resolveBladeViewVariableTypeForView,
      resolvePhpReceiverMethodCompletions,
      workspaceRoot,
    ],
  );

  const provideBladeCodeActions = useCallback(
    async (
      source: string,
      range: PhpCodeActionRange = { end: 0, start: 0 },
    ): Promise<PhpCodeActionDescriptor[]> => {
      return provideBladeCodeActionsFromProvider(source, range, {
        createMissingBladeViewCodeAction,
        currentWorkspaceRootRef,
        workspaceRoot,
      });
    },
    [createMissingBladeViewCodeAction, currentWorkspaceRootRef, workspaceRoot],
  );

  // Cmd+Click navigation for `.blade.php` documents. detectBladeReferenceAt
  // (pure) classifies Blade view/component offsets; Laravel helper literals and
  // typed view-data member access reuse the existing PHP/Laravel resolvers.
  // Conservative: an unresolvable or non-existent reference returns false (no
  // phpactor fallback for blade). Per-project isolation: capture the requested
  // root up front and re-check after every await so a tab switch mid-resolution
  // can never navigate into a stale-workspace file.
  const provideBladeDefinition = useCallback(
    async (source: string, offset: number): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return false;
      }

      if (isInsideBladeComment(source, offset)) {
        return false;
      }

      if (isLaravelFrameworkActive) {
        const helper = bladeLaravelStringLiteralHelperAt(source, offset);

        if (helper?.helper === "view") {
          if (!resolveLaravelViewTarget(helper.literal)) {
            return false;
          }

          const target = await findPhpLaravelViewTarget(helper.literal);

          if (!isRequestedRootActive()) {
            return false;
          }

          return target
            ? openNavigationTarget(target.path, target.position, target.name)
            : false;
        }

        if (helper?.helper === "route") {
          if (!activeDocument) {
            return false;
          }

          const routes = await collectPhpLaravelNamedRouteTargets(
            activeDocument.content,
            activeDocument.path,
          );

          if (!isRequestedRootActive()) {
            return false;
          }

          const target = routes.find(
            (route) =>
              route.name.toLowerCase() === helper.literal.toLowerCase(),
          );

          return target
            ? openNavigationTarget(target.path, target.position, target.name)
            : false;
        }

        if (helper?.helper === "config") {
          if (!resolveLaravelConfigTarget(helper.literal)) {
            return false;
          }

          const target = await findPhpLaravelConfigTarget(helper.literal);

          if (!isRequestedRootActive()) {
            return false;
          }

          return target
            ? openNavigationTarget(target.path, target.position, target.key)
            : false;
        }

        if (helper?.helper === "trans") {
          if (!resolveLaravelTransTarget(helper.literal)) {
            return false;
          }

          const target = await findPhpLaravelTranslationTarget(helper.literal);

          if (!isRequestedRootActive()) {
            return false;
          }

          return target
            ? openNavigationTarget(target.path, target.position, target.key)
            : false;
        }

        const memberContext = phpIdentifierContextAt(
          source,
          editorPositionAtOffset(source, offset),
        );

        if (
          memberContext?.kind === "methodCall" ||
          memberContext?.kind === "memberPropertyAccess"
        ) {
          const activePath = activeDocument?.path ?? "";
          const relativePath = activePath
            ? relativeWorkspacePath(requestedRoot, activePath)
            : "";
          const viewName = phpLaravelViewNameFromRelativePath(relativePath);
          const variableName = memberContext.variableName
            ? `$${memberContext.variableName}`
            : "";
          const memberName =
            memberContext.kind === "methodCall"
              ? memberContext.methodName
              : memberContext.propertyName;

          if (viewName && variableName && memberName) {
            const className = await resolveBladeViewVariableTypeForView(
              viewName,
              variableName,
            );

            if (!isRequestedRootActive()) {
              return false;
            }

            if (className) {
              const openedMethod = await openDirectPhpMethodTarget(
                className,
                memberName,
              );

              if (!isRequestedRootActive()) {
                return false;
              }

              if (openedMethod) {
                return true;
              }

              if (memberContext.kind === "memberPropertyAccess") {
                const openedAttribute = await openPhpLaravelModelAttributeTarget(
                  className,
                  memberName,
                );

                if (!isRequestedRootActive()) {
                  return false;
                }

                if (openedAttribute) {
                  return true;
                }

                return openDirectPhpPropertyTarget(className, memberName);
              }
            }
          }
        }
      }

      const reference = detectBladeReferenceAt(source, offset);

      if (!reference) {
        return false;
      }

      // Components probe the class-based PHP file before the anonymous blade
      // view (PhpStorm parity — Laravel resolves a class component first too).
      const candidateRelativePaths =
        reference.kind === "component"
          ? bladeComponentNavigationCandidateRelativePaths(reference.name)
          : reference.kind === "view"
            ? bladeViewCandidateRelativePaths(reference.name)
            : [];

      if (candidateRelativePaths.length === 0) {
        return false;
      }

      for (const relativePath of candidateRelativePaths) {
        if (!isRequestedRootActive()) {
          return false;
        }

        const path = joinWorkspacePath(requestedRoot, relativePath);

        try {
          await readNavigationFileContent(path);
        } catch {
          if (!isRequestedRootActive()) {
            return false;
          }

          continue;
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        return openNavigationTarget(
          path,
          { column: 1, lineNumber: 1 },
          reference.name,
        );
      }

      return false;
    },
    [
      activeDocument,
      collectPhpLaravelNamedRouteTargets,
      findPhpLaravelConfigTarget,
      findPhpLaravelTranslationTarget,
      findPhpLaravelViewTarget,
      isLaravelFrameworkActive,
      openDirectPhpMethodTarget,
      openDirectPhpPropertyTarget,
      openNavigationTarget,
      openPhpLaravelModelAttributeTarget,
      readNavigationFileContent,
      resolveBladeViewVariableTypeForView,
      workspaceRoot,
    ],
  );

  const resetBladeIntelligenceCaches = useCallback((): void => {
    bladeViewDataEntriesByRootRef.current = {};
    bladeViewDataEntriesLoadInFlightRef.current = new Map();
    bladeComponentNamesByRootRef.current = {};
  }, []);

  return {
    provideBladeCodeActions,
    provideBladeCompletions,
    provideBladeDefinition,
    invalidateBladeComponentNamesForPath,
    invalidateBladeViewDataEntriesForPath,
    resetBladeIntelligenceCaches,
  };
}

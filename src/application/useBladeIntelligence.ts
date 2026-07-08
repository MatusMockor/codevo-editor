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
import { useCallback } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
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
  provideBladeCompletions as provideBladeCompletionsFromProvider,
} from "./bladeCompletionProvider";
import {
  provideBladeDefinition as provideBladeDefinitionFromProvider,
} from "./bladeDefinitionProvider";
import { useBladeIntelligenceCaches } from "./useBladeIntelligenceCaches";

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
    ensurePhpFrameworkSourceCollectionsLoaded,
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

  const {
    collectBladeComponentNames,
    collectBladeForeachLoopVariables,
    collectBladeViewVariablesWithDisplayTypes,
    invalidateBladeComponentNamesForPath,
    invalidateBladeViewDataEntriesForPath,
    resolveBladeForeachElementTypeForVariable,
    resolveBladeViewVariableTypeForView,
    resetBladeIntelligenceCaches,
  } = useBladeIntelligenceCaches({
    currentWorkspaceRootRef,
    frameworkProviders: activePhpFrameworkProviders,
    readNavigationFileContent,
    relativeWorkspacePath,
    resolvePhpClassPropertyOrRelationType,
    resolvePhpDeclaredType,
    resolvePhpExpressionType,
    textSearch,
    workspaceFiles,
    workspaceRoot,
  });

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
        ensurePhpFrameworkSourceCollectionsLoaded,
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
      ensurePhpFrameworkSourceCollectionsLoaded,
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

  const provideBladeDefinition = useCallback(
    async (source: string, offset: number): Promise<boolean> => {
      return provideBladeDefinitionFromProvider(source, offset, {
        activeDocument,
        collectPhpLaravelNamedRouteTargets,
        currentWorkspaceRootRef,
        findPhpLaravelConfigTarget,
        findPhpLaravelTranslationTarget,
        findPhpLaravelViewTarget,
        isLaravelFrameworkActive,
        openDirectPhpMethodTarget,
        openDirectPhpPropertyTarget,
        openNavigationTarget,
        openPhpLaravelModelAttributeTarget,
        readNavigationFileContent,
        relativeWorkspacePath,
        resolveBladeViewVariableTypeForView,
        workspaceRoot,
      });
    },
    [
      activeDocument,
      collectPhpLaravelNamedRouteTargets,
      currentWorkspaceRootRef,
      findPhpLaravelConfigTarget,
      findPhpLaravelTranslationTarget,
      findPhpLaravelViewTarget,
      isLaravelFrameworkActive,
      openDirectPhpMethodTarget,
      openDirectPhpPropertyTarget,
      openNavigationTarget,
      openPhpLaravelModelAttributeTarget,
      readNavigationFileContent,
      relativeWorkspacePath,
      resolveBladeViewVariableTypeForView,
      workspaceRoot,
    ],
  );

  return {
    provideBladeCodeActions,
    provideBladeCompletions,
    provideBladeDefinition,
    invalidateBladeComponentNamesForPath,
    invalidateBladeViewDataEntriesForPath,
    resetBladeIntelligenceCaches,
  };
}

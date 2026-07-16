import {
  isPhpFrameworkContainerBindingCandidatePath,
  phpFrameworkContainerBindingsFromSource,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { detectLanguage } from "../domain/workspace";
import type { WorkspaceFileChangeEvent } from "../domain/workspaceFileChange";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpFrameworkBindingInvalidationDependencies {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "supports">;
  frameworkProviders: readonly PhpFrameworkProvider[];
  currentRootPath(): string | null;
  currentBindingCacheGeneration(): number;
  invalidateBindingCache(): void;
  isBindingSearchCandidatePath(path: string): boolean;
  readTextFile(path: string): Promise<string>;
}

export function createPhpFrameworkBindingFileChangeInvalidator({
  frameworkRuntime,
  frameworkProviders,
  currentRootPath,
  currentBindingCacheGeneration,
  invalidateBindingCache,
  isBindingSearchCandidatePath,
  readTextFile,
}: PhpFrameworkBindingInvalidationDependencies): (
  event: WorkspaceFileChangeEvent,
) => void {
  return (event) => {
    if (!frameworkRuntime.supports("containerBindingsFromSource")) {
      return;
    }

    if (!workspaceRootKeysEqual(currentRootPath(), event.rootPath)) {
      return;
    }

    if (event.fileKind === "directory") {
      return;
    }

    if (
      phpFrameworkBindingKnownCandidateChanged(
        event,
        frameworkProviders,
        isBindingSearchCandidatePath,
      )
    ) {
      invalidateBindingCache();
      return;
    }

    if (!phpFrameworkBindingFileChangeMayIntroduceBindings(event)) {
      return;
    }

    if (frameworkRuntime.supports("containerConcreteClassNamesFromSource")) {
      invalidateBindingCache();
      return;
    }

    const requestedRoot = event.rootPath;
    const requestedGeneration = currentBindingCacheGeneration();
    const invalidateIfCurrent = (): void => {
      if (!phpFrameworkBindingInvalidationRequestIsCurrent({
        currentRootPath,
        currentBindingCacheGeneration,
        requestedRoot,
        requestedGeneration,
      })) {
        return;
      }

      invalidateBindingCache();
    };

    void readTextFile(event.path)
      .then((source) => {
        if (!phpFrameworkBindingInvalidationRequestIsCurrent({
          currentRootPath,
          currentBindingCacheGeneration,
          requestedRoot,
          requestedGeneration,
        })) {
          return;
        }

        if (
          phpFrameworkContainerBindingsFromSource(
            source,
            frameworkProviders,
          ).length === 0
        ) {
          return;
        }

        invalidateIfCurrent();
      })
      .catch(() => invalidateIfCurrent());
  };
}

export function phpFrameworkBindingKnownCandidateChanged(
  event: WorkspaceFileChangeEvent,
  frameworkProviders: readonly PhpFrameworkProvider[],
  isBindingSearchCandidatePath: (path: string) => boolean,
): boolean {
  return [event.path, event.previousPath]
    .filter((path): path is string => Boolean(path))
    .some(
      (path) =>
        isBindingSearchCandidatePath(path) ||
        isPhpFrameworkContainerBindingCandidatePath(path, frameworkProviders),
    );
}

function phpFrameworkBindingFileChangeMayIntroduceBindings(
  event: WorkspaceFileChangeEvent,
): boolean {
  if (
    event.kind !== "created" &&
    event.kind !== "modified" &&
    event.kind !== "renamed"
  ) {
    return false;
  }

  return detectLanguage(event.path) === "php";
}

function phpFrameworkBindingInvalidationRequestIsCurrent({
  currentRootPath,
  currentBindingCacheGeneration,
  requestedRoot,
  requestedGeneration,
}: {
  currentRootPath(): string | null;
  currentBindingCacheGeneration(): number;
  requestedRoot: string;
  requestedGeneration: number;
}): boolean {
  return (
    workspaceRootKeysEqual(currentRootPath(), requestedRoot) &&
    currentBindingCacheGeneration() === requestedGeneration
  );
}

export function phpFrameworkBindingEditorChangeRequiresInvalidation(
  path: string,
  previousSource: string,
  nextSource: string,
  frameworkProviders: readonly PhpFrameworkProvider[],
  isBindingDependencyPath: (path: string) => boolean,
): boolean {
  if (isBindingDependencyPath(path)) {
    return true;
  }

  return [previousSource, nextSource].some(
    (source) =>
      phpFrameworkContainerBindingsFromSource(
        source,
        frameworkProviders,
      ).length > 0,
  );
}

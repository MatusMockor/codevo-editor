import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpLaravelViewNameCandidateRelativePaths,
  phpLaravelViewNameFromRelativePath,
  type PhpLaravelViewTarget,
} from "../domain/phpLaravelViews";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  createWorkspaceTargetCollector,
  type WorkspaceTargetCollectorDeps,
} from "./phpWorkspaceTargetCollector";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

/**
 * A resolved view navigation target: the parsed view plus the 1:1 blade file
 * position navigation jumps to.
 */
export interface PhpLaravelViewNavigationTarget extends PhpLaravelViewTarget {
  position: EditorPosition;
}

export interface PhpLaravelViewTargetResolverDeps {
  currentWorkspaceRootRef: { readonly current: string | null };
  workspaceRoot: string | null;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  workspaceTargetCollectorDeps: WorkspaceTargetCollectorDeps;
  readNavigationFileContent: (path: string) => Promise<string>;
  joinWorkspacePath: (workspaceRoot: string, relativePath: string) => string;
  readCachedViewTargets: (workspaceRoot: string) => PhpLaravelViewTarget[] | null;
  writeCachedViewTargets: (
    workspaceRoot: string,
    targets: PhpLaravelViewTarget[],
  ) => void;
}

export interface PhpLaravelViewTargetResolver {
  collect: () => Promise<PhpLaravelViewTarget[]>;
  find: (viewName: string) => Promise<PhpLaravelViewNavigationTarget | null>;
}

function isWorkspaceRootActive(
  deps: PhpLaravelViewTargetResolverDeps,
  requestedRoot: string | null,
): boolean {
  return workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);
}

function supportsViews(deps: PhpLaravelViewTargetResolverDeps): boolean {
  return deps.frameworkRuntime.supports("views");
}

async function collectPhpLaravelViewTargets(
  deps: PhpLaravelViewTargetResolverDeps,
): Promise<PhpLaravelViewTarget[]> {
  const collect = createWorkspaceTargetCollector<PhpLaravelViewTarget>(
    deps.workspaceTargetCollectorDeps,
    {
      kind: "directoryScan",
      isEnabled: () => supportsViews(deps),
      roots: ["resources/views"],
      recursive: true,
      parseEntry: ({ path, relativePath }) => {
        const viewName = phpLaravelViewNameFromRelativePath(relativePath);

        if (!viewName) {
          return [];
        }

        return [{ name: viewName, path, relativePath }];
      },
      dedupKey: (target) => target.name.toLowerCase(),
      compareTargets: (left, right) => left.name.localeCompare(right.name),
      cache: {
        read: deps.readCachedViewTargets,
        write: deps.writeCachedViewTargets,
      },
    },
  );

  return collect({ workspaceRoot: deps.workspaceRoot });
}

async function findPhpLaravelViewTarget(
  deps: PhpLaravelViewTargetResolverDeps,
  viewName: string,
): Promise<PhpLaravelViewNavigationTarget | null> {
  const requestedRoot = deps.workspaceRoot;

  if (!supportsViews(deps) || !requestedRoot) {
    return null;
  }

  for (const relativePath of phpLaravelViewNameCandidateRelativePaths(viewName)) {
    if (!isWorkspaceRootActive(deps, requestedRoot)) {
      return null;
    }

    const path = deps.joinWorkspacePath(requestedRoot, relativePath);

    try {
      await deps.readNavigationFileContent(path);

      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return null;
      }

      return {
        name: viewName,
        path,
        position: { column: 1, lineNumber: 1 },
        relativePath,
      };
    } catch {
      if (!isWorkspaceRootActive(deps, requestedRoot)) {
        return null;
      }
    }
  }

  return null;
}

export function createPhpLaravelViewTargetResolver(
  deps: PhpLaravelViewTargetResolverDeps,
): PhpLaravelViewTargetResolver {
  return {
    collect: () => collectPhpLaravelViewTargets(deps),
    find: (viewName) => findPhpLaravelViewTarget(deps, viewName),
  };
}

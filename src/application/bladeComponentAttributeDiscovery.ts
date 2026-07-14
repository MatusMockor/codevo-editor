import {
  bladeComponentNavigationCandidateRelativePaths,
  isBladeComponentSourcePath,
} from "../domain/bladeNavigation";
import {
  bladeClassComponentConstructorAttributes,
  bladeComponentPropsAttributes,
} from "../domain/bladeComponentProps";
import { joinWorkspacePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface BladeComponentAttributesCacheRef {
  current: Record<string, Record<string, string[]>>;
}

export interface BladeComponentAttributeDiscoveryDependencies {
  cacheRef: BladeComponentAttributesCacheRef;
  currentWorkspaceRootRef: { readonly current: string | null };
  readNavigationFileContent: (path: string) => Promise<string>;
  workspaceRoot: string | null;
}

export async function collectBladeComponentAttributes(
  componentName: string,
  dependencies: BladeComponentAttributeDiscoveryDependencies,
): Promise<string[]> {
  const {
    cacheRef,
    currentWorkspaceRootRef,
    readNavigationFileContent,
    workspaceRoot,
  } = dependencies;
  const requestedRoot = workspaceRoot;
  const isRequestedRootActive = () =>
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

  if (!requestedRoot) {
    return [];
  }

  const cachedAttributes = cacheRef.current[requestedRoot]?.[componentName];

  if (cachedAttributes) {
    return cachedAttributes;
  }

  for (const relativePath of bladeComponentNavigationCandidateRelativePaths(
    componentName,
  )) {
    const path = joinWorkspacePath(requestedRoot, relativePath);
    let content: string;

    try {
      content = await readNavigationFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return [];
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    const attributes = relativePath.endsWith(".blade.php")
      ? bladeComponentPropsAttributes(content)
      : bladeClassComponentConstructorAttributes(content);

    return cacheAttributes(cacheRef, requestedRoot, componentName, attributes);
  }

  if (!isRequestedRootActive()) {
    return [];
  }

  return cacheAttributes(cacheRef, requestedRoot, componentName, []);
}

function cacheAttributes(
  cacheRef: BladeComponentAttributesCacheRef,
  root: string,
  componentName: string,
  attributes: string[],
): string[] {
  const rootCache = (cacheRef.current[root] ??= {});
  rootCache[componentName] = attributes;

  return attributes;
}

export function invalidateBladeComponentAttributesForPath(
  cacheRef: BladeComponentAttributesCacheRef,
  root: string,
  path: string,
): void {
  if (!isBladeComponentSourcePath(root, path)) {
    return;
  }

  delete cacheRef.current[root];
}

import {
  BLADE_ANONYMOUS_COMPONENTS_DIR,
  BLADE_CLASS_COMPONENTS_DIR,
  bladeComponentNameFromClassRelativePath,
  isBladeComponentSourcePath,
} from "../domain/bladeNavigation";
import {
  joinWorkspacePath,
  type FileEntry,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface BladeComponentNamesCacheRef {
  current: Record<string, string[]>;
}

export interface BladeComponentDiscoveryDependencies {
  cacheRef: BladeComponentNamesCacheRef;
  currentWorkspaceRootRef: { readonly current: string | null };
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
  workspaceFiles: { readDirectory: (path: string) => Promise<FileEntry[]> };
  workspaceRoot: string | null;
}

export async function collectBladeComponentNames(
  dependencies: BladeComponentDiscoveryDependencies,
): Promise<string[]> {
  const {
    cacheRef,
    currentWorkspaceRootRef,
    relativeWorkspacePath,
    workspaceFiles,
    workspaceRoot,
  } = dependencies;
  const requestedRoot = workspaceRoot;
  const isRequestedRootActive = () =>
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

  if (!requestedRoot) {
    return [];
  }

  const cachedNames = cacheRef.current[requestedRoot];

  if (cachedNames) {
    return cachedNames;
  }

  const names = new Set<string>();

  const visitDirectory = async (
    directory: string,
    addEntry: (relativePath: string) => void,
    scanRoot: string,
  ): Promise<void> => {
    let entries: FileEntry[];

    try {
      entries = await workspaceFiles.readDirectory(directory);
    } catch {
      return;
    }

    if (!isRequestedRootActive()) {
      return;
    }

    for (const entry of entries) {
      if (!isRequestedRootActive()) {
        return;
      }

      if (entry.kind === "directory") {
        await visitDirectory(entry.path, addEntry, scanRoot);
        continue;
      }

      addEntry(relativeWorkspacePath(scanRoot, entry.path));
    }
  };

  const componentsRoot = joinWorkspacePath(
    requestedRoot,
    BLADE_ANONYMOUS_COMPONENTS_DIR,
  );
  await visitDirectory(
    componentsRoot,
    (relativePath) => {
      const componentName = bladeComponentNameFromRelativePath(relativePath);

      if (componentName) {
        names.add(componentName);
      }
    },
    componentsRoot,
  );

  const classComponentsRoot = joinWorkspacePath(
    requestedRoot,
    BLADE_CLASS_COMPONENTS_DIR,
  );
  await visitDirectory(
    classComponentsRoot,
    (relativePath) => {
      const componentName =
        bladeComponentNameFromClassRelativePath(relativePath);

      if (componentName) {
        names.add(componentName);
      }
    },
    classComponentsRoot,
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  const sortedNames = Array.from(names).sort((left, right) =>
    left.localeCompare(right),
  );
  cacheRef.current[requestedRoot] = sortedNames;

  return sortedNames;
}

export function invalidateBladeComponentNamesForPath(
  cacheRef: BladeComponentNamesCacheRef,
  root: string,
  path: string,
): void {
  if (!isBladeComponentSourcePath(root, path)) {
    return;
  }

  delete cacheRef.current[root];
}

/**
 * Maps a component blade file path relative to `resources/views/components` to
 * its dotted component name. `forms/input.blade.php` -> `forms.input`;
 * `alert/index.blade.php` -> `alert`.
 */
export function bladeComponentNameFromRelativePath(
  relativePath: string,
): string | null {
  const normalized = relativePath.split("\\").join("/").replace(/^\/+/, "");

  if (!normalized.endsWith(".blade.php")) {
    return null;
  }

  const withoutExtension = normalized.slice(0, -".blade.php".length);
  const segments = withoutExtension.split("/").filter(Boolean);

  if (segments[segments.length - 1] === "index") {
    segments.pop();
  }

  if (segments.length === 0) {
    return null;
  }

  return segments.join(".");
}

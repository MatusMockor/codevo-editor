import { resolveLaravelInertiaComponentTarget } from "../domain/phpLaravelInertia";
import {
  getParentPath,
  joinWorkspacePath,
  type FileEntry,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

type ReadDirectory = (path: string) => Promise<FileEntry[]>;
type DirectoryListingMemo = Map<string, Promise<FileEntry[]>>;

export interface InertiaComponentTargetDependencies {
  currentWorkspaceRootRef: { readonly current: string | null };
  readDirectory: ReadDirectory;
}

export interface InertiaComponentNavigationTarget {
  name: string;
  path: string;
  position: { column: number; lineNumber: number };
}

export async function pathExistsInDirectoryListing(
  readDirectory: ReadDirectory,
  path: string,
  directoryListings: DirectoryListingMemo,
): Promise<boolean> {
  const parentPath = getParentPath(path);
  let listing = directoryListings.get(parentPath);

  if (!listing) {
    listing = readDirectory(parentPath);
    directoryListings.set(parentPath, listing);
  }

  let entries: FileEntry[];

  try {
    entries = await listing;
  } catch {
    return false;
  }

  const name = path.slice(path.lastIndexOf("/") + 1);

  return entries.some((entry) => entry.kind === "file" && entry.name === name);
}

export async function findInertiaComponentTarget(
  componentName: string,
  dependencies: InertiaComponentTargetDependencies,
): Promise<InertiaComponentNavigationTarget | null> {
  const { currentWorkspaceRootRef, readDirectory } = dependencies;
  const requestedRoot = currentWorkspaceRootRef.current;
  const target = resolveLaravelInertiaComponentTarget(componentName);

  if (!requestedRoot || !target) {
    return null;
  }

  const directoryListings: DirectoryListingMemo = new Map();

  for (const relativeFilePath of target.relativeFilePaths) {
    const path = joinWorkspacePath(requestedRoot, relativeFilePath);
    const exists = await pathExistsInDirectoryListing(
      readDirectory,
      path,
      directoryListings,
    );

    if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
      return null;
    }

    if (!exists) {
      continue;
    }

    return {
      name: componentName,
      path,
      position: { column: 1, lineNumber: 1 },
    };
  }

  return null;
}

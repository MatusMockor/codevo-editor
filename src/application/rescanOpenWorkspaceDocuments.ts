import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import { getParentPath, workspaceRelativePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceFileChangeEvent } from "../domain/workspaceFileChange";

export const MAX_RESCANNED_OPEN_DOCUMENTS = 256;
const MAX_DIRECTORY_ENTRIES = 4_000;

interface Dependencies {
  readonly event: WorkspaceFileChangeEvent;
  readonly documents: Readonly<Record<string, EditorDocument>>;
  readonly files: Pick<WorkspaceFileGateway, "readDirectory" | "readDirectoryBounded">;
  readonly isCurrent: () => boolean;
  readonly dispatch: (event: WorkspaceFileChangeEvent) => Promise<void>;
  readonly reportIncomplete: () => void;
}

export async function rescanOpenWorkspaceDocuments({
  event,
  documents,
  files,
  isCurrent,
  dispatch,
  reportIncomplete,
}: Dependencies): Promise<void> {
  const inside = (root: string, path: string) => {
    if (workspaceRootKeysEqual(root, path)) return true;
    const relative = workspaceRelativePath(root, path);
    return (
      relative !== null &&
      !relative.split(/[\\/]/).some((segment) => segment === ".." || segment === ".")
    );
  };
  if (!inside(event.rootPath, event.path)) return;
  const scope = event.path;
  const paths = Object.keys(documents).filter((path) => inside(scope, path));
  let incompleteReported = false;
  const incomplete = () => {
    if (incompleteReported || !isCurrent()) return;
    incompleteReported = true;
    reportIncomplete();
  };
  if (paths.length > MAX_RESCANNED_OPEN_DOCUMENTS) incomplete();
  const directories = new Map<string, Promise<ReadonlySet<string> | null>>();
  const listing = (directory: string): Promise<ReadonlySet<string> | null> => {
    const existing = directories.get(directory);
    if (existing) return existing;
    const pending = (async () => {
      if (!isCurrent()) return null;
      try {
        const result = files.readDirectoryBounded
          ? await files.readDirectoryBounded(directory, MAX_DIRECTORY_ENTRIES)
          : { entries: await files.readDirectory(directory), truncated: false };
        if (!isCurrent() || result.truncated || result.entries.length > MAX_DIRECTORY_ENTRIES)
          return null;
        return new Set(result.entries.map((entry) => entry.path));
      } catch {
        return null;
      }
    })();
    directories.set(directory, pending);
    return pending;
  };
  const removed = async (path: string): Promise<boolean | null> => {
    let candidate = path;
    for (let depth = 0; depth < 32; depth += 1) {
      const parent = getParentPath(candidate);
      if (parent === candidate || !inside(event.rootPath, parent)) return null;
      const entries = await listing(parent);
      if (!isCurrent()) return false;
      if (entries !== null) {
        if (!entries.has(candidate)) return true;
        return depth === 0 ? false : null;
      }
      candidate = parent;
    }
    return null;
  };
  for (const path of paths.slice(0, MAX_RESCANNED_OPEN_DOCUMENTS)) {
    if (!isCurrent()) return;
    const deleted = await removed(path);
    if (!isCurrent()) return;
    if (deleted === null) incomplete();
    await dispatch({
      rootPath: event.rootPath,
      path,
      relativePath: workspaceRelativePath(event.rootPath, path) ?? "",
      kind: deleted ? "deleted" : "modified",
      fileKind: "file",
    });
    if (!isCurrent()) return;
  }
}

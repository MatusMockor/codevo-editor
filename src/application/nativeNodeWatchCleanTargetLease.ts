import { isDirty, type EditorDocument } from "../domain/workspace";

export interface NativeNodeWatchCleanTargetLease {
  readonly targetPath: string;
  isCurrent(
    activeDocument: EditorDocument | null,
    openDocuments: readonly EditorDocument[],
  ): boolean;
}

/**
 * Pins the exact clean editor snapshot used to admit a native-watch start.
 *
 * Filesystem aliases are rejected by the backend launch boundary. This lease
 * handles the remaining editor race: a matching buffer must stay present with
 * the same saved revision/content until the asynchronous backend start settles.
 */
export function createNativeNodeWatchCleanTargetLease(
  targetPath: string,
  activeDocument: EditorDocument | null,
  openDocuments: readonly EditorDocument[],
): NativeNodeWatchCleanTargetLease | null {
  const snapshots = matchingSnapshots(targetPath, activeDocument, openDocuments);
  if (snapshots === null) return null;

  return Object.freeze({
    targetPath,
    isCurrent: (currentActive: EditorDocument | null, currentOpen: readonly EditorDocument[]) => {
      const current = matchingSnapshots(targetPath, currentActive, currentOpen);
      return current !== null && equalSnapshots(snapshots, current);
    },
  });
}

function matchingSnapshots(
  targetPath: string,
  activeDocument: EditorDocument | null,
  openDocuments: readonly EditorDocument[],
): readonly string[] | null {
  const documents = [...(activeDocument ? [activeDocument] : []), ...openDocuments];
  const matching = documents.filter((document) => document.path === targetPath);
  // A filesystem identity can only be compared with the target when an exact
  // target snapshot is present. Without it, an open symlink/hardlink alias is
  // indistinguishable from an unrelated document, so admission must fail
  // closed instead of granting an unpinned lease.
  if (matching.length === 0) return null;
  if (documents.some((document) => aliasesTarget(document, targetPath, matching))) return null;
  if (matching.some(isDirty)) return null;

  return Object.freeze(
    [
      ...new Set(
        matching.map(({ content, savedContent, revision }) =>
          JSON.stringify([content, savedContent, revision ?? null]),
        ),
      ),
    ].sort(),
  );
}

function aliasesTarget(
  document: EditorDocument,
  targetPath: string,
  exactDocuments: readonly EditorDocument[],
): boolean {
  if (document.path === targetPath) return false;
  if (document.path.toLocaleLowerCase("en-US") === targetPath.toLocaleLowerCase("en-US")) {
    return true;
  }
  if (!document.revision) return false;
  return exactDocuments.some(
    ({ revision }) =>
      revision !== null &&
      revision !== undefined &&
      revision.device === document.revision?.device &&
      revision.inode === document.revision.inode,
  );
}

function equalSnapshots(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

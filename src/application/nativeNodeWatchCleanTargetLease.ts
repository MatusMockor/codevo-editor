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
  const matching = [
    ...(activeDocument?.path === targetPath ? [activeDocument] : []),
    ...openDocuments.filter((document) => document.path === targetPath),
  ];
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

function equalSnapshots(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

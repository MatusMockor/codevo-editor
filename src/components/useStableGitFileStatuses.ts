import { useMemo, useRef } from "react";
import { EMPTY_FILE_STATUSES_BY_PATH } from "../application/appClosedState";
import type { GitChangedFile, GitChangeStatus } from "../domain/git";
import { areFileStatusesByPathEqual } from "./appPresentation";

export function useStableGitFileStatuses(
  gitChanges: readonly GitChangedFile[] | null | undefined,
): Record<string, GitChangeStatus> {
  const previousRef = useRef<Record<string, GitChangeStatus>>({});
  return useMemo(() => {
    const previous = previousRef.current;
    if (!Array.isArray(gitChanges) || gitChanges.length === 0) {
      if (Object.keys(previous).length === 0) return previous;
      previousRef.current = EMPTY_FILE_STATUSES_BY_PATH;
      return previousRef.current;
    }

    const next = gitChanges.reduce<Record<string, GitChangeStatus>>((statuses, change) => {
      statuses[change.path] = change.status;
      if (change.oldPath) statuses[change.oldPath] = change.status;
      return statuses;
    }, {});
    if (areFileStatusesByPathEqual(previous, next)) return previous;
    previousRef.current = next;
    return next;
  }, [gitChanges]);
}

import { useEffect, useRef } from "react";
import type { WorkbenchNotice } from "./workbenchNotice";

export type ReplaceJsTestProblemNotices = (replacements: readonly WorkbenchNotice[]) => void;

export function useJsTestProblemNoticeComposition(
  replacements: readonly WorkbenchNotice[],
  replacementsPublished: boolean,
  replaceNotices: ReplaceJsTestProblemNotices,
): void {
  const dismissedSnapshotsRef = useRef(new WeakSet<object>());
  const previousPublishedRef = useRef(false);
  const previousReplacementsRef = useRef<readonly WorkbenchNotice[] | null>(null);

  useEffect(() => {
    const identityChanged = previousReplacementsRef.current !== replacements;
    if (!identityChanged && previousPublishedRef.current && !replacementsPublished) {
      dismissedSnapshotsRef.current.add(replacements);
    }
    if (identityChanged) {
      replaceNotices(dismissedSnapshotsRef.current.has(replacements) ? [] : replacements);
    }
    previousReplacementsRef.current = replacements;
    previousPublishedRef.current = replacementsPublished;
  }, [replaceNotices, replacements, replacementsPublished]);
}

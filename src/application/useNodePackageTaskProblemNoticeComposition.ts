import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { GLOBAL_NOTICE_LIMIT, isCappableDiagnosticNotice } from "./diagnosticNotices";
import { capWorkbenchNotices, type WorkbenchNotice } from "./workbenchNotice";

export function useNodePackageTaskProblemNoticeComposition(
  replacements: readonly WorkbenchNotice[],
  setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>,
): void {
  const ownedGroupsRef = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const replacementGroups = new Set(
      replacements.flatMap((notice) => (notice.groupKey ? [notice.groupKey] : [])),
    );
    const replacedGroups = new Set([...ownedGroupsRef.current, ...replacementGroups]);
    ownedGroupsRef.current = replacementGroups;
    setNotices((current) => {
      const next = [
        ...replacements,
        ...current.filter((notice) => !notice.groupKey || !replacedGroups.has(notice.groupKey)),
      ];
      return capWorkbenchNotices(next, GLOBAL_NOTICE_LIMIT, isCappableDiagnosticNotice);
    });
  }, [replacements, setNotices]);

  useEffect(
    () => () => {
      const ownedGroups = ownedGroupsRef.current;
      setNotices((current) =>
        current.filter((notice) => !notice.groupKey || !ownedGroups.has(notice.groupKey)),
      );
    },
    [setNotices],
  );
}

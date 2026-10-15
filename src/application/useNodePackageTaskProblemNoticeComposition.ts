import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { NODE_PACKAGE_TASK_PROBLEM_GROUP_PREFIX } from "../domain/nodePackageTaskProblems";
import { capWorkbenchNotices, type WorkbenchNotice } from "./workbenchNotice";

const GLOBAL_NOTICE_LIMIT = 2000;

function isNodePackageTaskProblemNotice(notice: WorkbenchNotice): boolean {
  return notice.groupKey?.startsWith(NODE_PACKAGE_TASK_PROBLEM_GROUP_PREFIX) ?? false;
}

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
      return capWorkbenchNotices(next, GLOBAL_NOTICE_LIMIT, isNodePackageTaskProblemNotice);
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

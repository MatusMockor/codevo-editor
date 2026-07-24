import { useEffect, type Dispatch, type SetStateAction } from "react";
import { GLOBAL_NOTICE_LIMIT, isCappableDiagnosticNotice } from "./diagnosticNotices";
import {
  capWorkbenchNotices,
  replaceNodePackageTaskProblemNotices,
  type WorkbenchNotice,
} from "./workbenchNotice";

export function useNodePackageTaskProblemNoticeComposition(
  replacements: readonly WorkbenchNotice[],
  setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>,
): void {
  useEffect(() => {
    setNotices((current) =>
      capWorkbenchNotices(
        replaceNodePackageTaskProblemNotices(current, replacements),
        GLOBAL_NOTICE_LIMIT,
        isCappableDiagnosticNotice,
      ),
    );
  }, [replacements, setNotices]);
}

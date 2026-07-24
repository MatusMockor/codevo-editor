import { useCallback, type Dispatch, type SetStateAction } from "react";
import { GLOBAL_NOTICE_LIMIT, isCappableDiagnosticNotice } from "./diagnosticNotices";
import {
  capWorkbenchNotices,
  replaceJsTestProblemNotices,
  type WorkbenchNotice,
} from "./workbenchNotice";

/** Builds the narrow JS-test action without exposing the workbench notice dispatcher. */
export function useReplaceJavaScriptTestProblemNotices(
  setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>,
): (replacements: readonly WorkbenchNotice[]) => void {
  return useCallback(
    (replacements: readonly WorkbenchNotice[]) => {
      setNotices((current) =>
        capWorkbenchNotices(
          replaceJsTestProblemNotices(current, replacements),
          GLOBAL_NOTICE_LIMIT,
          isCappableDiagnosticNotice,
        ),
      );
    },
    [setNotices],
  );
}

import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import {
  createWorkbenchNotice,
  replaceWorkbenchNoticeGroup,
  type WorkbenchNotice,
} from "./workbenchNotice";
import type { DiagnosticsChannelKind } from "./diagnosticsOwnerIdentity";

export function useDiagnosticsCapacityNotices(
  setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>,
) {
  const failedOwnerByKindRef = useRef<Partial<Record<DiagnosticsChannelKind, string>>>({});

  const reportOwnerCapacity = useCallback(
    (kind: DiagnosticsChannelKind, ownerKey: string, available: boolean) => {
      const failedOwner = failedOwnerByKindRef.current[kind];
      if (available && failedOwner !== ownerKey) {
        return;
      }
      if (available) {
        delete failedOwnerByKindRef.current[kind];
      } else {
        failedOwnerByKindRef.current[kind] = ownerKey;
      }
      const groupKey = `diagnostics-owner-capacity:${kind}`;
      setNotices((current) =>
        replaceWorkbenchNoticeGroup(
          current,
          groupKey,
          available
            ? []
            : [
                createWorkbenchNotice(
                  "warning",
                  kind === "php" ? "PHP" : "TypeScript",
                  "Diagnostics are paused for this workspace because the bounded diagnostics capacity was reached.",
                  groupKey,
                ),
              ],
        ),
      );
    },
    [setNotices],
  );

  const reportUriCapacity = useCallback(
    (kind: DiagnosticsChannelKind, ownerKey: string) => {
      const groupKey = `diagnostics-uri-capacity:${kind}:${ownerKey}`;
      setNotices((current) =>
        replaceWorkbenchNoticeGroup(current, groupKey, [
          createWorkbenchNotice(
            "warning",
            kind === "php" ? "PHP" : "TypeScript",
            "New diagnostic files are paused for this workspace because its bounded URI history is full.",
            groupKey,
          ),
        ]),
      );
    },
    [setNotices],
  );

  const clearUriCapacity = useCallback(
    (kind: DiagnosticsChannelKind, ownerKey: string) => {
      const groupKey = `diagnostics-uri-capacity:${kind}:${ownerKey}`;
      setNotices((current) => current.filter((notice) => notice.groupKey !== groupKey));
    },
    [setNotices],
  );

  return { clearUriCapacity, reportOwnerCapacity, reportUriCapacity };
}

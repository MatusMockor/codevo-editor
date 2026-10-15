import { useCallback, useState, type MutableRefObject, type SetStateAction } from "react";
import { createWorkbenchNotice, type WorkbenchNotice } from "../../domain/workbenchNotice";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";

export const MAX_AGENT_APP_NOTICES = 50;

export interface AgentNoticesOptions {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly isBenignError: (error: unknown) => boolean;
}

export function useAgentNotices({ currentWorkspaceRootRef, isBenignError }: AgentNoticesOptions) {
  const [notices, setNoticeList] = useState<readonly WorkbenchNotice[]>([]);

  const setNotices = useCallback((update: SetStateAction<WorkbenchNotice[]>) => {
    setNoticeList((current) => {
      const next = typeof update === "function" ? update([...current]) : update;
      return next.length > MAX_AGENT_APP_NOTICES ? next.slice(0, MAX_AGENT_APP_NOTICES) : next;
    });
  }, []);

  const reportError = useCallback(
    (source: string, error: unknown) => {
      if (isBenignError(error)) return;
      const notice = createWorkbenchNotice("error", source, String(error));
      setNotices((current) => [notice, ...current]);
    },
    [isBenignError, setNotices],
  );

  const reportErrorForActiveWorkspaceRoot = useCallback(
    (rootPath: string | null | undefined, source: string, error: unknown) => {
      if (rootPath && !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) return;
      reportError(source, error);
    },
    [currentWorkspaceRootRef, reportError],
  );

  const reportInfo = useCallback(
    (source: string, message: string) => {
      setNotices((current) => [createWorkbenchNotice("info", source, message), ...current]);
    },
    [setNotices],
  );

  const reportCommandError = useCallback(
    (error: unknown) => reportError("Command", error),
    [reportError],
  );

  return {
    notices,
    reportCommandError,
    reportError,
    reportErrorForActiveWorkspaceRoot,
    reportInfo,
    setNotices,
  };
}

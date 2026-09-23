import { useMemo } from "react";
import type { AgentTasksNotice } from "../../application/agentThreadPorts";
import type { AgentLocalFileLocation } from "../../domain/agentMarkdown/agentMarkdownLink";
import {
  AGENT_LOCAL_FILE_LINK_BLOCKED_NOTICE,
  AGENT_LOCAL_FILE_LINK_FAILED_NOTICE,
  AGENT_LOCAL_FILE_LINK_REMOTE_NOTICE,
  type AgentLocalFileLinkPort,
  type AgentLocalFileLinkRejection,
} from "./agentMarkdownLinks";

export type AgentFileLocationOpener = (location: AgentLocalFileLocation) => Promise<boolean>;

export function useAgentLocalFileLinks(
  openFileLocation: AgentFileLocationOpener | undefined,
  reportNotice: (notice: AgentTasksNotice) => void,
): AgentLocalFileLinkPort | null {
  return useMemo(() => {
    if (openFileLocation === undefined) return null;
    const reportFailure = (): void => reportNotice(AGENT_LOCAL_FILE_LINK_FAILED_NOTICE);
    return {
      open: (location) => {
        void openFileLocation(location).then((opened) => {
          if (!opened) reportFailure();
        }, reportFailure);
      },
      reject: (reason) => reportNotice(rejectionNotice(reason)),
    };
  }, [openFileLocation, reportNotice]);
}

function rejectionNotice(reason: AgentLocalFileLinkRejection): AgentTasksNotice {
  switch (reason) {
    case "outsideRoots":
      return AGENT_LOCAL_FILE_LINK_BLOCKED_NOTICE;
    case "remoteThread":
      return AGENT_LOCAL_FILE_LINK_REMOTE_NOTICE;
    default:
      return unsupportedRejection(reason);
  }
}

function unsupportedRejection(reason: never): never {
  throw new Error(`Unsupported local file link rejection: ${String(reason)}`);
}

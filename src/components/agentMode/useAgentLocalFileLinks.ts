import { useMemo } from "react";
import type { AgentTasksNotice } from "../../application/agentThreadPorts";
import type { AgentLocalFileOpenOutcome } from "../../domain/agentMarkdown/agentLocalFileLinkFailure";
import {
  agentLocalFileLinkNotice,
  type AgentLocalFileLinkPort,
  type AgentLocalFileOpenRequest,
} from "./agentMarkdownLinks";

export type AgentFileLocationOpener = (
  request: AgentLocalFileOpenRequest,
) => Promise<AgentLocalFileOpenOutcome>;

export function useAgentLocalFileLinks(
  openFileLocation: AgentFileLocationOpener | undefined,
  reportNotice: (notice: AgentTasksNotice) => void,
): AgentLocalFileLinkPort | null {
  return useMemo(() => {
    if (openFileLocation === undefined) return null;
    return {
      open: openFileLocation,
      report: (failure) => reportNotice(agentLocalFileLinkNotice(failure)),
    };
  }, [openFileLocation, reportNotice]);
}

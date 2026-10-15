import type { AgentDiffFile } from "../../../../application/rightPanel/agentDiffSources";
import { DELETED_FILE_REASON } from "../../../../application/useAgentEditorBridge";

export const NOT_IN_CHECKOUT_REASON = "This file is not in a checkout on this machine.";

export function agentDiffOpenBlockedReason(file: AgentDiffFile): string | null {
  if (file.status === "deleted") return DELETED_FILE_REASON;
  if (file.repositoryRoot === null) return NOT_IN_CHECKOUT_REASON;
  return null;
}

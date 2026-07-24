import {
  decodeNodeDebugAttachCandidateListResult,
  type NodeDebugAttachCandidateListResult,
} from "../domain/nodeDebugAttachCandidate";

export const DEBUG_LIST_NODE_ATTACH_CANDIDATES_IPC_COMMAND =
  "debug_list_node_attach_candidates" as const;

export interface NodeDebugAttachCandidateListRequest {
  readonly rootPath: string;
}

export type InvokeNodeDebugAttachCandidateCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

const GENERIC_ERROR_RESULT: NodeDebugAttachCandidateListResult = Object.freeze({
  status: "error",
});

export async function invokeNodeDebugAttachCandidateListIpc(
  invokeCommand: InvokeNodeDebugAttachCandidateCommand,
  request: NodeDebugAttachCandidateListRequest,
): Promise<NodeDebugAttachCandidateListResult> {
  try {
    return decodeNodeDebugAttachCandidateListResult(
      await invokeCommand(DEBUG_LIST_NODE_ATTACH_CANDIDATES_IPC_COMMAND, {
        request: {
          rootPath: request.rootPath,
        },
      }),
    );
  } catch {
    // Transport failures and malformed backend values are intentionally
    // indistinguishable and never include backend messages or candidate data.
    return GENERIC_ERROR_RESULT;
  }
}

import { agentAttachmentPromptLines } from "../domain/agentAttachmentIntake";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import {
  AGENT_ATTACHMENTS_DISCARDED_NOTICE,
  claimTurnAttachments,
  intentReferenceEntries,
} from "./agentTurnAttachments";
import type {
  AgentComposerAttachmentsSurface,
  AgentComposerTurnAttachments,
} from "./useAgentComposerAttachments";

export interface AgentQuestionAttachments {
  readonly targetKey: string;
  draft(draftKey: string): AgentComposerAttachmentsSurface;
  claim(prepared: AgentComposerTurnAttachments): Promise<ReadonlyArray<string>>;
}

export interface AgentQuestionAttachmentsPort {
  forThread(threadId: string): AgentQuestionAttachments | null;
}

export interface AgentQuestionAttachmentsDependencies {
  readonly gateway: AgentAttachmentGateway;
  readonly forDraft: ((draftKey: string) => AgentComposerAttachmentsSurface) | undefined;
  readonly resolveThreadRootKey: (threadId: string) => string | null;
}

export function createAgentQuestionAttachmentsPort(
  dependencies: AgentQuestionAttachmentsDependencies,
): AgentQuestionAttachmentsPort {
  const { gateway, forDraft, resolveThreadRootKey } = dependencies;
  return {
    forThread: (threadId) => {
      const targetKey = resolveThreadRootKey(threadId);
      if (forDraft === undefined || targetKey === null) return null;
      return {
        targetKey,
        draft: (draftKey) => forDraft(JSON.stringify(["question", threadId, draftKey])),
        claim: async (prepared) => {
          if (
            prepared.owner.projectRootKey !== targetKey ||
            resolveThreadRootKey(threadId) !== targetKey
          ) {
            throw new Error(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
          }
          if (prepared.intents.length === 0) return [];
          const claimed = await claimTurnAttachments(
            gateway,
            prepared.owner.workspaceId,
            threadId,
            prepared.intents,
            "",
          );
          return agentAttachmentPromptLines(
            claimed.attachments,
            intentReferenceEntries(prepared.intents),
          );
        },
      };
    },
  };
}

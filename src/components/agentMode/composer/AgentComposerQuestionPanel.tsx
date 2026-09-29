import { useContext, useRef } from "react";
import { AgentQuestionCard } from "../AgentQuestionCard";
import type { AgentComposerInteraction } from "./agentComposerInteraction";
import { AgentQuestionAttachmentsContext } from "./agentQuestionAttachmentsContext";
import { useAgentComposerPanelFocus } from "./useAgentComposerInteractionFocus";

export function AgentComposerQuestionPanel({
  interaction,
}: {
  readonly interaction: Extract<AgentComposerInteraction, { kind: "question" }>;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const port = useContext(AgentQuestionAttachmentsContext);
  useAgentComposerPanelFocus(rootRef);
  const target = interaction.attachments;
  const attachments = target.kind === "thread" ? (port?.forThread(target.threadId) ?? null) : null;
  return (
    <div
      className="cv-composer-interaction cv-composer-interaction--question"
      ref={rootRef}
      tabIndex={-1}
    >
      <AgentQuestionCard
        attachments={attachments}
        attachmentsUnavailableReason={target.kind === "unavailable" ? target.reason : undefined}
        error={interaction.error}
        key={interaction.key}
        onAnswer={interaction.answer}
        pending={interaction.sending}
        request={interaction.request}
      />
    </div>
  );
}

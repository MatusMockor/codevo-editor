import { useRef } from "react";
import { AgentQuestionCard } from "../AgentQuestionCard";
import type { AgentComposerInteraction } from "./agentComposerInteraction";
import { useAgentComposerPanelFocus } from "./useAgentComposerInteractionFocus";

export function AgentComposerQuestionPanel({
  interaction,
}: {
  readonly interaction: Extract<AgentComposerInteraction, { kind: "question" }>;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useAgentComposerPanelFocus(rootRef);
  return (
    <div
      className="cv-composer-interaction cv-composer-interaction--question"
      ref={rootRef}
      tabIndex={-1}
    >
      <AgentQuestionCard
        error={interaction.error}
        key={interaction.key}
        onAnswer={interaction.answer}
        pending={interaction.sending}
        request={interaction.request}
      />
    </div>
  );
}

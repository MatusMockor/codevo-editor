import { X } from "lucide-react";
import { AGENT_DICTATION_DISMISS_LABEL } from "./agentDictationPresentation";
import type { AgentComposerDictation } from "./useAgentComposerDictation";

export interface AgentComposerDictationNoticeProps {
  readonly dictation: AgentComposerDictation;
}

export function AgentComposerDictationNotice({ dictation }: AgentComposerDictationNoticeProps) {
  const { notice } = dictation;
  if (notice === null) return null;
  return (
    <p className="agent-composer__attachment-refusal" data-dictation-notice={notice.kind}>
      <span>{notice.message}</span>
      <button
        aria-label={AGENT_DICTATION_DISMISS_LABEL}
        className="agent-composer__attachment-dismiss"
        onClick={dictation.dismiss}
        type="button"
      >
        <X aria-hidden="true" size={13} />
      </button>
    </p>
  );
}

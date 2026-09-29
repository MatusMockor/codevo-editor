import type { RefObject } from "react";
import { Paperclip } from "lucide-react";
import { MAX_AGENT_QUESTION_TEXT_BYTES } from "../../domain/agentQuestion";
import { AgentComposerAttachments } from "./AgentComposerAttachments";
import type { AgentQuestionAttachmentsView } from "./useAgentQuestionAttachments";

export interface AgentQuestionCustomAnswerProps {
  readonly attachments: AgentQuestionAttachmentsView;
  readonly controlId: string;
  readonly dropRef: RefObject<HTMLDivElement | null>;
  readonly lengthError: string | null;
  readonly text: string;
  onChange(text: string): void;
}

export function AgentQuestionCustomAnswer({
  attachments,
  controlId,
  dropRef,
  lengthError,
  text,
  onChange,
}: AgentQuestionCustomAnswerProps) {
  const surface = attachments.surface;
  return (
    <>
      <label className="agent-question-card__custom-label" htmlFor={`${controlId}-custom`}>
        Your own answer or additional details
      </label>
      <div
        ref={dropRef}
        className="agent-question-card__custom"
        data-agent-question-drop={attachments.dropActive ? "active" : undefined}
      >
        {surface !== null && (
          <AgentComposerAttachments
            drafts={surface.drafts}
            refusal={surface.refusal}
            onDismissRefusal={surface.dismissRefusal}
            onRemove={attachments.remove}
          />
        )}
        <textarea
          id={`${controlId}-custom`}
          value={text}
          maxLength={MAX_AGENT_QUESTION_TEXT_BYTES}
          aria-invalid={lengthError !== null || undefined}
          aria-describedby={lengthError !== null ? `${controlId}-length` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onPaste={attachments.paste}
        />
        {attachments.available && (
          <button
            type="button"
            className="agent-question-card__attach"
            aria-label="Attach files"
            title="Attach files"
            onClick={attachments.open}
          >
            <Paperclip aria-hidden="true" size={14} strokeWidth={2} />
          </button>
        )}
      </div>
      {attachments.notice !== null && (
        <p className="agent-question-card__error" role="status">
          {attachments.notice}
        </p>
      )}
      {lengthError !== null && (
        <p className="agent-question-card__error" id={`${controlId}-length`}>
          {lengthError}
        </p>
      )}
    </>
  );
}

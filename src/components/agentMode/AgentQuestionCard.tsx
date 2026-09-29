import { useId, useRef, useState } from "react";
import type { AgentQuestionAttachments } from "../../application/agentQuestionAttachments";
import {
  MAX_AGENT_QUESTION_TEXT_BYTES,
  agentQuestionAnswerWithAttachments,
  parseAgentQuestionResponse,
  type AgentQuestionAnswer,
  type AgentQuestionRequest,
  type AgentQuestionResponse,
} from "../../domain/agentQuestion";
import { AgentQuestionCustomAnswer } from "./AgentQuestionCustomAnswer";
import {
  openAgentAttachmentPicker,
  subscribeAgentAttachmentDragDrop,
  type AgentComposerDragDropSubscribe,
  type AgentComposerFilePicker,
} from "./agentComposerAttachmentPorts";
import { AGENT_QUESTION_ATTACHMENTS_UNAVAILABLE } from "./composer/agentComposerInteraction";
import { useAgentQuestionAttachments } from "./useAgentQuestionAttachments";
import "./agentQuestionCard.css";

export const AGENT_QUESTION_ATTACHMENTS_TOO_LONG =
  "This answer is too long with its attachment paths. Shorten it or remove an attachment.";

const UTF8 = new TextEncoder();

export interface AgentQuestionCardProps {
  readonly request: AgentQuestionRequest;
  readonly pending: boolean;
  readonly error: string | null;
  /** Resolve only after acceptance; reject on failure so the user can retry. */
  readonly onAnswer: (response: AgentQuestionResponse) => void | Promise<void>;
  readonly attachments?: AgentQuestionAttachments | null;
  readonly attachmentsUnavailableReason?: string;
  readonly attachmentPicker?: AgentComposerFilePicker;
  readonly attachmentDragDrop?: AgentComposerDragDropSubscribe;
}

/** Callers key this card by their exact workspace/server ownership generation. */
export function AgentQuestionCard(props: AgentQuestionCardProps) {
  const { request } = props;
  return (
    <AgentQuestionCardBody
      key={JSON.stringify([request.provider, request.taskId, request.id, request.status])}
      {...props}
    />
  );
}

function AgentQuestionCardBody(props: AgentQuestionCardProps) {
  const { request } = props;
  switch (request.status) {
    case "pending":
      return <AgentQuestionForm {...props} />;
    case "answered":
      return null;
    case "cancelled":
    case "expired":
      return (
        <section className="agent-question-card" aria-label="Agent question">
          <p role="status">
            {request.status === "cancelled"
              ? "Question cancelled. The agent is no longer waiting for an answer."
              : "Question expired. This run can no longer receive an answer."}
          </p>
        </section>
      );
    default:
      return unsupportedQuestionStatus(request);
  }
}

function unsupportedQuestionStatus(request: never): never {
  throw new TypeError(`Unsupported agent question status: ${JSON.stringify(request)}.`);
}

function AgentQuestionForm(props: AgentQuestionCardProps) {
  const { request, pending, error, onAnswer } = props;
  const controlId = useId();
  const dropRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<readonly AgentQuestionAnswer[]>(() =>
    request.questions.map((question) => ({ questionId: question.id, optionIds: [], text: "" })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const question = request.questions[index];
  const answer = answers[index];
  const busy = pending || submitting || accepted;
  const questionAttachments = useAgentQuestionAttachments({
    capability: props.attachments ?? null,
    unavailableReason: props.attachmentsUnavailableReason ?? AGENT_QUESTION_ATTACHMENTS_UNAVAILABLE,
    request,
    questionId: question.id,
    enabled: question.allowCustom,
    busy,
    picker: props.attachmentPicker ?? openAgentAttachmentPicker,
    dragDrop: props.attachmentDragDrop ?? subscribeAgentAttachmentDragDrop,
    dropTarget: dropRef,
  });

  const update = (next: AgentQuestionAnswer) => {
    setAnswers((current) => current.map((item, position) => (position === index ? next : item)));
    setSubmitError(null);
  };
  const withReservedPaths = (item: AgentQuestionAnswer): AgentQuestionAnswer => {
    const reserved = questionAttachments.reservedLineBytes(item.questionId);
    if (reserved === 0) return item;
    return agentQuestionAnswerWithAttachments(item, ["x".repeat(reserved)]);
  };
  const overflows = (item: AgentQuestionAnswer): boolean =>
    UTF8.encode(withReservedPaths(item).text).length > MAX_AGENT_QUESTION_TEXT_BYTES;
  const currentValid = validResponse([withReservedPaths(answer)], { questions: [question] });
  const allValid = validResponse(answers.map(withReservedPaths), request);
  const sendable = allValid && !questionAttachments.blocked;
  const tooLong = UTF8.encode(answer.text).length > MAX_AGENT_QUESTION_TEXT_BYTES;
  const tooLongWithPaths = !tooLong && overflows(answer);
  const lengthError = tooLong
    ? "This answer is too long. Please shorten it."
    : tooLongWithPaths
      ? AGENT_QUESTION_ATTACHMENTS_TOO_LONG
      : null;
  const last = index === request.questions.length - 1;
  const sendHint =
    last && !busy && !sendable
      ? agentQuestionSendHint(request, answers, questionAttachments.blockedQuestion, overflows)
      : null;

  return (
    <section className="agent-question-card" aria-label="Agent question" aria-busy={busy}>
      <div className="agent-question-card__status">
        <span role="status">
          {accepted
            ? "Waiting for confirmation…"
            : busy
              ? "Sending answer…"
              : "Waiting for your answer"}
        </span>
        <span aria-live="polite">
          {index + 1} of {request.questions.length}
        </span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!sendable || busy || submittingRef.current || !last) return;
          submittingRef.current = true;
          setSubmitting(true);
          setSubmitError(null);
          void (async () => {
            try {
              const resolved = await questionAttachments.resolve(answers);
              if (resolved.kind === "abandoned") return;
              if (resolved.kind === "refused") {
                submittingRef.current = false;
                setSubmitError(resolved.reason);
                return;
              }
              await onAnswer(parseAgentQuestionResponse({ answers: resolved.answers }, request));
              questionAttachments.markSent();
              setAccepted(true);
            } catch {
              submittingRef.current = false;
              setSubmitError("Could not send your answer. Please try again.");
            } finally {
              setSubmitting(false);
            }
          })();
        }}
      >
        <fieldset disabled={busy}>
          <legend>{question.prompt}</legend>
          {question.multiple && question.options.length > 0 && (
            <p className="agent-question-card__hint">Choose one or more options.</p>
          )}
          <div className="agent-question-card__choices">
            {question.options.map((option, optionIndex) => (
              <label className="agent-question-card__choice" key={option.id}>
                <input
                  type={question.multiple ? "checkbox" : "radio"}
                  name={`${controlId}-choices`}
                  checked={answer.optionIds.includes(option.id)}
                  aria-describedby={
                    option.description ? `${controlId}-option-${optionIndex}` : undefined
                  }
                  onChange={() =>
                    update({
                      ...answer,
                      optionIds: question.multiple
                        ? answer.optionIds.includes(option.id)
                          ? answer.optionIds.filter((id) => id !== option.id)
                          : [...answer.optionIds, option.id]
                        : [option.id],
                    })
                  }
                />
                <span>
                  {option.label}
                  {option.description && (
                    <span
                      className="agent-question-card__description"
                      id={`${controlId}-option-${optionIndex}`}
                    >
                      {option.description}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          {question.allowCustom && (
            <>
              {answer.optionIds.length > 0 && (
                <button
                  type="button"
                  className="agent-question-card__clear"
                  onClick={() => update({ ...answer, optionIds: [] })}
                >
                  Clear selection
                </button>
              )}
              <AgentQuestionCustomAnswer
                attachments={questionAttachments}
                controlId={controlId}
                dropRef={dropRef}
                lengthError={lengthError}
                onChange={(text) => update({ ...answer, text })}
                text={answer.text}
              />
            </>
          )}
        </fieldset>
        {sendHint !== null && !(error || submitError) && (
          <p className="agent-question-card__hint" role="status">
            {sendHint}
          </p>
        )}
        {(error || submitError) && (
          <p className="agent-question-card__error" role="alert">
            {error || submitError}
          </p>
        )}
        <div className="agent-question-card__actions">
          {index > 0 && (
            <button type="button" disabled={busy} onClick={() => setIndex(index - 1)}>
              Back
            </button>
          )}
          {last ? (
            <button
              type="submit"
              className="agent-question-card__submit"
              disabled={busy || !sendable}
            >
              {accepted ? "Waiting…" : busy ? "Sending…" : "Send answer"}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !currentValid}
              onClick={() => setIndex(index + 1)}
            >
              Next
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function agentQuestionSendHint(
  request: AgentQuestionRequest,
  answers: readonly AgentQuestionAnswer[],
  blocked: (questionId: string) => boolean,
  overflows: (answer: AgentQuestionAnswer) => boolean,
): string | null {
  const total = request.questions.length;
  for (const [position, answer] of answers.entries()) {
    const label = total === 1 ? "This answer" : `Answer ${position + 1}`;
    if (blocked(answer.questionId)) {
      return `${label} has an attachment that is still saving or failed. Wait for it or remove it.`;
    }
    if (overflows(answer)) return `${label} is too long with its attachment paths.`;
  }
  return null;
}

function validResponse(
  answers: readonly AgentQuestionAnswer[],
  request: Pick<AgentQuestionRequest, "questions">,
): boolean {
  try {
    parseAgentQuestionResponse({ answers }, request);
    return true;
  } catch {
    return false;
  }
}

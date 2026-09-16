import { useId, useRef, useState } from "react";
import {
  MAX_AGENT_QUESTION_TEXT_BYTES,
  parseAgentQuestionResponse,
  type AgentQuestionAnswer,
  type AgentQuestionRequest,
  type AgentQuestionResponse,
} from "../../domain/agentQuestion";
import "./agentQuestionCard.css";

export interface AgentQuestionCardProps {
  readonly request: AgentQuestionRequest;
  readonly pending: boolean;
  readonly error: string | null;
  /** Resolve only after acceptance; reject on failure so the user can retry. */
  readonly onAnswer: (response: AgentQuestionResponse) => void | Promise<void>;
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

function AgentQuestionCardBody({ request, pending, error, onAnswer }: AgentQuestionCardProps) {
  const controlId = useId();
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

  if (request.status === "answered") {
    return (
      <section className="agent-question-card" aria-label="Agent question">
        <details>
          <summary>Answer sent</summary>
          <dl>
            {request.questions.map((item) => {
              const response = request.answers.find((value) => value.questionId === item.id)!;
              return (
                <div key={item.id}>
                  <dt>{item.prompt}</dt>
                  <dd>
                    {[
                      ...item.options
                        .filter((option) => response.optionIds.includes(option.id))
                        .map((option) => option.label),
                      response.text,
                    ]
                      .filter(Boolean)
                      .join("\n")}
                  </dd>
                </div>
              );
            })}
          </dl>
        </details>
      </section>
    );
  }
  if (request.status !== "pending") {
    return (
      <section className="agent-question-card" aria-label="Agent question">
        <p role="status">
          {request.status === "cancelled"
            ? "Question cancelled. The agent is no longer waiting for an answer."
            : "Question expired. This run can no longer receive an answer."}
        </p>
      </section>
    );
  }

  const update = (next: AgentQuestionAnswer) => {
    setAnswers((current) => current.map((item, position) => (position === index ? next : item)));
    setSubmitError(null);
  };
  const currentValid = validResponse([answer], { questions: [question] });
  const allValid = validResponse(answers, request);
  const tooLong = new TextEncoder().encode(answer.text).length > MAX_AGENT_QUESTION_TEXT_BYTES;
  const last = index === request.questions.length - 1;

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
          if (!allValid || busy || submittingRef.current || !last) return;
          submittingRef.current = true;
          setSubmitting(true);
          setSubmitError(null);
          void (async () => {
            try {
              await onAnswer(parseAgentQuestionResponse({ answers }, request));
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
              <label className="agent-question-card__custom-label" htmlFor={`${controlId}-custom`}>
                Your own answer or additional details
              </label>
              <textarea
                id={`${controlId}-custom`}
                value={answer.text}
                maxLength={MAX_AGENT_QUESTION_TEXT_BYTES}
                aria-invalid={tooLong || undefined}
                aria-describedby={tooLong ? `${controlId}-length` : undefined}
                onChange={(event) => update({ ...answer, text: event.target.value })}
              />
              {tooLong && (
                <p className="agent-question-card__error" id={`${controlId}-length`}>
                  This answer is too long. Please shorten it.
                </p>
              )}
            </>
          )}
        </fieldset>
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
              disabled={busy || !allValid}
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

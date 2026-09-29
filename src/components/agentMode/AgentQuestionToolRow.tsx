import { useId, useMemo } from "react";
import { ChevronRight, MessageCircleQuestion } from "lucide-react";
import {
  agentQuestionToolOutcome,
  type AgentAnsweredQuestion,
  type AgentQuestionToolOutcome,
} from "../../domain/agentQuestionTranscript";
import { useAgentToolDisclosure } from "./AgentToolDisclosure";
import { AgentTurnAttachments, type AgentTurnAttachmentImageViewer } from "./AgentTurnAttachments";
import type { AgentTurnAttachmentView } from "./agentTurnAttachmentPresentation";
import type { AgentTurnItem } from "./agentModePresentation";

export const AGENT_QUESTION_SHORTENED_NOTE =
  "Part of this answer was shortened in the saved transcript.";

type QuestionToolItem = Extract<AgentTurnItem, { kind: "tool" }>;

export function AgentQuestionToolRow({
  attachmentImages,
  item,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly item: QuestionToolItem;
}) {
  const disclosure = useAgentToolDisclosure(item.toolId);
  const detailId = useId();
  const expanded = disclosure.expanded;
  const outcome = useMemo(
    () =>
      agentQuestionToolOutcome({
        inputSummary: item.inputSummary,
        output: item.output,
        isError: item.status === "error",
      }),
    [item.inputSummary, item.output, item.status],
  );
  const summary = rowSummary(outcome, item);

  return (
    <div className="agent-question-row">
      <button
        aria-controls={detailId}
        aria-expanded={expanded}
        className="cv-work-row agent-question-row__toggle"
        onClick={disclosure.toggle}
        type="button"
      >
        <span aria-hidden="true" className="cv-work-row__icon">
          <MessageCircleQuestion size={16} strokeWidth={1.5} />
        </span>
        <span className="agent-question-row__label">{summary.label}</span>
        {outcome.prompt !== null && (
          <span className="agent-question-row__prompt cv-work-row__label">{outcome.prompt}</span>
        )}
        {summary.answer !== null && (
          <span className="agent-question-row__answer">{summary.answer}</span>
        )}
        <ChevronRight aria-hidden="true" className="cv-work-row__chevron" size={14} />
      </button>
      <div className="agent-question-row__detail" hidden={!expanded} id={detailId}>
        {expanded && <AgentQuestionToolDetail images={attachmentImages} outcome={outcome} />}
      </div>
    </div>
  );
}

function rowSummary(
  outcome: AgentQuestionToolOutcome,
  item: QuestionToolItem,
): { readonly label: string; readonly answer: string | null } {
  switch (outcome.kind) {
    case "asked":
      return { label: "Question", answer: askedStatus(item.status) };
    case "answered":
      return { label: "Answered", answer: firstAnswer(outcome.answers[0]) };
    case "recorded":
      return { label: "Question", answer: "Answer recorded" };
    case "unanswered":
      return { label: "Question", answer: "Not answered" };
    default:
      return unsupportedOutcome(outcome);
  }
}

function askedStatus(status: QuestionToolItem["status"]): string {
  return status === "running" ? "Waiting for your answer" : "No answer recorded";
}

function firstAnswer(answer: AgentAnsweredQuestion | undefined): string | null {
  if (answer === undefined) return null;
  if (answer.answer !== "") return answer.answer.split("\n")[0] ?? null;
  if (answer.images.length > 0) return imageCount(answer.images.length);
  return "No option selected";
}

function imageCount(count: number): string {
  return count === 1 ? "1 image" : `${count} images`;
}

function AgentQuestionToolDetail({
  images,
  outcome,
}: {
  readonly images: AgentTurnAttachmentImageViewer | null;
  readonly outcome: AgentQuestionToolOutcome;
}) {
  const answers = useMemo(
    () =>
      outcome.kind === "answered"
        ? outcome.answers.map((answer, index) => ({ answer, views: imageViews(answer, index) }))
        : [],
    [outcome],
  );
  if (outcome.kind === "asked") {
    return <p className="agent-question-row__note">{outcome.prompt ?? "Question"}</p>;
  }
  if (outcome.kind === "unanswered" || outcome.kind === "recorded") {
    return <p className="agent-question-row__note">{outcome.text}</p>;
  }
  return (
    <>
      <dl className="agent-question-row__answers">
        {answers.map(({ answer, views }, index) => (
          <div className="agent-question-row__pair" key={index}>
            <dt>{answer.question}</dt>
            <dd>
              {answer.answer === "" && views.length === 0 ? "No option selected" : answer.answer}
              {views.length > 0 && (
                <div className="agent-question-row__images">
                  <AgentTurnAttachments attachments={views} images={images} />
                </div>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {!outcome.complete && (
        <p className="agent-question-row__note" role="note">
          {AGENT_QUESTION_SHORTENED_NOTE}
        </p>
      )}
    </>
  );
}

function imageViews(
  answer: AgentAnsweredQuestion,
  index: number,
): ReadonlyArray<AgentTurnAttachmentView> {
  return answer.images.map((image) => ({
    kind: "image",
    key: `${index}:${image.attachmentId}`,
    name: image.name,
    attachmentId: image.attachmentId,
    mime: image.mime,
  }));
}

function unsupportedOutcome(outcome: never): never {
  throw new TypeError(`Unsupported agent question outcome: ${JSON.stringify(outcome)}.`);
}

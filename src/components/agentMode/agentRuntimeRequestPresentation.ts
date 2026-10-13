import type { AgentApprovalDecision, AgentApprovalKind } from "../../domain/agentApproval";
import { isAgentAttachmentId, type AgentImageMime } from "../../domain/agentAttachment";
import {
  parseAgentAttachmentPromptLine,
  type AgentAttachmentPromptLine,
} from "../../domain/agentAttachmentPromptLine";
import type { AgentQuestion, AgentQuestionAnswer } from "../../domain/agentQuestion";
import type {
  AgentRuntimeApprovalBody,
  AgentRuntimeQuestionBody,
  AgentRuntimeRequestCloseReason,
} from "../../domain/agentRuntimeRequest";
import type { ClosedAgentRuntimeRequest } from "../../domain/agentTurnRequestRows";
import { presentAgentApproval } from "./agentApprovalPresenter";
import type { AgentTurnAttachmentView } from "./agentTurnAttachmentPresentation";

export const AGENT_REQUEST_ROW_LIMITS = {
  titleChars: 200,
  summaryChars: 120,
  promptChars: 480,
  promptLines: 6,
  answerChars: 480,
  answerLines: 6,
  optionChars: 160,
  detailChars: 1_200,
  detailLines: 12,
  factValueChars: 240,
  factValueLines: 4,
  questions: 4,
  options: 12,
  facts: 8,
  attachments: 16,
} as const;

export const AGENT_REQUEST_TRUNCATION_MARKER = "…";

export interface AgentRequestClampedText {
  readonly preview: string;
  readonly full: string;
  readonly clamped: boolean;
}

export type AgentRuntimeRequestGlyph = "question" | "approval" | "approved" | "denied";

export interface AgentRequestQuestionView {
  readonly key: string;
  readonly prompt: AgentRequestClampedText;
  readonly selected: readonly string[];
  readonly text: AgentRequestClampedText | null;
  readonly attachments: readonly AgentTurnAttachmentView[];
  readonly notChosen: readonly string[];
  readonly omittedOptions: number;
  readonly emptyNote: string | null;
}

export interface AgentRequestFactView {
  readonly key: string;
  readonly label: string;
  readonly value: AgentRequestClampedText;
}

export type AgentRuntimeRequestDetailView =
  | {
      readonly kind: "question";
      readonly questions: readonly AgentRequestQuestionView[];
      readonly omittedQuestions: number;
    }
  | {
      readonly kind: "approval";
      readonly heading: AgentRequestClampedText;
      readonly detailLabel: string;
      readonly detail: AgentRequestClampedText | null;
      readonly truncatedNote: string | null;
      readonly facts: readonly AgentRequestFactView[];
      readonly omittedFacts: number;
    };

export interface AgentRuntimeRequestView {
  readonly id: string;
  readonly glyph: AgentRuntimeRequestGlyph;
  readonly settled: boolean;
  readonly label: string;
  readonly title: string;
  readonly summary: string | null;
  readonly ending: string;
  readonly detail: AgentRuntimeRequestDetailView;
}

type ClosedQuestionRequest = Extract<
  ClosedAgentRuntimeRequest,
  { readonly body: AgentRuntimeQuestionBody }
>;
type ClosedApprovalRequest = Extract<
  ClosedAgentRuntimeRequest,
  { readonly body: AgentRuntimeApprovalBody }
>;
type UnresolvedStatus = Exclude<ClosedAgentRuntimeRequest["status"], "resolved">;

interface Wording {
  readonly subject: string;
  readonly settled: string;
  readonly reply: string;
}

interface AnswerParts {
  readonly text: string;
  readonly attachments: readonly AgentTurnAttachmentView[];
}

const QUESTION_WORDING: Wording = { subject: "question", settled: "answered", reply: "answer" };
const APPROVAL_WORDING: Wording = { subject: "request", settled: "decided", reply: "decision" };
const LINE_BREAK = /\r\n|\r|\n/u;
const CARRIAGE_BREAK = /\r\n?/gu;
const UNNAMED_ATTACHMENT = "Attachment";
const IMAGE_MIMES: ReadonlyMap<string, AgentImageMime> = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
]);
const NO_ANSWER_NOTE = "No answer";
const ANSWER_NOT_RECORDED_NOTE = "Answer not recorded";

export function presentAgentRuntimeRequest(
  request: ClosedAgentRuntimeRequest,
): AgentRuntimeRequestView {
  if (isQuestionRequest(request)) return presentQuestion(request);
  if (isApprovalRequest(request)) return presentApproval(request);
  return unsupported(request);
}

export function agentRuntimeRequestEnding(request: ClosedAgentRuntimeRequest): string {
  if (isQuestionRequest(request)) return questionEnding(request);
  if (isApprovalRequest(request)) return approvalEnding(request);
  return unsupported(request);
}

function isQuestionRequest(request: ClosedAgentRuntimeRequest): request is ClosedQuestionRequest {
  return request.body.kind === "question";
}

function isApprovalRequest(request: ClosedAgentRuntimeRequest): request is ClosedApprovalRequest {
  return request.body.kind === "approval";
}

function presentQuestion(request: ClosedQuestionRequest): AgentRuntimeRequestView {
  const settled = request.status === "resolved";
  const answers = request.resolution?.answers ?? [];
  const emptyNote = sentWithoutRecord(request) ? ANSWER_NOT_RECORDED_NOTE : NO_ANSWER_NOTE;
  const shown = request.body.questions.slice(0, AGENT_REQUEST_ROW_LIMITS.questions);
  const questions = shown.map((question, index) =>
    questionView(
      question,
      answers.find((answer) => answer.questionId === question.id),
      index,
      emptyNote,
    ),
  );
  return {
    id: request.id,
    glyph: "question",
    settled,
    label: settled ? "Answered" : "Question",
    title: shortened(firstLine(shown[0]?.prompt ?? ""), AGENT_REQUEST_ROW_LIMITS.titleChars),
    summary: answerSummary(questions[0]),
    ending: questionEnding(request),
    detail: {
      kind: "question",
      questions,
      omittedQuestions: request.body.questions.length - shown.length,
    },
  };
}

function presentApproval(request: ClosedApprovalRequest): AgentRuntimeRequestView {
  const body = request.body;
  const settled = request.status === "resolved";
  const decision = request.resolution?.decision ?? null;
  const shared = presentAgentApproval({
    id: request.id,
    taskId: request.turnId,
    provider: request.provider,
    kind: body.approvalKind,
    title: body.title,
    detail: body.detail,
    detailTruncated: body.detailTruncated,
    facts: body.facts,
    decisions: body.decisions,
    status: "cancelled",
  });
  const facts = body.facts.slice(0, AGENT_REQUEST_ROW_LIMITS.facts);
  return {
    id: request.id,
    glyph: approvalGlyph(settled, decision),
    settled,
    label: approvalLabel(body.approvalKind, settled ? decision : null),
    title: shortened(firstLine(body.title), AGENT_REQUEST_ROW_LIMITS.titleChars),
    summary: decision === null ? null : decisionSummary(body.approvalKind, decision, settled),
    ending: approvalEnding(request),
    detail: {
      kind: "approval",
      heading: clampedText(
        body.title,
        AGENT_REQUEST_ROW_LIMITS.promptChars,
        AGENT_REQUEST_ROW_LIMITS.promptLines,
      ),
      detailLabel: shared.detailLabel,
      detail:
        body.detail.trim() === ""
          ? null
          : clampedText(
              body.detail,
              AGENT_REQUEST_ROW_LIMITS.detailChars,
              AGENT_REQUEST_ROW_LIMITS.detailLines,
            ),
      truncatedNote: shared.truncatedNote,
      facts: facts.map((fact, index) => ({
        key: `${index}:${fact.label}`,
        label: fact.label,
        value: clampedText(
          fact.value,
          AGENT_REQUEST_ROW_LIMITS.factValueChars,
          AGENT_REQUEST_ROW_LIMITS.factValueLines,
        ),
      })),
      omittedFacts: body.facts.length - facts.length,
    },
  };
}

function sentWithoutRecord(request: ClosedQuestionRequest): boolean {
  if (request.resolution !== null) return false;
  const reason = request.responseCapability.reason;
  return reason === "answerUnconfirmed" || reason === "deliveryFailed";
}

function questionView(
  question: AgentQuestion,
  answer: AgentQuestionAnswer | undefined,
  index: number,
  emptyNote: string,
): AgentRequestQuestionView {
  const chosen = new Set(answer?.optionIds ?? []);
  const offered = question.options.slice(0, AGENT_REQUEST_ROW_LIMITS.options);
  const parts = answerParts(answer?.text ?? "", index);
  const selected = offered.filter((option) => chosen.has(option.id));
  const answered = selected.length > 0 || parts.text !== "" || parts.attachments.length > 0;
  return {
    key: `${index}:${question.id}`,
    prompt: clampedText(
      question.prompt,
      AGENT_REQUEST_ROW_LIMITS.promptChars,
      AGENT_REQUEST_ROW_LIMITS.promptLines,
    ),
    selected: selected.map((option) => optionLabel(option.label)),
    text:
      parts.text === ""
        ? null
        : clampedText(
            parts.text,
            AGENT_REQUEST_ROW_LIMITS.answerChars,
            AGENT_REQUEST_ROW_LIMITS.answerLines,
          ),
    attachments: parts.attachments,
    notChosen: offered
      .filter((option) => !chosen.has(option.id))
      .map((option) => optionLabel(option.label)),
    omittedOptions: question.options.length - offered.length,
    emptyNote: answered ? null : emptyNote,
  };
}

function optionLabel(label: string): string {
  return shortened(label, AGENT_REQUEST_ROW_LIMITS.optionChars);
}

function answerSummary(question: AgentRequestQuestionView | undefined): string | null {
  if (question === undefined || question.emptyNote !== null) return null;
  const typed = question.text === null ? [] : [firstLine(question.text.full)];
  const said = [...question.selected, ...typed].filter((part) => part !== "").join(", ");
  if (said !== "") return shortened(said, AGENT_REQUEST_ROW_LIMITS.summaryChars);
  return attachmentCount(question.attachments.length);
}

function attachmentCount(count: number): string {
  return count === 1 ? "1 attachment" : `${count} attachments`;
}

function answerParts(text: string, questionIndex: number): AnswerParts {
  const kept: string[] = [];
  const attachments: AgentTurnAttachmentView[] = [];
  let omitted = 0;
  for (const line of text.split(LINE_BREAK)) {
    const attached = parseAgentAttachmentPromptLine(line.trim());
    if (attached === null) {
      kept.push(line);
      continue;
    }
    if (attachments.length >= AGENT_REQUEST_ROW_LIMITS.attachments) {
      omitted += 1;
      continue;
    }
    attachments.push(attachmentView(attached, `${questionIndex}:${attachments.length}`));
  }
  if (omitted > 0) {
    attachments.push({
      kind: "chip",
      key: `${questionIndex}:omitted`,
      name: `${omitted} more not shown`,
      glyph: "file",
    });
  }
  return { text: kept.join("\n").trim(), attachments };
}

function attachmentView(attached: AgentAttachmentPromptLine, key: string): AgentTurnAttachmentView {
  const name = safeAttachmentName(attached.name);
  const kind = attached.kind;
  switch (kind) {
    case "image":
      return imageAttachmentView(name, attached.path, key);
    case "file":
      return { kind: "chip", key, name, glyph: "file" };
    case "reference":
    case "folder":
      return { kind: "chip", key, name, glyph: "reference" };
    default:
      return unsupported(kind);
  }
}

function imageAttachmentView(name: string, path: string, key: string): AgentTurnAttachmentView {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  const attachmentId = file.slice(0, Math.max(dot, 0));
  const mime = IMAGE_MIMES.get(file.slice(dot + 1).toLowerCase());
  if (dot <= 0 || mime === undefined || !isAgentAttachmentId(attachmentId))
    return { kind: "chip", key, name, glyph: "image" };
  return { kind: "image", key, name, attachmentId, mime };
}

function safeAttachmentName(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1).trim();
  return base === "" ? UNNAMED_ATTACHMENT : base;
}

function approvalGlyph(
  settled: boolean,
  decision: AgentApprovalDecision | null,
): AgentRuntimeRequestGlyph {
  if (!settled || decision === null) return "approval";
  return decision === "deny" ? "denied" : "approved";
}

function approvalLabel(kind: AgentApprovalKind, decision: AgentApprovalDecision | null): string {
  if (decision === null) return kind === "plan" ? "Plan review" : "Approval";
  const denied = decision === "deny";
  switch (kind) {
    case "plan":
      return denied ? "Kept planning" : "Plan approved";
    case "mcpElicitation":
      return denied ? "Declined" : "Accepted";
    case "command":
    case "fileChange":
    case "tool":
      return denied ? "Denied" : "Approved";
    default:
      return unsupported(kind);
  }
}

function decisionSummary(
  kind: AgentApprovalKind,
  decision: AgentApprovalDecision,
  settled: boolean,
): string | null {
  if (!settled) return `Sent: ${decisionPhrase(kind, decision)}`;
  if (kind === "plan" || kind === "mcpElicitation") return null;
  switch (decision) {
    case "allowOnce":
      return "Allowed once";
    case "allowForSession":
      return "Allowed for this session";
    case "deny":
      return null;
    default:
      return unsupported(decision);
  }
}

function decisionPhrase(kind: AgentApprovalKind, decision: AgentApprovalDecision): string {
  if (kind === "plan") return decision === "deny" ? "keep planning" : "approve the plan";
  if (kind === "mcpElicitation") return decision === "deny" ? "decline" : "accept";
  switch (decision) {
    case "allowOnce":
      return "allow once";
    case "allowForSession":
      return "allow for this session";
    case "deny":
      return "deny";
    default:
      return unsupported(decision);
  }
}

function questionEnding(request: ClosedQuestionRequest): string {
  if (request.status === "resolved") return "This question was answered.";
  return unresolvedEnding(request.status, request.responseCapability.reason, QUESTION_WORDING);
}

function approvalEnding(request: ClosedApprovalRequest): string {
  if (request.status === "resolved")
    return decidedEnding(request.body.approvalKind, request.resolution.decision);
  return unresolvedEnding(request.status, request.responseCapability.reason, APPROVAL_WORDING);
}

function decidedEnding(kind: AgentApprovalKind, decision: AgentApprovalDecision): string {
  if (kind === "plan")
    return decision === "deny" ? "The agent was asked to keep planning." : "The plan was approved.";
  if (kind === "mcpElicitation")
    return decision === "deny" ? "This request was declined." : "This request was accepted.";
  switch (decision) {
    case "allowOnce":
      return "This was allowed once.";
    case "allowForSession":
      return "This was allowed for the rest of the session.";
    case "deny":
      return "This was denied.";
    default:
      return unsupported(decision);
  }
}

function unresolvedEnding(
  status: UnresolvedStatus,
  reason: AgentRuntimeRequestCloseReason,
  wording: Wording,
): string {
  switch (reason) {
    case "turnEnded":
      return `The agent finished the turn before this was ${wording.settled}.`;
    case "providerCancelled":
      return `The agent withdrew this ${wording.subject} before it was ${wording.settled}.`;
    case "timedOut":
      return `This closed because no ${wording.reply} arrived in time.`;
    case "deliveryFailed":
      return `Your ${wording.reply} could not be delivered to the agent.`;
    case "appRestarted":
      return `Codevo quit before this was ${wording.settled}.`;
    case "answerUnconfirmed":
      return `Your ${wording.reply} was sent, but Codevo could not confirm the agent received it.`;
    case "runnerRestarted":
      return `The runner restarted before this was ${wording.settled}.`;
    case "runnerStopped":
      return `The runner stopped before this was ${wording.settled}.`;
    case "taskCancelled":
      return `The run was stopped before this was ${wording.settled}.`;
    case "unknown":
      return unexplainedEnding(status, wording);
    default:
      return unsupported(reason);
  }
}

function unexplainedEnding(status: UnresolvedStatus, wording: Wording): string {
  switch (status) {
    case "cancelled":
      return `This ${wording.subject} was cancelled before it was ${wording.settled}.`;
    case "expired":
      return `This ${wording.subject} closed before it was ${wording.settled}.`;
    case "timedOut":
      return `This ${wording.subject} closed after waiting too long for the ${wording.reply}.`;
    default:
      return unsupported(status);
  }
}

function firstLine(text: string): string {
  const trimmed = text.trim();
  const end = trimmed.search(LINE_BREAK);
  return end === -1 ? trimmed : trimmed.slice(0, end).trimEnd();
}

function shortened(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, safeCut(text, maxChars)).trimEnd()}${AGENT_REQUEST_TRUNCATION_MARKER}`;
}

function clampedText(text: string, maxChars: number, maxLines: number): AgentRequestClampedText {
  const full = text.replace(CARRIAGE_BREAK, "\n").trimEnd();
  const cut = Math.min(lineLimit(full, maxLines), maxChars);
  if (full.length <= cut) return { preview: full, full, clamped: false };
  return { preview: full.slice(0, safeCut(full, cut)).trimEnd(), full, clamped: true };
}

function lineLimit(text: string, maxLines: number): number {
  let index = -1;
  for (let line = 0; line < maxLines; line += 1) {
    index = text.indexOf("\n", index + 1);
    if (index === -1) return text.length;
  }
  return index;
}

function safeCut(text: string, cut: number): number {
  const code = text.charCodeAt(cut - 1);
  return code >= 0xd800 && code <= 0xdbff ? cut - 1 : cut;
}

function unsupported(value: never): never {
  throw new TypeError(`Unsupported agent runtime request value: ${JSON.stringify(value)}.`);
}

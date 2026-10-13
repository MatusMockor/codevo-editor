import { parseAgentApprovalRequest, type AgentApprovalRequest } from "./agentApproval";
import { parseAgentQuestionRequest, type AgentQuestionRequest } from "./agentQuestion";

export interface AgentInteractionSnapshot {
  readonly workspaceId: string;
  readonly taskId: string;
  readonly sequence: number;
  readonly questions: readonly AgentQuestionRequest[];
  readonly approvals: readonly AgentApprovalRequest[];
}

export const MAX_AGENT_INTERACTION_SNAPSHOT_QUESTIONS = 32;
export const MAX_AGENT_INTERACTION_SNAPSHOT_APPROVALS = 32;

const SNAPSHOT_FIELDS = ["workspaceId", "taskId", "sequence", "questions", "approvals"] as const;
const NO_SESSION_SEQUENCE = 0;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

interface OwnedRequest {
  readonly id: string;
  readonly taskId: string;
}

function invalid(): never {
  throw new Error("Invalid agent interaction snapshot.");
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).length !== SNAPSHOT_FIELDS.length ||
    !SNAPSHOT_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(result, field))
  )
    return invalid();
  return result;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) return invalid();
  return value;
}

function sequence(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}

function requests<Request extends OwnedRequest>(
  value: unknown,
  max: number,
  taskId: string,
  parse: (item: unknown) => Request,
): readonly Request[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  const parsed = (value as readonly unknown[]).map((item) => parse(item));
  if (parsed.some((request) => request.taskId !== taskId)) return invalid();
  if (new Set(parsed.map((request) => request.id)).size !== parsed.length) return invalid();
  return parsed;
}

export function parseAgentInteractionSnapshot(value: unknown): AgentInteractionSnapshot {
  const item = record(value);
  const taskId = identifier(item.taskId);
  const snapshot: AgentInteractionSnapshot = {
    workspaceId: identifier(item.workspaceId),
    taskId,
    sequence: sequence(item.sequence),
    questions: requests(
      item.questions,
      MAX_AGENT_INTERACTION_SNAPSHOT_QUESTIONS,
      taskId,
      parseAgentQuestionRequest,
    ),
    approvals: requests(
      item.approvals,
      MAX_AGENT_INTERACTION_SNAPSHOT_APPROVALS,
      taskId,
      parseAgentApprovalRequest,
    ),
  };
  if (snapshot.sequence === NO_SESSION_SEQUENCE && !isEmpty(snapshot)) return invalid();
  return snapshot;
}

function isEmpty(snapshot: AgentInteractionSnapshot): boolean {
  return snapshot.questions.length === 0 && snapshot.approvals.length === 0;
}

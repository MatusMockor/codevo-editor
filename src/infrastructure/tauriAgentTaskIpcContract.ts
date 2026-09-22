import { agentCliBinaryUnavailableMessage } from "../domain/agentCliVersion";
import {
  AgentTaskStartRejectedError,
  validateAcknowledgeAgentTaskOutputRequest,
  type AcknowledgeAgentTaskOutputRequest,
  parseAgentTaskOutputEvent,
  parseAgentTaskStatusEvent,
  parseAgentTaskSteerRejection,
  parseStartAgentTaskResult,
  validateAgentTaskReferenceRequest,
  validateStartAgentTaskRequest,
  validateSteerAgentTaskRequest,
  validateStopAgentTasksForRootRequest,
  type AgentTaskOutputEvent,
  type AgentTaskReferenceRequest,
  type AgentTaskStatusEvent,
  type AgentTaskSteerRejectionReason,
  type AgentTaskSteerResult,
  type StartAgentTaskRequest,
  type StartAgentTaskResult,
  type SteerAgentTaskRequest,
  type StopAgentTasksForRootRequest,
} from "../domain/agentTask";

export const START_AGENT_TASK_IPC_COMMAND = "start_agent_task" as const;
export const ACKNOWLEDGE_AGENT_TASK_START_IPC_COMMAND = "acknowledge_agent_task_start" as const;
export const STOP_AGENT_TASK_IPC_COMMAND = "stop_agent_task" as const;
export const STOP_AGENT_TASKS_FOR_ROOT_IPC_COMMAND = "stop_agent_tasks_for_root" as const;
export const STEER_AGENT_TASK_IPC_COMMAND = "steer_agent_task" as const;
export const CLOSE_AGENT_TASK_INPUT_IPC_COMMAND = "close_agent_task_input" as const;

export const IDEMPOTENT_AGENT_TASK_INPUT_CLOSE_REJECTIONS: ReadonlySet<AgentTaskSteerRejectionReason> =
  new Set<AgentTaskSteerRejectionReason>(["inputClosed", "notRunning", "notRegistered"]);

export const AGENT_TASK_STATUS_EVENT = "agent-task://status" as const;
export const AGENT_TASK_OUTPUT_EVENT = "agent-task://output" as const;

export type InvokeAgentTaskCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export const AGENT_LAUNCH_PROVIDER_MISMATCH_REJECTION =
  "Agent launch options do not match the agent CLI kind." as const;

export const DEFINITE_AGENT_TASK_START_REJECTIONS: ReadonlySet<string> = new Set([
  "Agent tasks require a trusted repository.",
  "Agent tasks require a trusted agent worktree.",
  "In-place agent tasks must run at the repository root.",
  "Agent task workspace is not registered or its identity changed.",
  "Agent project root does not match the registered workspace.",
  "Agent repository must be contained within the registered project root.",
  "Agent task paths must be bounded normalized absolute paths.",
  "Agent task workspace is closing or busy.",
  "Agent task trust authority is busy.",
  "Agent task startup is closed.",
  "Too many agent tasks are starting or running.",
  "Too many agent tasks are starting or running in this repository.",
  "An agent task is already using this repository's working tree.",
  "An agent task is already running in this working directory.",
  "An agent task with this taskId already exists.",
  "Agent provider settings changed. Retry the operation.",
  "Enable this provider in Settings before starting a turn.",
  "This provider is updating. Wait for the update to finish.",
  // These failures occur during catalog/CLI validation, before the agent is spawned.
  "Agent launch options include a capability the selected model does not support.",
  "Cannot verify the Claude Code version for this model. Refresh the provider status and try again.",
  "The installed Claude Code version does not support the selected model.",
  "Claude version checks are busy. Try again shortly.",
  "Provider version probe failed.",
  "Claude catalog unavailable.",
  AGENT_LAUNCH_PROVIDER_MISMATCH_REJECTION,
  agentCliBinaryUnavailableMessage("claudeCode"),
  agentCliBinaryUnavailableMessage("codex"),
]);

export function classifyAgentTaskStartFailure(error: unknown): unknown {
  const message = failureMessageOf(error);
  if (!DEFINITE_AGENT_TASK_START_REJECTIONS.has(message)) return error;
  return new AgentTaskStartRejectedError(message);
}

export async function invokeStartAgentTaskIpc(
  invokeCommand: InvokeAgentTaskCommand,
  request: StartAgentTaskRequest,
): Promise<StartAgentTaskResult> {
  const validated = validateStartAgentTaskRequest(request);
  const result = parseStartAgentTaskResult(
    await invokeStartCommand(invokeCommand, { request: validated }),
  );
  if (result.taskId !== validated.taskId) {
    throw new TypeError(
      "Invalid agent task value at result.taskId: expected the requested task id.",
    );
  }
  return result;
}

export async function invokeAcknowledgeAgentTaskStartIpc(
  invokeCommand: InvokeAgentTaskCommand,
  request: AgentTaskReferenceRequest,
): Promise<void> {
  return invokeUnit(
    invokeCommand,
    ACKNOWLEDGE_AGENT_TASK_START_IPC_COMMAND,
    validateAgentTaskReferenceRequest(request),
  );
}

export async function invokeAcknowledgeAgentTaskOutputIpc(
  invokeCommand: InvokeAgentTaskCommand,
  request: AcknowledgeAgentTaskOutputRequest,
): Promise<void> {
  return invokeUnit(
    invokeCommand,
    "acknowledge_agent_task_output",
    validateAcknowledgeAgentTaskOutputRequest(request),
  );
}

export async function invokeStopAgentTaskIpc(
  invokeCommand: InvokeAgentTaskCommand,
  request: AgentTaskReferenceRequest,
): Promise<void> {
  return invokeUnit(
    invokeCommand,
    STOP_AGENT_TASK_IPC_COMMAND,
    validateAgentTaskReferenceRequest(request),
  );
}

export async function invokeStopAgentTasksForRootIpc(
  invokeCommand: InvokeAgentTaskCommand,
  request: StopAgentTasksForRootRequest,
): Promise<void> {
  return invokeUnit(
    invokeCommand,
    STOP_AGENT_TASKS_FOR_ROOT_IPC_COMMAND,
    validateStopAgentTasksForRootRequest(request),
  );
}

export async function invokeSteerAgentTaskIpc(
  invokeCommand: InvokeAgentTaskCommand,
  request: SteerAgentTaskRequest,
): Promise<AgentTaskSteerResult> {
  const validated = validateSteerAgentTaskRequest(request);
  let value: unknown;
  try {
    value = await invokeCommand(STEER_AGENT_TASK_IPC_COMMAND, { request: validated });
  } catch (error) {
    const rejection = parseAgentTaskSteerRejection(error);
    if (rejection === null) throw error;
    return { kind: "rejected", rejection };
  }
  if (value !== null) {
    throw new TypeError("Invalid agent task value at result: expected null.");
  }
  return { kind: "accepted" };
}

export async function invokeCloseAgentTaskInputIpc(
  invokeCommand: InvokeAgentTaskCommand,
  request: AgentTaskReferenceRequest,
): Promise<void> {
  const validated = validateAgentTaskReferenceRequest(request);
  let value: unknown;
  try {
    value = await invokeCommand(CLOSE_AGENT_TASK_INPUT_IPC_COMMAND, { request: validated });
  } catch (error) {
    const rejection = parseAgentTaskSteerRejection(error);
    if (rejection === null) throw error;
    if (!IDEMPOTENT_AGENT_TASK_INPUT_CLOSE_REJECTIONS.has(rejection.reason)) throw error;
    return;
  }
  if (value !== null) {
    throw new TypeError("Invalid agent task value at result: expected null.");
  }
}

export function decodeAgentTaskStatusEvent(value: unknown): AgentTaskStatusEvent {
  return parseAgentTaskStatusEvent(value);
}

export function decodeAgentTaskOutputEvent(value: unknown): AgentTaskOutputEvent {
  return parseAgentTaskOutputEvent(value);
}

async function invokeUnit(
  invokeCommand: InvokeAgentTaskCommand,
  command: string,
  request: AgentTaskReferenceRequest | StopAgentTasksForRootRequest,
): Promise<void> {
  const value = await invokeCommand(command, { request });
  if (value !== null) {
    throw new TypeError("Invalid agent task value at result: expected null.");
  }
}

async function invokeStartCommand(
  invokeCommand: InvokeAgentTaskCommand,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await invokeCommand(START_AGENT_TASK_IPC_COMMAND, args);
  } catch (error) {
    throw classifyAgentTaskStartFailure(error);
  }
}

function failureMessageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

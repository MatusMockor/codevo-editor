import {
  AgentTaskStartRejectedError,
  parseAgentTaskOutputEvent,
  parseAgentTaskStatusEvent,
  parseStartAgentTaskResult,
  validateAgentTaskReferenceRequest,
  validateStartAgentTaskRequest,
  validateStopAgentTasksForRootRequest,
  type AgentTaskOutputEvent,
  type AgentTaskReferenceRequest,
  type AgentTaskStatusEvent,
  type StartAgentTaskRequest,
  type StartAgentTaskResult,
  type StopAgentTasksForRootRequest,
} from "../domain/agentTask";

export const START_AGENT_TASK_IPC_COMMAND = "start_agent_task" as const;
export const ACKNOWLEDGE_AGENT_TASK_START_IPC_COMMAND = "acknowledge_agent_task_start" as const;
export const STOP_AGENT_TASK_IPC_COMMAND = "stop_agent_task" as const;
export const STOP_AGENT_TASKS_FOR_ROOT_IPC_COMMAND = "stop_agent_tasks_for_root" as const;

export const AGENT_TASK_STATUS_EVENT = "agent-task://status" as const;
export const AGENT_TASK_OUTPUT_EVENT = "agent-task://output" as const;

export type InvokeAgentTaskCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export const DEFINITE_AGENT_TASK_START_REJECTIONS: ReadonlySet<string> = new Set([
  "Agent tasks require a trusted repository.",
  "Agent tasks require a trusted agent worktree.",
  "In-place agent tasks must run at the repository root.",
  "Too many agent tasks are starting or running.",
  "Too many agent tasks are starting or running in this repository.",
  "An agent task is already using this repository's working tree.",
  "An agent task is already running in this working directory.",
  "An agent task with this taskId already exists.",
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

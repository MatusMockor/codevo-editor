import {
  parseNodeRunTaskStatusEvent,
  parseStartNodeRunTaskResult,
  validateStartNodeRunTaskRequest,
  validateStopNodeRunTaskRequest,
  type NodeRunTaskStatusEvent,
  type StartNodeRunTaskRequest,
  type StartNodeRunTaskResult,
  type StopNodeRunTaskRequest,
} from "../domain/nodeRunTask";

export const START_NODE_RUN_TASK_IPC_COMMAND = "workspace_start_node_run_task" as const;
export const ACKNOWLEDGE_NODE_RUN_TASK_START_IPC_COMMAND =
  "workspace_acknowledge_node_run_task_start" as const;
export const STOP_NODE_RUN_TASK_IPC_COMMAND = "workspace_stop_node_run_task" as const;
export const NODE_RUN_TASK_STATUS_EVENT = "node-run-task-status" as const;

export type InvokeNodeRunTaskCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export async function invokeStartNodeRunTaskIpc(
  invokeCommand: InvokeNodeRunTaskCommand,
  request: StartNodeRunTaskRequest,
): Promise<StartNodeRunTaskResult> {
  const validated = validateStartNodeRunTaskRequest(request);
  const result = parseStartNodeRunTaskResult(
    await invokeCommand(START_NODE_RUN_TASK_IPC_COMMAND, { request: validated }),
  );
  if (result.runId !== validated.runId) {
    throw new TypeError(
      "Invalid Node run task value at result.runId: expected the requested run id.",
    );
  }
  return result;
}

export async function invokeAcknowledgeNodeRunTaskStartIpc(
  invokeCommand: InvokeNodeRunTaskCommand,
  request: StopNodeRunTaskRequest,
): Promise<void> {
  return invokeUnit(
    invokeCommand,
    ACKNOWLEDGE_NODE_RUN_TASK_START_IPC_COMMAND,
    validateStopNodeRunTaskRequest(request),
  );
}

export async function invokeStopNodeRunTaskIpc(
  invokeCommand: InvokeNodeRunTaskCommand,
  request: StopNodeRunTaskRequest,
): Promise<void> {
  return invokeUnit(
    invokeCommand,
    STOP_NODE_RUN_TASK_IPC_COMMAND,
    validateStopNodeRunTaskRequest(request),
  );
}

export function decodeNodeRunTaskStatusEvent(value: unknown): NodeRunTaskStatusEvent {
  return parseNodeRunTaskStatusEvent(value);
}

async function invokeUnit(
  invokeCommand: InvokeNodeRunTaskCommand,
  command: string,
  request: StopNodeRunTaskRequest,
): Promise<void> {
  const value = await invokeCommand(command, { request });
  if (value !== null) {
    throw new TypeError("Invalid Node run task value at result: expected null.");
  }
}

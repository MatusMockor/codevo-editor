import type { NodeRunTaskGateway } from "../domain/nodeRunTask";
import type { VscodeProcessTasksGateway } from "../domain/vscodeProcessTasksGateway";

export const unavailableNodeRunTaskGateway: NodeRunTaskGateway = {
  acknowledgeNodeRunTaskStart: async () => undefined,
  startNodeRunTask: async () => {
    throw new Error("Node run task execution is unavailable.");
  },
  stopNodeRunTask: async () => undefined,
  subscribeNodeRunTaskStatus: async () => () => undefined,
};

export const unavailableVscodeProcessTasksGateway: VscodeProcessTasksGateway = {
  acknowledgeVscodeProcessTaskStart: async () => undefined,
  discoverVscodeProcessTasks: async () => {
    throw new Error("VS Code process-task discovery is unavailable.");
  },
  startVscodeProcessTask: async () => {
    throw new Error("VS Code process-task execution is unavailable.");
  },
  stopVscodeProcessTask: async () => undefined,
  subscribeVscodeProcessTaskEvents: async () => () => undefined,
};

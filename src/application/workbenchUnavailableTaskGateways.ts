import type { VscodeProcessTasksGateway } from "../domain/vscodeProcessTasksGateway";

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

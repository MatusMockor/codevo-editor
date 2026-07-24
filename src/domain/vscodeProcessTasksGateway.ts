import type {
  VscodeProcessTaskEvent,
  VscodeProcessTaskOwner,
  VscodeProcessTasksSnapshot,
} from "./vscodeProcessTasks";

export interface VscodeProcessTasksGateway {
  discoverVscodeProcessTasks(workspaceId: string): Promise<VscodeProcessTasksSnapshot>;
  startVscodeProcessTask(owner: VscodeProcessTaskOwner): Promise<VscodeProcessTaskOwner>;
  acknowledgeVscodeProcessTaskStart(owner: VscodeProcessTaskOwner): Promise<void>;
  stopVscodeProcessTask(owner: VscodeProcessTaskOwner): Promise<void>;
  subscribeVscodeProcessTaskEvents(
    handler: (event: VscodeProcessTaskEvent) => void,
  ): Promise<() => void>;
}

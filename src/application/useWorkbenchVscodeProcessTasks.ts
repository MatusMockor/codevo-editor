import { useCallback } from "react";
import type { VscodeProcessTasksGateway } from "../domain/vscodeProcessTasksGateway";
import { useVscodeProcessTasks } from "./useVscodeProcessTasks";
import { unavailableVscodeProcessTasksGateway } from "./workbenchUnavailableTaskGateways";
import type { WorkbenchVscodeProcessTaskCommandsOptions } from "./workbenchVscodeProcessTaskCommands";

interface UseWorkbenchVscodeProcessTasksOptions {
  readonly configurationVersion: number;
  readonly gateway?: VscodeProcessTasksGateway;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
  readonly workspaceTrusted: boolean;
  requestTerminalSession(consumer: (sessionId: number | null) => void): void;
}

export function useWorkbenchVscodeProcessTasks({
  configurationVersion,
  gateway,
  requestTerminalSession,
  rootPath,
  workspaceId,
  workspaceTrusted,
}: UseWorkbenchVscodeProcessTasksOptions) {
  const requestTerminalSessionPromise = useCallback(
    () =>
      new Promise<number | null>((resolve) => {
        requestTerminalSession(resolve);
      }),
    [requestTerminalSession],
  );

  const state = useVscodeProcessTasks({
    configurationVersion,
    gateway: gateway ?? unavailableVscodeProcessTasksGateway,
    requestTerminalSession: requestTerminalSessionPromise,
    rootPath: gateway ? rootPath : null,
    workspaceId: gateway ? workspaceId : null,
    workspaceTrusted: Boolean(gateway) && workspaceTrusted,
  });
  const commands: WorkbenchVscodeProcessTaskCommandsOptions = {
    available: state.unavailable === null,
    discover: state.discover,
    discovering: state.discovering,
    occupied: state.occupied,
    start: state.start,
    tasks: state.tasks,
    trusted: workspaceTrusted,
  };
  return { commands, state };
}

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { VscodeProcessTasksGateway } from "../domain/vscodeProcessTasksGateway";
import { useNodePackageTaskProblemNoticeComposition } from "./useNodePackageTaskProblemNoticeComposition";
import { useVscodeProcessTasks } from "./useVscodeProcessTasks";
import type { WorkbenchNotice } from "./workbenchNotice";
import { unavailableVscodeProcessTasksGateway } from "./workbenchUnavailableTaskGateways";
import type { WorkbenchVscodeProcessTaskCommandsOptions } from "./workbenchVscodeProcessTaskCommands";

interface UseWorkbenchVscodeProcessTasksOptions {
  readonly configurationVersion: number;
  readonly gateway?: VscodeProcessTasksGateway;
  readonly rootPath: string | null;
  readonly setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;
  readonly workspaceId: string | null;
  readonly workspaceTrusted: boolean;
  requestTerminalSession(consumer: (sessionId: number | null) => void): void;
}

export function useWorkbenchVscodeProcessTasks({
  configurationVersion,
  gateway,
  requestTerminalSession,
  rootPath,
  setNotices,
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
  useNodePackageTaskProblemNoticeComposition(state.problemNotices, setNotices);
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

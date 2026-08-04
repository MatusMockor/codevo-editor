import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { VscodeProcessTaskDiagnostic } from "../domain/vscodeProcessTasks";
import type { VscodeProcessTasksGateway } from "../domain/vscodeProcessTasksGateway";
import {
  VSCODE_TASKS_EMPTY_CONFIG_REVISION,
  type VscodeProcessTasksConfigurationAction,
} from "./configureVscodeProcessTasks";
import { useCommitBailoutState } from "./useCommitBailoutState";
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
  configureTasks?(action: VscodeProcessTasksConfigurationAction): Promise<boolean>;
  requestTerminalSession(consumer: (sessionId: number | null) => void): void;
}

interface ConfigurationBoundary {
  readonly configurationVersion: number;
  readonly configureTasks:
    ((action: VscodeProcessTasksConfigurationAction) => Promise<boolean>) | undefined;
  readonly ownerKey: string | null;
  readonly trusted: boolean;
}

interface PendingConfigurationAdmission {
  readonly activation: number;
  readonly identity: object;
}

export function useWorkbenchVscodeProcessTasks({
  configurationVersion,
  gateway,
  requestTerminalSession,
  rootPath,
  setNotices,
  workspaceId,
  workspaceTrusted,
  configureTasks,
}: UseWorkbenchVscodeProcessTasksOptions) {
  const configurationOwnerKey = workspaceId && rootPath ? `${workspaceId}\u0000${rootPath}` : null;
  const configurationBoundary: ConfigurationBoundary = {
    configurationVersion,
    configureTasks,
    ownerKey: configurationOwnerKey,
    trusted: workspaceTrusted,
  };
  const configurationBoundaryRef = useRef<ConfigurationBoundary | null>(null);
  const configurationActivationRef = useRef(0);
  const pendingConfigurationRef = useRef<PendingConfigurationAdmission | null>(null);
  if (!sameConfigurationBoundary(configurationBoundaryRef.current, configurationBoundary)) {
    configurationBoundaryRef.current = configurationBoundary;
    configurationActivationRef.current += 1;
    pendingConfigurationRef.current = null;
  }
  const configurationActivation = configurationActivationRef.current;
  const configurationMountedRef = useRef(true);
  const currentConfigurationRef = useRef({
    activation: configurationActivation,
    ownerKey: configurationOwnerKey,
    trusted: workspaceTrusted,
  });
  currentConfigurationRef.current = {
    activation: configurationActivation,
    ownerKey: configurationOwnerKey,
    trusted: workspaceTrusted,
  };
  const [configurationOperation, setConfigurationOperation] = useCommitBailoutState<{
    readonly activation: number;
    readonly error: string | null;
    readonly pending: boolean;
  } | null>(null);
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
  const { discover, occupied } = state;
  const configurationAction =
    configureTasks && state.configRevision !== null
      ? vscodeProcessTasksConfigurationAction(state.configRevision, state.diagnostics)
      : null;
  const configure = useCallback(async (): Promise<boolean> => {
    if (
      !configureTasks ||
      !configurationAction ||
      !configurationOwnerKey ||
      !workspaceTrusted ||
      occupied ||
      pendingConfigurationRef.current !== null
    ) {
      return false;
    }
    const admission: PendingConfigurationAdmission = {
      activation: configurationActivation,
      identity: Object.freeze({}),
    };
    pendingConfigurationRef.current = admission;
    const isCurrent = () => {
      const current = currentConfigurationRef.current;
      return (
        configurationMountedRef.current &&
        current.activation === admission.activation &&
        current.ownerKey === configurationOwnerKey &&
        current.trusted &&
        pendingConfigurationRef.current?.identity === admission.identity
      );
    };
    setConfigurationOperation({
      activation: admission.activation,
      error: null,
      pending: true,
    });
    try {
      const configured = await configureTasks(configurationAction);
      if (!isCurrent()) return false;
      if (!configured) {
        setConfigurationOperation({
          activation: admission.activation,
          error: "Unable to configure tasks for this workspace.",
          pending: false,
        });
        return false;
      }
      if (configurationAction === "create") await discover();
      if (!isCurrent()) return false;
      setConfigurationOperation({
        activation: admission.activation,
        error: null,
        pending: false,
      });
      return true;
    } catch {
      if (isCurrent()) {
        setConfigurationOperation({
          activation: admission.activation,
          error: "Unable to configure tasks for this workspace.",
          pending: false,
        });
      }
      return false;
    } finally {
      if (pendingConfigurationRef.current?.identity === admission.identity) {
        pendingConfigurationRef.current = null;
      }
    }
  }, [
    configurationAction,
    configurationActivation,
    configurationOwnerKey,
    configureTasks,
    discover,
    occupied,
    setConfigurationOperation,
    workspaceTrusted,
  ]);

  useEffect(() => {
    setConfigurationOperation(null);
  }, [configurationActivation, setConfigurationOperation]);

  useEffect(() => {
    configurationMountedRef.current = true;
    return () => {
      configurationMountedRef.current = false;
      pendingConfigurationRef.current = null;
    };
  }, []);

  const currentConfigurationOperation =
    configurationOperation?.activation === configurationActivation ? configurationOperation : null;
  const configuredState = {
    ...state,
    configurationAction,
    configure,
    configuring: currentConfigurationOperation?.pending ?? false,
    error: currentConfigurationOperation?.error ?? state.error,
  };
  const commands: WorkbenchVscodeProcessTaskCommandsOptions = {
    available: state.unavailable === null,
    configurationAction,
    configure,
    configuring: configuredState.configuring,
    discover: state.discover,
    discovering: state.discovering,
    occupied: state.occupied,
    start: state.start,
    tasks: state.tasks,
    trusted: workspaceTrusted,
  };
  return { commands, state: configuredState };
}

function sameConfigurationBoundary(
  previous: ConfigurationBoundary | null,
  next: ConfigurationBoundary,
): boolean {
  return (
    previous !== null &&
    previous.configurationVersion === next.configurationVersion &&
    previous.configureTasks === next.configureTasks &&
    previous.ownerKey === next.ownerKey &&
    previous.trusted === next.trusted
  );
}

export function vscodeProcessTasksConfigurationAction(
  configRevision: string,
  diagnostics: readonly VscodeProcessTaskDiagnostic[],
): VscodeProcessTasksConfigurationAction {
  return configRevision === VSCODE_TASKS_EMPTY_CONFIG_REVISION &&
    diagnostics.length === 1 &&
    diagnostics[0]?.severity === "warning"
    ? "create"
    : "open";
}

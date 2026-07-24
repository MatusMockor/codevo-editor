import { useMemo } from "react";
import type { NodeRunTarget } from "../domain/nodeRunTask";
import type { NodeLaunchConfigurationReads } from "./nodeLaunchConfigurationLoader";
import { nodeRunConfigurationStrategy } from "./nodeRunConfigurationStrategy";
import {
  useNodeLaunchConfigurationPicker,
  type NodeLaunchConfigurationPicker,
  type NodeLaunchConfigurationPickerStrategy,
  type NodeLaunchPickerCoordinator,
} from "./useNodeLaunchConfigurationPicker";

export const NODE_RUN_CONFIGURATION_START_ERROR =
  "Node Run Without Debugging configuration could not be started.";

export interface UseNodeRunConfigurationLauncherOptions {
  readonly blocked: boolean;
  readonly configurationVersion?: number;
  readonly coordinator?: NodeLaunchPickerCoordinator;
  readonly isBlocked: () => boolean;
  readonly isWorkspaceCurrent: (rootPath: string, workspaceId: string) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly revealPicker: () => void;
  readonly rootPath: string | null;
  readonly startTarget: (target: NodeRunTarget) => boolean;
  readonly workspaceId: string | null;
  readonly workspaceReads: NodeLaunchConfigurationReads;
  readonly workspaceTrusted: boolean;
}

export type NodeRunConfigurationLauncher = NodeLaunchConfigurationPicker;

/** Run-specific adapter over the shared private configuration-picker engine. */
export function useNodeRunConfigurationLauncher(
  options: UseNodeRunConfigurationLauncherOptions,
): NodeRunConfigurationLauncher {
  const strategy = useMemo<NodeLaunchConfigurationPickerStrategy<NodeRunTarget>>(
    () => ({
      prepare: nodeRunConfigurationStrategy,
      start: options.startTarget,
      startErrorMessage: NODE_RUN_CONFIGURATION_START_ERROR,
    }),
    [options.startTarget],
  );
  const picker = useNodeLaunchConfigurationPicker({
    blocked: options.blocked,
    configurationVersion: options.configurationVersion,
    coordinator: options.coordinator,
    isBlocked: options.isBlocked,
    isWorkspaceCurrent: options.isWorkspaceCurrent,
    isWorkspaceTrusted: options.isWorkspaceTrusted,
    revealPicker: options.revealPicker,
    rootPath: options.rootPath,
    strategy,
    workspaceId: options.workspaceId,
    workspaceReads: options.workspaceReads,
    workspaceTrusted: options.workspaceTrusted,
  });
  const choices = useMemo(
    () =>
      Object.freeze(
        picker.choices.filter(({ runnable, targetKind }) => runnable || targetKind === "compound"),
      ),
    [picker.choices],
  );
  return {
    ...picker,
    choices,
    state:
      picker.state.kind === "ready" && choices.length === 0
        ? {
            kind: "empty",
            ...(picker.state.diagnosticNotice
              ? { diagnosticNotice: picker.state.diagnosticNotice }
              : {}),
          }
        : picker.state,
  };
}

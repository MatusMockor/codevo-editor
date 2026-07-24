import type { DebugLaunchTarget } from "../domain/debug";
import {
  nodeLaunchTargetFromConfiguration,
  type NodeLaunchConfiguration,
} from "../domain/nodeLaunchConfiguration";
import { toNodeRunTarget, type NodeRunTarget } from "../domain/nodeRunTask";
import type {
  NodeLaunchConfigurationUnsupportedReason,
  PreparedNodeLaunchConfiguration,
} from "./useNodeLaunchConfigurationPicker";

export type NodeRunConfigurationUnsupportedReason = NodeLaunchConfigurationUnsupportedReason;
export type NodeRunConfigurationPreparation = PreparedNodeLaunchConfiguration<NodeRunTarget>;

/** Converts a private named launch configuration into a cloned, transport-safe Run target. */
export function nodeRunConfigurationStrategy(
  configuration: NodeLaunchConfiguration,
  rootPath: string,
): NodeRunConfigurationPreparation {
  return prepareNodeRunLaunchTarget(nodeLaunchTargetFromConfiguration(configuration, rootPath));
}

export function prepareNodeRunLaunchTarget(
  launch: DebugLaunchTarget,
): NodeRunConfigurationPreparation {
  if (launch.kind === "node-attach") {
    return { kind: "unsupported", reason: "attachRequiresDebugger" };
  }
  if (launchEnablesInspector(launch)) {
    return { kind: "unsupported", reason: "inspectorRequiresDebugger" };
  }
  try {
    const target = toNodeRunTarget(launch);
    return target
      ? { kind: "supported", value: target }
      : { kind: "unsupported", reason: "unsupportedTarget" };
  } catch {
    return { kind: "unsupported", reason: "invalidOptions" };
  }
}

function launchEnablesInspector(launch: DebugLaunchTarget): boolean {
  if (
    launch.kind !== "node-configured-script" &&
    launch.kind !== "js-configured-test" &&
    launch.kind !== "node-npm-script"
  ) {
    return false;
  }
  return launch.args.some((argument) => argument.toLowerCase().startsWith("--inspect"));
}

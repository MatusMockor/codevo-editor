import {
  NodeLaunchConfigurationPicker,
  type NodeLaunchConfigurationPickerProps,
} from "./NodeLaunchConfigurationPicker";

export { MAX_NODE_LAUNCH_CONFIGURATION_PICKER_ROWS as MAX_NODE_DEBUG_PICKER_ROWS } from "./NodeLaunchConfigurationPicker";

export type NodeDebugConfigurationPickerProps = Omit<NodeLaunchConfigurationPickerProps, "intent">;

/** Backward-compatible Debug adapter over the shared launch picker surface. */
export function NodeDebugConfigurationPicker(props: NodeDebugConfigurationPickerProps) {
  return <NodeLaunchConfigurationPicker {...props} intent="debug" />;
}

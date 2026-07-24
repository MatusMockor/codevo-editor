import {
  NodeLaunchConfigurationPicker,
  type NodeLaunchConfigurationPickerChoice,
  type NodeLaunchConfigurationPickerState,
} from "./NodeLaunchConfigurationPicker";

export interface NodeRunConfigurationPickerLauncherProjection {
  readonly busy: boolean;
  readonly choices: readonly NodeLaunchConfigurationPickerChoice[];
  readonly error: string | null;
  readonly pickerOpen: boolean;
  readonly selectedName: string | null;
  readonly state:
    | NodeLaunchConfigurationPickerState
    | {
        readonly kind: NodeLaunchConfigurationPickerState;
        readonly diagnosticNotice?: {
          readonly count: number;
          readonly message: string;
        };
      };
  closePicker(): void;
  refresh(): void | Promise<unknown>;
  startNamed(name: string): void | Promise<unknown>;
}

export interface NodeRunConfigurationPickerHostProps {
  readonly launcher?: NodeRunConfigurationPickerLauncherProjection | null;
}

/** App-level adapter that exposes only the launcher's safe presentation projection. */
export function NodeRunConfigurationPickerHost({ launcher }: NodeRunConfigurationPickerHostProps) {
  if (!launcher) return null;
  const state = typeof launcher.state === "string" ? launcher.state : launcher.state.kind;
  return (
    <NodeLaunchConfigurationPicker
      busy={launcher.busy}
      choices={launcher.choices}
      diagnosticNotice={
        typeof launcher.state === "string" ? undefined : launcher.state.diagnosticNotice
      }
      error={launcher.error}
      intent="run"
      onClose={launcher.closePicker}
      onRefresh={() => void launcher.refresh()}
      onStartNamed={(name) => void launcher.startNamed(name)}
      open={launcher.pickerOpen}
      selectedName={launcher.selectedName}
      state={state}
    />
  );
}

import { Play } from "lucide-react";
import type { CSSProperties } from "react";

export interface NodeRunWithoutDebuggingPickerCommand {
  readonly canOpenPicker: () => boolean;
  readonly openPicker: () => void;
}

interface NodeRunWithoutDebuggingPickerActionProps {
  readonly command: NodeRunWithoutDebuggingPickerCommand;
}

const actionStyle: CSSProperties = {
  alignItems: "center",
  background: "transparent",
  border: 0,
  color: "inherit",
  display: "inline-flex",
  padding: 2,
};

/** Toolbar adapter for the existing owner-safe Run Without Debugging picker command. */
export function NodeRunWithoutDebuggingPickerAction({
  command,
}: NodeRunWithoutDebuggingPickerActionProps) {
  const canOpen = command.canOpenPicker();

  const openPicker = () => {
    // Re-evaluate at the mutation boundary; render-time availability may already be stale.
    if (!command.canOpenPicker()) return;
    command.openPicker();
  };

  return (
    <button
      aria-label="Select and start without debugging"
      disabled={!canOpen}
      onClick={openPicker}
      style={actionStyle}
      title="Run: Select and Start Without Debugging"
      type="button"
    >
      <Play aria-hidden="true" size={14} />
    </button>
  );
}

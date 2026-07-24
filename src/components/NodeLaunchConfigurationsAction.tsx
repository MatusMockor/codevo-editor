import { Settings } from "lucide-react";
import type { CSSProperties } from "react";

export interface NodeLaunchConfigurationsActionProps {
  readonly onOpen: () => void;
}

const actionStyle: CSSProperties = {
  alignItems: "center",
  background: "transparent",
  border: 0,
  color: "inherit",
  display: "inline-flex",
  padding: 2,
};

/** Toolbar adapter for the controlled Node launch-configuration editor surface. */
export function NodeLaunchConfigurationsAction({ onOpen }: NodeLaunchConfigurationsActionProps) {
  return (
    <button
      aria-label="Configure Node launch configurations"
      onClick={onOpen}
      style={actionStyle}
      title="Run: Configure Node Launch Configurations"
      type="button"
    >
      <Settings aria-hidden="true" size={14} />
    </button>
  );
}

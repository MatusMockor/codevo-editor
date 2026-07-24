import { Square } from "lucide-react";
import type { NodeRunStatusPresentation } from "../application/nodeRunWithoutDebuggingPresentation";

interface NodeRunStatusActionProps {
  readonly status: NodeRunStatusPresentation;
  onStop(): void;
}

export function NodeRunStatusAction({ status, onStop }: NodeRunStatusActionProps) {
  return (
    <button
      aria-label={status.stopLabel}
      aria-live="polite"
      className={`status-node-run ${status.phase}`}
      disabled={!status.canStop}
      onClick={onStop}
      title={status.stopLabel}
      type="button"
    >
      <Square aria-hidden="true" size={11} />
      {status.label}
    </button>
  );
}

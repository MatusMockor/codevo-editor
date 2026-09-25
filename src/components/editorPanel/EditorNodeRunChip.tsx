import type { NodeRunStatusPresentation } from "../../application/nodeRunWithoutDebuggingPresentation";

export interface EditorNodeRunChipProps {
  readonly nodeRun: NodeRunStatusPresentation;
  onStop(): void;
}

export function EditorNodeRunChip({ nodeRun, onStop }: EditorNodeRunChipProps) {
  return (
    <span className="cv-esub__run" data-phase={nodeRun.phase}>
      <span aria-hidden="true" className="cv-esub__run-dot" />
      <span aria-live="polite">{nodeRun.label}</span>
      <button
        aria-label={nodeRun.stopLabel}
        className="cv-esub__run-stop"
        disabled={!nodeRun.canStop}
        onClick={onStop}
        title={nodeRun.stopLabel}
        type="button"
      >
        Stop
      </button>
    </span>
  );
}

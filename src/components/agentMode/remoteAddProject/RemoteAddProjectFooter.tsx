import type { RemoteAddProjectStep } from "../../../application/useRemoteAddProject";
import {
  remoteAddProjectEnterHint,
  remoteAddProjectPrimaryLabel,
} from "./remoteAddProjectPresentation";

export interface RemoteAddProjectFooterProps {
  readonly step: RemoteAddProjectStep;
  readonly listStep: boolean;
  readonly disabled: boolean;
  onPrimary(): void;
}

export function RemoteAddProjectFooter({
  disabled,
  listStep,
  onPrimary,
  step,
}: RemoteAddProjectFooterProps) {
  return (
    <div className="palette-footer agent-remote-add-project__footer">
      {listStep && (
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navigate
        </span>
      )}
      {step.kind !== "confirm" && (
        <span>
          <kbd>↵</kbd> {remoteAddProjectEnterHint(step)}
        </span>
      )}
      {step.kind !== "sources" && (
        <span>
          <kbd>⌫</kbd> back
        </span>
      )}
      <span>
        <kbd>⌘↵</kbd> {remoteAddProjectPrimaryLabel(step)}
      </span>
      <span>
        <kbd>esc</kbd> close
      </span>
      <span className="agent-remote-add-project__spacer" />
      <button
        className="agent-remote-add-project__primary"
        disabled={disabled}
        onClick={onPrimary}
        type="button"
      >
        {remoteAddProjectPrimaryLabel(step)}
      </button>
    </div>
  );
}

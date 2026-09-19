import "./remoteAddProject.css";
import type { RemoteAddProjectPendingClone } from "../../../application/useRemoteAddProject";
import { remoteAddProjectCloneStatusText } from "./remoteAddProjectMessages";
import {
  remoteAddProjectBoundedText,
  remoteAddProjectCloneActive,
} from "./remoteAddProjectPresentation";

export interface AgentRailCloneRowProps {
  readonly clone: RemoteAddProjectPendingClone;
  onCancel(): void;
  onDismiss(): void;
}

export function AgentRailCloneRow({ clone, onCancel, onDismiss }: AgentRailCloneRowProps) {
  const active = remoteAddProjectCloneActive(clone.status);
  return (
    <div aria-label="Repository clone" className="agent-rail-clone">
      <span className="agent-rail-clone__name">{clone.name}</span>
      <span className="agent-rail-clone__status" role="status">
        {remoteAddProjectCloneStatusText(clone.status)}
      </span>
      {active && (
        <span aria-hidden="true" className="agent-rail-clone__track">
          <i />
        </span>
      )}
      {clone.error !== null && (
        <p className="agent-rail-clone__error">{remoteAddProjectBoundedText(clone.error)}</p>
      )}
      <span className="agent-rail-clone__actions">
        {active && (
          <button className="agent-linkbutton" onClick={onCancel} type="button">
            Cancel
          </button>
        )}
        {!active && (
          <button className="agent-linkbutton" onClick={onDismiss} type="button">
            Dismiss
          </button>
        )}
      </span>
    </div>
  );
}

import {
  CircleAlert,
  FilePlus2,
  GitCompareArrows,
  MoveRight,
  RefreshCw,
  Save,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  externalFileConflictActions,
  externalFileConflictLabels,
  type ExternalFileConflict,
  type ExternalFileConflictAction,
  type ExternalFileConflictResolutionAction,
} from "../domain/externalFileConflict";
import "./ExternalFileConflict.css";

interface ExternalFileConflictBarProps {
  busyAction?: ExternalFileConflictResolutionAction | null;
  conflict: ExternalFileConflict;
  error?: string | null;
  onAction(action: ExternalFileConflictAction): void;
}

export function ExternalFileConflictBar({
  busyAction = null,
  conflict,
  error = null,
  onAction,
}: ExternalFileConflictBarProps) {
  const labels = externalFileConflictLabels(conflict);
  const actions = externalFileConflictActions(conflict);

  return (
    <section
      aria-label="External file conflict"
      className="external-file-conflict-bar"
      data-conflict-kind={conflict.kind}
    >
      <CircleAlert
        aria-hidden="true"
        className="external-file-conflict-icon"
        size={16}
      />
      <div className="external-file-conflict-message">
        <strong>{labels.title}</strong>
        <span>{error ?? labels.detail}</span>
      </div>
      <div
        aria-label="External file conflict actions"
        className="external-file-conflict-actions"
        role="group"
      >
        {actions.map(({ action, label, tone }) => {
          const isBusy = busyAction === action;

          return (
            <button
              aria-busy={isBusy || undefined}
              className={`external-file-conflict-action external-file-conflict-action-${tone}`}
              disabled={busyAction !== null}
              key={action}
              onClick={() => onAction(action)}
              title={label}
              type="button"
            >
              {actionIcon(action)}
              <span>{isBusy ? `${label}...` : label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function actionIcon(action: ExternalFileConflictAction): ReactNode {
  if (action === "compare") {
    return <GitCompareArrows aria-hidden="true" size={14} />;
  }

  if (action === "reload") {
    return <RefreshCw aria-hidden="true" size={14} />;
  }

  if (action === "followRename") {
    return <MoveRight aria-hidden="true" size={14} />;
  }

  if (action === "recreate") {
    return <FilePlus2 aria-hidden="true" size={14} />;
  }

  return <Save aria-hidden="true" size={14} />;
}

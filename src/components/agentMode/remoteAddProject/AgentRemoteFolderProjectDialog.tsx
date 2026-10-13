import "./remoteAddProject.css";
import { ArrowLeft } from "lucide-react";
import type { KeyboardEvent } from "react";
import { remoteAddProjectFolderInput } from "../../../application/remoteAddProjectFolder";
import type { RemoteProjectFolderController } from "../../../application/useRemoteProjectFolderRegistration";
import { AgentAddProjectDialog } from "../AgentAddProjectDialog";
import { RemoteAddProjectFolderForm } from "./RemoteAddProjectFolderForm";
import {
  REMOTE_FOLDER_PROJECT_TITLE,
  remoteFolderProjectPrimaryLabel,
} from "./remoteFolderProjectMessages";

const NO_PROJECT_ROOTS: readonly string[] = Object.freeze([]);

export interface AgentRemoteFolderProjectDialogProps {
  readonly controller: RemoteProjectFolderController;
  onBackToEntry(): void;
}

export function AgentRemoteFolderProjectDialog({
  controller,
  onBackToEntry,
}: AgentRemoteFolderProjectDialogProps) {
  const { directoryGateway, folder, open } = controller;
  if (!open) return null;
  if (folder.phase === "browsing" && directoryGateway !== null) {
    return (
      <AgentAddProjectDialog
        environment="remote"
        environmentLabel={REMOTE_FOLDER_PROJECT_TITLE}
        gateway={directoryGateway}
        initialPath={folder.path}
        mode="selectServerFolder"
        onAdd={controller.chooseFolder}
        onBack={() => {
          controller.close();
          onBackToEntry();
        }}
        onClose={controller.close}
        onOpenExisting={controller.chooseFolder}
        projectRootPaths={NO_PROJECT_ROOTS}
      />
    );
  }

  const submitting = folder.phase === "submitting";
  const canSubmit = remoteAddProjectFolderInput(folder) !== null;
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      controller.close();
      return;
    }
    if (event.key !== "Enter" || event.repeat || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    if (canSubmit) controller.submit();
  };

  return (
    <div className="palette-backdrop" onMouseDown={controller.close} role="presentation">
      <section
        aria-label="Add existing folder on server"
        className="quick-open agent-remote-add-project"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="agent-remote-add-project__crumb">
          <button
            aria-label="Go back"
            className="agent-iconbutton"
            disabled={submitting || folder.phase === "browsing"}
            onClick={controller.back}
            title="Go back"
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={15} />
          </button>
          <span className="agent-remote-add-project__title">{REMOTE_FOLDER_PROJECT_TITLE}</span>
        </div>
        <div className="quick-open-results agent-remote-add-project__body">
          <RemoteAddProjectFolderForm
            folder={folder}
            onName={controller.setName}
            onSubmit={controller.submit}
          />
        </div>
        <div className="palette-footer agent-remote-add-project__footer">
          <span>
            <kbd>↵</kbd> add
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
          <span className="agent-remote-add-project__spacer" />
          <button
            className="agent-remote-add-project__primary"
            disabled={!canSubmit}
            onClick={controller.submit}
            type="button"
          >
            {remoteFolderProjectPrimaryLabel(folder)}
          </button>
        </div>
      </section>
    </div>
  );
}

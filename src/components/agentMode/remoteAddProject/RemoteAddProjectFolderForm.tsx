import { FolderGit2 } from "lucide-react";
import { useId, type KeyboardEvent } from "react";
import {
  remoteAddProjectFolderInput,
  type RemoteAddProjectFolderState,
} from "../../../application/remoteAddProjectFolder";
import { REMOTE_PROJECT_NAME_CHARS } from "../../../domain/remoteProjectRegistration";
import { remoteAddProjectBoundedText } from "./remoteAddProjectPresentation";
import {
  remoteFolderProjectMessage,
  remoteFolderProjectNameMessage,
} from "./remoteFolderProjectMessages";

export interface RemoteAddProjectFolderFormProps {
  readonly folder: RemoteAddProjectFolderState;
  onName(value: string): void;
  onSubmit(): void;
}

export function RemoteAddProjectFolderForm({
  folder,
  onName,
  onSubmit,
}: RemoteAddProjectFolderFormProps) {
  const nameId = useId();
  const nameErrorId = useId();
  if (folder.phase === "browsing")
    return <p className="quick-open-state">Server folders cannot be browsed here.</p>;
  const submitting = folder.phase === "submitting";
  const canSubmit = remoteAddProjectFolderInput(folder) !== null;
  const nameMessage = remoteFolderProjectNameMessage(folder);
  const message = remoteFolderProjectMessage(folder);
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.repeat || event.nativeEvent.isComposing) return;
    if (event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    if (canSubmit) onSubmit();
  };

  return (
    <form
      aria-busy={submitting}
      className="agent-remote-add-project__form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <div className="agent-remote-add-project__repo">
        <FolderGit2 aria-hidden="true" size={15} />
        <span>
          <strong>{folderLabel(folder.path)}</strong>
          <small className="agent-remote-add-project__path">{folder.path}</small>
        </span>
      </div>

      <label className="agent-remote-add-project__field" htmlFor={nameId}>
        <span>Project name</span>
        <input
          aria-describedby={nameMessage === null ? undefined : nameErrorId}
          aria-invalid={nameMessage !== null}
          aria-label="Project name"
          autoFocus
          disabled={submitting}
          id={nameId}
          maxLength={REMOTE_PROJECT_NAME_CHARS}
          onChange={(event) => onName(event.currentTarget.value)}
          onKeyDown={submitOnEnter}
          spellCheck={false}
          value={folder.name}
        />
      </label>
      {nameMessage !== null && (
        <p className="agent-remote-add-project__error" id={nameErrorId}>
          {nameMessage}
        </p>
      )}
      {message !== null && (
        <p className="agent-remote-add-project__error" role="alert">
          {remoteAddProjectBoundedText(message)}
        </p>
      )}
    </form>
  );
}

function folderLabel(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

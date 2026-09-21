import { useState } from "react";
import type { LocalProjectCloneInput } from "../../application/useLocalProjectClone";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import { parseLocalProjectCloneRequest } from "../../domain/localProjectClone";
import { cloneFolderName, parseRepositoryCloneUrl } from "../../domain/repositoryCloneUrl";
import { AgentAddProjectDialog } from "./AgentAddProjectDialog";
import "./remoteAddProject/remoteAddProject.css";

type Props = Readonly<{
  gateway: DirectoryListingGateway;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onClone(input: LocalProjectCloneInput): void;
}>;

export function AgentLocalCloneDialog({ gateway, busy, error, onClose, onClone }: Props) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [branch, setBranch] = useState("");
  const [parentPath, setParentPath] = useState("");
  const [picking, setPicking] = useState(false);
  const input = { url: url.trim(), name, parentPath, ...(branch ? { branch } : {}) };
  let valid = false;
  try {
    parseLocalProjectCloneRequest({
      ...input,
      idempotencyKey: "00000000-0000-0000-0000-000000000000",
    });
    valid = true;
  } catch {
    /* The submit action stays disabled until every field is valid. */
  }
  if (picking)
    return (
      <AgentAddProjectDialog
        gateway={gateway}
        mode="selectDirectory"
        projectRootPaths={[]}
        onClose={() => setPicking(false)}
        onOpenExisting={() => undefined}
        onAdd={(path) => {
          setParentPath(path);
          setPicking(false);
        }}
      />
    );
  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <section
        className="quick-open agent-remote-add-project"
        aria-label="Clone repository on this computer"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="agent-remote-add-project__crumb">
          <strong>Clone repository · This computer</strong>
        </div>
        <form
          className="agent-remote-add-project__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !busy) onClone(input);
          }}
        >
          <label className="agent-remote-add-project__field">
            <span>Repository URL</span>
            <input
              autoFocus
              maxLength={2048}
              value={url}
              disabled={busy}
              spellCheck={false}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setUrl(value);
                if (!nameEdited) {
                  const identity = parseRepositoryCloneUrl(value.trim());
                  setName(identity ? (cloneFolderName(identity) ?? "") : "");
                }
              }}
              placeholder="https://github.com/owner/repository.git"
            />
          </label>
          <label className="agent-remote-add-project__field">
            <span>Folder name</span>
            <input
              maxLength={64}
              value={name}
              disabled={busy}
              spellCheck={false}
              onChange={(event) => {
                setNameEdited(true);
                setName(event.currentTarget.value);
              }}
            />
          </label>
          <label className="agent-remote-add-project__field">
            <span>Branch</span>
            <input
              maxLength={255}
              value={branch}
              disabled={busy}
              spellCheck={false}
              placeholder="Default branch"
              onChange={(event) => setBranch(event.currentTarget.value)}
            />
          </label>
          <div className="agent-remote-add-project__field">
            <span>Destination folder</span>
            <span>{parentPath || "Choose where to create the repository folder"}</span>
            <button
              type="button"
              className="agent-linkbutton"
              disabled={busy}
              onClick={() => setPicking(true)}
            >
              Choose folder
            </button>
          </div>
          {error && (
            <p role="alert" className="agent-remote-add-project__error">
              {error.slice(0, 500)}
            </p>
          )}
          <div className="palette-footer">
            <button type="button" className="agent-linkbutton" onClick={onClose}>
              Back
            </button>
            <button type="submit" className="agent-add-project__add" disabled={!valid || busy}>
              {busy ? "Starting…" : "Clone repository"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

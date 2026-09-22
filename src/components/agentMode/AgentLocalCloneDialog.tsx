import { useEffect, useState } from "react";
import { ArrowLeft, Folder, GitBranch } from "lucide-react";
import type { LocalProjectCloneInput } from "../../application/useLocalProjectClone";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import { parseLocalProjectCloneRequest } from "../../domain/localProjectClone";
import { cloneFolderName, parseRepositoryCloneUrl } from "../../domain/repositoryCloneUrl";
import type { RepositoryLookupGateway } from "../../application/repositoryLookupPorts";
import { ProjectRepositoryPicker } from "./ProjectRepositoryPicker";
import { AgentAddProjectDialog } from "./AgentAddProjectDialog";
import "./remoteAddProject/remoteAddProject.css";
import "./agentLocalCloneDialog.css";

type Props = Readonly<{
  gateway: DirectoryListingGateway;
  lookupGateway?: RepositoryLookupGateway | null;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onClone(input: LocalProjectCloneInput): void;
}>;

export function AgentLocalCloneDialog({
  gateway,
  lookupGateway,
  busy,
  error,
  onClose,
  onClone,
}: Props) {
  const [step, setStep] = useState<"source" | "url" | "confirm">(
    lookupGateway != null ? "source" : "url",
  );
  const [confirmationSource, setConfirmationSource] = useState<"source" | "url">("url");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [homePath, setHomePath] = useState<string | null>(null);
  const [customDestination, setCustomDestination] = useState<string | null>(null);
  const destination =
    customDestination ?? (homePath === null || name === "" ? "" : appendCloneName(homePath, name));
  const { parentPath, name: destinationName } = splitCloneDestination(destination);
  useEffect(() => {
    let current = true;
    setHomePath(null);
    void gateway
      .listDirectoryEntries({ path: null, includeFiles: false })
      .then((listing) => {
        if (current) setHomePath(listing.path);
      })
      .catch(() => {
        /* Browsing or a manually entered absolute path remains available. */
      });
    return () => {
      current = false;
    };
  }, [gateway]);
  const [picking, setPicking] = useState(false);
  const repository = parseRepositoryCloneUrl(url.trim());
  const close = () => {
    if (!busy) onClose();
  };
  const back = () => {
    if (busy) return;
    if (step === "confirm") setStep(confirmationSource);
    else if (lookupGateway != null) setStep("source");
    else onClose();
  };
  const input = {
    url: url.trim(),
    name: destinationName,
    parentPath,
  };
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
        initialPath={parentPath || homePath}
        onClose={() => {
          if (!busy) setPicking(false);
        }}
        onOpenExisting={() => undefined}
        onAdd={(path) => {
          if (busy) return;
          setCustomDestination(appendCloneName(path, destinationName || name));
          setPicking(false);
        }}
      />
    );
  return (
    <div className="palette-backdrop" onMouseDown={close} role="presentation">
      <section
        className="quick-open agent-remote-add-project agent-local-clone"
        aria-label="Clone repository on this computer"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Tab" && step !== "source") {
            const controls = [
              ...event.currentTarget.querySelectorAll<HTMLElement>("button, input"),
            ].filter((control) => !control.hasAttribute("disabled"));
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        {step === "source" ? (
          <ProjectRepositoryPicker
            gateway={lookupGateway ?? null}
            environmentLabel="This computer"
            onBack={close}
            onUseUrl={() => {
              if (!busy) setStep("url");
            }}
            onChoose={(selected) => {
              if (busy) return;
              const cloneUrl = selected.sshUrl ?? selected.httpsUrl;
              if (cloneUrl === null) return;
              setUrl(cloneUrl);
              const identity = parseRepositoryCloneUrl(cloneUrl);
              setName(identity ? (cloneFolderName(identity) ?? "") : "");
              setCustomDestination(null);
              setConfirmationSource("source");
              setStep("confirm");
            }}
          />
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              if (step === "url") {
                if (repository === null) return;
                setConfirmationSource("url");
                setStep("confirm");
              } else if (valid) onClone(input);
            }}
          >
            <div className="agent-local-clone__heading">
              <button
                type="button"
                className="agent-linkbutton"
                aria-label="Back"
                disabled={busy}
                onClick={back}
              >
                <ArrowLeft size={16} aria-hidden="true" />
              </button>
              <strong>{step === "url" ? "Clone from Git URL" : "Clone repository"}</strong>
              <span>This computer</span>
            </div>
            {step === "url" ? (
              <div className="agent-local-clone__url-step">
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
                      const identity = parseRepositoryCloneUrl(value.trim());
                      setName(identity ? (cloneFolderName(identity) ?? "") : "");
                    }}
                    placeholder="https://github.com/owner/repository.git"
                  />
                </label>
                <p className="agent-local-clone__hint">Paste an HTTPS or SSH repository URL.</p>
              </div>
            ) : (
              <div className="agent-local-clone__confirmation">
                <div className="agent-local-clone__repository">
                  <GitBranch size={18} aria-hidden="true" />
                  <div>
                    <strong>{name || "Repository"}</strong>
                    <span>{url.trim()}</span>
                  </div>
                </div>
                <label className="agent-remote-add-project__field">
                  <span>Destination path</span>
                  <div className="agent-local-clone__destination">
                    <input
                      autoFocus
                      aria-label="Destination path"
                      maxLength={4162}
                      value={destination}
                      placeholder={name ? `~/${name}` : "Absolute destination path"}
                      disabled={busy}
                      spellCheck={false}
                      onChange={(event) => setCustomDestination(event.currentTarget.value)}
                    />
                    <button
                      type="button"
                      className="agent-linkbutton"
                      aria-label="Choose folder"
                      title="Choose folder"
                      disabled={busy}
                      onClick={() => setPicking(true)}
                    >
                      <Folder size={18} aria-hidden="true" />
                    </button>
                  </div>
                </label>
                <p className="agent-local-clone__hint">
                  The repository will be cloned into this folder.
                </p>
                {destination !== "" && !valid && (
                  <p role="alert" className="agent-remote-add-project__error">
                    Enter an absolute destination path with a valid folder name.
                  </p>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="agent-remote-add-project__error">
                {error.slice(0, 500)}
              </p>
            )}
            <div className="palette-footer">
              <button
                type="submit"
                className="agent-add-project__add"
                disabled={busy || (step === "url" ? repository === null : !valid)}
              >
                {busy ? "Starting…" : step === "url" ? "Continue" : "Clone repository"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function appendCloneName(parent: string, name: string): string {
  const separator = /^[A-Za-z]:\\/.test(parent) ? "\\" : "/";
  return `${parent.replace(/[\\/]$/, "")}${separator}${name}`;
}

function splitCloneDestination(destination: string): { parentPath: string; name: string } {
  const windows = /^[A-Za-z]:[\\/]/.test(destination);
  const slash = Math.max(
    destination.lastIndexOf("/"),
    windows ? destination.lastIndexOf("\\") : -1,
  );
  if (slash < 0) return { parentPath: "", name: "" };
  return {
    parentPath:
      slash === 0
        ? "/"
        : windows && slash === 2
          ? destination.slice(0, 3)
          : destination.slice(0, slash),
    name: destination.slice(slash + 1),
  };
}

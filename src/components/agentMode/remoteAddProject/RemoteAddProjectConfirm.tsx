import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { RemoteAddProjectStep } from "../../../application/useRemoteAddProject";
import type { DirectoryListingGateway } from "../../../domain/directoryListing";
import { AgentAddProjectDialog } from "../AgentAddProjectDialog";
import { FolderOpen } from "lucide-react";
import { isRemoteProjectDirectoryPath } from "../../../domain/remoteProjectManagement";
import "./remoteCloneDestination.css";
import type { CloneProtocol } from "../../../domain/repositoryCloneUrl";
import { RemoteAddProjectSourceGlyph } from "./RemoteAddProjectSources";
import {
  remoteAddProjectBranchErrorMessage,
  remoteAddProjectNameErrorMessage,
} from "./remoteAddProjectMessages";
import {
  remoteAddProjectBoundedText,
  remoteAddProjectCandidateView,
  remoteAddProjectHttpsWarning,
  remoteAddProjectProtocolOptions,
} from "./remoteAddProjectPresentation";

export type RemoteAddProjectConfirmStep = Extract<RemoteAddProjectStep, { kind: "confirm" }>;

export interface RemoteAddProjectConfirmProps {
  readonly step: RemoteAddProjectConfirmStep;
  readonly directoryGateway?: DirectoryListingGateway | null;
  readonly parentPath?: string | null;
  readonly environmentLabel?: string;
  onParentPath?(path: string): void;
  onName(value: string): void;
  onBranch(value: string): void;
  onProtocol(value: CloneProtocol): void;
  onOpenExisting(): void;
  onSubmit(): void;
}

export function RemoteAddProjectConfirm({
  directoryGateway,
  parentPath,
  environmentLabel = "Server",
  onParentPath,
  onBranch,
  onName,
  onOpenExisting,
  onProtocol,
  onSubmit,
  step,
}: RemoteAddProjectConfirmProps) {
  const [browsing, setBrowsing] = useState(false);
  const [destinationDraft, setDestinationDraft] = useState<string | null>(null);
  const latest = useRef({ onParentPath, submitting: step.submitting, edited: false });
  latest.current.onParentPath = onParentPath;
  latest.current.submitting = step.submitting;
  useEffect(() => {
    if (!directoryGateway || parentPath != null) return;
    let active = true;
    void directoryGateway.listDirectoryEntries({ path: null, includeFiles: false }).then(
      (listing) => {
        if (
          active &&
          !latest.current.submitting &&
          !latest.current.edited &&
          isRemoteProjectDirectoryPath(listing.path)
        )
          latest.current.onParentPath?.(listing.path);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [directoryGateway, environmentLabel, parentPath]);
  const fullDestination = Boolean(directoryGateway && onParentPath);
  const destination =
    destinationDraft ??
    (parentPath == null ? step.name : `${parentPath.replace(/\/$/, "")}/${step.name}`);
  const validDestination =
    !fullDestination ||
    (parentPath != null && isRemoteProjectDirectoryPath(destination) && destination !== "/");
  const canSubmit =
    !step.submitting && step.nameError === null && step.branchError === null && validDestination;
  const editDestination = (value: string) => {
    latest.current.edited = true;
    setDestinationDraft(value);
    const index = value.lastIndexOf("/");
    if (!isRemoteProjectDirectoryPath(value) || index < 0 || value === "/") {
      onName("");
      return;
    }
    onParentPath?.(value.slice(0, index) || "/");
    onName(value.slice(index + 1));
  };
  const nameId = useId();
  const nameErrorId = useId();
  const branchId = useId();
  const branchErrorId = useId();
  const view = remoteAddProjectCandidateView(step.candidate);
  const protocols = remoteAddProjectProtocolOptions(step.candidate);
  const warning = remoteAddProjectHttpsWarning(step.candidate, step.protocol);
  const nameMessage =
    step.nameError === null ? null : remoteAddProjectNameErrorMessage(step.nameError);
  const branchMessage = step.branchError === null ? null : remoteAddProjectBranchErrorMessage();
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    if (canSubmit) onSubmit();
  };

  if (browsing && !step.submitting && directoryGateway && onParentPath) {
    return (
      <AgentAddProjectDialog
        environment="remote"
        environmentLabel={environmentLabel}
        gateway={directoryGateway}
        initialPath={parentPath}
        mode="selectDirectory"
        projectRootPaths={[]}
        onClose={() => setBrowsing(false)}
        onAdd={(path) => {
          latest.current.edited = true;
          setDestinationDraft(null);
          onParentPath(path);
          setBrowsing(false);
        }}
        onOpenExisting={() => undefined}
      />
    );
  }

  return (
    <form
      className="agent-remote-add-project__form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <div className="agent-remote-add-project__repo">
        <RemoteAddProjectSourceGlyph kind={view.provider ?? "gitUrl"} />
        <span>
          <strong>{view.title}</strong>
          <small>
            {view.host} · {view.visibility}
          </small>
        </span>
        {step.existingProjectKey !== null && (
          <span className="agent-remote-add-project__chip">Name exists on server</span>
        )}
      </div>

      {step.existingProjectKey !== null && (
        <button className="agent-linkbutton" onClick={onOpenExisting} type="button">
          Open existing
        </button>
      )}

      <label className="agent-remote-add-project__field" htmlFor={nameId}>
        <span>{fullDestination ? "Destination" : "Folder name"}</span>
        <span className="remote-clone-destination">
          <input
            aria-label={fullDestination ? "Destination path" : "Folder name"}
            aria-describedby={nameMessage === null ? undefined : nameErrorId}
            aria-invalid={nameMessage !== null || !validDestination}
            disabled={step.submitting}
            id={nameId}
            maxLength={fullDestination ? 4096 : 64}
            onChange={(event) =>
              fullDestination
                ? editDestination(event.currentTarget.value)
                : onName(event.currentTarget.value)
            }
            onKeyDown={submitOnEnter}
            spellCheck={false}
            value={fullDestination ? destination : step.name}
          />
          {fullDestination && (
            <button
              aria-label="Choose destination folder"
              className="agent-iconbutton"
              disabled={step.submitting}
              onClick={() => setBrowsing(true)}
              title="Choose destination folder"
              type="button"
            >
              <FolderOpen aria-hidden="true" size={18} />
            </button>
          )}
        </span>
        {!fullDestination && <small>Inside the server projects folder</small>}
      </label>
      {nameMessage !== null && (
        <p className="agent-remote-add-project__error" id={nameErrorId}>
          {nameMessage}
        </p>
      )}

      {branchMessage !== null && (
        <label className="agent-remote-add-project__field" htmlFor={branchId}>
          <span>Branch</span>
          <input
            aria-describedby={branchMessage === null ? undefined : branchErrorId}
            aria-invalid={branchMessage !== null}
            id={branchId}
            disabled={step.submitting}
            maxLength={255}
            onChange={(event) => onBranch(event.currentTarget.value)}
            onKeyDown={submitOnEnter}
            placeholder={view.defaultBranch ?? "Default branch"}
            spellCheck={false}
            value={step.branch}
          />
        </label>
      )}
      {branchMessage !== null && (
        <p className="agent-remote-add-project__error" id={branchErrorId}>
          {branchMessage}
        </p>
      )}

      {protocols.every((option) => option.available) && (
        <div
          aria-label="Clone protocol"
          className="agent-remote-add-project__segmented"
          role="group"
        >
          {protocols.map((option) => (
            <button
              aria-pressed={step.protocol === option.protocol}
              disabled={step.submitting || !option.available}
              key={option.protocol}
              onClick={() => onProtocol(option.protocol)}
              title={option.available ? undefined : "This repository has no URL for this protocol."}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {warning !== null && <p className="agent-remote-add-project__warning">{warning}</p>}
      {step.submitError !== null && (
        <p className="agent-remote-add-project__error" role="alert">
          {remoteAddProjectBoundedText(step.submitError)}
        </p>
      )}
    </form>
  );
}

import { useId, type KeyboardEvent } from "react";
import type { RemoteAddProjectStep } from "../../../application/useRemoteAddProject";
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
  onName(value: string): void;
  onBranch(value: string): void;
  onProtocol(value: CloneProtocol): void;
  onOpenExisting(): void;
  onSubmit(): void;
}

export function RemoteAddProjectConfirm({
  onBranch,
  onName,
  onOpenExisting,
  onProtocol,
  onSubmit,
  step,
}: RemoteAddProjectConfirmProps) {
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
    onSubmit();
  };

  return (
    <form
      className="agent-remote-add-project__form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
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
        <span>Folder name</span>
        <span className="agent-remote-add-project__prefixed">
          <span className="agent-remote-add-project__prefix">projects root/</span>
          <input
            aria-describedby={nameMessage === null ? undefined : nameErrorId}
            aria-invalid={nameMessage !== null}
            id={nameId}
            maxLength={64}
            onChange={(event) => onName(event.currentTarget.value)}
            onKeyDown={submitOnEnter}
            spellCheck={false}
            value={step.name}
          />
        </span>
      </label>
      {nameMessage !== null && (
        <p className="agent-remote-add-project__error" id={nameErrorId}>
          {nameMessage}
        </p>
      )}

      <label className="agent-remote-add-project__field" htmlFor={branchId}>
        <span>Branch</span>
        <input
          aria-describedby={branchMessage === null ? undefined : branchErrorId}
          aria-invalid={branchMessage !== null}
          id={branchId}
          maxLength={255}
          onChange={(event) => onBranch(event.currentTarget.value)}
          onKeyDown={submitOnEnter}
          placeholder={view.defaultBranch ?? "Default branch"}
          spellCheck={false}
          value={step.branch}
        />
      </label>
      {branchMessage !== null && (
        <p className="agent-remote-add-project__error" id={branchErrorId}>
          {branchMessage}
        </p>
      )}

      <div aria-label="Clone protocol" className="agent-remote-add-project__segmented" role="group">
        {protocols.map((option) => (
          <button
            aria-pressed={step.protocol === option.protocol}
            disabled={!option.available}
            key={option.protocol}
            onClick={() => onProtocol(option.protocol)}
            title={option.available ? undefined : "This repository has no URL for this protocol."}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      {warning !== null && <p className="agent-remote-add-project__warning">{warning}</p>}
      {step.submitError !== null && (
        <p className="agent-remote-add-project__error" role="alert">
          {remoteAddProjectBoundedText(step.submitError)}
        </p>
      )}
    </form>
  );
}

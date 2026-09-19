import { useRef } from "react";
import type {
  AgentArtifactFailureReporter,
  AgentArtifactLoader,
  AgentArtifactOwner,
  AgentArtifactPreviewPort,
} from "../../application/agentArtifactPorts";
import { useAgentArtifactPreview } from "../../application/useAgentArtifactPreview";
import {
  agentArtifactFailureMessage,
  agentArtifactFailureRetryable,
  type AgentArtifactFailureReason,
} from "../../domain/agentArtifactFailure";

export interface AgentArtifactPreviewProps {
  readonly owner: AgentArtifactOwner;
  readonly path: string;
  readonly loader: AgentArtifactLoader;
  readonly preview: AgentArtifactPreviewPort;
  readonly reportError: AgentArtifactFailureReporter | null;
  readonly frameTimeoutMs?: number;
  readonly previewTtlMs?: number;
}

export function AgentArtifactPreview({
  owner,
  path,
  loader,
  preview,
  reportError,
  frameTimeoutMs,
  previewTtlMs,
}: AgentArtifactPreviewProps) {
  const { state, retry, notifyFrameLoaded } = useAgentArtifactPreview({
    owner,
    path,
    loader,
    preview,
    reportError,
    frameTimeoutMs,
    previewTtlMs,
  });
  if (state.kind === "loading")
    return (
      <p className="agent-artifacts__status" role="status">
        Loading preview…
      </p>
    );
  if (state.kind === "failed") return <ArtifactFailure onRetry={retry} reason={state.reason} />;
  if (state.metadata.mediaType === "text/html")
    return (
      <div className="agent-artifacts__html">
        <p className="agent-artifacts__hint">Interactive preview · network access is disabled.</p>
        {state.frame === "pending" && <p className="agent-artifacts__status">Loading preview…</p>}
        <iframe
          onLoad={notifyFrameLoaded}
          sandbox="allow-scripts"
          src={state.url}
          title={`Preview of ${state.metadata.name}`}
        />
      </div>
    );
  return <ArtifactImage name={state.metadata.name} url={state.url} />;
}

function ArtifactFailure({
  reason,
  onRetry,
}: {
  readonly reason: AgentArtifactFailureReason;
  readonly onRetry: () => void;
}) {
  return (
    <div className="agent-artifacts__failure">
      <p role="status">{agentArtifactFailureMessage(reason)}</p>
      {agentArtifactFailureRetryable(reason) && (
        <button className="agent-artifacts__retry" onClick={onRetry} type="button">
          Retry
        </button>
      )}
    </div>
  );
}

function ArtifactImage({ name, url }: { readonly name: string; readonly url: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    dialogRef.current?.close();
    triggerRef.current?.focus();
  };
  return (
    <>
      <button
        aria-label={`Enlarge ${name}`}
        className="agent-artifacts__image"
        onClick={() => dialogRef.current?.showModal()}
        ref={triggerRef}
        type="button"
      >
        <img alt={name} src={url} />
      </button>
      <dialog aria-label={name} className="agent-artifacts__dialog" ref={dialogRef}>
        <button aria-label="Close image preview" onClick={close} type="button">
          Close
        </button>
        <img alt={name} src={url} />
      </dialog>
    </>
  );
}

import { memo, useState } from "react";
import { AlertTriangle, FileText, ImageIcon, Link2, Loader2, X } from "lucide-react";
import type { AgentComposerAttachmentDraft } from "../../application/useAgentComposerAttachments";
import { formatAgentAttachmentBytes } from "./agentTurnAttachmentPresentation";

export interface AgentComposerAttachmentsProps {
  readonly drafts: ReadonlyArray<AgentComposerAttachmentDraft>;
  readonly refusal: string | null;
  onDismissRefusal(): void;
  onRemove(draftId: string): void;
}

export const AgentComposerAttachments = memo(function AgentComposerAttachments({
  drafts,
  refusal,
  onDismissRefusal,
  onRemove,
}: AgentComposerAttachmentsProps) {
  if (drafts.length === 0 && refusal === null) return null;

  return (
    <div className="agent-composer__attachments">
      {drafts.length > 0 && (
        <ul aria-label="Attachments" className="agent-composer__attachment-list">
          {drafts.map((draft) => (
            <li key={draft.draftId}>
              <AgentComposerAttachment draft={draft} onRemove={onRemove} />
            </li>
          ))}
        </ul>
      )}
      {refusal !== null && (
        <p className="agent-composer__attachment-refusal" role="status">
          <span>{refusal}</span>
          <button
            aria-label="Dismiss attachment message"
            className="agent-composer__attachment-dismiss"
            onClick={onDismissRefusal}
            type="button"
          >
            <X aria-hidden="true" size={13} />
          </button>
        </p>
      )}
    </div>
  );
});

function AgentComposerAttachment({
  draft,
  onRemove,
}: {
  readonly draft: AgentComposerAttachmentDraft;
  onRemove(draftId: string): void;
}) {
  const image = draft.kind === "image" && draft.state !== "failed";
  return (
    <div
      aria-busy={draft.state === "staging" || undefined}
      className={
        image
          ? "agent-composer-attachment agent-composer-attachment--image"
          : "agent-composer-attachment agent-composer-attachment--chip"
      }
      data-agent-attachment-kind={draft.kind}
      data-agent-attachment-missing={draft.missing ? "true" : undefined}
      data-agent-attachment-state={draft.state}
      title={attachmentTitle(draft)}
    >
      {image ? (
        <span className="agent-composer-attachment__thumb">
          <AgentComposerAttachmentThumb draft={draft} />
        </span>
      ) : (
        <>
          <AgentComposerAttachmentGlyph draft={draft} />
          <span className="agent-composer-attachment__meta">
            <span className="agent-composer-attachment__name">{draft.name}</span>
            <AgentComposerAttachmentDetail draft={draft} />
          </span>
        </>
      )}
      <button
        aria-label={`Remove ${draft.name}`}
        className="agent-composer-attachment__remove"
        onClick={() => onRemove(draft.draftId)}
        type="button"
      >
        <X aria-hidden="true" size={12} />
      </button>
    </div>
  );
}

function AgentComposerAttachmentThumb({ draft }: { readonly draft: AgentComposerAttachmentDraft }) {
  const [broken, setBroken] = useState(false);
  const previewUrl = draft.previewUrl;

  if (draft.state === "staging" || previewUrl === null || broken) {
    return (
      <>
        <AgentComposerAttachmentGlyph draft={draft} />
        <span className="agent-visually-hidden">{draft.name}</span>
      </>
    );
  }

  return (
    <img
      alt={draft.name}
      className="agent-composer-attachment__preview"
      onError={() => setBroken(true)}
      src={previewUrl}
    />
  );
}

function AgentComposerAttachmentDetail({
  draft,
}: {
  readonly draft: AgentComposerAttachmentDraft;
}) {
  if (draft.state === "failed" && draft.failure !== null) {
    return <span className="agent-composer-attachment__failure">{draft.failure}</span>;
  }
  if (draft.missing && draft.notice !== null) {
    return <span className="agent-composer-attachment__notice">{draft.notice}</span>;
  }
  if (draft.notice !== null) {
    return <span className="agent-composer-attachment__notice">{draft.notice}</span>;
  }
  if (draft.state === "staging") {
    return <span className="agent-composer-attachment__size">Saving…</span>;
  }
  return (
    <span className="agent-composer-attachment__size agent-num">
      {formatAgentAttachmentBytes(draft.bytes)}
    </span>
  );
}

function AgentComposerAttachmentGlyph({ draft }: { readonly draft: AgentComposerAttachmentDraft }) {
  const size = 14;
  if (draft.state === "staging") {
    return (
      <Loader2
        aria-hidden="true"
        className="agent-composer-attachment__spinner"
        size={size}
        strokeWidth={2.5}
      />
    );
  }
  if (draft.state === "failed") return <AlertTriangle aria-hidden="true" size={size} />;
  if (draft.kind === "image") return <ImageIcon aria-hidden="true" size={20} />;
  if (draft.kind === "reference") return <Link2 aria-hidden="true" size={size} />;
  return <FileText aria-hidden="true" size={size} />;
}

function attachmentTitle(draft: AgentComposerAttachmentDraft): string {
  if (draft.state === "failed" && draft.failure !== null) return `${draft.name} - ${draft.failure}`;
  if (draft.notice !== null) return `${draft.name} - ${draft.notice}`;
  if (draft.path !== null) return draft.path;
  return draft.name;
}

import { memo, useCallback, useEffect, useState, type CSSProperties } from "react";
import { FileText, ImageIcon, ImageOff, Link2 } from "lucide-react";
import type { AgentAttachmentImageState } from "../../application/useAgentAttachmentImages";
import type { AgentImageMime } from "../../domain/agentAttachment";
import {
  AGENT_ATTACHMENT_DECODE_FAILED_REASON,
  AGENT_ATTACHMENT_LOADING_LABEL,
  AGENT_ATTACHMENT_NO_IMAGES_REASON,
  AGENT_ATTACHMENT_UNAVAILABLE_LABEL,
  AGENT_ATTACHMENT_UNRESOLVABLE_REASON,
  agentAttachmentImageIsResolvable,
  agentAttachmentPlaceholderSize,
  type AgentTurnAttachmentGlyph,
  type AgentTurnAttachmentImageView,
  type AgentTurnAttachmentView,
} from "./agentTurnAttachmentPresentation";

export interface AgentTurnAttachmentImagePort {
  stateOf(attachmentId: string): AgentAttachmentImageState | undefined;
  ensure(attachmentId: string, mime: AgentImageMime): void;
  reveal(attachmentId: string): void;
}

export interface AgentTurnAttachmentImageViewer extends AgentTurnAttachmentImagePort {
  open(attachment: AgentTurnAttachmentImageView, origin: HTMLElement): void;
}

export interface AgentTurnAttachmentsProps {
  readonly attachments: ReadonlyArray<AgentTurnAttachmentView>;
  readonly images: AgentTurnAttachmentImageViewer | null;
}

export const AgentTurnAttachments = memo(function AgentTurnAttachments({
  attachments,
  images,
}: AgentTurnAttachmentsProps) {
  const [broken, setBroken] = useState<ReadonlyMap<string, string>>(EMPTY_BROKEN);
  const markBroken = useCallback((attachmentId: string, url: string): void => {
    setBroken((current) => {
      if (current.get(attachmentId) === url) return current;
      const next = new Map(current);
      next.set(attachmentId, url);
      return next;
    });
  }, []);

  const ensure = images?.ensure ?? null;
  useEffect(() => {
    if (ensure === null) return;
    for (const attachment of attachments) {
      if (!agentAttachmentImageIsResolvable(attachment)) continue;
      if (attachment.kind !== "image") continue;
      ensure(attachment.attachmentId, attachment.mime);
    }
  }, [attachments, ensure]);

  if (attachments.length === 0) return null;

  return (
    <ul aria-label="Attachments" className="agent-attachments">
      {attachments.map((attachment) => (
        <li className="agent-attachments__item" key={attachment.key}>
          {attachment.kind === "chip" ? (
            <AgentAttachmentChip glyph={attachment.glyph} name={attachment.name} />
          ) : (
            <AgentAttachmentImage
              attachment={attachment}
              brokenUrl={broken.get(attachment.attachmentId) ?? null}
              images={images}
              onBroken={markBroken}
            />
          )}
        </li>
      ))}
    </ul>
  );
});

const EMPTY_BROKEN: ReadonlyMap<string, string> = new Map();

function AgentAttachmentImage({
  attachment,
  brokenUrl,
  images,
  onBroken,
}: {
  readonly attachment: AgentTurnAttachmentImageView;
  readonly brokenUrl: string | null;
  readonly images: AgentTurnAttachmentImageViewer | null;
  onBroken(attachmentId: string, url: string): void;
}) {
  const state = images === null ? undefined : images.stateOf(attachment.attachmentId);
  const unavailable = unavailableReason(attachment, images, brokenUrl, state);

  if (unavailable !== null) {
    return (
      <AgentAttachmentChip
        description={`${attachment.name}: ${unavailable}`}
        glyph="unavailable"
        name={AGENT_ATTACHMENT_UNAVAILABLE_LABEL}
      />
    );
  }

  if (images === null || state?.kind !== "ready") {
    return (
      <span
        aria-label={AGENT_ATTACHMENT_LOADING_LABEL}
        className="agent-attachments__pending"
        role="img"
        style={placeholderStyle(attachment)}
      />
    );
  }

  return (
    <button
      className="agent-attachments__open"
      onClick={(event) => images.open(attachment, event.currentTarget)}
      title={attachment.name}
      type="button"
    >
      <img
        alt={attachment.name}
        className="agent-attachments__image"
        height={attachment.height}
        onError={() => onBroken(attachment.attachmentId, state.url)}
        src={state.url}
        width={attachment.width}
      />
    </button>
  );
}

function unavailableReason(
  attachment: AgentTurnAttachmentImageView,
  images: AgentTurnAttachmentImagePort | null,
  brokenUrl: string | null,
  state: AgentAttachmentImageState | undefined,
): string | null {
  if (!agentAttachmentImageIsResolvable(attachment)) return AGENT_ATTACHMENT_UNRESOLVABLE_REASON;
  if (images === null) return AGENT_ATTACHMENT_NO_IMAGES_REASON;
  if (state?.kind === "unavailable") return state.reason;
  if (state?.kind === "ready" && state.url === brokenUrl) {
    return AGENT_ATTACHMENT_DECODE_FAILED_REASON;
  }
  return null;
}

function placeholderStyle(attachment: AgentTurnAttachmentImageView): CSSProperties | undefined {
  const size = agentAttachmentPlaceholderSize(attachment);
  if (size === null) return undefined;
  return { width: `${size.width}px`, height: `${size.height}px` };
}

function AgentAttachmentChip({
  description = null,
  glyph,
  name,
}: {
  readonly description?: string | null;
  readonly glyph: AgentTurnAttachmentGlyph | "unavailable";
  readonly name: string;
}) {
  return (
    <span
      className="agent-attachments__chip"
      data-agent-attachment={glyph}
      title={description ?? name}
    >
      <AgentAttachmentGlyph glyph={glyph} />
      <span className="agent-attachments__name">{name}</span>
      {description !== null && <span className="agent-visually-hidden">{description}</span>}
    </span>
  );
}

function AgentAttachmentGlyph({
  glyph,
}: {
  readonly glyph: AgentTurnAttachmentGlyph | "unavailable";
}) {
  const size = 14;
  if (glyph === "unavailable") return <ImageOff aria-hidden="true" size={size} />;
  if (glyph === "image") return <ImageIcon aria-hidden="true" size={size} />;
  if (glyph === "reference") return <Link2 aria-hidden="true" size={size} />;
  return <FileText aria-hidden="true" size={size} />;
}

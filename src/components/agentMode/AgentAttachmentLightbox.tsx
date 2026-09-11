import { ExternalLink, X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { AgentTurnAttachmentImagePort } from "./AgentTurnAttachments";
import { agentAttachmentLightboxFit } from "./agentTurnAttachmentPresentation";
import type { AgentAttachmentLightboxEntry } from "./useAgentAttachmentLightbox";

export const AGENT_LIGHTBOX_CLOSE_LABEL = "Close";
export const AGENT_LIGHTBOX_REVEAL_LABEL = "Open in system viewer";

export interface AgentAttachmentLightboxProps {
  readonly entry: AgentAttachmentLightboxEntry | null;
  readonly images: AgentTurnAttachmentImagePort | null;
  onClose(): void;
}

export function AgentAttachmentLightbox({ entry, images, onClose }: AgentAttachmentLightboxProps) {
  const state =
    entry === null || images === null ? undefined : images.stateOf(entry.request.attachmentId);
  const url = state?.kind === "ready" ? state.url : null;
  const stale = entry !== null && url === null;

  useEffect(() => {
    if (!stale) return;
    onClose();
  }, [onClose, stale]);

  if (entry === null || images === null || url === null) return null;

  return createPortal(
    <AgentAttachmentLightboxDialog entry={entry} images={images} onClose={onClose} url={url} />,
    entry.host,
  );
}

function AgentAttachmentLightboxDialog({
  entry,
  images,
  onClose,
  url,
}: {
  readonly entry: AgentAttachmentLightboxEntry;
  readonly images: AgentTurnAttachmentImagePort;
  readonly url: string;
  onClose(): void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const revealRef = useRef<HTMLButtonElement | null>(null);
  const { origin, request } = entry;
  const fit = agentAttachmentLightboxFit(request);

  useEffect(() => {
    closeRef.current?.focus();
    return () => origin.focus({ preventScroll: true });
  }, [origin]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [closeRef.current, revealRef.current].filter(isControl);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (first === undefined || last === undefined) return;
    const active = document.activeElement;
    const inside = event.currentTarget.contains(active);
    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleCloseKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClose();
  };

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    onClose();
  };

  return (
    <div
      aria-label={request.name}
      aria-modal="true"
      className="palette-backdrop agent-lightbox"
      onKeyDown={handleKeyDown}
      onMouseDown={handleBackdropMouseDown}
      role="dialog"
      tabIndex={-1}
    >
      <div className="agent-lightbox__controls">
        <button
          aria-label={AGENT_LIGHTBOX_CLOSE_LABEL}
          className="agent-lightbox__control"
          onClick={onClose}
          onKeyDown={handleCloseKeyDown}
          ref={closeRef}
          title={`${AGENT_LIGHTBOX_CLOSE_LABEL} (Esc)`}
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>
        <button
          aria-label={AGENT_LIGHTBOX_REVEAL_LABEL}
          className="agent-lightbox__control agent-lightbox__control--secondary"
          onClick={() => images.reveal(request.attachmentId)}
          ref={revealRef}
          title={AGENT_LIGHTBOX_REVEAL_LABEL}
          type="button"
        >
          <ExternalLink aria-hidden="true" size={16} />
        </button>
      </div>
      <img
        alt={request.name}
        className="agent-lightbox__image"
        height={request.height}
        src={url}
        style={fit ?? undefined}
        width={request.width}
      />
    </div>
  );
}

function isControl(element: HTMLButtonElement | null): element is HTMLButtonElement {
  return element !== null;
}

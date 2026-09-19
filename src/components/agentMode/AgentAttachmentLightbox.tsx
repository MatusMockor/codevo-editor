import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { trapTab } from "./agentFocusTrap";
import type { AgentTurnAttachmentImagePort } from "./AgentTurnAttachments";
import {
  agentAttachmentLightboxFit,
  agentLightboxNeighborIndex,
  type AgentLightboxStep,
} from "./agentTurnAttachmentPresentation";
import type {
  AgentAttachmentLightboxEntry,
  AgentAttachmentLightboxRequest,
} from "./useAgentAttachmentLightbox";

export const AGENT_LIGHTBOX_CLOSE_LABEL = "Close";
export const AGENT_LIGHTBOX_SCRIM_LABEL = "Close image";
export const AGENT_LIGHTBOX_REVEAL_LABEL = "Open in system viewer";
export const AGENT_LIGHTBOX_PREVIOUS_LABEL = "Previous image";
export const AGENT_LIGHTBOX_NEXT_LABEL = "Next image";

export interface AgentAttachmentLightboxProps {
  readonly entry: AgentAttachmentLightboxEntry | null;
  readonly images: AgentTurnAttachmentImagePort | null;
  readonly canReveal?: boolean;
  onClose(): void;
  onSelect(index: number): void;
}

export function AgentAttachmentLightbox({
  entry,
  images,
  canReveal = true,
  onClose,
  onSelect,
}: AgentAttachmentLightboxProps) {
  const request = entry?.items[entry.index] ?? null;
  const state =
    request === null || images === null ? undefined : images.stateOf(request.attachmentId);
  const url = state?.kind === "ready" ? state.url : null;
  const stale = entry !== null && url === null;

  useEffect(() => {
    if (!stale) return;
    onClose();
  }, [onClose, stale]);

  if (entry === null || request === null || images === null || url === null) return null;

  return createPortal(
    <AgentAttachmentLightboxDialog
      canReveal={canReveal}
      entry={entry}
      images={images}
      onClose={onClose}
      onSelect={onSelect}
      request={request}
      url={url}
    />,
    entry.host,
  );
}

function AgentAttachmentLightboxDialog({
  canReveal,
  entry,
  images,
  onClose,
  onSelect,
  request,
  url,
}: {
  readonly canReveal: boolean;
  readonly entry: AgentAttachmentLightboxEntry;
  readonly images: AgentTurnAttachmentImagePort;
  readonly request: AgentAttachmentLightboxRequest;
  readonly url: string;
  onClose(): void;
  onSelect(index: number): void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const revealRef = useRef<HTMLButtonElement | null>(null);
  const previousRef = useRef<HTMLButtonElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const { origin, items, index } = entry;
  const fit = agentAttachmentLightboxFit(request);
  const ready = (attachmentId: string): boolean => images.stateOf(attachmentId)?.kind === "ready";
  const navigable = items.length > 1;
  const previous = navigable ? agentLightboxNeighborIndex(items, index, -1, ready) : null;
  const next = navigable ? agentLightboxNeighborIndex(items, index, 1, ready) : null;

  useEffect(() => {
    closeRef.current?.focus();
    return () => origin.focus({ preventScroll: true });
  }, [origin]);

  const step = (direction: AgentLightboxStep): void => {
    const target = direction === -1 ? previous : next;
    if (target === null) return;
    onSelect(target);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      step(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (event.key !== "Tab") return;
    trapTab(event, [closeRef, revealRef, previousRef, nextRef]);
  };

  const handleCloseKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClose();
  };

  return (
    <div
      aria-label={request.name}
      aria-modal="true"
      className="palette-backdrop agent-lightbox"
      onKeyDown={handleKeyDown}
      role="dialog"
      tabIndex={-1}
    >
      <div className="agent-lightbox__stage">
        <div className="agent-lightbox__frame">
          <img
            alt={request.name}
            className="agent-lightbox__image"
            height={request.height}
            onError={onClose}
            src={url}
            style={fit ?? undefined}
            width={request.width}
          />
          <button
            aria-label={AGENT_LIGHTBOX_CLOSE_LABEL}
            className="agent-lightbox__chip agent-lightbox__close"
            onClick={onClose}
            onKeyDown={handleCloseKeyDown}
            ref={closeRef}
            title={`${AGENT_LIGHTBOX_CLOSE_LABEL} (Esc)`}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="agent-lightbox__caption">
          <span aria-live="polite" className="agent-lightbox__name" title={request.name}>
            {request.name}
          </span>
          {canReveal && (
            <button
              className="agent-lightbox__reveal"
              onClick={() => images.reveal(request.attachmentId)}
              ref={revealRef}
              type="button"
            >
              <ExternalLink aria-hidden="true" size={14} />
              <span>{AGENT_LIGHTBOX_REVEAL_LABEL}</span>
            </button>
          )}
        </div>
      </div>
      {navigable && (
        <>
          <button
            aria-disabled={previous === null}
            aria-label={AGENT_LIGHTBOX_PREVIOUS_LABEL}
            className="agent-lightbox__chip agent-lightbox__nav agent-lightbox__nav--previous"
            onClick={() => step(-1)}
            ref={previousRef}
            title={`${AGENT_LIGHTBOX_PREVIOUS_LABEL} (←)`}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <button
            aria-disabled={next === null}
            aria-label={AGENT_LIGHTBOX_NEXT_LABEL}
            className="agent-lightbox__chip agent-lightbox__nav agent-lightbox__nav--next"
            onClick={() => step(1)}
            ref={nextRef}
            title={`${AGENT_LIGHTBOX_NEXT_LABEL} (→)`}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </>
      )}
      <button
        aria-label={AGENT_LIGHTBOX_SCRIM_LABEL}
        className="agent-lightbox__scrim"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
    </div>
  );
}

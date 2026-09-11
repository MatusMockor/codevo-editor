import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentTurnAttachmentImagePort,
  AgentTurnAttachmentImageViewer,
} from "./AgentTurnAttachments";
import {
  agentAttachmentImageIsResolvable,
  type AgentTurnAttachmentImageView,
} from "./agentTurnAttachmentPresentation";
import type { AgentTurnAttachmentImageOwner } from "./useAgentTurnAttachmentImages";

export interface AgentAttachmentLightboxRequest {
  readonly workspaceId: string;
  readonly threadId: string;
  readonly attachmentId: string;
  readonly name: string;
  readonly width?: number;
  readonly height?: number;
}

export interface AgentAttachmentLightboxEntry {
  readonly items: ReadonlyArray<AgentAttachmentLightboxRequest>;
  readonly index: number;
  readonly origin: HTMLElement;
  readonly host: Element;
}

export interface AgentAttachmentLightboxSurface {
  readonly images: AgentTurnAttachmentImageViewer | null;
  readonly entry: AgentAttachmentLightboxEntry | null;
  close(): void;
  select(index: number): void;
}

interface LightboxState {
  readonly owner: AgentTurnAttachmentImageOwner;
  readonly entry: AgentAttachmentLightboxEntry;
}

export function useAgentAttachmentLightbox(
  port: AgentTurnAttachmentImagePort | null,
  owner: AgentTurnAttachmentImageOwner,
): AgentAttachmentLightboxSurface {
  const [state, setState] = useState<LightboxState | null>(null);

  useEffect(() => () => setState(null), [owner]);

  const close = useCallback((): void => setState(null), []);

  const select = useCallback(
    (index: number): void => {
      if (port === null) return;
      setState((current) => {
        if (current === null || current.owner !== owner) return current;
        const item = current.entry.items[index];
        if (item === undefined || !Number.isInteger(index)) return current;
        if (port.stateOf(item.attachmentId)?.kind !== "ready") return current;
        return { owner, entry: { ...current.entry, index } };
      });
    },
    [owner, port],
  );

  const images = useMemo<AgentTurnAttachmentImageViewer | null>(() => {
    if (port === null) return null;
    return {
      stateOf: port.stateOf,
      ensure: port.ensure,
      reveal: port.reveal,
      open: (
        attachment: AgentTurnAttachmentImageView,
        origin: HTMLElement,
        siblings: ReadonlyArray<AgentTurnAttachmentImageView>,
      ): void => {
        if (port.stateOf(attachment.attachmentId)?.kind !== "ready") return;
        setState({ owner, entry: lightboxEntry(owner, attachment, origin, siblings) });
      },
    };
  }, [owner, port]);

  const entry = state !== null && state.owner === owner ? state.entry : null;
  return { images, entry, close, select };
}

function lightboxEntry(
  owner: AgentTurnAttachmentImageOwner,
  attachment: AgentTurnAttachmentImageView,
  origin: HTMLElement,
  siblings: ReadonlyArray<AgentTurnAttachmentImageView>,
): AgentAttachmentLightboxEntry {
  const views = siblings.filter(agentAttachmentImageIsResolvable);
  const position = views.findIndex((view) => view.attachmentId === attachment.attachmentId);
  const ordered = position === -1 ? [attachment] : views;
  return {
    items: ordered.map((view) => lightboxRequest(owner, view)),
    index: position === -1 ? 0 : position,
    origin,
    host: origin.closest(".workbench-frame") ?? document.body,
  };
}

function lightboxRequest(
  owner: AgentTurnAttachmentImageOwner,
  view: AgentTurnAttachmentImageView,
): AgentAttachmentLightboxRequest {
  return {
    workspaceId: owner.workspaceId,
    threadId: owner.threadId,
    attachmentId: view.attachmentId,
    name: view.name,
    width: view.width,
    height: view.height,
  };
}

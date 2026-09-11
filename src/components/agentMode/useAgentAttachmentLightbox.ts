import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentTurnAttachmentImagePort,
  AgentTurnAttachmentImageViewer,
} from "./AgentTurnAttachments";
import type { AgentTurnAttachmentImageView } from "./agentTurnAttachmentPresentation";
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
  readonly request: AgentAttachmentLightboxRequest;
  readonly origin: HTMLElement;
  readonly host: Element;
}

export interface AgentAttachmentLightboxSurface {
  readonly images: AgentTurnAttachmentImageViewer | null;
  readonly entry: AgentAttachmentLightboxEntry | null;
  close(): void;
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

  const images = useMemo<AgentTurnAttachmentImageViewer | null>(() => {
    if (port === null) return null;
    return {
      stateOf: port.stateOf,
      ensure: port.ensure,
      reveal: port.reveal,
      open: (attachment: AgentTurnAttachmentImageView, origin: HTMLElement): void => {
        if (port.stateOf(attachment.attachmentId)?.kind !== "ready") return;
        setState({ owner, entry: lightboxEntry(owner, attachment, origin) });
      },
    };
  }, [owner, port]);

  const entry = state !== null && state.owner === owner ? state.entry : null;
  return { images, entry, close };
}

function lightboxEntry(
  owner: AgentTurnAttachmentImageOwner,
  attachment: AgentTurnAttachmentImageView,
  origin: HTMLElement,
): AgentAttachmentLightboxEntry {
  return {
    request: {
      workspaceId: owner.workspaceId,
      threadId: owner.threadId,
      attachmentId: attachment.attachmentId,
      name: attachment.name,
      width: attachment.width,
      height: attachment.height,
    },
    origin,
    host: origin.closest(".app-shell") ?? document.body,
  };
}

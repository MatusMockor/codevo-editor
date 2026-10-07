import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AgentAttachmentImageState } from "../../application/useAgentAttachmentImages";
import type { AgentInlineImageState } from "../../application/useAgentInlineImages";
import type { AgentInlineImageItem } from "../../domain/agentMarkdown/agentInlineImagePlan";
import type { AgentTurnAttachmentImagePort } from "./AgentTurnAttachments";
import type {
  AgentInlineImagePort,
  AgentThreadInlineImageViewer,
  AgentThreadInlineImages,
} from "./agentInlineImagePort";
import type {
  AgentAttachmentLightboxEntry,
  AgentAttachmentLightboxRequest,
} from "./useAgentAttachmentLightbox";

const INLINE_IMAGE_LIGHTBOX_OWNER = "inline-image";

export interface AgentInlineImageLightboxOptions {
  readonly suppressed: boolean;
  onOpen(): void;
}

export interface AgentInlineImageLightboxSurface {
  readonly viewer: AgentThreadInlineImageViewer | null;
  readonly images: AgentTurnAttachmentImagePort | null;
  readonly entry: AgentAttachmentLightboxEntry | null;
  close(): void;
  select(index: number): void;
}

interface LightboxState {
  readonly thread: AgentThreadInlineImages;
  readonly port: AgentInlineImagePort;
  readonly entry: AgentAttachmentLightboxEntry;
}

export function useAgentInlineImageLightbox(
  thread: AgentThreadInlineImages | null,
  { onOpen, suppressed }: AgentInlineImageLightboxOptions,
): AgentInlineImageLightboxSurface {
  const [state, setState] = useState<LightboxState | null>(null);
  const shown = state !== null && state.thread === thread && !suppressed ? state : null;

  const close = useCallback((): void => setState(null), []);

  useEffect(() => {
    if (state === null || shown !== null) return;
    close();
  }, [close, shown, state]);

  const subscribe = useCallback(
    (listener: () => void): (() => void) => {
      if (shown === null) return ignore;
      return shown.thread.subscribe(listener);
    },
    [shown],
  );
  const revision = useCallback(
    (): number => (shown === null ? 0 : shown.thread.revision()),
    [shown],
  );
  useSyncExternalStore(subscribe, revision);

  const select = useCallback((index: number): void => {
    setState((current) => {
      if (current === null) return current;
      const item = current.entry.items[index];
      if (item === undefined || !Number.isInteger(index)) return current;
      if (current.port.stateOf(item.attachmentId)?.kind !== "ready") return current;
      return { ...current, entry: { ...current.entry, index } };
    });
  }, []);

  const viewer = useMemo<AgentThreadInlineImageViewer | null>(() => {
    if (thread === null) return null;
    return {
      forScope: (scope) => {
        const port = thread.forScope(scope);
        return {
          ...port,
          open: (item, origin, siblings): void => {
            const entry = lightboxEntry(port, item, origin, siblings);
            if (entry === null) return;
            onOpen();
            setState({ thread, port, entry });
          },
        };
      },
    };
  }, [onOpen, thread]);

  const shownPort = shown?.port ?? null;
  const shownPath = shown?.entry.items[shown.entry.index]?.attachmentId ?? null;

  useEffect(() => {
    if (shownPort === null || shownPath === null) return;
    return shownPort.pin(shownPath);
  }, [shownPath, shownPort]);

  const images = useMemo<AgentTurnAttachmentImagePort | null>(() => {
    if (shownPort === null) return null;
    return {
      stateOf: (path) => attachmentState(shownPort.stateOf(path)),
      ensure: ignore,
      reveal: ignore,
    };
  }, [shownPort]);

  return { viewer, images, entry: shown?.entry ?? null, close, select };
}

function attachmentState(
  state: AgentInlineImageState | undefined,
): AgentAttachmentImageState | undefined {
  if (state === undefined || state.kind === "waiting") return undefined;
  return state;
}

function lightboxEntry(
  port: AgentInlineImagePort,
  item: AgentInlineImageItem,
  origin: HTMLElement,
  siblings: ReadonlyArray<AgentInlineImageItem>,
): AgentAttachmentLightboxEntry | null {
  if (port.stateOf(item.path)?.kind !== "ready") return null;
  const ready = siblings.filter((sibling) => port.stateOf(sibling.path)?.kind === "ready");
  const position = ready.findIndex((sibling) => sibling.path === item.path);
  const ordered = position === -1 ? [item] : ready;
  return {
    items: ordered.map((sibling) => lightboxRequest(port, sibling)),
    index: position === -1 ? 0 : position,
    origin,
    host: origin.closest(".workbench-frame") ?? document.body,
  };
}

function lightboxRequest(
  port: AgentInlineImagePort,
  item: AgentInlineImageItem,
): AgentAttachmentLightboxRequest {
  const size = port.sizeOf(item.path);
  return {
    workspaceId: INLINE_IMAGE_LIGHTBOX_OWNER,
    threadId: INLINE_IMAGE_LIGHTBOX_OWNER,
    attachmentId: item.path,
    name: item.name,
    width: size?.width,
    height: size?.height,
  };
}

function ignore(): void {}

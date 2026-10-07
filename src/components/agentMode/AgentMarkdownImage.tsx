import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { ImageIcon, ImageOff } from "lucide-react";
import {
  AGENT_INLINE_IMAGE_CACHE_LIMIT_REASON,
  type AgentInlineImageSize,
  type AgentInlineImageState,
} from "../../application/useAgentInlineImages";
import type {
  AgentInlineImageHost,
  AgentInlineImageSlot,
} from "../../domain/agentMarkdown/agentInlineImagePlan";
import {
  AGENT_ATTACHMENT_LOADING_LABEL,
  AGENT_ATTACHMENT_UNAVAILABLE_LABEL,
} from "./agentTurnAttachmentPresentation";
import type { AgentMessageInlineImages } from "./useAgentMessageInlineImages";

export const AGENT_INLINE_IMAGE_OPEN_LABEL = "Open image";
export const AGENT_INLINE_IMAGE_RETRY_HINT = "Select to try again.";
export const AGENT_INLINE_IMAGE_WAITING_LABEL = "Image waiting for preview room";
const MAX_EDGE_REM: Readonly<Record<AgentInlineImageHost, number>> = {
  flow: 30,
  cell: 12,
};

type ImageBox = "slot" | "sized" | "natural";

type ImagePhase = "loading" | "waiting" | "unavailable" | "decoding" | "loaded";

const LOADING_STATE: AgentInlineImageState = Object.freeze({ kind: "loading" });
const ICON_SIZE = 14;

export const AgentMarkdownImage = memo(function AgentMarkdownImage({
  images,
  slot,
}: {
  readonly images: AgentMessageInlineImages;
  readonly slot: AgentInlineImageSlot;
}) {
  const { onLayout, open, port, viewport } = images;
  const { alt, host, layout, name, path } = slot;
  const hostRef = useRef<HTMLButtonElement | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const readState = useCallback(() => port.stateOf(path), [path, port]);
  const view = useSyncExternalStore(port.subscribe, readState) ?? LOADING_STATE;
  const phase = imagePhase(view, loadedUrl);
  const size = port.sizeOf(path);
  const box = imageBox(phase, size);

  useEffect(() => {
    const element = hostRef.current;
    if (element === null) return;
    let unpin: (() => void) | null = null;
    const enter = (): void => {
      if (unpin !== null) return;
      unpin = port.pin(path);
      port.ensure(path);
    };
    const leave = (): void => {
      unpin?.();
      unpin = null;
    };
    if (viewport === null) {
      enter();
      return leave;
    }
    const stop = viewport.watch(element, { enter, leave });
    return () => {
      stop();
      leave();
    };
  }, [path, port, viewport]);

  useLayoutEffect(() => {
    onLayout();
  }, [box, layout, onLayout, phase]);

  const activate = (origin: HTMLElement): void => {
    switch (view.kind) {
      case "loading":
      case "waiting":
        return;
      case "unavailable":
        port.retry(path);
        return;
      case "ready":
        open({ path, name }, origin);
        return;
      default:
        unsupportedState(view);
    }
  };
  const activateByKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (event.repeat) return;
    activate(event.currentTarget);
  };

  switch (view.kind) {
    case "loading":
      return (
        <button
          aria-disabled="true"
          aria-label={AGENT_ATTACHMENT_LOADING_LABEL}
          className="agent-md__inline-image"
          data-box={box}
          data-host={host}
          data-layout={layout}
          data-state="loading"
          ref={hostRef}
          style={boxStyle(box, size, host)}
          tabIndex={-1}
          type="button"
        />
      );
    case "waiting":
      return (
        <button
          aria-disabled="true"
          className="agent-attachments__chip agent-md__inline-image-chip"
          data-agent-attachment="image"
          data-state="waiting"
          ref={hostRef}
          title={AGENT_INLINE_IMAGE_CACHE_LIMIT_REASON}
          type="button"
        >
          <ImageIcon aria-hidden="true" size={ICON_SIZE} />
          <span className="agent-attachments__name">
            {chipLabel(AGENT_INLINE_IMAGE_WAITING_LABEL, alt)}
          </span>
          <span className="agent-visually-hidden">{AGENT_INLINE_IMAGE_CACHE_LIMIT_REASON}</span>
        </button>
      );
    case "unavailable": {
      const description = `${view.reason} ${AGENT_INLINE_IMAGE_RETRY_HINT}`;
      return (
        <button
          className="agent-attachments__chip agent-md__inline-image-chip"
          data-agent-attachment="unavailable"
          data-state="unavailable"
          onClick={(event) => activate(event.currentTarget)}
          onKeyDown={activateByKey}
          ref={hostRef}
          title={description}
          type="button"
        >
          <ImageOff aria-hidden="true" size={ICON_SIZE} />
          <span className="agent-attachments__name">
            {chipLabel(AGENT_ATTACHMENT_UNAVAILABLE_LABEL, alt)}
          </span>
          <span className="agent-visually-hidden">{description}</span>
        </button>
      );
    }
    case "ready": {
      const url = view.url;
      const settle = (event: SyntheticEvent<HTMLImageElement>): void => {
        const { naturalHeight, naturalWidth } = event.currentTarget;
        port.measure(path, url, { width: naturalWidth, height: naturalHeight });
        setLoadedUrl(url);
      };
      return (
        <button
          aria-label={`${AGENT_INLINE_IMAGE_OPEN_LABEL} ${name}`}
          className="agent-md__inline-image"
          data-box={box}
          data-host={host}
          data-layout={layout}
          data-loaded={phase === "loaded"}
          data-state="ready"
          onClick={(event) => activate(event.currentTarget)}
          onKeyDown={activateByKey}
          ref={hostRef}
          style={boxStyle(box, size, host)}
          type="button"
        >
          <img
            alt={name}
            className="agent-md__inline-image-file"
            decoding="async"
            draggable={false}
            height={size?.height}
            onError={() => port.markBroken(path, url)}
            onLoad={settle}
            src={url}
            width={size?.width}
          />
        </button>
      );
    }
    default:
      return unsupportedState(view);
  }
});

function imagePhase(view: AgentInlineImageState, loadedUrl: string | null): ImagePhase {
  switch (view.kind) {
    case "loading":
    case "waiting":
    case "unavailable":
      return view.kind;
    case "ready":
      return view.url === loadedUrl ? "loaded" : "decoding";
    default:
      return unsupportedState(view);
  }
}

function imageBox(phase: ImagePhase, size: AgentInlineImageSize | null): ImageBox {
  if (size !== null) return "sized";
  switch (phase) {
    case "loading":
    case "decoding":
      return "slot";
    case "waiting":
    case "unavailable":
    case "loaded":
      return "natural";
    default:
      return unsupportedPhase(phase);
  }
}

function boxStyle(
  box: ImageBox,
  size: AgentInlineImageSize | null,
  host: AgentInlineImageHost,
): CSSProperties | undefined {
  if (box !== "sized" || size === null) return undefined;
  const edge = MAX_EDGE_REM[host];
  const fitted = `${roundedRem((edge * size.width) / size.height)}rem`;
  const bounds = [`${size.width}px`, `${edge}rem`, fitted];
  const limits = host === "cell" ? bounds : ["100%", ...bounds];
  return {
    inlineSize: `min(${limits.join(", ")})`,
    aspectRatio: `${size.width} / ${size.height}`,
  };
}

function roundedRem(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function chipLabel(label: string, alt: string | null): string {
  if (alt === null) return label;
  return `${label}: ${alt}`;
}

function unsupportedPhase(phase: never): never {
  throw new Error(`Unsupported inline image phase: ${String(phase)}`);
}

function unsupportedState(state: never): never {
  throw new Error(`Unsupported inline image state: ${String(state)}`);
}

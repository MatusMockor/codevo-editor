import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentMarkdownViewport } from "../../application/agentMarkdownViewport";
import {
  agentInlineImageBlockSlots,
  agentInlineImagePlan,
  type AgentInlineImageBlockPlan,
  type AgentInlineImageBlockSlots,
  type AgentInlineImageItem,
  type AgentInlineImagePlan,
} from "../../domain/agentMarkdown/agentInlineImagePlan";
import type { AgentMarkdownBlock } from "../../domain/agentMarkdown/agentMarkdownTree";
import type { AgentInlineImagePort, AgentInlineImageViewer } from "./agentInlineImagePort";
import type { AgentLocalFileLinkScope } from "./agentMarkdownLinks";

const IMAGE_SYNTAX = "![";
const NO_GALLERY: ReadonlyArray<AgentInlineImageItem> = [];

export interface AgentMessageInlineImages {
  readonly port: AgentInlineImagePort;
  readonly viewport: AgentMarkdownViewport | null;
  open(item: AgentInlineImageItem, origin: HTMLElement): void;
  onLayout(): void;
}

export interface AgentMessageInlineImageSource {
  readonly viewer: AgentInlineImageViewer | null;
  readonly localFiles: AgentLocalFileLinkScope | null;
  readonly viewport: AgentMarkdownViewport | null;
  readonly onLayout: () => void;
}

export interface AgentMessageInlineImageLayout {
  readonly images: AgentMessageInlineImages | null;
  readonly blocks: ReadonlyArray<AgentInlineImageBlockPlan> | null;
  readonly truncated: boolean;
}

interface CachedSlots {
  readonly base: string | null;
  readonly slots: AgentInlineImageBlockSlots;
}

type SlotCache = WeakMap<AgentMarkdownBlock, CachedSlots>;

export function useAgentMessageInlineImages(
  { localFiles, onLayout, viewer, viewport }: AgentMessageInlineImageSource,
  blocks: ReadonlyArray<AgentMarkdownBlock> | null,
  text: string,
): AgentMessageInlineImageLayout {
  const [cache] = useState<SlotCache>(() => new WeakMap());
  const enabled = viewer !== null && localFiles?.kind !== "remote";
  const base = localFiles?.kind === "local" ? localFiles.base : null;
  const candidates = enabled && blocks !== null && text.includes(IMAGE_SYNTAX) ? blocks : null;

  const plan = useMemo<AgentInlineImagePlan | null>(() => {
    if (candidates === null) return null;
    return agentInlineImagePlan(candidates.map((block) => cachedSlots(cache, block, base)));
  }, [base, cache, candidates]);

  const planRef = useRef(plan);
  useLayoutEffect(() => {
    planRef.current = plan;
  }, [plan]);
  const open = useCallback(
    (item: AgentInlineImageItem, origin: HTMLElement): void => {
      viewer?.open(item, origin, planRef.current?.gallery ?? NO_GALLERY);
    },
    [viewer],
  );

  const images = useMemo<AgentMessageInlineImages | null>(() => {
    if (viewer === null || !enabled) return null;
    return { port: viewer, viewport, open, onLayout };
  }, [enabled, onLayout, open, viewer, viewport]);

  return { images, blocks: plan?.blocks ?? null, truncated: plan?.truncated ?? false };
}

function cachedSlots(
  cache: SlotCache,
  block: AgentMarkdownBlock,
  base: string | null,
): AgentInlineImageBlockSlots {
  const cached = cache.get(block);
  if (cached !== undefined && cached.base === base) return cached.slots;
  const slots = agentInlineImageBlockSlots(block, base);
  cache.set(block, { base, slots });
  return slots;
}

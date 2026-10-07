import type {
  AgentInlineImageSize,
  AgentInlineImageState,
} from "../../application/useAgentInlineImages";
import type { AgentInlineImageItem } from "../../domain/agentMarkdown/agentInlineImagePlan";

export interface AgentInlineImagePort {
  subscribe(listener: () => void): () => void;
  stateOf(path: string): AgentInlineImageState | undefined;
  sizeOf(path: string): AgentInlineImageSize | null;
  ensure(path: string): void;
  retry(path: string): void;
  pin(path: string): () => void;
  markBroken(path: string, url: string): void;
  measure(path: string, url: string, size: AgentInlineImageSize): void;
}

export interface AgentThreadInlineImages {
  subscribe(listener: () => void): () => void;
  revision(): number;
  forScope(scope: string): AgentInlineImagePort;
}

export interface AgentInlineImageViewer extends AgentInlineImagePort {
  open(
    item: AgentInlineImageItem,
    origin: HTMLElement,
    siblings: ReadonlyArray<AgentInlineImageItem>,
  ): void;
}

export interface AgentThreadInlineImageViewer {
  forScope(scope: string): AgentInlineImageViewer;
}

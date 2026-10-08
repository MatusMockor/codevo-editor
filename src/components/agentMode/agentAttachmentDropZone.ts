import { createContext, type RefObject } from "react";

export interface AgentAttachmentDropZone {
  readonly columnRef: RefObject<HTMLElement | null>;
  readonly available: boolean;
  showOverlay(): () => void;
}

export const AgentAttachmentDropZoneContext = createContext<AgentAttachmentDropZone | null>(null);

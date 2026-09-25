import { createPaletteProviderSlot } from "./commandPalette/commandPaletteProvider";

export interface AgentThreadOpener {
  openThread(threadId: string): boolean;
}

export interface AgentThreadOpenerSource {
  current(): AgentThreadOpener | null;
}

export const workbenchAgentThreadOpener = createPaletteProviderSlot<AgentThreadOpener>();

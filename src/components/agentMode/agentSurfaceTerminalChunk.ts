import { lazy } from "react";
import { createChunkLoader } from "../chunkLoader";
import { loadTerminalTabsPanel } from "../terminalTabsPanelChunk";

const agentSurfaceTerminalChunk = createChunkLoader(() =>
  Promise.all([import("./AgentSurfaceTerminal"), loadTerminalTabsPanel()]).then(
    ([module]) => module,
  ),
);

export const preloadAgentSurfaceTerminal = agentSurfaceTerminalChunk.preload;

export const LazyAgentSurfaceTerminal = lazy(() =>
  agentSurfaceTerminalChunk.load().then((module) => ({ default: module.AgentSurfaceTerminal })),
);

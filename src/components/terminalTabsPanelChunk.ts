import { lazy } from "react";
import { createChunkLoader } from "./chunkLoader";

const terminalTabsPanelChunk = createChunkLoader(() => import("./TerminalTabsPanel"));

export const loadTerminalTabsPanel = terminalTabsPanelChunk.load;
export const preloadTerminalTabsPanel = terminalTabsPanelChunk.preload;

export const LazyTerminalTabsPanel = lazy(() =>
  loadTerminalTabsPanel().then((module) => ({ default: module.TerminalTabsPanel })),
);

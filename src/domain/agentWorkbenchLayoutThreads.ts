import {
  agentSurfacesEqual,
  agentWorkbenchLayoutSnapshotsEqual,
  parseAgentSurfaceSelection,
  parseAgentWorkbenchLayout,
  parsePersistedAgentBottomPanel,
  persistableAgentSurfaceSelection,
  serializeAgentWorkbenchLayout,
  type AgentSurfaceKind,
  type AgentWorkbenchLayout,
  type AgentWorkbenchLayoutPersisted,
} from "./agentWorkbenchLayout";
import type { AgentFileViewerReveal } from "./agentWorkbenchLayoutFileReveal";

export const MAX_AGENT_THREAD_LAYOUTS = 200;
export const MAX_AGENT_THREAD_LAYOUT_KEY_CHARS = 256;

export interface AgentThreadSurfaceLayout {
  readonly openSurfaces: ReadonlyArray<AgentSurfaceKind>;
  readonly activeSurface: AgentSurfaceKind | null;
  readonly rightPanelMaximized: boolean;
}

export interface AgentThreadSurfaceLayoutPersisted extends AgentThreadSurfaceLayout {
  readonly threadId: string;
}

export interface AgentThreadSurfaceLayoutEntry extends AgentThreadSurfaceLayoutPersisted {
  readonly fileReveal: AgentFileViewerReveal | null;
}

export type AgentThreadSurfaceLayouts = ReadonlyArray<AgentThreadSurfaceLayoutEntry>;

export interface AgentWorkbenchSessionPersisted extends AgentWorkbenchLayoutPersisted {
  readonly threadLayouts?: ReadonlyArray<AgentThreadSurfaceLayoutPersisted>;
}

export const NO_AGENT_THREAD_LAYOUTS: AgentThreadSurfaceLayouts = Object.freeze([]);

export function isAgentThreadLayoutKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_AGENT_THREAD_LAYOUT_KEY_CHARS
  );
}

export function agentThreadSurfaceLayoutOf(layout: AgentWorkbenchLayout): AgentThreadSurfaceLayout {
  return {
    openSurfaces: layout.openSurfaces,
    activeSurface: layout.activeSurface,
    rightPanelMaximized: layout.rightPanelMaximized,
  };
}

export function findAgentThreadSurfaceLayout(
  entries: AgentThreadSurfaceLayouts,
  threadId: string | null,
): AgentThreadSurfaceLayoutEntry | null {
  if (threadId === null) return null;
  return entries.find((entry) => entry.threadId === threadId) ?? null;
}

export function withAgentThreadSurfaceLayout(
  layout: AgentWorkbenchLayout,
  thread: AgentThreadSurfaceLayout | null,
): AgentWorkbenchLayout {
  if (thread === null) return layout;
  const rightPanelMaximized = thread.rightPanelMaximized && layout.rightPanel === "open";
  if (
    agentSurfacesEqual(layout.openSurfaces, thread.openSurfaces) &&
    layout.activeSurface === thread.activeSurface &&
    layout.rightPanelMaximized === rightPanelMaximized
  ) {
    return layout;
  }
  return {
    ...layout,
    openSurfaces: thread.openSurfaces,
    activeSurface: thread.activeSurface,
    rightPanelMaximized,
  };
}

export function rememberAgentThreadSurfaceLayout(
  entries: AgentThreadSurfaceLayouts,
  threadId: string,
  thread: AgentThreadSurfaceLayout,
  fileReveal: AgentFileViewerReveal | null,
): AgentThreadSurfaceLayouts {
  if (!isAgentThreadLayoutKey(threadId)) return entries;
  const entry: AgentThreadSurfaceLayoutEntry = {
    threadId,
    openSurfaces: thread.openSurfaces,
    activeSurface: thread.activeSurface,
    rightPanelMaximized: thread.rightPanelMaximized,
    fileReveal,
  };
  const rest = entries.filter((candidate) => candidate.threadId !== threadId);
  return [entry, ...rest.slice(0, MAX_AGENT_THREAD_LAYOUTS - 1)];
}

export function parseAgentThreadSurfaceLayouts(value: unknown): AgentThreadSurfaceLayouts {
  if (!isRecord(value) || !Array.isArray(value.threadLayouts)) return NO_AGENT_THREAD_LAYOUTS;
  const entries: AgentThreadSurfaceLayoutEntry[] = [];
  for (const candidate of value.threadLayouts) {
    if (entries.length >= MAX_AGENT_THREAD_LAYOUTS) break;
    const entry = parseEntry(candidate);
    if (entry === null) continue;
    if (entries.some((existing) => existing.threadId === entry.threadId)) continue;
    entries.push(entry);
  }
  return entries.length === 0 ? NO_AGENT_THREAD_LAYOUTS : entries;
}

export function serializeAgentWorkbenchSession(
  layout: AgentWorkbenchLayout,
  bottomPanel: boolean,
  threads: AgentThreadSurfaceLayouts,
): AgentWorkbenchSessionPersisted {
  const snapshot = serializeAgentWorkbenchLayout(layout, bottomPanel);
  if (threads.length === 0) return snapshot;
  return {
    ...snapshot,
    threadLayouts: threads.slice(0, MAX_AGENT_THREAD_LAYOUTS).map(serializeEntry),
  };
}

export function normalizePersistedAgentWorkbenchSession(
  value: unknown,
): AgentWorkbenchSessionPersisted | undefined {
  if (!isRecord(value)) return undefined;
  return serializeAgentWorkbenchSession(
    parseAgentWorkbenchLayout(value),
    parsePersistedAgentBottomPanel(value),
    parseAgentThreadSurfaceLayouts(value),
  );
}

export function agentWorkbenchSessionSnapshotsEqual(
  left: AgentWorkbenchSessionPersisted,
  right: AgentWorkbenchSessionPersisted,
): boolean {
  if (!agentWorkbenchLayoutSnapshotsEqual(left, right)) return false;
  const leftThreads = left.threadLayouts ?? [];
  const rightThreads = right.threadLayouts ?? [];
  if (leftThreads.length !== rightThreads.length) return false;
  return leftThreads.every((entry, index) => {
    const other = rightThreads[index];
    return (
      other !== undefined &&
      entry.threadId === other.threadId &&
      entry.activeSurface === other.activeSurface &&
      entry.rightPanelMaximized === other.rightPanelMaximized &&
      agentSurfacesEqual(entry.openSurfaces, other.openSurfaces)
    );
  });
}

function serializeEntry(entry: AgentThreadSurfaceLayoutEntry): AgentThreadSurfaceLayoutPersisted {
  const selection = persistableAgentSurfaceSelection(entry);
  return {
    threadId: entry.threadId,
    openSurfaces: selection.openSurfaces,
    activeSurface: selection.activeSurface,
    rightPanelMaximized: entry.rightPanelMaximized,
  };
}

function parseEntry(value: unknown): AgentThreadSurfaceLayoutEntry | null {
  if (!isRecord(value)) return null;
  if (!isAgentThreadLayoutKey(value.threadId)) return null;
  if (!Array.isArray(value.openSurfaces)) return null;
  const selection = parseAgentSurfaceSelection(value);
  return {
    threadId: value.threadId,
    openSurfaces: selection.openSurfaces,
    activeSurface: selection.activeSurface,
    rightPanelMaximized: value.rightPanelMaximized === true,
    fileReveal: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

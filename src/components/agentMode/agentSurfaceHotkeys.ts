import { AGENT_SURFACE_KINDS, type AgentSurfaceKind } from "../../domain/agentWorkbenchLayout";

export const AGENT_SURFACE_HOTKEYS: Readonly<Record<AgentSurfaceKind, string>> = {
  files: "F",
  diff: "D",
  terminal: "T",
};

export function agentSurfaceForHotkey(key: string): AgentSurfaceKind | null {
  if (key.length !== 1) return null;
  const upper = key.toUpperCase();
  return AGENT_SURFACE_KINDS.find((kind) => AGENT_SURFACE_HOTKEYS[kind] === upper) ?? null;
}

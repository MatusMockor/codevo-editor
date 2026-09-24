import { AGENT_SURFACE_KINDS, type AgentSurfaceKind } from "../../domain/agentWorkbenchLayout";
import { AGENT_RIGHT_PANEL_SURFACE_CATALOG } from "./rightPanel/agentRightPanelSurfaceCatalog";

export const AGENT_SURFACE_HOTKEYS: Readonly<Record<AgentSurfaceKind, string | null>> =
  Object.freeze(
    Object.fromEntries(
      AGENT_SURFACE_KINDS.map((kind) => [
        kind,
        AGENT_RIGHT_PANEL_SURFACE_CATALOG[kind].addMenuShortcut,
      ]),
    ) as Record<AgentSurfaceKind, string | null>,
  );

export function agentSurfaceForHotkey(key: string): AgentSurfaceKind | null {
  if (key.length !== 1) return null;
  const upper = key.toUpperCase();
  return AGENT_SURFACE_KINDS.find((kind) => AGENT_SURFACE_HOTKEYS[kind] === upper) ?? null;
}

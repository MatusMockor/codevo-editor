import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";
import { AGENT_RIGHT_PANEL_SURFACE_CATALOG } from "./agentRightPanelSurfaceCatalog";

export interface AgentTerminalStripSession {
  readonly id: string;
  readonly title: string;
  readonly live: boolean;
  readonly closable: boolean;
}

export interface AgentTerminalStripState {
  readonly sessions: ReadonlyArray<AgentTerminalStripSession>;
  readonly activeSessionId: string | null;
}

export type AgentTerminalSessionCommand =
  | { readonly kind: "activate"; readonly sessionId: string }
  | { readonly kind: "close"; readonly sessionId: string }
  | { readonly kind: "create" };

export type AgentRightPanelTabEntry =
  | {
      readonly kind: "surface";
      readonly id: string;
      readonly surface: AgentSurfaceKind;
      readonly label: string;
      readonly active: boolean;
      readonly panelId: string;
    }
  | {
      readonly kind: "terminalSession";
      readonly id: string;
      readonly sessionId: string;
      readonly label: string;
      readonly live: boolean;
      readonly closable: boolean;
      readonly active: boolean;
      readonly panelId: string;
    };

export interface AgentRightPanelTabEntriesInput {
  readonly openSurfaces: ReadonlyArray<AgentSurfaceKind>;
  readonly activeSurface: AgentSurfaceKind | null;
  readonly terminal: AgentTerminalStripState | null;
}

export function agentSurfacePanelId(kind: AgentSurfaceKind): string {
  return `agent-surface-panel-${kind}`;
}

export function agentRightPanelTabEntries(
  input: AgentRightPanelTabEntriesInput,
): ReadonlyArray<AgentRightPanelTabEntry> {
  return input.openSurfaces.flatMap((surface) => surfaceEntries(surface, input));
}

export function selectedAgentRightPanelTabId(
  entries: ReadonlyArray<AgentRightPanelTabEntry>,
): string | null {
  return entries.find((entry) => entry.active)?.id ?? null;
}

function surfaceEntries(
  surface: AgentSurfaceKind,
  input: AgentRightPanelTabEntriesInput,
): ReadonlyArray<AgentRightPanelTabEntry> {
  const active = input.activeSurface === surface;
  const terminal = input.terminal;
  if (surface === "terminal" && terminal !== null && terminal.sessions.length > 0) {
    return terminal.sessions.map((session) => ({
      kind: "terminalSession",
      id: `terminal:${session.id}`,
      sessionId: session.id,
      label: session.title,
      live: session.live,
      closable: session.closable,
      active: active && terminal.activeSessionId === session.id,
      panelId: agentSurfacePanelId("terminal"),
    }));
  }
  return [
    {
      kind: "surface",
      id: `surface:${surface}`,
      surface,
      label: AGENT_RIGHT_PANEL_SURFACE_CATALOG[surface].tabLabel,
      active,
      panelId: agentSurfacePanelId(surface),
    },
  ];
}

import type { AgentSurfaceKind } from "../domain/agentWorkbenchLayout";

export const AGENT_JUMP_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type AgentJumpSlot = (typeof AGENT_JUMP_SLOTS)[number];

export type AgentViewCommandId =
  | "agent.newThread"
  | "agent.previousThread"
  | "agent.nextThread"
  | "agent.searchThreads"
  | "agent.findInThread"
  | "agent.goToTurn"
  | "agent.runPreferredScript"
  | "agent.openCommitMenu"
  | "panel.toggleMaximized"
  | "project.add"
  | `agent.jumpToThread.${AgentJumpSlot}`;

export interface AgentViewCommandHandlers {
  surfaceBlocked(surface: AgentSurfaceKind): boolean;
  newThread(): void;
  previousThread(): void;
  nextThread(): void;
  jumpToThread(slot: AgentJumpSlot): void;
  searchThreads(): void;
  findInThread(): void;
  goToTurn?(): void;
  threadFindFocused?(): boolean;
  editorTextFocused?(): boolean;
  runPreferredScript?(): void;
  openCommitMenu?(): void;
  toggleMaximizedPanel?(): void;
  addProject?(): void;
  threadSelected(): boolean;
}

export interface AgentViewCommandBridge {
  bind(handlers: AgentViewCommandHandlers): () => void;
  bound(): boolean;
  threadSelected(): boolean;
  threadFindFocused(): boolean;
  editorTextFocused(): boolean;
  surfaceBlocked(surface: AgentSurfaceKind): boolean;
  addProjectAvailable(): boolean;
  run(commandId: AgentViewCommandId): void;
}

export function agentJumpCommandId(slot: AgentJumpSlot): `agent.jumpToThread.${AgentJumpSlot}` {
  return `agent.jumpToThread.${slot}`;
}

export function createAgentViewCommandBridge(): AgentViewCommandBridge {
  let current: AgentViewCommandHandlers | null = null;

  return {
    bind(handlers) {
      current = handlers;
      return () => {
        if (current !== handlers) return;
        current = null;
      };
    },
    bound: () => current !== null,
    threadSelected: () => current?.threadSelected() ?? false,
    threadFindFocused: () => current?.threadFindFocused?.() ?? false,
    editorTextFocused: () => current?.editorTextFocused?.() ?? false,
    surfaceBlocked: (surface) => current?.surfaceBlocked(surface) ?? true,
    addProjectAvailable: () => current?.addProject !== undefined,
    run(commandId) {
      const handlers = current;
      if (handlers === null) return;
      dispatch(handlers, commandId);
    },
  };
}

export const workbenchAgentViewCommandBridge = createAgentViewCommandBridge();

function dispatch(handlers: AgentViewCommandHandlers, commandId: AgentViewCommandId): void {
  switch (commandId) {
    case "agent.newThread":
      handlers.newThread();
      return;
    case "agent.previousThread":
      handlers.previousThread();
      return;
    case "agent.nextThread":
      handlers.nextThread();
      return;
    case "agent.searchThreads":
      handlers.searchThreads();
      return;
    case "agent.findInThread":
      handlers.findInThread();
      return;
    case "agent.goToTurn":
      handlers.goToTurn?.();
      return;
    case "agent.runPreferredScript":
      handlers.runPreferredScript?.();
      return;
    case "agent.openCommitMenu":
      handlers.openCommitMenu?.();
      return;
    case "panel.toggleMaximized":
      handlers.toggleMaximizedPanel?.();
      return;
    case "project.add":
      handlers.addProject?.();
      return;
    default:
      handlers.jumpToThread(jumpSlotOf(commandId));
  }
}

function jumpSlotOf(commandId: `agent.jumpToThread.${AgentJumpSlot}`): AgentJumpSlot {
  const slot = Number(commandId.slice("agent.jumpToThread.".length));
  const known = AGENT_JUMP_SLOTS.find((candidate) => candidate === slot);
  if (known === undefined) throw new TypeError(`Unsupported agent jump command: ${commandId}.`);
  return known;
}

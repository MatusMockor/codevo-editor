import {
  editorExpandToggleAction,
  rightPanelToggleAction,
  type AgentSurfaceKind,
  type AgentWorkbenchLayout,
  type AgentWorkbenchLayoutAction,
} from "../domain/agentWorkbenchLayout";
import type { KeymapCommandId } from "../domain/keymap";
import {
  AGENT_JUMP_SLOTS,
  agentJumpCommandId,
  createAgentViewCommandBridge,
  type AgentViewCommandBridge,
  type AgentViewCommandId,
} from "./agentViewCommandBridge";
import type { Command, CommandContext } from "./commandRegistry";

export interface AgentWorkbenchLayoutCommandPort {
  readonly layout: AgentWorkbenchLayout;
  dispatch(action: AgentWorkbenchLayoutAction): void;
}

export interface WorkbenchAgentCommandsOptions {
  agentLayout?: AgentWorkbenchLayoutCommandPort;
  viewCommands?: AgentViewCommandBridge;
  shortcut?: (commandId: KeymapCommandId) => string;
}

const SURFACE_COMMANDS: ReadonlyArray<{
  readonly id: KeymapCommandId;
  readonly surface: AgentSurfaceKind;
  readonly title: string;
}> = [
  { id: "agent.openFilesSurface", surface: "files", title: "Show Files Surface" },
  { id: "agent.openDiffSurface", surface: "diff", title: "Show Diff Surface" },
  { id: "agent.openTerminalSurface", surface: "terminal", title: "Show Terminal Surface" },
];

export function workbenchAgentCommands({
  agentLayout,
  shortcut,
  viewCommands = createAgentViewCommandBridge(),
}: WorkbenchAgentCommandsOptions): Command[] {
  const inAgentMode = (context: CommandContext): boolean =>
    context.hasWorkspace && viewCommands.bound();
  const withThread = (context: CommandContext): boolean =>
    inAgentMode(context) && viewCommands.threadSelected();
  const viewCommand = (
    id: AgentViewCommandId,
    title: string,
    isEnabled: (context: CommandContext) => boolean = inAgentMode,
  ): Command => ({
    id,
    title,
    category: "Agents",
    shortcut: shortcut?.(id),
    isEnabled,
    run: () => viewCommands.run(id),
  });
  const layoutCommand = (
    id: KeymapCommandId,
    title: string,
    action: AgentWorkbenchLayoutAction,
  ): Command => ({
    id,
    title,
    category: "Agents",
    shortcut: shortcut?.(id),
    isEnabled: (context) => context.hasWorkspace,
    run: () => agentLayout?.dispatch(action),
  });
  const layoutPolicyCommand = (
    id: KeymapCommandId,
    title: string,
    actionFor: (
      layout: AgentWorkbenchLayout,
      isSurfaceBlocked: (surface: AgentSurfaceKind) => boolean,
    ) => AgentWorkbenchLayoutAction,
  ): Command => ({
    id,
    title,
    category: "Agents",
    shortcut: shortcut?.(id),
    isEnabled: (context) => context.hasWorkspace,
    run: () => {
      if (agentLayout === undefined) return;
      agentLayout.dispatch(
        actionFor(agentLayout.layout, (surface) => viewCommands.surfaceBlocked(surface)),
      );
    },
  });

  return [
    viewCommand("agent.newThread", "New Thread"),
    viewCommand("agent.previousThread", "Previous Thread"),
    viewCommand("agent.nextThread", "Next Thread"),
    ...AGENT_JUMP_SLOTS.map((slot) =>
      viewCommand(agentJumpCommandId(slot), `Jump to Thread ${slot}`),
    ),
    viewCommand("agent.searchThreads", "Search Threads"),
    viewCommand("agent.findInThread", "Find in Thread", withThread),
    viewCommand("agent.runPreferredScript", "Run Thread Script", withThread),
    viewCommand("agent.openCommitMenu", "Commit Thread Changes", withThread),
    layoutPolicyCommand("agent.toggleRightPanel", "Toggle Right Panel", rightPanelToggleAction),
    ...SURFACE_COMMANDS.map((surfaceCommand) =>
      layoutCommand(surfaceCommand.id, surfaceCommand.title, {
        kind: "openSurface",
        surface: surfaceCommand.surface,
      }),
    ),
    layoutPolicyCommand(
      "agent.toggleEditorExpanded",
      "Expand or Collapse Editor",
      editorExpandToggleAction,
    ),
  ];
}

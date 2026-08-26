import type { AgentWorkbenchLayoutState } from "../../application/useAgentWorkbenchLayout";
import {
  agentWorkbenchLayoutReducer,
  initialAgentWorkbenchLayout,
  type AgentWorkbenchLayout,
  type AgentWorkbenchLayoutAction,
} from "../../domain/agentWorkbenchLayout";
import { UNAVAILABLE_AGENT_SCRIPT_RUNNER, type AgentWorkbenchChrome } from "./agentWorkbenchChrome";

export interface RecordedAgentWorkbenchLayout extends AgentWorkbenchLayoutState {
  readonly actions: AgentWorkbenchLayoutAction[];
}

export function recordedLayoutState(
  overrides: Partial<AgentWorkbenchLayout> = {},
): RecordedAgentWorkbenchLayout {
  const actions: AgentWorkbenchLayoutAction[] = [];
  const state = { ...initialAgentWorkbenchLayout, ...overrides };
  return {
    actions,
    layout: state,
    effectiveLayout: state.layout,
    dispatch: (action) => {
      actions.push(action);
    },
  };
}

export function chromeFixture(overrides: Partial<AgentWorkbenchChrome> = {}): AgentWorkbenchChrome {
  return {
    layout: recordedLayoutState(),
    bottomPanelVisible: false,
    shortcuts: null,
    scripts: UNAVAILABLE_AGENT_SCRIPT_RUNNER,
    workspaceId: "workspace-app",
    workspaceTrusted: true,
    fileTree: null,
    diff: { monacoTheme: "calm-dark" },
    terminal: null,
    addProject: null,
    onToggleBottomPanel: () => undefined,
    onShowTerminalPanel: () => undefined,
    onOpenScriptsView: null,
    revealPath: async () => undefined,
    ...overrides,
  };
}

export function reduceRecordedLayout(layout: RecordedAgentWorkbenchLayout): AgentWorkbenchLayout {
  return layout.actions.reduce(agentWorkbenchLayoutReducer, layout.layout);
}

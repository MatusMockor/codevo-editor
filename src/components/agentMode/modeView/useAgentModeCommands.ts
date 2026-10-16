import { useCallback, useMemo, useState, type RefObject } from "react";
import { agentNoticeForProject } from "../../../application/agentProjectAuthority";
import type { AgentTasksNotice } from "../../../application/agentThreadPorts";
import type {
  AgentViewCommandBridge,
  AgentViewCommandHandlers,
} from "../../../application/agentViewCommandBridge";
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";
import { useAgentCommandPaletteProvider } from "../useAgentCommandPaletteProvider";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import { useAgentViewCommands } from "../useAgentViewCommands";
import type { AgentModeAgents, AgentModeNoticeReporter } from "./agentModeViewProps";
import type { AgentModeProjects } from "./useAgentModeProjects";
import type { AgentModeRailProjects } from "./useAgentModeRailProjects";
import type { AgentModeSurface } from "./useAgentModeSurface";

export interface AgentModeCommandsOptions {
  readonly agents: AgentModeAgents;
  readonly navigation: AgentThreadNavigation;
  readonly projectsState: AgentModeProjects;
  readonly surfaceState: AgentModeSurface;
  readonly railProjects: AgentModeRailProjects;
  readonly viewCommands: AgentViewCommandBridge | null;
  readonly selectedThreadId: string | null;
  readonly selectedRootKey: string | null;
  readonly openAddProjectRef: RefObject<() => void>;
  readonly localNotice: AgentTasksNotice | null;
  readonly setLocalNotice: AgentModeNoticeReporter;
  openSurfaceCommand(kind: AgentSurfaceKind): void;
}

export function useAgentModeCommands({
  agents,
  navigation,
  projectsState,
  surfaceState,
  railProjects,
  viewCommands,
  selectedThreadId,
  selectedRootKey,
  openAddProjectRef,
  localNotice,
  setLocalNotice,
  openSurfaceCommand,
}: AgentModeCommandsOptions) {
  const [goToTurnSignal, setGoToTurnSignal] = useState(0);
  const { scripts, toggleResponsivePanel } = surfaceState;
  const { projectThreads, requestNewThread } = railProjects;
  const navigationCommands = navigation.commands;
  const surfaceBlocked = surfaceState.surface.surfaceBlocked;
  const commandHandlers = useMemo<AgentViewCommandHandlers>(
    () => ({
      ...navigationCommands,
      newThread: () => requestNewThread(false),
      newThreadIn: projectThreads.openNewThreadPicker,
      runPreferredScript: () => {
        if (scripts.preferred === null) return;
        scripts.runScript(scripts.preferred.key);
      },
      openCommitMenu: () => {
        if (selectedThreadId === null) return;
        openSurfaceCommand("git");
      },
      goToTurn: () => {
        if (selectedThreadId === null) return;
        setGoToTurnSignal((current) => current + 1);
      },
      toggleMaximizedPanel: toggleResponsivePanel,
      addProject: () => openAddProjectRef.current(),
      surfaceBlocked,
    }),
    [
      navigationCommands,
      scripts,
      selectedThreadId,
      requestNewThread,
      projectThreads.openNewThreadPicker,
      openSurfaceCommand,
      surfaceBlocked,
      toggleResponsivePanel,
      openAddProjectRef,
    ],
  );
  useAgentViewCommands(viewCommands, commandHandlers);
  useAgentCommandPaletteProvider({
    threads: projectsState.presentationThreads,
    projects: projectsState.displayProjects,
    selectedThreadId,
    activeProjectKey: navigation.railScope?.projectRootKey ?? null,
    scripts,
    selectThread: navigation.selectThread,
    switchProject: projectThreads.switchProject,
    newThreadIn: projectThreads.newThreadInProject,
  });

  const notice = localNotice ?? agentNoticeForProject(agents.notice, selectedRootKey);
  const dismissNotice = useCallback(() => {
    if (localNotice !== null) {
      setLocalNotice(null);
      return;
    }
    if (agents.notice !== null) {
      agents.dismissNotice();
      return;
    }
  }, [agents, localNotice, setLocalNotice]);
  return { goToTurnSignal, notice, dismissNotice };
}

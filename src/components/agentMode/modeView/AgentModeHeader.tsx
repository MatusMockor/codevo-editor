import type { AgentThreadView } from "../../../application/agentThreadPorts";
import { AgentThreadErrorBanner } from "../AgentThreadErrorBanner";
import { AgentThreadHeader } from "../AgentThreadHeader";
import { AgentAgentsToggleButton } from "../agents/AgentAgentsToggleButton";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import type { AgentModeAgents } from "./agentModeViewProps";
import type { AgentModeActivity } from "./useAgentModeActivity";
import type { AgentModeComposer } from "./useAgentModeComposer";
import type { AgentModeCreation } from "./useAgentModeCreation";
import type { AgentModeHeaderChrome } from "./useAgentModeHeaderChrome";
import type { AgentModeSurface } from "./useAgentModeSurface";
import type { AgentModeThreadMenu } from "./useAgentModeThreadMenu";

const AGENTS_TOGGLE_BUTTON = <AgentAgentsToggleButton />;

export interface AgentModeHeaderProps {
  readonly agents: AgentModeAgents;
  readonly chrome: AgentWorkbenchChrome;
  readonly surfaceState: AgentModeSurface;
  readonly threadMenu: AgentModeThreadMenu;
  readonly activity: AgentModeActivity;
  readonly headerChrome: AgentModeHeaderChrome;
  readonly headerProject: AgentModeCreation["headerProject"];
  readonly composerState: AgentModeComposer;
  readonly selectedThread: AgentThreadView | null;
  readonly sessionThread: AgentThreadView | null;
}

export function AgentModeHeader({
  agents,
  chrome,
  surfaceState,
  threadMenu,
  activity,
  headerChrome,
  headerProject,
  composerState,
  selectedThread,
  sessionThread,
}: AgentModeHeaderProps) {
  const { layout } = surfaceState.surface;
  return (
    <>
      <AgentThreadHeader
        bottomPanelOpen={chrome.bottomPanelVisible}
        gitSurfaceActive={layout.rightPanel === "open" && layout.activeSurface === "git"}
        layout={layout}
        leading={
          layout.rail === "collapsed" && !layout.rightPanelMaximized
            ? headerChrome.sidebarReveal
            : null
        }
        onNewThread={threadMenu.newThread}
        onOpenScriptsView={chrome.onOpenScriptsView}
        onOpenSurface={activity.openSurfaceCommand}
        onOpenTerminalSessions={headerChrome.openHeaderTerminalSessions}
        onRenameThread={threadMenu.renameThread}
        onRevealFailed={activity.revealFailed}
        onRevealPath={chrome.revealPath}
        onThreadMenuCommand={threadMenu.threadMenuCommand}
        onToggleBottomPanel={chrome.onToggleBottomPanel}
        onToggleRightPanel={activity.toggleRightPanelCommand}
        project={headerProject}
        scripts={surfaceState.headerScripts}
        serverPorts={surfaceState.serverPortsMenu}
        shortcuts={chrome.shortcuts}
        thread={selectedThread}
        trailingExtras={AGENTS_TOGGLE_BUTTON}
      />
      <AgentThreadErrorBanner
        agents={agents}
        recovery={composerState.composer.composerProps.recovery ?? null}
        view={sessionThread}
      />
    </>
  );
}

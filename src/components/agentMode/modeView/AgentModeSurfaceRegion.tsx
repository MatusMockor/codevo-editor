import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import type { WorkspaceTrustOrigin } from "../../../domain/trust";
import { AgentRegionBoundary } from "../AgentRegionBoundary";
import { AgentSurfaceHost } from "../AgentSurfaceHost";
import { AgentAgentsPanelSurface } from "../agents/AgentAgentsPanelSurface";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import type { AgentModeActivity } from "./useAgentModeActivity";
import type { AgentModeComposer } from "./useAgentModeComposer";
import type { AgentModeCreation } from "./useAgentModeCreation";
import type { AgentModeHeaderChrome } from "./useAgentModeHeaderChrome";
import type { AgentModeScope } from "./useAgentModeScope";
import type { AgentModeSelectedThread } from "./useAgentModeSelectedThread";
import type { AgentModeSurface } from "./useAgentModeSurface";
import type { AgentModeThreadMenu } from "./useAgentModeThreadMenu";

const AGENTS_PANEL_SURFACE = <AgentAgentsPanelSurface />;

export interface AgentModeSurfaceRegionProps {
  readonly chrome: AgentWorkbenchChrome;
  readonly selected: AgentModeSelectedThread;
  readonly scope: AgentModeScope;
  readonly composerState: AgentModeComposer;
  readonly surfaceState: AgentModeSurface;
  readonly threadMenu: AgentModeThreadMenu;
  readonly activity: AgentModeActivity;
  readonly creationState: AgentModeCreation;
  readonly headerChrome: AgentModeHeaderChrome;
  readonly displayProjects: ReadonlyArray<AgentProjectDescriptor>;
  readonly selectedThreadId: string | null;
  readonly selectedServerId: string | null;
  readonly textClipboard: TextClipboardGateway | null;
  readonly workspaceRoot: string | null;
  trustProject(projectRootKey: string, origin?: WorkspaceTrustOrigin): void;
}

export function AgentModeSurfaceRegion({
  chrome,
  selected,
  scope,
  composerState,
  surfaceState,
  threadMenu,
  activity,
  creationState,
  headerChrome,
  displayProjects,
  selectedThreadId,
  selectedServerId,
  textClipboard,
  workspaceRoot,
  trustProject,
}: AgentModeSurfaceRegionProps) {
  const { surface, diffScopes, shipActions, scripts } = surfaceState;
  const { layout } = surface;
  const { composerProps } = composerState.composer;
  const { surfaceThread, surfaceThreadRootPath } = selected;
  if (!surface.surfaceHost.mounted) return null;
  return (
    <AgentRegionBoundary
      clipboard={textClipboard}
      hidden={surface.surfaceHost.hidden}
      region="rightPanel"
      resetKeys={[selectedThreadId, selectedServerId, layout.activeSurface, layout.rightPanel]}
    >
      <AgentSurfaceHost
        draftIsolation={composerProps.isolation}
        draftPreviousWorktree={
          composerProps.previousWorktree?.selected === true
            ? composerProps.previousWorktree.available
            : null
        }
        agents={headerChrome.surfaceAgents}
        agentsPanel={AGENTS_PANEL_SURFACE}
        diffScope={diffScopes.scope}
        onDiffScopeChange={diffScopes.setScope}
        remoteDraft={surfaceThread === null && selectedServerId !== null}
        remoteSurface={scope.remoteSurface}
        remoteFileReveal={threadMenu.remoteFileLinks.reveal}
        shipActions={shipActions}
        scripts={scripts}
        chooserAutoFocus={surface.chooserRequested}
        chrome={chrome}
        hidden={surface.surfaceHost.hidden}
        layout={layout}
        layoutControls={headerChrome.layoutControls}
        leadingControls={
          layout.rail === "collapsed" && layout.rightPanelMaximized
            ? headerChrome.sidebarReveal
            : null
        }
        onResizeWidth={surface.resizeRightPanel}
        onActivateSurface={activity.activateSurface}
        onCloseSurfaceTab={activity.closeSurfaceTab}
        onOpenSurface={activity.openSurfaceCommand}
        onSwitchScope={
          chrome.addProject === null ? null : creationState.creation.addProject.addProject
        }
        onTrustScope={trustProject}
        projects={displayProjects}
        scope={scope.surfaceScope}
        thread={surfaceThread}
        threadRootPath={surfaceThreadRootPath}
        workspaceRoot={workspaceRoot}
      />
    </AgentRegionBoundary>
  );
}

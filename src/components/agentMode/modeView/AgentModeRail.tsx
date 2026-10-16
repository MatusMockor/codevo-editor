import type { ComponentProps } from "react";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import type { AgentCliKind } from "../../../domain/agentTask";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import { AgentRailResizeHandle } from "../AgentRailResizeHandle";
import { AgentRegionBoundary } from "../AgentRegionBoundary";
import { AgentThreadsSidebar } from "../AgentThreadsSidebar";
import { AgentThreadBranchMemoryContext } from "../agentThreadBranchMemoryContext";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import type { AgentModeAgents } from "./agentModeViewProps";
import type { AgentModeActivity } from "./useAgentModeActivity";
import type { AgentModeComposer } from "./useAgentModeComposer";
import type { AgentModeCreation } from "./useAgentModeCreation";
import type { AgentModeHeaderChrome } from "./useAgentModeHeaderChrome";
import type { AgentModeProjects } from "./useAgentModeProjects";
import type { AgentModeRailProjects } from "./useAgentModeRailProjects";
import type { AgentModeSurface } from "./useAgentModeSurface";
import type { AgentModeThreadMenu } from "./useAgentModeThreadMenu";

export interface AgentModeRailProps {
  readonly agents: AgentModeAgents;
  readonly chrome: AgentWorkbenchChrome;
  readonly navigation: AgentThreadNavigation;
  readonly projectsState: AgentModeProjects;
  readonly surfaceState: AgentModeSurface;
  readonly railProjects: AgentModeRailProjects;
  readonly threadMenu: AgentModeThreadMenu;
  readonly creationState: AgentModeCreation;
  readonly activity: AgentModeActivity;
  readonly headerChrome: AgentModeHeaderChrome;
  readonly startingThreads: AgentModeComposer["startingThreads"];
  readonly pendingInteractions: ComponentProps<typeof AgentThreadsSidebar>["pendingInteractions"];
  readonly selectedThread: AgentThreadView | null;
  readonly selectedThreadId: string | null;
  readonly selectedServerId: string | null;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly textClipboard: TextClipboardGateway | null;
  onOpenSourceControl(): void;
  onOpenUsageSettings?(): void;
}

export function AgentModeRail({
  agents,
  chrome,
  navigation,
  projectsState,
  surfaceState,
  railProjects,
  threadMenu,
  creationState,
  activity,
  headerChrome,
  startingThreads,
  pendingInteractions,
  selectedThread,
  selectedThreadId,
  selectedServerId,
  providerEnabled,
  overflowRootPaths,
  textClipboard,
  onOpenSourceControl,
  onOpenUsageSettings,
}: AgentModeRailProps) {
  const { surface } = surfaceState;
  const { layout } = surface;
  const { creation } = creationState;
  return (
    <>
      {layout.rail === "collapsed" ? null : (
        <AgentRegionBoundary
          clipboard={textClipboard}
          region="sidebar"
          resetKeys={[
            selectedThreadId,
            selectedServerId,
            navigation.railScope?.projectRootKey ?? null,
          ]}
        >
          <AgentThreadBranchMemoryContext.Provider value={projectsState.threadBranchMemory.memory}>
            <AgentThreadsSidebar
              catalog={projectsState.projectRename.catalog}
              collapseShortcut={chrome.shortcuts?.sidebar ?? null}
              footerActivity={activity.footerActivity}
              addProjectAvailable={chrome.addProject !== null}
              evidenceOf={projectsState.turnEvidenceOf}
              groups={projectsState.groups}
              onAddProject={creationState.openAddProject}
              onCancelPendingClone={creationState.cancelPendingClone}
              onDismissPendingClone={creationState.dismissPendingClone}
              pendingClones={creation.pendingClones}
              onOpenPendingClone={creationState.openPendingClone}
              onCollapseSidebar={surface.toggleRail}
              onNewThread={railProjects.requestNewThread}
              newThreadTitle={headerChrome.newThreadTitle}
              onNewThreadInProject={railProjects.newThreadInProject}
              onFocusProject={railProjects.focusRailProject}
              onShowAllProjects={railProjects.showAllRailProjects}
              onSwitchProject={railProjects.switchRailProject}
              projectDisclosure={projectsState.projectDisclosure}
              projectFocus={projectsState.projectFocus.focus}
              workingRail={projectsState.workingRail.rail}
              onOpenProviderSettings={agents.configureAgentCli}
              onOpenSourceControl={onOpenSourceControl}
              onOpenUsage={onOpenUsageSettings}
              onProjectCommand={threadMenu.projectMenuCommand}
              onSelectThread={navigation.selectThread}
              onThreadBulkCommand={threadMenu.threadBulkCommand}
              onThreadMenuCommand={threadMenu.threadMenuCommand}
              onTogglePin={threadMenu.togglePin}
              overflowRootPaths={overflowRootPaths}
              pendingInteractions={pendingInteractions}
              providerEnabled={providerEnabled}
              providerManagement={agents.providerManagement}
              scope={navigation.railScope}
              scopeEntries={navigation.scopeEntries}
              search={navigation.search}
              selectedThreadId={selectedThread?.thread.threadId ?? null}
              startingThreads={startingThreads}
              turnLog={agents.turnLog ?? null}
            />
          </AgentThreadBranchMemoryContext.Provider>
        </AgentRegionBoundary>
      )}
      {layout.rail === "expanded" && (
        <AgentRailResizeHandle
          onReset={surface.resetRailWidth}
          onResize={surface.resizeRail}
          width={layout.railWidth}
        />
      )}
    </>
  );
}

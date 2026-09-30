import type { AgentSurfaceHistoryProps } from "./AgentSurfaceHistory";
import { Suspense, lazy, useRef, type PointerEvent, type ReactNode } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
  MIN_AGENT_RIGHT_PANEL_WIDTH,
  type AgentSurfaceKind,
  type AgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import {
  isAgentRemoteSurfaceKind,
  type AgentRemoteSurfaceKind,
} from "../../domain/agentSurfaceActivation";
import { TopBar } from "../../ui/shell/TopBar";
import {
  AGENT_RIGHT_PANEL_ADD_MENU_ORDER,
  AGENT_RIGHT_PANEL_SURFACE_CATALOG,
} from "./rightPanel/agentRightPanelSurfaceCatalog";
import {
  agentRightPanelTabEntries,
  type AgentRightPanelEditorDocuments,
  type AgentTerminalSessionCommand,
} from "./rightPanel/agentRightPanelTabEntries";
import { useAgentTerminalStrip } from "./rightPanel/useAgentTerminalStrip";
import { AgentRightPanelTabStrip } from "./rightPanel/AgentRightPanelTabStrip";
import {
  AgentRightPanelSurfaceBody,
  type AgentSurfaceTerminalPanelProps,
} from "./rightPanel/AgentRightPanelSurfaceBody";
import { useAgentPanelKeyboardResize } from "./agentSurfaceResize";
import type { AgentSurfaceDiffProps } from "./AgentSurfaceDiff";
import { AgentSurfaceEmptyState } from "./AgentSurfaceEmptyState";
import type { AgentSurfaceFileTreeProps } from "./AgentSurfaceFileTree";
import { isRemoteAgentSurfaceThread, type AgentSurfaceScope } from "./agentSurfacePolicy";
import {
  agentSurfaceEditorSlot,
  agentSurfaceServes,
  effectiveAgentSurface,
  servedAgentSurfaces,
  withoutEmptyEditorSurface,
  type AgentSurfaceActivation,
} from "../../domain/agentSurfaceActivation";
import { remoteSurfaceCapabilities, type AgentRemoteSurface } from "./agentRemoteSurface";
import { HIDDEN_AGENT_SURFACE_LOCATION, type AgentSurfaceLocation } from "./agentSurfaceLocation";
import { AgentSurfaceLocationLine } from "./AgentSurfaceLocationLine";

const RemoteFilesPanel = lazy(() =>
  import("../remoteRunner/RemoteFilesPanel").then((module) => ({
    default: module.RemoteFilesPanel,
  })),
);
const RemoteGitHistoryPanel = lazy(() =>
  import("../remoteRunner/RemoteGitHistoryPanel").then((module) => ({
    default: module.RemoteGitHistoryPanel,
  })),
);
const RemoteTerminalPanel = lazy(() =>
  import("../remoteRunner/RemoteTerminalPanel").then((module) => ({
    default: module.RemoteTerminalPanel,
  })),
);

export type { AgentSurfaceTerminalPanelProps } from "./rightPanel/AgentRightPanelSurfaceBody";

export type AgentSurfaceDiffPanelProps = Omit<AgentSurfaceDiffProps, "thread">;

export type AgentSurfacePanelLayout = Pick<AgentWorkbenchLayout, "openSurfaces" | "activeSurface"> &
  Partial<
    Pick<AgentWorkbenchLayout, "rightPanelWidth" | "rightPanelMaximized" | "rail" | "railWidth">
  >;

export interface AgentSurfacePanelProps {
  readonly unavailable?: ReactNode;
  readonly remote?: boolean;
  readonly remoteSurface?: AgentRemoteSurface | null;
  readonly remoteTerminalTheme?: AgentSurfaceTerminalPanelProps["terminalTheme"];
  readonly layout: AgentSurfacePanelLayout;
  readonly thread: AgentThreadView | null;
  readonly scope: AgentSurfaceScope;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly layoutControls: ReactNode;
  readonly leadingControls?: ReactNode;
  readonly hidden: boolean;
  readonly chooserAutoFocus: boolean;
  readonly fileTree: AgentSurfaceFileTreeProps | null;
  readonly remoteMonacoTheme?: AgentSurfaceDiffPanelProps["monacoTheme"];
  readonly terminal: AgentSurfaceTerminalPanelProps | null;
  readonly history?: AgentSurfaceHistoryProps | null;
  readonly agentsPanel?: ReactNode;
  readonly editorDocuments?: AgentRightPanelEditorDocuments | null;
  readonly location?: AgentSurfaceLocation;
  onOpenSurface(surface: AgentSurfaceKind): void;
  onActivateSurface(surface: AgentSurfaceKind): void;
  onCloseSurfaceTab(surface: AgentSurfaceKind): void;
  onTrustWorkspace?(): void;
  onResizeStart?(event: PointerEvent<HTMLDivElement>): void;
  readonly onResizeWidth?: (width: number) => void;
}

export function AgentSurfacePanel({
  agentsPanel = null,
  editorDocuments = null,
  unavailable = null,
  remote = false,
  remoteSurface = null,
  remoteTerminalTheme,
  chooserAutoFocus,
  remoteMonacoTheme,
  fileTree,
  hidden,
  history = null,
  layout,
  location = HIDDEN_AGENT_SURFACE_LOCATION,
  layoutControls,
  leadingControls = null,
  onActivateSurface,
  onCloseSurfaceTab,
  onOpenSurface,
  onResizeStart,
  onResizeWidth,
  onTrustWorkspace,
  scope,
  terminal,
  thread,
  workspaceRoot,
  workspaceTrusted,
}: AgentSurfacePanelProps) {
  const maximized = layout.rightPanelMaximized === true;
  const panelRef = useRef<HTMLElement>(null);
  const resize = useAgentPanelKeyboardResize({
    disabled: maximized,
    onCommit: onResizeWidth,
    panelRef,
    rail: layout.rail,
    railWidth: layout.railWidth,
    savedWidth: layout.rightPanelWidth ?? DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
  });
  const terminalStrip = useAgentTerminalStrip();
  const onTerminalSessionCommand = (command: AgentTerminalSessionCommand): void =>
    terminalStrip.command(command, () => onCloseSurfaceTab("terminal"));
  const server = remote || isRemoteAgentSurfaceThread(thread);
  const activation: AgentSurfaceActivation = {
    remote: server,
    threadPresent: thread !== null,
    remoteCapabilities: remoteSurfaceCapabilities(remoteSurface),
    unavailable: unavailable !== null,
    hidden,
  };
  const selection = withoutEmptyEditorSurface(
    layout.openSurfaces,
    layout.activeSurface,
    editorDocuments !== null && editorDocuments.documents.length > 0,
  );
  const openSurfaces = servedAgentSurfaces(activation, selection.openSurfaces);
  const activeSurface = effectiveAgentSurface(activation, selection.activeSurface);
  const editorSlot = agentSurfaceEditorSlot(activation, selection.activeSurface);
  const treeShown =
    !server && !hidden && unavailable === null && activeSurface === "files" && fileTree !== null;
  const chooserShown = activeSurface === null;
  const terminalLayoutRevision = agentSurfaceLayoutRevision(openSurfaces, hidden);

  return (
    <aside
      aria-label="Thread surface"
      className="agent-surface"
      data-editor-slot={editorSlot}
      data-surface={activeSurface ?? "empty"}
      ref={panelRef}
    >
      <div
        aria-disabled={maximized || undefined}
        aria-label="Resize right panel"
        aria-orientation="vertical"
        aria-valuemax={resize.valueMax}
        aria-valuemin={MIN_AGENT_RIGHT_PANEL_WIDTH}
        aria-valuenow={resize.valueNow}
        className="agent-surface__resize"
        onBlur={resize.onBlur}
        onFocus={resize.onFocus}
        onKeyDown={resize.onKeyDown}
        onKeyUp={resize.onKeyUp}
        onPointerDown={onResizeStart}
        role="separator"
        tabIndex={maximized ? -1 : 0}
      />
      <TopBar
        className="agent-surface__head"
        data-agent-surface-head=""
        label="Right panel"
        leading={leadingControls}
        region="panel"
        trailing={layoutControls}
        windowEdge={maximized}
      >
        <AgentRightPanelTabStrip
          addableSurfaces={AGENT_RIGHT_PANEL_ADD_MENU_ORDER.filter((kind) =>
            agentSurfaceServes(activation, kind),
          )}
          editorDocuments={editorDocuments}
          entries={agentRightPanelTabEntries({
            openSurfaces,
            activeSurface,
            terminal: terminalStrip.state,
            editorDocuments,
          })}
          onActivateSurface={onActivateSurface}
          onAddSurface={(kind) =>
            kind === "terminal" && openSurfaces.includes("terminal")
              ? onTerminalSessionCommand({ kind: "create" })
              : onOpenSurface(kind)
          }
          onCloseSurface={onCloseSurfaceTab}
          onTerminalSessionCommand={onTerminalSessionCommand}
          tabPanelsRendered={unavailable === null}
        />
      </TopBar>
      <AgentSurfaceLocationLine location={location} />
      <div className="agent-surface__body" data-agent-surface-body>
        {unavailable}
        {unavailable === null && chooserShown && (
          <AgentSurfaceEmptyState
            autoFocus={chooserAutoFocus && !hidden}
            remote={server}
            remoteSurface={remoteSurface}
            onChooseSurface={onOpenSurface}
            onTrustWorkspace={onTrustWorkspace}
            scope={scope}
            thread={thread}
            workspaceRoot={workspaceRoot}
            workspaceTrusted={workspaceTrusted}
          />
        )}
        {unavailable === null &&
          openSurfaces.map((kind) => (
            <div
              aria-label={AGENT_RIGHT_PANEL_SURFACE_CATALOG[kind].label}
              className="agent-surface__tabpanel"
              data-surface-panel={kind}
              hidden={activeSurface !== kind}
              id={`agent-surface-panel-${kind}`}
              key={kind}
              role="tabpanel"
            >
              {server && isAgentRemoteSurfaceKind(kind) && remoteSurface?.gateway ? (
                <Suspense fallback={<p className="agent-note">Opening server panel…</p>}>
                  <RemoteSurfaceBody
                    key={JSON.stringify(remoteSurface.scope)}
                    kind={kind}
                    surface={remoteSurface}
                    active={!hidden && activeSurface === kind}
                    terminalTheme={remoteTerminalTheme}
                    monacoTheme={remoteMonacoTheme}
                  />
                </Suspense>
              ) : (
                <AgentRightPanelSurfaceBody
                  active={!hidden && activeSurface === kind}
                  agentsPanel={agentsPanel}
                  fileTree={fileTree}
                  history={history}
                  kind={kind}
                  scope={scope}
                  terminal={
                    terminal === null
                      ? null
                      : { ...terminal, externalStrip: terminalStrip.externalStrip }
                  }
                  terminalLayoutRevision={terminalLayoutRevision}
                  thread={thread}
                  treeShown={treeShown}
                  workspaceRoot={workspaceRoot}
                  workspaceTrusted={workspaceTrusted}
                />
              )}
            </div>
          ))}
      </div>
    </aside>
  );
}

function agentSurfaceLayoutRevision(
  openSurfaces: ReadonlyArray<AgentSurfaceKind>,
  hidden: boolean,
): number {
  const openMask = openSurfaces.reduce((mask, surface) => mask | agentSurfaceMask(surface), 0);
  return hidden ? openMask | 256 : openMask;
}

function agentSurfaceMask(surface: AgentSurfaceKind): number {
  switch (surface) {
    case "files":
      return 1;
    case "diff":
      return 2;
    case "terminal":
      return 4;
    case "history":
      return 8;
    case "git":
      return 16;
    case "scripts":
      return 32;
    case "pullRequest":
      return 64;
    case "agents":
      return 128;
    case "editor":
      return 512;
  }
}

function RemoteSurfaceBody({
  kind,
  surface,
  active,
  terminalTheme,
  monacoTheme,
}: {
  readonly kind: AgentRemoteSurfaceKind;
  readonly surface: AgentRemoteSurface;
  readonly active: boolean;
  readonly terminalTheme: AgentSurfaceTerminalPanelProps["terminalTheme"] | undefined;
  readonly monacoTheme: AgentSurfaceDiffPanelProps["monacoTheme"] | undefined;
}) {
  if (surface.gateway === null) return null;
  if (kind === "files")
    return (
      <RemoteFilesPanel scope={surface.scope} gateway={surface.gateway} monacoTheme={monacoTheme} />
    );
  if (kind === "history")
    return active ? (
      <RemoteGitHistoryPanel
        scope={surface.scope}
        gateway={surface.gateway}
        monacoTheme={monacoTheme}
      />
    ) : null;
  return (
    <RemoteTerminalPanel
      scope={surface.scope}
      gateway={surface.gateway}
      terminalTheme={terminalTheme}
      isActive={active}
    />
  );
}

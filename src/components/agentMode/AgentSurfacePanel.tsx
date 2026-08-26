import { FolderTree, GitCompare, PanelLeft, SquareTerminal, X } from "lucide-react";
import {
  Suspense,
  lazy,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentSurfaceKind, AgentWorkbenchLayout } from "../../domain/agentWorkbenchLayout";
import type { AgentSurfaceDiffProps } from "./AgentSurfaceDiff";
import { AgentSurfaceEmptyState } from "./AgentSurfaceEmptyState";
import { AgentSurfaceFileTree, type AgentSurfaceFileTreeProps } from "./AgentSurfaceFileTree";
import type { AgentSurfaceTerminalProps } from "./AgentSurfaceTerminal";
import { SURFACE_NO_THREAD_REASON, agentSurfaceBlockedReason } from "./agentSurfacePolicy";
import { useWorkbenchFrameTreeReport } from "../workbenchFrameTreeReport";

export const AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE = "data-agent-editor-slot";
export const AGENT_SURFACE_CLOSE_PANEL_LABEL = "Close panel";

const LazyAgentSurfaceDiff = lazy(() =>
  import("./AgentSurfaceDiff").then((module) => ({ default: module.AgentSurfaceDiff })),
);
const LazyAgentSurfaceTerminal = lazy(() =>
  import("./AgentSurfaceTerminal").then((module) => ({ default: module.AgentSurfaceTerminal })),
);

export type AgentSurfaceDiffPanelProps = Omit<AgentSurfaceDiffProps, "thread">;
export type AgentSurfaceTerminalPanelProps = Omit<AgentSurfaceTerminalProps, "thread">;

export interface AgentSurfacePanelProps {
  readonly layout: Pick<AgentWorkbenchLayout, "openSurfaces" | "activeSurface">;
  readonly thread: AgentThreadView | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly layoutControls: ReactNode;
  readonly hidden: boolean;
  readonly chooserAutoFocus: boolean;
  readonly fileTree: AgentSurfaceFileTreeProps | null;
  readonly diff: AgentSurfaceDiffPanelProps | null;
  readonly terminal: AgentSurfaceTerminalPanelProps | null;
  onOpenSurface(surface: AgentSurfaceKind): void;
  onActivateSurface(surface: AgentSurfaceKind): void;
  onCloseSurfaceTab(surface: AgentSurfaceKind): void;
  onClosePanel(): void;
  onTrustWorkspace?(): void;
  onResizeStart?(event: PointerEvent<HTMLDivElement>): void;
}

interface SurfaceTab {
  readonly kind: AgentSurfaceKind;
  readonly label: string;
  readonly icon: typeof FolderTree;
}

const TABS: ReadonlyArray<SurfaceTab> = [
  { kind: "files", label: "Files", icon: FolderTree },
  { kind: "diff", label: "Diff", icon: GitCompare },
  { kind: "terminal", label: "Terminal", icon: SquareTerminal },
];

function nextAgentSurfaceTabIndex(key: string, count: number, current: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export function AgentSurfacePanel({
  chooserAutoFocus,
  diff,
  fileTree,
  hidden,
  layout,
  layoutControls,
  onActivateSurface,
  onClosePanel,
  onCloseSurfaceTab,
  onOpenSurface,
  onResizeStart,
  onTrustWorkspace,
  terminal,
  thread,
  workspaceRoot,
  workspaceTrusted,
}: AgentSurfacePanelProps) {
  const { activeSurface, openSurfaces } = layout;
  const [treeVisible, setTreeVisible] = useState(true);
  const treeShown = !hidden && activeSurface === "files" && treeVisible && fileTree !== null;
  useWorkbenchFrameTreeReport(treeShown);
  const tabRefs = useRef(new Map<AgentSurfaceKind, HTMLButtonElement | null>());
  const chooserShown = activeSurface === null;

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const next = nextAgentSurfaceTabIndex(event.key, openSurfaces.length, index);
    if (next === null) return;
    const surface = openSurfaces[next];
    if (surface === undefined) return;
    event.preventDefault();
    onActivateSurface(surface);
    tabRefs.current.get(surface)?.focus();
  };

  return (
    <aside
      aria-label="Thread surface"
      className="agent-surface"
      data-surface={activeSurface ?? "empty"}
      data-tree={treeShown ? "visible" : "hidden"}
    >
      <div
        aria-label="Resize right panel"
        aria-orientation="vertical"
        className="agent-surface__resize"
        onPointerDown={onResizeStart}
        role="separator"
      />
      <header className="agent-surface__head" data-agent-surface-head>
        {openSurfaces.length > 0 && (
          <div aria-label="Surfaces" className="agent-surface__tabs" role="tablist">
            {openSurfaces.map((kind, index) => {
              const tab = TABS.find((candidate) => candidate.kind === kind) ?? TABS[0];
              const Icon = tab.icon;
              const active = activeSurface === kind;
              return (
                <span
                  className={
                    active
                      ? "agent-surface__tabitem agent-surface__tabitem--active"
                      : "agent-surface__tabitem"
                  }
                  key={kind}
                  role="presentation"
                >
                  <button
                    aria-controls={`agent-surface-panel-${kind}`}
                    aria-selected={active}
                    className="agent-surface__tab"
                    id={`agent-surface-tab-${kind}`}
                    onClick={() => onActivateSurface(kind)}
                    onKeyDown={(event) => onTabKeyDown(event, index)}
                    ref={(node) => {
                      tabRefs.current.set(kind, node);
                    }}
                    role="tab"
                    tabIndex={active ? 0 : -1}
                    type="button"
                  >
                    <Icon aria-hidden="true" size={12} />
                    <span>{tab.label}</span>
                  </button>
                  <button
                    aria-controls={`agent-surface-panel-${kind}`}
                    aria-label={`Close ${tab.label} tab`}
                    className="agent-surface__tab-close"
                    onClick={() => onCloseSurfaceTab(kind)}
                    title={`Close ${tab.label}`}
                    type="button"
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <span className="agent-session__spacer" />
        {activeSurface === "files" && fileTree !== null && (
          <button
            aria-label="Toggle file tree"
            aria-pressed={treeVisible}
            className="agent-iconbutton"
            onClick={() => setTreeVisible((current) => !current)}
            type="button"
          >
            <PanelLeft aria-hidden="true" size={13} />
          </button>
        )}
        <div className="agent-surface__layout-controls">{layoutControls}</div>
        <button
          aria-label={AGENT_SURFACE_CLOSE_PANEL_LABEL}
          className="agent-iconbutton"
          onClick={onClosePanel}
          title={AGENT_SURFACE_CLOSE_PANEL_LABEL}
          type="button"
        >
          <X aria-hidden="true" size={14} />
        </button>
      </header>
      <div className="agent-surface__body" data-agent-surface-body>
        {chooserShown && (
          <AgentSurfaceEmptyState
            autoFocus={chooserAutoFocus && !hidden}
            onChooseSurface={onOpenSurface}
            onTrustWorkspace={onTrustWorkspace}
            thread={thread}
            workspaceRoot={workspaceRoot}
            workspaceTrusted={workspaceTrusted}
          />
        )}
        {openSurfaces.map((kind) => (
          <div
            aria-labelledby={`agent-surface-tab-${kind}`}
            className="agent-surface__tabpanel"
            data-surface-panel={kind}
            hidden={activeSurface !== kind}
            id={`agent-surface-panel-${kind}`}
            key={kind}
            role="tabpanel"
          >
            <SurfaceBody
              diff={diff}
              fileTree={fileTree}
              kind={kind}
              terminal={terminal}
              thread={thread}
              treeShown={treeShown}
              workspaceRoot={workspaceRoot}
              workspaceTrusted={workspaceTrusted}
            />
          </div>
        ))}
      </div>
    </aside>
  );
}

interface SurfaceBodyProps {
  readonly kind: AgentSurfaceKind;
  readonly thread: AgentThreadView | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly treeShown: boolean;
  readonly fileTree: AgentSurfaceFileTreeProps | null;
  readonly diff: AgentSurfaceDiffPanelProps | null;
  readonly terminal: AgentSurfaceTerminalPanelProps | null;
}

function SurfaceBody({
  diff,
  fileTree,
  kind,
  terminal,
  thread,
  treeShown,
  workspaceRoot,
  workspaceTrusted,
}: SurfaceBodyProps) {
  if (kind === "files") {
    return (
      <div className="agent-surface__files">
        {treeShown && fileTree !== null && <AgentSurfaceFileTree {...fileTree} />}
        <div
          className="agent-surface__editor-slot"
          {...{ [AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE]: "" }}
        />
      </div>
    );
  }

  const reason = agentSurfaceBlockedReason(kind, thread, workspaceTrusted, workspaceRoot);
  if (reason !== null || thread === null) {
    return <p className="agent-note agent-note--warning">{reason ?? SURFACE_NO_THREAD_REASON}</p>;
  }

  if (kind === "diff") {
    if (diff === null) return null;
    return (
      <Suspense fallback={<p className="agent-note">Loading the diff surface…</p>}>
        <LazyAgentSurfaceDiff {...diff} thread={thread} />
      </Suspense>
    );
  }

  if (terminal === null) return null;
  return (
    <Suspense fallback={<p className="agent-note">Loading the terminal…</p>}>
      <LazyAgentSurfaceTerminal {...terminal} thread={thread} />
    </Suspense>
  );
}

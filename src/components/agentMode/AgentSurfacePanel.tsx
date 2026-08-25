import { FolderTree, GitCompare, Maximize2, PanelLeft, SquareTerminal, X } from "lucide-react";
import { Suspense, lazy, useState, type PointerEvent, type ReactNode } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  AGENT_SURFACE_KINDS,
  type AgentSurfaceKind,
  type AgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import type { AgentSurfaceDiffProps } from "./AgentSurfaceDiff";
import { AgentSurfaceEmptyState } from "./AgentSurfaceEmptyState";
import { AgentSurfaceFileTree, type AgentSurfaceFileTreeProps } from "./AgentSurfaceFileTree";
import type { AgentSurfaceTerminalProps } from "./AgentSurfaceTerminal";
import { agentSurfaceBlockedReason } from "./agentSurfacePolicy";
import { useWorkbenchFrameTreeReport } from "../workbenchFrameTreeReport";

export const AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE = "data-agent-editor-slot";

const LazyAgentSurfaceDiff = lazy(() =>
  import("./AgentSurfaceDiff").then((module) => ({ default: module.AgentSurfaceDiff })),
);
const LazyAgentSurfaceTerminal = lazy(() =>
  import("./AgentSurfaceTerminal").then((module) => ({ default: module.AgentSurfaceTerminal })),
);

export type AgentSurfaceDiffPanelProps = Omit<AgentSurfaceDiffProps, "thread">;
export type AgentSurfaceTerminalPanelProps = Omit<AgentSurfaceTerminalProps, "thread">;

export interface AgentSurfacePanelProps {
  readonly layout: Pick<AgentWorkbenchLayout, "rightSurface">;
  readonly thread: AgentThreadView | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly layoutControls: ReactNode;
  readonly fileTree: AgentSurfaceFileTreeProps | null;
  readonly diff: AgentSurfaceDiffPanelProps | null;
  readonly terminal: AgentSurfaceTerminalPanelProps | null;
  onChooseSurface(surface: AgentSurfaceKind): void;
  onCloseSurface(): void;
  onExpandEditor(): void;
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

export function AgentSurfacePanel({
  diff,
  fileTree,
  layout,
  layoutControls,
  onChooseSurface,
  onCloseSurface,
  onExpandEditor,
  onResizeStart,
  onTrustWorkspace,
  terminal,
  thread,
  workspaceRoot,
  workspaceTrusted,
}: AgentSurfacePanelProps) {
  const surface = layout.rightSurface;
  const [treeVisible, setTreeVisible] = useState(true);
  const treeShown = surface === "files" && treeVisible && fileTree !== null;
  useWorkbenchFrameTreeReport(treeShown);

  return (
    <aside
      aria-label="Thread surface"
      className="agent-surface"
      data-surface={surface ?? "empty"}
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
        <div aria-label="Surfaces" className="agent-surface__tabs" role="tablist">
          {AGENT_SURFACE_KINDS.map((kind) => {
            const tab = TABS.find((candidate) => candidate.kind === kind) ?? TABS[0];
            const reason = agentSurfaceBlockedReason(kind, thread, workspaceTrusted, workspaceRoot);
            const Icon = tab.icon;
            const active = surface === kind;
            return (
              <button
                aria-selected={active}
                className={
                  active ? "agent-surface__tab agent-surface__tab--active" : "agent-surface__tab"
                }
                disabled={reason !== null}
                key={kind}
                onClick={() => onChooseSurface(kind)}
                role="tab"
                title={reason ?? undefined}
                type="button"
              >
                <Icon aria-hidden="true" size={12} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <span className="agent-session__spacer" />
        {surface === "files" && (
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
        <button
          aria-label="Expand to editor (⌥⌘E)"
          className="agent-iconbutton"
          disabled={surface === null}
          onClick={onExpandEditor}
          title="Expand to editor (⌥⌘E)"
          type="button"
        >
          <Maximize2 aria-hidden="true" size={13} />
        </button>
        <div className="agent-surface__layout-controls">{layoutControls}</div>
        <button
          aria-label="Close surface"
          className="agent-iconbutton"
          onClick={onCloseSurface}
          type="button"
        >
          <X aria-hidden="true" size={13} />
        </button>
      </header>
      <div className="agent-surface__body" data-agent-surface-body>
        {surface === null && (
          <AgentSurfaceEmptyState
            onChooseSurface={onChooseSurface}
            onTrustWorkspace={onTrustWorkspace}
            thread={thread}
            workspaceRoot={workspaceRoot}
            workspaceTrusted={workspaceTrusted}
          />
        )}
        {surface === "files" && (
          <div className="agent-surface__files">
            {treeShown && fileTree !== null && <AgentSurfaceFileTree {...fileTree} />}
            <div
              className="agent-surface__editor-slot"
              {...{ [AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE]: "" }}
            />
          </div>
        )}
        {surface === "diff" && thread !== null && diff !== null && (
          <Suspense fallback={<p className="agent-note">Loading the diff surface…</p>}>
            <LazyAgentSurfaceDiff {...diff} thread={thread} />
          </Suspense>
        )}
        {surface === "terminal" && thread !== null && terminal !== null && (
          <Suspense fallback={<p className="agent-note">Loading the terminal…</p>}>
            <LazyAgentSurfaceTerminal {...terminal} thread={thread} />
          </Suspense>
        )}
        {surface !== null && surface !== "files" && thread === null && (
          <AgentSurfaceEmptyState
            onChooseSurface={onChooseSurface}
            onTrustWorkspace={onTrustWorkspace}
            thread={null}
            workspaceRoot={workspaceRoot}
            workspaceTrusted={workspaceTrusted}
          />
        )}
      </div>
    </aside>
  );
}

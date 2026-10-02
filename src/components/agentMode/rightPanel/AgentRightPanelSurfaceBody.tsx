import { Suspense, lazy, memo, type ReactNode } from "react";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";
import type { AgentSurfaceHistoryProps } from "../AgentSurfaceHistory";
import type { AgentSurfaceFileTreeProps } from "../AgentSurfaceFileTree";
import type { AgentSurfaceTerminalProps } from "../AgentSurfaceTerminal";
import { EditorSurfaceSlot } from "../../editorPanel/EditorSurfaceSlot";
import {
  agentSurfaceBlockedReason,
  isRemoteGitShipThread,
  type AgentSurfaceScope,
} from "../agentSurfacePolicy";
import { AgentDiffSurfaceContainer } from "./diff/AgentDiffSurfaceContainer";
import { AgentFilesSurface } from "./files/AgentFilesSurface";
import { AgentGitSurfaceContainer } from "./git/AgentGitSurfaceContainer";
import { AgentRemoteGitSurface } from "./git/AgentRemoteGitSurface";
import { AgentPullRequestSurfaceContainer } from "./pullRequest/AgentPullRequestSurfaceContainer";
import { AgentScriptsSurfaceContainer } from "./scripts/AgentScriptsSurfaceContainer";

const FilesSurface = memo(AgentFilesSurface);
const DiffSurface = memo(AgentDiffSurfaceContainer);
const GitSurface = memo(AgentGitSurfaceContainer);
const RemoteGitSurface = memo(AgentRemoteGitSurface);
const ScriptsSurface = memo(AgentScriptsSurfaceContainer);
const PullRequestSurface = memo(AgentPullRequestSurfaceContainer);

const LazyAgentSurfaceHistory = lazy(() =>
  import("../AgentSurfaceHistory").then((module) => ({ default: module.AgentSurfaceHistory })),
);
const LazyAgentSurfaceTerminal = lazy(() =>
  import("../AgentSurfaceTerminal").then((module) => ({ default: module.AgentSurfaceTerminal })),
);

export type AgentSurfaceTerminalPanelProps = Omit<
  AgentSurfaceTerminalProps,
  "isActive" | "layoutRevision" | "thread"
>;

export interface AgentRightPanelSurfaceBodyProps {
  readonly kind: AgentSurfaceKind;
  readonly scope: AgentSurfaceScope;
  readonly thread: AgentThreadView | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly active: boolean;
  readonly treeShown: boolean;
  readonly fileTree: AgentSurfaceFileTreeProps | null;
  readonly history: AgentSurfaceHistoryProps | null;
  readonly terminal: AgentSurfaceTerminalPanelProps | null;
  readonly terminalLayoutRevision: number;
  readonly agentsPanel: ReactNode;
}

export function AgentRightPanelSurfaceBody(props: AgentRightPanelSurfaceBodyProps) {
  switch (props.kind) {
    case "files":
      return <FilesSurface fileTree={props.fileTree} treeShown={props.treeShown} />;
    case "history":
      if (!props.active) return null;
      if (props.history === null) return <p className="cv-rp-note">Git history is unavailable.</p>;
      return (
        <Suspense fallback={<p className="cv-rp-note">Loading Git history…</p>}>
          <LazyAgentSurfaceHistory {...props.history} />
        </Suspense>
      );
    case "agents":
      return props.agentsPanel ?? <p className="cv-rp-note">Agents are unavailable.</p>;
    case "diff":
      return blockedOr(props, <DiffSurface />);
    case "terminal":
      return blockedOr(
        props,
        props.terminal === null ? null : (
          <Suspense fallback={<p className="cv-rp-note">Loading the terminal…</p>}>
            <LazyAgentSurfaceTerminal
              {...props.terminal}
              isActive={props.active}
              layoutRevision={props.terminalLayoutRevision}
              thread={props.thread}
            />
          </Suspense>
        ),
      );
    case "git":
      if (isRemoteGitShipThread(props.thread)) return <RemoteGitSurface />;
      return blockedOr(props, <GitSurface />);
    case "scripts":
      return blockedOr(props, <ScriptsSurface />);
    case "pullRequest":
      return blockedOr(props, <PullRequestSurface />);
    case "editor":
      return <EditorSurfaceSlot />;
  }
}

function blockedOr(props: AgentRightPanelSurfaceBodyProps, body: ReactNode): ReactNode {
  const reason = agentSurfaceBlockedReason(
    props.kind,
    props.thread,
    props.workspaceTrusted,
    props.workspaceRoot,
    props.scope,
  );
  if (reason !== null) return <p className="cv-rp-note cv-rp-note--warning">{reason}</p>;
  return body;
}

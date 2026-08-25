import { FolderTree, GitCompare, SquareTerminal } from "lucide-react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { AGENT_SURFACE_KINDS, type AgentSurfaceKind } from "../../domain/agentWorkbenchLayout";
import {
  SURFACE_FILES_THREAD_DESCRIPTION,
  SURFACE_UNTRUSTED_TERMINAL_REASON,
  agentSurfaceBlockedReason,
  agentSurfaceFilesDescription,
} from "./agentSurfacePolicy";

export interface AgentSurfaceEmptyStateProps {
  readonly thread: AgentThreadView | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  onChooseSurface(surface: AgentSurfaceKind): void;
  onTrustWorkspace?(): void;
}

interface SurfaceCard {
  readonly kind: AgentSurfaceKind;
  readonly label: string;
  readonly description: string;
  readonly icon: typeof FolderTree;
}

const CARDS: ReadonlyArray<SurfaceCard> = [
  {
    kind: "files",
    label: "Files",
    description: SURFACE_FILES_THREAD_DESCRIPTION,
    icon: FolderTree,
  },
  { kind: "diff", label: "Diff", description: "Review changes in this thread.", icon: GitCompare },
  {
    kind: "terminal",
    label: "Terminal",
    description: "Start a shell in the thread's checkout.",
    icon: SquareTerminal,
  },
];

export function AgentSurfaceEmptyState({
  onChooseSurface,
  onTrustWorkspace,
  thread,
  workspaceRoot,
  workspaceTrusted,
}: AgentSurfaceEmptyStateProps) {
  return (
    <div className="agent-surface-empty">
      <div className="agent-surface-empty__inner">
        <header className="agent-surface-empty__head">
          <h3 className="agent-surface-empty__title">Open a surface</h3>
          <p className="agent-surface-empty__hint">Choose what to show in the right panel.</p>
        </header>
        <div className="agent-surface-empty__cards">
          {AGENT_SURFACE_KINDS.map((kind) => {
            const card = CARDS.find((candidate) => candidate.kind === kind) ?? CARDS[0];
            const reason = agentSurfaceBlockedReason(kind, thread, workspaceTrusted, workspaceRoot);
            const Icon = card.icon;
            const description =
              kind === "files" ? agentSurfaceFilesDescription(thread) : card.description;
            const showTrust =
              reason === SURFACE_UNTRUSTED_TERMINAL_REASON && onTrustWorkspace !== undefined;
            return (
              <div className="agent-surface-card__slot" key={kind}>
                <button
                  aria-describedby={reason === null ? undefined : `agent-surface-card-${kind}`}
                  aria-label={`Open ${card.label} surface`}
                  className="agent-surface-card"
                  disabled={reason !== null}
                  onClick={() => onChooseSurface(kind)}
                  type="button"
                >
                  <span className="agent-surface-card__icon">
                    <Icon aria-hidden="true" size={18} />
                  </span>
                  <span className="agent-surface-card__label">{card.label}</span>
                  <span className="agent-surface-card__description">{description}</span>
                </button>
                {reason !== null && (
                  <p className="agent-surface-card__reason" id={`agent-surface-card-${kind}`}>
                    {reason}
                    {showTrust && (
                      <button
                        aria-label="Trust the workspace"
                        className="agent-linkbutton"
                        onClick={onTrustWorkspace}
                        type="button"
                      >
                        Trust
                      </button>
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, type KeyboardEvent } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { isAgentRemoteSurfaceKind } from "../../domain/agentSurfaceActivation";
import type { AgentSurfaceKind } from "../../domain/agentWorkbenchLayout";
import {
  SURFACE_REMOTE_CAPABILITIES_DESCRIPTION,
  SURFACE_REMOTE_NO_THREAD_DESCRIPTION,
  SURFACE_REMOTE_NO_PROJECT_DESCRIPTION,
  isRemoteAgentSurfaceThread,
  agentSurfaceBlockedReason,
  agentSurfaceFilesDescription,
  type AgentSurfaceScope,
} from "./agentSurfacePolicy";
import { remoteSurfaceSupports, type AgentRemoteSurface } from "./agentRemoteSurface";
import { AGENT_SURFACE_HOTKEYS, agentSurfaceForHotkey } from "./agentSurfaceHotkeys";
import {
  AGENT_RIGHT_PANEL_ADD_MENU_ORDER,
  AGENT_RIGHT_PANEL_SURFACE_CATALOG,
} from "./rightPanel/agentRightPanelSurfaceCatalog";

export interface AgentSurfaceEmptyStateProps {
  readonly thread: AgentThreadView | null;
  readonly remote?: boolean;
  readonly remoteSurface?: AgentRemoteSurface | null;
  readonly scope: AgentSurfaceScope;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly autoFocus?: boolean;
  onChooseSurface(surface: AgentSurfaceKind): void;
  onTrustWorkspace?(): void;
}

export function AgentSurfaceEmptyState({
  autoFocus = false,
  remote = false,
  remoteSurface = null,
  onChooseSurface,
  scope,
  thread,
  workspaceRoot,
  workspaceTrusted,
}: AgentSurfaceEmptyStateProps) {
  const server = remote || isRemoteAgentSurfaceThread(thread);
  const unavailableSurfaces = (["files", "terminal", "history"] as const).filter(
    (kind) => !remoteSurfaceSupports(remoteSurface, kind),
  );
  const unavailableMessage =
    thread === null && remoteSurface === null
      ? SURFACE_REMOTE_NO_PROJECT_DESCRIPTION
      : (remoteSurface?.message ??
        (unavailableSurfaces.length === 3
          ? SURFACE_REMOTE_CAPABILITIES_DESCRIPTION
          : `Server ${unavailableSurfaces.map((kind) => kind[0].toUpperCase() + kind.slice(1)).join(", ")} ${unavailableSurfaces.length === 1 ? "is" : "are"} not available.`));
  const containerRef = useRef<HTMLDivElement>(null);
  const remoteServes = (kind: AgentSurfaceKind): boolean =>
    kind === "diff"
      ? thread !== null
      : isAgentRemoteSurfaceKind(kind) && remoteSurfaceSupports(remoteSurface, kind);
  const blockedReason = (kind: AgentSurfaceKind): string | null =>
    server && kind !== "diff" && remoteServes(kind)
      ? null
      : agentSurfaceBlockedReason(kind, thread, workspaceTrusted, workspaceRoot, scope);

  useEffect(() => {
    if (!autoFocus) return;
    const container = containerRef.current;
    if (container === null || container.contains(document.activeElement)) return;
    container.focus({ preventScroll: true });
  }, [autoFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const surface = agentSurfaceForHotkey(event.key);
    if (surface === null || (server && !remoteServes(surface)) || blockedReason(surface) !== null)
      return;
    event.preventDefault();
    onChooseSurface(surface);
  };

  return (
    <div
      aria-label="Open a surface"
      className="agent-surface-empty"
      onKeyDown={onKeyDown}
      ref={containerRef}
      role="group"
      tabIndex={-1}
    >
      <div className="agent-surface-empty__inner">
        <header className="agent-surface-empty__head">
          <h3 className="agent-surface-empty__title">Open a surface</h3>
          <p className="agent-surface-empty__hint">Choose what to show in the right panel.</p>
        </header>
        <div className="agent-surface-empty__cards">
          {AGENT_RIGHT_PANEL_ADD_MENU_ORDER.filter((kind) => !server || remoteServes(kind)).map(
            (kind) => {
              const card = AGENT_RIGHT_PANEL_SURFACE_CATALOG[kind];
              const reason = blockedReason(kind);
              const Icon = card.icon;
              const shortcut = AGENT_SURFACE_HOTKEYS[kind];
              const description = server
                ? card.description
                : kind === "files"
                  ? agentSurfaceFilesDescription(thread, scope)
                  : thread === null && kind === "diff"
                    ? "Review changes in this project."
                    : thread === null && kind === "terminal"
                      ? "Start a shell in this project."
                      : card.description;
              return (
                <div className="agent-surface-card__slot" key={kind}>
                  <button
                    aria-describedby={reason === null ? undefined : `agent-surface-card-${kind}`}
                    aria-keyshortcuts={shortcut ?? undefined}
                    aria-label={`Open ${card.label} surface`}
                    className="agent-surface-card"
                    disabled={reason !== null}
                    onClick={() => onChooseSurface(kind)}
                    type="button"
                  >
                    <span className="agent-surface-card__title">
                      <span className="agent-surface-card__icon">
                        <Icon aria-hidden="true" size={16} />
                      </span>
                      <span className="agent-surface-card__label">{card.label}</span>
                    </span>
                    <span className="agent-surface-card__description">{description}</span>
                    {shortcut !== null && (
                      <kbd aria-hidden="true" className="agent-surface-card__key">
                        {shortcut}
                      </kbd>
                    )}
                  </button>
                  {reason !== null && (
                    <p className="agent-surface-card__reason" id={`agent-surface-card-${kind}`}>
                      {reason}
                    </p>
                  )}
                </div>
              );
            },
          )}
        </div>
        {server && (remoteSurface?.message || unavailableSurfaces.length > 0) && (
          <p className="agent-surface-empty__hint" role="status">
            {thread === null && remoteSurface !== null && (
              <>{SURFACE_REMOTE_NO_THREAD_DESCRIPTION} </>
            )}
            {unavailableMessage}
          </p>
        )}
      </div>
    </div>
  );
}

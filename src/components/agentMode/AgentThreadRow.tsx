import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Check, Pin } from "lucide-react";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  NO_AGENT_TURN_LOG_EVIDENCE,
  type AgentTurnLogEvidenceLookup,
} from "../../domain/agentTurnContentLoss";
import type { ListSelectionModifiers } from "../../domain/listSelection";
import {
  AgentThreadRowStatusSlot,
  RemoteThreadIndicator,
  RenameInput,
} from "./AgentThreadRowParts";
import { agentShipBranchLabel } from "./agentModePresentation";
import { agentProjectMonogram } from "./agentRailFilter";
import {
  agentRowClassName,
  agentThreadImportedBadgeLabel,
  agentThreadRowModel,
  agentViewCanMarkUnread,
  type AgentThreadMenuCommand,
} from "./agentSidebarPresentation";
import { agentRowIsLive, agentRowWorkingAgents } from "./agentThreadRowStatus";
import { useAgentRowBackgroundActivity } from "./useAgentRowBackgroundActivity";
import { useAgentThreadRowMenu } from "./useAgentThreadRowMenu";

export interface AgentThreadRowProps {
  readonly view: AgentThreadView;
  readonly projectLabel: string;
  readonly on: boolean;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly jumpLabel: string | null;
  readonly moveUpId?: string;
  readonly moveDownId?: string;
  readonly reorderable?: boolean;
  readonly evidenceOf?: AgentTurnLogEvidenceLookup;
  readonly pending: AgentPendingInteraction | null;
  onSelect(threadId: string, modifiers: ListSelectionModifiers): void;
  onMenuCommand(threadId: string, command: AgentThreadMenuCommand): void;
}

export const AgentThreadRow = memo(function AgentThreadRow(props: AgentThreadRowProps) {
  const {
    evidenceOf = NO_AGENT_TURN_LOG_EVIDENCE,
    focused,
    jumpLabel,
    on,
    onMenuCommand,
    onSelect,
    pending,
    projectLabel,
    selected,
    view,
  } = props;
  const thread = view.thread;
  const threadId = thread.threadId;
  const background = useAgentRowBackgroundActivity(view, evidenceOf);
  const workingAgents = agentRowWorkingAgents(view);
  const model = agentThreadRowModel(view, on, projectLabel, evidenceOf, background, {
    pending,
    workingAgents,
  });
  const status = model.status;
  const importedLabel = agentThreadImportedBadgeLabel(thread.externalOrigin);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const wasRenaming = useRef(false);
  useEffect(() => {
    const ended = wasRenaming.current && !renaming;
    wasRenaming.current = renaming;
    if (!ended) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    rowRef.current?.focus();
  }, [renaming]);
  const command = useCallback(
    (next: AgentThreadMenuCommand) => onMenuCommand(threadId, next),
    [onMenuCommand, threadId],
  );
  const menu = useAgentThreadRowMenu({
    title: model.title,
    returnFocusRef: rowRef,
    context: () => ({
      branch: agentShipBranchLabel(view.ship),
      pinned: thread.pinned,
      archived: thread.archived,
      running: agentRowIsLive(status),
      snoozed: (thread.snoozedUntil ?? 0) > Date.now(),
      settled: thread.settledAt != null,
      canMarkUnread: agentViewCanMarkUnread(view),
      claudeSession: thread.provider.kind === "claudeCode" && view.execution?.kind !== "remote",
      moveUpId: props.moveUpId,
      moveDownId: props.moveDownId,
    }),
    onCommand: command,
    onRename: () => setRenaming(true),
  });
  const openMenu = menu.openAtPointer;
  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (renaming) return;
    menu.openFromKeyboard(event);
  };

  const commitRename = (next: string): void => {
    setRenaming(false);
    const trimmed = next.trim();
    if (trimmed === "" || trimmed === thread.title) return;
    command({ kind: "rename", title: trimmed });
  };

  const rowClass = agentRowClassName({
    on,
    marked: selected,
    recede: model.recede,
    status,
    unread: view.unread,
  });
  const selectRow = (event: MouseEvent<HTMLDivElement>): void => {
    onSelect(threadId, {
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    });
  };
  const menuNode = menu.overlays;

  const canSettle = !agentRowIsLive(status) && thread.settledAt == null && !renaming;
  return (
    <li className="cv-sb-item" data-menu-open={menu.open ? "true" : undefined} role="none">
      <div
        aria-current={on ? "true" : undefined}
        aria-selected={selected}
        className={rowClass}
        data-thread-id={threadId}
        draggable={!renaming && props.reorderable === true}
        onClick={selectRow}
        onContextMenu={openMenu}
        onDoubleClick={() => setRenaming(true)}
        onKeyDown={onRowKeyDown}
        ref={rowRef}
        role="option"
        tabIndex={focused ? 0 : -1}
      >
        <span className="cv-card-row__l1">
          <span aria-hidden="true" className="cv-favicon">
            {agentProjectMonogram(model.project)}
          </span>
          <span className="cv-card-row__project">{model.project}</span>
          {thread.pinned && (
            <span aria-label="Pinned" className="cv-card-row__pin" role="img" title="Pinned">
              <Pin aria-hidden="true" size={12} />
            </span>
          )}
          <span className="cv-card-row__slot">
            <AgentThreadRowStatusSlot status={status} updatedAtEpochMs={thread.updatedAtEpochMs} />
          </span>
        </span>
        {renaming ? (
          <RenameInput
            initial={thread.title}
            onCancel={() => setRenaming(false)}
            onCommit={commitRename}
          />
        ) : (
          <span className="cv-card-row__title">
            {view.execution?.kind === "remote" && (
              <RemoteThreadIndicator serverId={view.execution.serverId} />
            )}
            {model.title}
          </span>
        )}
        <span className="cv-card-row__l3">
          <span className="cv-card-row__branch">{model.branch}</span>
          {model.filesLabel !== null && (
            <span className="cv-card-row__files">{model.filesLabel}</span>
          )}
          {importedLabel !== null && <ImportedBadge label={importedLabel} />}
        </span>
        {jumpLabel !== null && (
          <span aria-hidden="true" className="cv-card-row__jump">
            {jumpLabel}
          </span>
        )}
      </div>
      {canSettle && (
        <button
          aria-label="Settle thread"
          className="cv-card-row__act"
          onClick={(event) => {
            event.stopPropagation();
            command({ kind: "settle" });
          }}
          tabIndex={-1}
          title="Settle thread"
          type="button"
        >
          <Check aria-hidden="true" size={12} />
          Settle
        </button>
      )}
      {menuNode}
    </li>
  );
});

function ImportedBadge({ label }: { readonly label: string }) {
  return (
    <span className="agent-microlabel" title="Imported terminal session">
      {label}
    </span>
  );
}

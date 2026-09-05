import { memo, useCallback, useState, type MouseEvent } from "react";
import { Check, Folder, FolderGit2, Pin } from "lucide-react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { AgentCompactRelativeTime } from "./agentClock";
import { AgentProviderGlyph } from "./AgentProviderGlyph";
import { AgentThreadRowMenu } from "./AgentThreadRowMenu";
import { RenameInput, StatusSlot } from "./AgentThreadRowParts";
import { agentShipBranchLabel } from "./agentModePresentation";
import {
  agentRowClassName,
  agentThreadImportedBadgeLabel,
  agentThreadRowModel,
  type AgentThreadMenuCommand,
} from "./agentSidebarPresentation";

export interface AgentThreadRowProps {
  readonly view: AgentThreadView;
  readonly projectLabel: string;
  readonly on: boolean;
  readonly focused: boolean;
  readonly jumpLabel: string | null;
  onSelect(threadId: string): void;
  onTogglePin(threadId: string): void;
  onMenuCommand(threadId: string, command: AgentThreadMenuCommand): void;
}

interface MenuAnchor {
  readonly x: number;
  readonly y: number;
}

export const AgentThreadRow = memo(function AgentThreadRow(props: AgentThreadRowProps) {
  const { focused, jumpLabel, on, onMenuCommand, onSelect, onTogglePin, projectLabel, view } =
    props;
  const thread = view.thread;
  const threadId = thread.threadId;
  const model = agentThreadRowModel(view, on, projectLabel);
  const status = model.status;
  const importedLabel = agentThreadImportedBadgeLabel(thread.externalOrigin);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [renaming, setRenaming] = useState(false);
  const closeMenu = useCallback(() => setMenu(null), []);
  const command = useCallback(
    (next: AgentThreadMenuCommand) => onMenuCommand(threadId, next),
    [onMenuCommand, threadId],
  );

  const openMenu = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  };

  const commitRename = (next: string): void => {
    setRenaming(false);
    const trimmed = next.trim();
    if (trimmed === "" || trimmed === thread.title) return;
    command({ kind: "rename", title: trimmed });
  };

  const Icon = thread.target.isolation === "worktree" ? FolderGit2 : Folder;
  const rowClass = agentRowClassName(model.variant, on, model.recede, status, view.unread);
  const menuNode = menu !== null && (
    <AgentThreadRowMenu
      archived={thread.archived}
      branch={agentShipBranchLabel(view.ship)}
      onClose={closeMenu}
      onCommand={command}
      onRename={() => setRenaming(true)}
      pinned={thread.pinned}
      position={menu}
      running={status.kind === "working"}
      threadId={threadId}
    />
  );

  if (model.variant === "slim") {
    return (
      <li className="agent-slim-slot">
        <div
          aria-current={on ? "true" : undefined}
          className={rowClass}
          data-thread-id={threadId}
          onClick={() => onSelect(threadId)}
          onContextMenu={openMenu}
          role="button"
          tabIndex={focused ? 0 : -1}
        >
          <Icon aria-hidden="true" className="agent-row__icon" size={16} />
          {renaming ? (
            <RenameInput
              initial={thread.title}
              onCancel={() => setRenaming(false)}
              onCommit={commitRename}
            />
          ) : (
            <span className="agent-row__title">{model.title}</span>
          )}
          {importedLabel !== null && <ImportedBadge label={importedLabel} />}
          <span className="agent-row__time agent-num">
            <AgentCompactRelativeTime epochMs={thread.updatedAtEpochMs} />
          </span>
        </div>
        {menuNode}
      </li>
    );
  }

  return (
    <li className="agent-card-slot">
      <div
        aria-current={on ? "true" : undefined}
        className={rowClass}
        data-thread-id={threadId}
        onClick={() => onSelect(threadId)}
        onContextMenu={openMenu}
        role="button"
        tabIndex={focused ? 0 : -1}
      >
        <div className="agent-row__line1">
          <Icon aria-hidden="true" className="agent-row__icon" size={16} />
          <span className="agent-row__project">{model.project}</span>
          {thread.pinned && (
            <button
              aria-label="Unpin thread"
              className="agent-row__pin"
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin(threadId);
              }}
              tabIndex={-1}
              title="Unpin thread"
              type="button"
            >
              <Pin aria-hidden="true" size={12} />
            </button>
          )}
          <span className="agent-row__slot">
            <StatusSlot status={status} updatedAtEpochMs={thread.updatedAtEpochMs} />
            <span className="agent-row__actions">
              <button
                aria-label="Archive thread"
                className="agent-row__action"
                disabled={status.kind === "working"}
                onClick={(event) => {
                  event.stopPropagation();
                  command({ kind: "archive" });
                }}
                tabIndex={-1}
                title="Archive thread"
                type="button"
              >
                <Check aria-hidden="true" size={14} />
                Archive
              </button>
            </span>
          </span>
        </div>
        <div className="agent-row__line2">
          {renaming ? (
            <RenameInput
              initial={thread.title}
              onCancel={() => setRenaming(false)}
              onCommit={commitRename}
            />
          ) : (
            <span className="agent-row__title">{model.title}</span>
          )}
        </div>
        <div className="agent-row__line3">
          <span className="agent-row__branch">{model.branch}</span>
          {model.filesLabel !== null && (
            <span className="agent-row__files agent-num">{model.filesLabel}</span>
          )}
          {importedLabel !== null && <ImportedBadge label={importedLabel} />}
          <AgentProviderGlyph kind={model.provider} />
        </div>
        {jumpLabel !== null && (
          <span aria-hidden="true" className="agent-row__jump agent-num">
            {jumpLabel}
          </span>
        )}
      </div>
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

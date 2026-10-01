import { Archive, ArchiveRestore, Ellipsis, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { AgentHistoryCatalogRow as CatalogRow } from "../../application/useAgentHistoryCatalog";
import { savedConversationTitle } from "../../domain/agentSavedConversationTitle";
import { IconButton } from "../../ui/foundation/IconButton";
import { Menu } from "../../ui/foundation/Menu";
import { MenuItem, MenuSeparator } from "../../ui/foundation/MenuItem";
import { AgentCompactRelativeTime } from "./agentClock";
import { AgentThreadDeleteDialog } from "./AgentThreadDeleteDialog";
import { RenameInput } from "./AgentThreadRowParts";
import {
  agentProviderLabel,
  ARCHIVE_RUNNING_REASON,
  DELETE_RUNNING_REASON,
} from "./agentSidebarPresentation";

export const SAVED_CONVERSATION_ROW_SELECTOR = "[data-saved-conversation-row]";

export interface AgentHistoryCatalogRowActions {
  open(threadId: string): void;
  rename(threadId: string, title: string): void;
  setArchived(threadId: string, archived: boolean): void;
  remove(threadId: string): void;
}

export function AgentHistoryCatalogRow({
  actions,
  busy,
  row,
}: {
  readonly actions: AgentHistoryCatalogRowActions;
  readonly busy: boolean;
  readonly row: CatalogRow;
}) {
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const title = savedConversationTitle(row.title);
  const deleteBlocked = row.running ? DELETE_RUNNING_REASON : null;

  const askDelete = (): void => {
    if (deleteBlocked === null) setConfirmingDelete(true);
  };
  const commitRename = (next: string): void => {
    setRenaming(false);
    const trimmed = next.trim();
    if (trimmed === "" || trimmed === row.title) return;
    actions.rename(row.threadId, trimmed);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (busy) return;
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      setMenuOpen(true);
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      setRenaming(true);
      return;
    }
    if (event.key !== "Delete" && !(event.metaKey && event.key === "Backspace")) return;
    event.preventDefault();
    askDelete();
  };
  const onContextMenu = (event: MouseEvent<HTMLLIElement>): void => {
    event.preventDefault();
    if (!busy && !renaming) setMenuOpen(true);
  };

  return (
    <li
      className="agent-history-row"
      data-archived={row.archived ? "true" : undefined}
      data-menu-open={menuOpen ? "true" : undefined}
      onContextMenu={onContextMenu}
    >
      {renaming ? (
        <div className="agent-history-row__main">
          <RenameInput
            initial={row.title}
            onCancel={() => setRenaming(false)}
            onCommit={commitRename}
          />
        </div>
      ) : (
        <button
          aria-keyshortcuts="F2 Delete Shift+F10"
          className="agent-history-row__main"
          data-saved-conversation-row=""
          disabled={busy}
          onClick={() => actions.open(row.threadId)}
          onKeyDown={onKeyDown}
          ref={rowRef}
          title={row.title}
          type="button"
        >
          <span className="agent-history-row__line">
            <span className="agent-history-row__title">{title}</span>
            <span className="agent-history-row__when">
              <AgentCompactRelativeTime epochMs={row.updatedAtEpochMs} />
            </span>
          </span>
          <span className="agent-history-row__meta">
            <span>{agentProviderLabel(row.provider)}</span>
            <span aria-hidden="true">·</span>
            <span>{row.worktree ? "Worktree" : "Local checkout"}</span>
            {row.running && <span className="agent-history-row__tag">Working</span>}
            {row.archived && <span className="agent-history-row__tag">Archived</span>}
          </span>
        </button>
      )}
      {!renaming && (
        <IconButton
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="agent-history-row__more"
          disabled={busy}
          icon={<Ellipsis size={14} />}
          label={`Actions for ${title}`}
          onClick={() => setMenuOpen((open) => !open)}
          ref={moreRef}
        />
      )}
      <Menu
        anchorRef={moreRef}
        label="Saved conversation actions"
        onClose={() => setMenuOpen(false)}
        open={menuOpen}
        placement="bottom-end"
      >
        <MenuItem icon={<MessageSquare size={14} />} onSelect={() => actions.open(row.threadId)}>
          Open
        </MenuItem>
        <MenuItem icon={<Pencil size={14} />} onSelect={() => setRenaming(true)}>
          Rename thread
        </MenuItem>
        <MenuSeparator />
        {row.archived ? (
          <MenuItem
            icon={<ArchiveRestore size={14} />}
            onSelect={() => actions.setArchived(row.threadId, false)}
          >
            Unarchive thread
          </MenuItem>
        ) : (
          <MenuItem
            description={row.running ? ARCHIVE_RUNNING_REASON : undefined}
            disabled={row.running}
            icon={<Archive size={14} />}
            onSelect={() => actions.setArchived(row.threadId, true)}
          >
            Archive thread
          </MenuItem>
        )}
        <MenuItem
          description={deleteBlocked ?? undefined}
          disabled={deleteBlocked !== null}
          icon={<Trash2 size={14} />}
          onSelect={askDelete}
          tone="danger"
        >
          Delete
        </MenuItem>
      </Menu>
      <AgentThreadDeleteDialog
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false);
          actions.remove(row.threadId);
        }}
        open={confirmingDelete}
        returnFocusRef={rowRef}
        title={title}
      />
    </li>
  );
}

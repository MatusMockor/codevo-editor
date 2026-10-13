import { Ellipsis } from "lucide-react";
import { useRef, useState } from "react";
import type { AgentMcpServerActions } from "../../../domain/agentMcpServerActions";
import type { AgentMcpServerConfigScope } from "../../../domain/agentMcpServerManagement";
import type { AgentCliKind } from "../../../domain/agentTask";
import { Button } from "../../../ui/foundation/Button";
import { Dialog } from "../../../ui/foundation/Dialog";
import { IconButton } from "../../../ui/foundation/IconButton";
import { Menu } from "../../../ui/foundation/Menu";
import { MenuItem } from "../../../ui/foundation/MenuItem";
import {
  MCP_CANCEL_LABEL,
  MCP_REMOVE_LABEL,
  MCP_REMOVE_MENU_LABEL,
  MCP_SIGN_IN_AGAIN_LABEL,
  MCP_SIGN_OUT_LABEL,
  mcpMoreActionsLabel,
  mcpRemoveDescription,
  mcpRemoveTitle,
} from "./mcpServerManagementPresentation";

export interface McpServerActionsMenuProps {
  readonly actions: AgentMcpServerActions;
  readonly name: string;
  readonly provider: AgentCliKind;
  onRemove(scope: AgentMcpServerConfigScope): void;
  onSignInAgain(): void;
  onSignOut(): void;
}

interface PendingRemoval {
  readonly scope: AgentMcpServerConfigScope;
  remove(scope: AgentMcpServerConfigScope): void;
}

export function McpServerActionsMenu({
  actions,
  name,
  onRemove,
  onSignInAgain,
  onSignOut,
  provider,
}: McpServerActionsMenuProps) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const label = mcpMoreActionsLabel(name);
  const removeFrom = actions.removeFrom;
  const confirm = (removal: PendingRemoval): void => {
    setPending(null);
    removal.remove(removal.scope);
  };
  return (
    <>
      <IconButton
        aria-expanded={open}
        aria-haspopup="menu"
        className="settings-mcp-server__menu"
        icon={<Ellipsis aria-hidden="true" size={14} />}
        label={label}
        onClick={() => setOpen((shown) => !shown)}
        ref={anchorRef}
      />
      <Menu
        anchorRef={anchorRef}
        label={label}
        onClose={() => setOpen(false)}
        open={open}
        placement="bottom-end"
      >
        {actions.signInAgain ? (
          <MenuItem onSelect={onSignInAgain}>{MCP_SIGN_IN_AGAIN_LABEL}</MenuItem>
        ) : null}
        {actions.signOut ? <MenuItem onSelect={onSignOut}>{MCP_SIGN_OUT_LABEL}</MenuItem> : null}
        {removeFrom === null ? null : (
          <MenuItem
            onSelect={() => setPending({ scope: removeFrom, remove: onRemove })}
            tone="danger"
          >
            {MCP_REMOVE_MENU_LABEL}
          </MenuItem>
        )}
      </Menu>
      {pending === null ? null : (
        <Dialog
          description={mcpRemoveDescription(pending.scope, provider)}
          footer={
            <>
              <Button onClick={() => setPending(null)}>{MCP_CANCEL_LABEL}</Button>
              <Button onClick={() => confirm(pending)} variant="danger">
                {MCP_REMOVE_LABEL}
              </Button>
            </>
          }
          onClose={() => setPending(null)}
          open
          returnFocusRef={anchorRef}
          role="alertdialog"
          title={mcpRemoveTitle(name)}
          width="sm"
        />
      )}
    </>
  );
}

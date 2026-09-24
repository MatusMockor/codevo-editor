import { Ellipsis } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { AgentThreadView } from "../../../../application/agentThreadPorts";
import { agentShipStatus, type AgentShipAvailability } from "../../../../domain/agentShip";
import { Menu } from "../../../../ui/foundation/Menu";
import { MenuItem, MenuSeparator, type MenuItemTone } from "../../../../ui/foundation/MenuItem";
import { agentShipAvailability, compareHostLabel } from "../../agentModePresentation";
import type { AgentShipActions } from "../../useAgentShipActions";

export interface AgentGitMoreMenuProps {
  readonly thread: AgentThreadView | null;
  readonly actions: AgentShipActions | null;
  onRefresh(): void;
  onShowHistory(): void;
}

export function AgentGitMoreMenu(props: AgentGitMoreMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const { actions, thread } = props;
  const refresh = (): void => {
    if (thread !== null && actions !== null) actions.onRefreshShipStatus(thread.thread.threadId);
    props.onRefresh();
  };
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More Git actions"
        className="cv-icon-button cv-icon-button--xs"
        onClick={() => setOpen((current) => !current)}
        ref={anchorRef}
        title="More Git actions"
        type="button"
      >
        <span aria-hidden="true" className="cv-icon-button__glyph">
          <Ellipsis size={14} />
        </span>
      </button>
      <Menu
        anchorRef={anchorRef}
        label="More Git actions"
        onClose={() => setOpen(false)}
        open={open}
      >
        {thread !== null && actions !== null && <ShipItems actions={actions} thread={thread} />}
        <MenuItem onSelect={refresh}>Refresh status</MenuItem>
        <MenuItem onSelect={props.onShowHistory}>Show history</MenuItem>
      </Menu>
    </>
  );
}

function ShipItems(props: {
  readonly thread: AgentThreadView;
  readonly actions: AgentShipActions;
}) {
  const { actions, thread } = props;
  const threadId = thread.thread.threadId;
  const availability = agentShipAvailability(thread);
  const ship = thread.ship;
  const status = agentShipStatus(ship);
  const worktree = thread.thread.target.isolation === "worktree";
  const primary = status?.primary.branch ?? "the main checkout";
  const compareUrl =
    ship.kind === "pushed" ? (ship.receipt.compareUrl ?? status?.remote?.compareUrl ?? null) : null;
  const compareHost = compareUrl === null ? null : compareHostLabel(compareUrl);
  return (
    <>
      <ShipItem availability={availability.push} onSelect={() => void actions.onPush(threadId)}>
        Push branch
      </ShipItem>
      {compareUrl !== null && (
        <MenuItem onSelect={() => actions.onOpenCompareUrl(threadId)}>
          {compareHost === null ? "Open compare page" : `Open compare page on ${compareHost}`}
        </MenuItem>
      )}
      {worktree && (
        <>
          <ShipItem
            availability={availability.fastForward}
            onSelect={() => actions.onIntegrate(threadId, "fastForward")}
          >
            {`Integrate into ${primary} (fast-forward)`}
          </ShipItem>
          <ShipItem
            availability={availability.merge}
            onSelect={() => actions.onIntegrate(threadId, "merge")}
          >
            {`Integrate into ${primary} (merge commit)`}
          </ShipItem>
          <ShipItem
            availability={availability.removeWorktree}
            onSelect={() => actions.onRemoveWorktree(threadId, { deleteBranch: false })}
          >
            Remove worktree
          </ShipItem>
          <ShipItem
            availability={firstBlocked(availability.removeWorktree, availability.deleteBranch)}
            onSelect={() => actions.onRemoveWorktree(threadId, { deleteBranch: true })}
          >
            Remove worktree and branch
          </ShipItem>
          <ShipItem
            availability={availability.removeWorktree}
            onSelect={() => actions.onDiscardWorktree(threadId)}
            tone="danger"
          >
            Discard worktree
          </ShipItem>
        </>
      )}
      <MenuSeparator />
    </>
  );
}

function ShipItem(props: {
  readonly availability: AgentShipAvailability;
  readonly children: ReactNode;
  readonly tone?: MenuItemTone;
  onSelect(): void;
}) {
  const blocked = props.availability.kind === "blocked";
  return (
    <MenuItem
      description={props.availability.kind === "blocked" ? props.availability.reason : undefined}
      disabled={blocked}
      onSelect={props.onSelect}
      tone={props.tone}
    >
      {props.children}
    </MenuItem>
  );
}

function firstBlocked(
  primary: AgentShipAvailability,
  secondary: AgentShipAvailability,
): AgentShipAvailability {
  if (primary.kind === "blocked") return primary;
  return secondary;
}

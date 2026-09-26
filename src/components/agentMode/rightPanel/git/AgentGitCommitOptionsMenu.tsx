import { ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import type { AgentGitAmendView } from "../../../../application/rightPanel/useAgentGitAmendMode";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { Menu } from "../../../../ui/foundation/Menu";
import { MenuItem } from "../../../../ui/foundation/MenuItem";
import { AMEND_CHECKING_TEXT } from "./agentGitPresentation";

export interface AgentGitCommitOptionsMenuProps {
  readonly amend: AgentGitAmendView;
  readonly disabled: boolean;
  onCheckAmend(): void;
  onAmendChange(active: boolean): void;
}

export function AgentGitCommitOptionsMenu(props: AgentGitCommitOptionsMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const { amend } = props;
  const blocked = !amend.active && (amend.checking || amend.unavailableReason !== null);
  const description = amend.checking ? AMEND_CHECKING_TEXT : (amend.unavailableReason ?? undefined);
  const toggleMenu = (): void => {
    if (!open) props.onCheckAmend();
    setOpen(!open);
  };
  return (
    <>
      <IconButton
        aria-expanded={open}
        aria-haspopup="menu"
        className="cv-git-box__options"
        disabled={props.disabled}
        icon={<ChevronDown size={14} />}
        label="More commit options"
        onClick={toggleMenu}
        ref={anchorRef}
        size="xs"
      />
      <Menu
        anchorRef={anchorRef}
        label="Commit options"
        onClose={() => setOpen(false)}
        open={open}
        placement="top-end"
      >
        <MenuItem
          checked={amend.active}
          description={description}
          disabled={blocked}
          onSelect={() => props.onAmendChange(!amend.active)}
        >
          Amend last commit
        </MenuItem>
      </Menu>
    </>
  );
}

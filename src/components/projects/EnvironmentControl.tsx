import { ChevronDown, Monitor, Server } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { RemoteRunnerServer } from "../../domain/remoteRunner";
import { Menu } from "../../ui/foundation/Menu";
import { MenuItem } from "../../ui/foundation/MenuItem";

export interface EnvironmentControlProps {
  readonly servers: readonly RemoteRunnerServer[];
  readonly serverId: string | null;
  readonly triggerRef?: RefObject<HTMLButtonElement | null>;
  onChange(serverId: string | null): void;
  onTriggerKeyDown?(event: KeyboardEvent<HTMLButtonElement>): void;
}

const LOCAL_LABEL = "This computer";

export function EnvironmentControl({
  onChange,
  onTriggerKeyDown,
  serverId,
  servers,
  triggerRef,
}: EnvironmentControlProps) {
  const ownAnchor = useRef<HTMLButtonElement | null>(null);
  const anchor = triggerRef ?? ownAnchor;
  const [open, setOpen] = useState(false);
  const selected = servers.find((server) => server.id === serverId) ?? null;
  const label = selected?.name ?? LOCAL_LABEL;
  const icon =
    selected === null ? (
      <Monitor aria-hidden="true" size={14} />
    ) : (
      <Server aria-hidden="true" size={14} />
    );
  if (servers.length === 0)
    return (
      <span className="cv-projects-environment cv-projects-environment--static">
        {icon}
        {label}
      </span>
    );
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="cv-projects-environment"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
        onMouseDown={(event) => event.preventDefault()}
        ref={anchor}
        title="Where the project lives"
        type="button"
      >
        {icon}
        {label}
        <ChevronDown aria-hidden="true" size={12} />
      </button>
      <Menu
        anchorRef={anchor}
        label="Project environment"
        onClose={() => setOpen(false)}
        open={open}
        placement="bottom-end"
      >
        <MenuItem
          checked={serverId === null}
          icon={<Monitor size={14} />}
          onSelect={() => onChange(null)}
        >
          {LOCAL_LABEL}
        </MenuItem>
        {servers.map((server) => (
          <MenuItem
            checked={server.id === serverId}
            icon={<Server size={14} />}
            key={server.id}
            onSelect={() => onChange(server.id)}
          >
            {server.name}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

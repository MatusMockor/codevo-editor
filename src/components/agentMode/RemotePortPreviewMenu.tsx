import { useLayoutEffect, useRef, useState } from "react";
import { ExternalLink, Radio, RotateCw, X } from "lucide-react";
import type { RemotePortForwardView } from "../../domain/remotePortPreview";
import { Button } from "../../ui/foundation/Button";
import { cx } from "../../ui/foundation/classNames";
import { IconButton } from "../../ui/foundation/IconButton";
import { Popover } from "../../ui/foundation/Popover";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";
import {
  REMOTE_PORTS_AGENT_LIFETIME_NOTE,
  remotePortLocalUrl,
  remotePortRows,
  type RemotePortRow,
} from "./remotePortPreviewPresentation";
import type { AgentServerPortsMenu } from "./useAgentServerPorts";
import "./conversation/agentProse.css";
import "./remotePortPreviewMenu.css";

export function RemotePortPreviewMenu({ menu }: { readonly menu: AgentServerPortsMenu }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const rows = remotePortRows(menu.surface.ports);
  const label = rows.length === 0 ? "Ports" : `Ports, ${rows.length} detected`;
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className={cx("cv-button", "cv-button--default", "cv-button--sm", "cv-ports-chip")}
        onClick={() => setOpen((current) => !current)}
        ref={anchorRef}
        title={`Dev server ports on ${menu.server}`}
        type="button"
      >
        <span aria-hidden="true" className="cv-button__icon">
          <Radio size={14} />
        </span>
        Ports
        {rows.length > 0 && (
          <span aria-hidden="true" className="cv-ports-chip__count">
            {rows.length}
          </span>
        )}
      </button>
      <Popover
        anchorRef={anchorRef}
        className="cv-ports"
        label={`Ports on ${menu.server}`}
        onClose={() => setOpen(false)}
        open={open}
        placement="bottom-end"
      >
        <RemotePortPreviewPanel menu={menu} rows={rows} />
      </Popover>
    </>
  );
}

function RemotePortPreviewPanel({
  menu,
  rows,
}: {
  readonly menu: AgentServerPortsMenu;
  readonly rows: readonly RemotePortRow[];
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body === null) return;
    const first = body.querySelector<HTMLButtonElement>("button:not(:disabled)");
    (first ?? body).focus({ preventScroll: true });
  }, []);
  const { surface } = menu;
  return (
    <div className="cv-ports__body" ref={bodyRef} tabIndex={-1}>
      <header className="cv-ports__head">
        <span className="cv-ports__title">Ports</span>
        <span className="cv-ports__server" title={menu.server}>
          {menu.server}
        </span>
      </header>
      <RemotePortList menu={menu} rows={rows} />
      {surface.truncated && <p className="cv-ports__line">Some ports are not shown.</p>}
      <p className="cv-ports__note">{REMOTE_PORTS_AGENT_LIFETIME_NOTE}</p>
    </div>
  );
}

function RemotePortList({
  menu,
  rows,
}: {
  readonly menu: AgentServerPortsMenu;
  readonly rows: readonly RemotePortRow[];
}) {
  const { surface } = menu;
  const error =
    surface.status === "error" ? (
      <div className="cv-ports__line cv-ports__line--error" role="alert">
        <span>{surface.error ?? "Could not list server ports."}</span>
        <Button icon={<RotateCw size={12} />} onClick={surface.refresh} size="sm" variant="ghost">
          Retry
        </Button>
      </div>
    ) : null;
  if (rows.length === 0) {
    if (error !== null) return error;
    return (
      <p className="cv-ports__line" role="status">
        {surface.status === "ready"
          ? "Nothing is listening for this conversation yet."
          : "Checking the server…"}
      </p>
    );
  }
  return (
    <>
      <ul aria-label="Detected ports" className="cv-ports__list">
        {rows.map((row) => (
          <RemotePortRowView key={row.port} menu={menu} row={row} />
        ))}
      </ul>
      {error}
    </>
  );
}

function RemotePortRowView({
  menu,
  row,
}: {
  readonly menu: AgentServerPortsMenu;
  readonly row: RemotePortRow;
}) {
  const { forward, port } = row;
  const scheme = menu.schemeOf(port);
  const opening = forward.kind === "opening";
  return (
    <li className="cv-ports__row" data-forward={forward.kind}>
      <div className="cv-ports__id">
        <span className="cv-ports__port">{port}</span>
        <span className="cv-ports__meta">
          {row.process} · {row.sources.join(" + ")}
        </span>
      </div>
      <div className="cv-ports__actions">
        <Button
          aria-label={`Open port ${port} in browser`}
          disabled={opening}
          icon={<ExternalLink size={12} />}
          onClick={() => void menu.surface.open(port, { scheme })}
          size="sm"
          variant="ghost"
        >
          {opening ? "Opening…" : "Open in browser"}
        </Button>
        {forward.kind === "open" && (
          <>
            <AgentMessageCopyButton
              clipboard={menu.clipboard}
              label={`local URL for port ${port}`}
              text={remotePortLocalUrl(forward.localPort, scheme)}
            />
            <IconButton
              icon={<X size={13} />}
              label={`Stop forwarding port ${port}`}
              onClick={() => void menu.surface.close(port)}
              size="xs"
            />
          </>
        )}
      </div>
      <RemotePortForwardLine forward={forward} />
    </li>
  );
}

function RemotePortForwardLine({ forward }: { readonly forward: RemotePortForwardView }) {
  switch (forward.kind) {
    case "none":
      return null;
    case "opening":
      return <span className="cv-ports__state">Forwarding through SSH…</span>;
    case "open":
      return <span className="cv-ports__state">Forwarded to 127.0.0.1:{forward.localPort}</span>;
    case "failed":
      return (
        <span className="cv-ports__state cv-ports__state--failed" role="alert">
          {forward.reason}
        </span>
      );
    default: {
      const unreachable: never = forward;
      return unreachable;
    }
  }
}

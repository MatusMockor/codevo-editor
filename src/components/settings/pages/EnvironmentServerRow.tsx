import { useEffect, useRef, useState, type ReactNode } from "react";
import { Server, Trash2 } from "lucide-react";
import type { RemoteRunnerServer } from "../../../domain/remoteRunner";
import { SettingsSwitch } from "../primitives/SettingsSwitch";
import { EnvironmentServerRemoveConfirm } from "./EnvironmentServerRemoveConfirm";
import type { EnvironmentServerStatusView } from "./environmentServerStatus";

export interface EnvironmentServerRowProps {
  readonly server: RemoteRunnerServer;
  readonly status: EnvironmentServerStatusView;
  readonly disabled: boolean;
  readonly children?: ReactNode;
  onConnect(): void;
  onDisconnect(): void;
  onRemove(): void;
}

export function EnvironmentServerRow({
  server,
  status,
  disabled,
  children,
  onConnect,
  onDisconnect,
  onRemove,
}: EnvironmentServerRowProps) {
  const [confirming, setConfirming] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const connecting = status.kind === "connecting";
  const locked = disabled || connecting;
  if (locked && confirming) setConfirming(false);

  useEffect(() => {
    const closed = wasConfirming.current && !confirming;
    wasConfirming.current = confirming;
    if (!closed) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const trash = trashRef.current;
    if (trash && !trash.disabled) {
      trash.focus();
      return;
    }
    rowRef.current?.focus();
  }, [confirming]);

  const confirmRemove = () => {
    setConfirming(false);
    onRemove();
  };

  const toggle = (next: boolean) => {
    setConfirming(false);
    if (next) {
      onConnect();
      return;
    }
    onDisconnect();
  };

  return (
    <div
      aria-label={server.name}
      className="settings-environments__server"
      ref={rowRef}
      role="group"
      tabIndex={-1}
    >
      <span aria-hidden="true" className="settings-environments__server-icon">
        <Server size={15} />
      </span>
      <div className="settings-environments__server-main">
        <p className="settings-environments__server-name">
          <span className="settings-environments__server-title">{server.name}</span>
          <span
            aria-live="polite"
            className="settings-environments__status"
            data-status={status.kind}
            title={status.label}
          >
            <span aria-hidden="true" className="settings-environments__status-dot" />
            <span className="settings-environments__status-text">{status.label}</span>
          </span>
        </p>
        <p className="settings-environments__server-meta">
          {server.username}@{server.host}:{server.port}
        </p>
      </div>
      <div className="settings-environments__server-actions">
        <SettingsSwitch
          checked={server.connected || connecting}
          disabled={locked}
          label={`${server.name} connection`}
          onChange={toggle}
        />
        <button
          aria-expanded={confirming}
          aria-label={`Remove ${server.name}`}
          className="settings-environments__trash"
          disabled={locked}
          onClick={() => setConfirming(true)}
          ref={trashRef}
          title={`Remove ${server.name}`}
          type="button"
        >
          <Trash2 aria-hidden="true" size={15} />
        </button>
      </div>
      {confirming && (
        <EnvironmentServerRemoveConfirm
          disabled={locked}
          name={server.name}
          onCancel={() => setConfirming(false)}
          onConfirm={confirmRemove}
        />
      )}
      {children && <div className="settings-environments__server-details">{children}</div>}
    </div>
  );
}

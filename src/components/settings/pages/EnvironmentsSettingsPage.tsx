import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import { RemoteProjectLinksSettings } from "../../remoteRunner/RemoteProjectLinksSettings";
import { RemoteInstructionSettings } from "../../remoteRunner/RemoteInstructionSettings";
import { RemoteRunnerExecutionPolicy } from "../../remoteRunner/RemoteRunnerExecutionPolicy";
import { useState, type FormEvent } from "react";
import { Check, Monitor, Plus, Server } from "lucide-react";
import { useRemoteRunnerContext } from "../../remoteRunner/remoteRunnerContext";
import { SettingsButton } from "../primitives/SettingsButton";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import "./environmentsSettings.css";

export function EnvironmentsSettingsPage({
  projects = [],
}: {
  readonly projects?: readonly AgentProjectDescriptor[];
}) {
  const remote = useRemoteRunnerContext();
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [port, setPort] = useState("22");
  const [serverId, setServerId] = useState("");
  const busy = remote?.status === "busy" || remote?.status === "loading";

  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!remote || busy) return;
    const connected = await remote.connect({
      id: serverId,
      name: name.trim(),
      host: host.trim(),
      username: username.trim(),
      port: Number(port),
    });
    if (connected) setFormOpen(false);
  };

  return (
    <SettingsSectionHeading title="Environments">
      <SettingsRow rowId="environments.local">
        <span className="settings-environments__default">
          <Monitor aria-hidden="true" size={15} />
          Default for new threads
          <Check aria-hidden="true" size={14} />
        </span>
      </SettingsRow>
      <SettingsRow layout="stacked" rowId="environments.servers">
        <div className="settings-environments__servers">
          <div className="settings-environments__empty">
            <Server aria-hidden="true" className="settings-environments__icon" size={24} />
            <div className="settings-environments__copy">
              <p className="settings-environments__title">
                {remote?.servers.length ? "Your servers" : "No servers added"}
              </p>
              <p className="settings-environments__description">
                Connect to a Linux server running Codevo Runner using your existing SSH key. Remote
                tasks continue when you close this computer.
              </p>
            </div>
            <SettingsButton
              disabled={!remote || busy}
              onClick={() => {
                setServerId(crypto.randomUUID());
                setName("");
                setHost("");
                setUsername("");
                setPort("22");
                setFormOpen(true);
              }}
              expanded={formOpen}
              variant="outline"
            >
              <Plus aria-hidden="true" size={14} />
              Add server
            </SettingsButton>
          </div>
          {!remote && <p role="status">Server connections require the desktop application.</p>}
          {remote?.error && (
            <p className="settings-environments__error" role="alert">
              {remote.error}
            </p>
          )}
          {formOpen && (
            <form className="settings-environments__form" onSubmit={(event) => void connect(event)}>
              <label>
                Server name
                <input
                  className="settings-input"
                  required
                  maxLength={80}
                  value={name}
                  placeholder="Linux server"
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                SSH host
                <input
                  className="settings-input"
                  required
                  maxLength={253}
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={host}
                  placeholder="192.168.1.110"
                  disabled={busy}
                  onChange={(event) => setHost(event.target.value)}
                />
              </label>
              <label>
                SSH username
                <input
                  className="settings-input"
                  required
                  maxLength={64}
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  placeholder="codex"
                  disabled={busy}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label>
                SSH port
                <input
                  className="settings-input"
                  required
                  type="number"
                  min={1}
                  max={65535}
                  step={1}
                  value={port}
                  disabled={busy}
                  onChange={(event) => setPort(event.target.value)}
                />
              </label>
              <p className="settings-environments__description settings-environments__wide">
                Install and start Codevo Runner on the server first. Connect once using SSH and
                verify its host fingerprint before adding it here. Codevo uses your saved SSH
                identity and refuses unknown or changed server keys.
              </p>
              <div className="settings-environments__actions settings-environments__wide">
                <button
                  className="settings-btn settings-btn--primary settings-btn--compact"
                  type="submit"
                  disabled={busy || !name.trim() || !host.trim() || !username.trim()}
                  aria-busy={busy || undefined}
                >
                  {busy ? "Connecting…" : "Connect"}
                </button>
                <SettingsButton disabled={busy} onClick={() => setFormOpen(false)}>
                  Cancel
                </SettingsButton>
              </div>
            </form>
          )}
          {remote?.servers.map((server) => (
            <div className="settings-environments__empty" key={server.id}>
              <Server aria-hidden="true" className="settings-environments__icon" size={20} />
              <div className="settings-environments__copy">
                <p className="settings-environments__title">{server.name}</p>
                <p className="settings-environments__description">
                  {server.username}@{server.host}:{server.port} ·{" "}
                  {server.connected ? "Connected" : "Disconnected"}
                </p>
                {remote.gateway && (
                  <RemoteProjectLinksSettings
                    key={`projects:${server.id}:${server.connected}`}
                    gateway={remote.gateway}
                    serverId={server.id}
                    connected={server.connected}
                    projects={projects}
                  />
                )}
                {remote.gateway && (
                  <RemoteInstructionSettings
                    key={`${server.id}:${server.connected}`}
                    gateway={remote.gateway}
                    serverId={server.id}
                    connected={server.connected}
                    projects={projects}
                  />
                )}
                {remote.gateway && (
                  <RemoteRunnerExecutionPolicy
                    gateway={remote.gateway}
                    serverId={server.id}
                    connected={server.connected}
                  />
                )}
              </div>
              <div className="settings-environments__actions settings-environments__server-actions">
                <SettingsButton
                  disabled={busy}
                  label={`${server.connected ? "Disconnect" : "Connect"} ${server.name}`}
                  onClick={() => {
                    void (server.connected
                      ? remote.disconnect(server.id)
                      : remote.connect({
                          id: server.id,
                          name: server.name,
                          host: server.host,
                          username: server.username,
                          port: server.port,
                        }));
                  }}
                  variant={server.connected ? "outline" : "primary"}
                >
                  {server.connected ? "Disconnect" : "Connect"}
                </SettingsButton>
                <SettingsButton
                  disabled={busy}
                  label={`Remove ${server.name}`}
                  variant="danger"
                  onClick={() => {
                    void remote.remove(server.id);
                  }}
                >
                  Remove
                </SettingsButton>
              </div>
            </div>
          ))}
        </div>
      </SettingsRow>
    </SettingsSectionHeading>
  );
}

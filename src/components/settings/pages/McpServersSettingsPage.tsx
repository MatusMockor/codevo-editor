import { RefreshCw } from "lucide-react";
import { useEffect, useMemo } from "react";
import { agentMcpServersSnapshot } from "../../../application/agentMcpServersStore";
import type { AgentMcpServersSurface } from "../../../application/agentMcpServersSurface";
import { useAgentMcpServerManagementSupport } from "../../../application/useAgentMcpServerManagement";
import {
  useAgentMcpServersState,
  useAgentMcpServersTarget,
} from "../../../application/useAgentMcpServers";
import type { AgentMcpServer } from "../../../domain/agentMcpServers";
import type { AgentCliKind } from "../../../domain/agentTask";
import { IconButton } from "../../../ui/foundation/IconButton";
import { useNowMs } from "../../../ui/foundation/useNowMs";
import { AgentProviderGlyph } from "../../agentMode/AgentProviderGlyph";
import { agentProviderLabel } from "../../agentMode/agentSidebarPresentation";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSelect } from "../primitives/SettingsSelect";
import type { SettingsEnvironment, SettingsPageProps } from "../settingsPageProps";
import { useSettingsRowTarget } from "../settingsTargetContext";
import { McpAddServer } from "./McpAddServer";
import { McpServerList } from "./McpServerList";
import {
  selectedMcpProjectKey,
  type McpProjectNote,
  type McpProjectOption,
} from "./mcpProjectOptions";
import {
  MCP_NO_PROJECT_NOTICE,
  MCP_PROVIDERS,
  MCP_REFRESH_LABEL,
  MCP_TRUNCATED_NOTICE,
  MCP_UNAVAILABLE_NOTICE,
  mcpAddServerLead,
  mcpCheckNotice,
  mcpCheckedLabel,
  mcpProviderSummary,
  type McpProjectPlace,
  type McpProviderSummary,
} from "./mcpServersPresentation";
import {
  useMcpServerProjectsLoad,
  useMcpServersProject,
  type McpServersProject,
} from "./useMcpServersProject";
import "./mcpServersSettings.css";

const NO_SERVERS: ReadonlyArray<AgentMcpServer> = [];
const NO_NOTES: ReadonlyArray<McpProjectNote> = [];

export function McpServersSettingsPage({ env }: SettingsPageProps) {
  const rowRef = useSettingsRowTarget("mcp.servers");
  return (
    <div className="settings-stack" data-settings-row="mcp.servers" ref={rowRef} tabIndex={-1}>
      <McpServersContent env={env} />
    </div>
  );
}

export function McpServersPageActions({ env }: { readonly env: SettingsEnvironment }) {
  const surface = env.agentMcpServers ?? null;
  const store = surface?.store ?? null;
  const project = useMcpServersProject(env);
  const projectKey = selectedMcpProjectKey(project.selection);
  const claudeTarget = useAgentMcpServersTarget(projectKey, "claudeCode");
  const codexTarget = useAgentMcpServersTarget(projectKey, "codex");
  const claude = useAgentMcpServersState(store, claudeTarget);
  const codex = useAgentMcpServersState(store, codexTarget);
  if (surface === null || store === null) return null;
  const targets = [claudeTarget, codexTarget].flatMap((target) => target ?? []);
  if (targets.length === 0 && !project.serversKnown) return null;
  const checking = claude.kind === "loading" || codex.kind === "loading";
  const refresh = () => {
    surface.serverProjects.load();
    for (const target of targets) store.refresh(target);
  };
  return (
    <span className="settings-page-actions">
      <IconButton
        disabled={checking}
        icon={<RefreshCw aria-hidden="true" size={14} />}
        label={MCP_REFRESH_LABEL}
        onClick={refresh}
      />
    </span>
  );
}

function McpServersContent({ env }: { readonly env: SettingsEnvironment }) {
  const surface = env.agentMcpServers ?? null;
  const project = useMcpServersProject(env);
  const nowMs = useNowMs();
  useMcpServerProjectsLoad(surface?.serverProjects ?? null);
  if (surface === null) return <McpNotice notes={NO_NOTES} text={MCP_UNAVAILABLE_NOTICE} />;
  const selection = project.selection;
  switch (selection.kind) {
    case "none":
      return <McpNotice notes={project.notes} text={MCP_NO_PROJECT_NOTICE} />;
    case "waiting":
      return <McpNotice notes={project.notes} text={null} />;
    case "selected":
      return (
        <>
          <McpProjectSection project={project} selected={selection.option} />
          {MCP_PROVIDERS.map((provider) => (
            <McpProviderGroup
              key={`${provider}:${selection.option.key}`}
              nowMs={nowMs}
              onCopy={env.onCopyInstallCommand}
              place={selection.option.project.kind}
              projectKey={selection.option.key}
              provider={provider}
              surface={surface}
            />
          ))}
        </>
      );
    default: {
      const unreachable: never = selection;
      return unreachable;
    }
  }
}

function McpNotice({
  notes,
  text,
}: {
  readonly notes: ReadonlyArray<McpProjectNote>;
  readonly text: string | null;
}) {
  return (
    <SettingsSectionHeading title="MCP servers">
      {text === null ? null : <p className="settings-empty">{text}</p>}
      <McpProjectNotes className="settings-empty" notes={notes} />
    </SettingsSectionHeading>
  );
}

function McpProjectNotes({
  className,
  notes,
}: {
  readonly className: string;
  readonly notes: ReadonlyArray<McpProjectNote>;
}) {
  return notes.map((note) => (
    <p
      className={className}
      data-mcp-project-note={note.tone}
      key={note.serverId === null ? "list" : `server:${note.serverId}`}
      role={note.tone === "problem" ? "alert" : "status"}
    >
      {note.text}
    </p>
  ));
}

function McpProjectSection({
  project,
  selected,
}: {
  readonly project: McpServersProject;
  readonly selected: McpProjectOption;
}) {
  const options = useMemo(
    () => project.options.map(({ key, label }) => ({ label, value: key })),
    [project.options],
  );
  return (
    <SettingsSectionHeading title="Project">
      <div className="settings-row">
        <div className="settings-row__text">
          <div className="settings-row__head">
            <h3 className="settings-row__title">{selected.name}</h3>
          </div>
          <p
            className="settings-row__description settings-mcp-project__location"
            data-place={selected.project.kind}
          >
            {selected.location}
          </p>
        </div>
        {options.length < 2 ? null : (
          <div className="settings-row__control">
            <SettingsSelect
              label="Project"
              onChange={project.select}
              options={options}
              value={selected.key}
              width="md"
            />
          </div>
        )}
      </div>
      <div className="settings-row" data-layout="stacked">
        <p className="settings-row__description">{mcpCheckNotice(selected.project.kind)}</p>
        <McpProjectNotes className="settings-row__description" notes={project.notes} />
      </div>
    </SettingsSectionHeading>
  );
}

function McpProviderGroup({
  nowMs,
  onCopy,
  place,
  projectKey,
  provider,
  surface,
}: {
  readonly nowMs: number;
  readonly place: McpProjectPlace;
  readonly projectKey: string;
  readonly provider: AgentCliKind;
  readonly surface: AgentMcpServersSurface;
  onCopy(command: string): void;
}) {
  const store = surface.store;
  const target = useAgentMcpServersTarget(projectKey, provider);
  const state = useAgentMcpServersState(store, target);
  const support = useAgentMcpServerManagementSupport(surface, target);
  const management = support === "supported" ? surface.management : null;
  useEffect(() => {
    if (target === null) return;
    if (store.state(target).kind !== "idle") return;
    store.refresh(target);
  }, [store, target]);
  const snapshot = agentMcpServersSnapshot(state);
  const servers = snapshot?.result.servers ?? NO_SERVERS;
  const names = useMemo(() => servers.map((server) => server.name), [servers]);
  const summary = mcpProviderSummary(state, provider);
  return (
    <SettingsSectionHeading
      actions={
        snapshot === null ? undefined : (
          <>
            <span className="settings-section__note">
              {mcpCheckedLabel(snapshot.checkedAtMs, nowMs)}
            </span>
            {management === null || target === null ? null : (
              <McpAddServer
                configuredNames={names}
                management={management}
                provider={provider}
                target={target}
              />
            )}
          </>
        )
      }
      bare
      title={agentProviderLabel(provider)}
    >
      <div
        aria-busy={state.kind === "loading"}
        className="settings-group"
        data-mcp-provider={provider}
      >
        <McpProviderSummaryRow
          hintCommand={management === null ? summary.hintCommand : null}
          place={place}
          provider={provider}
          summary={summary}
        />
        <McpServerList
          management={management}
          onCopy={onCopy}
          place={place}
          provider={provider}
          servers={servers}
          target={target}
        />
        {snapshot?.result.truncated === true ? (
          <p className="settings-empty">{MCP_TRUNCATED_NOTICE}</p>
        ) : null}
      </div>
    </SettingsSectionHeading>
  );
}

function McpProviderSummaryRow({
  hintCommand,
  place,
  provider,
  summary,
}: {
  readonly hintCommand: string | null;
  readonly place: McpProjectPlace;
  readonly provider: AgentCliKind;
  readonly summary: McpProviderSummary;
}) {
  return (
    <div className="settings-row" data-layout="stacked">
      <span className="settings-mcp-summary" data-tone={summary.tone}>
        <AgentProviderGlyph decorative kind={provider} />
        <span role={summary.tone === "problem" ? "alert" : "status"}>{summary.text}</span>
      </span>
      {hintCommand === null ? null : (
        <p className="settings-row__description">
          {mcpAddServerLead(place)} <code>{hintCommand}</code>, then check again.
        </p>
      )}
    </div>
  );
}

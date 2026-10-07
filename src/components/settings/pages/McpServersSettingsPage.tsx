import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  Copy,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import {
  agentMcpServersSnapshot,
  type AgentMcpServersStore,
} from "../../../application/agentMcpServersStore";
import {
  useAgentMcpServersState,
  useAgentMcpServersTarget,
} from "../../../application/useAgentMcpServers";
import {
  agentMcpServerSignInCommand,
  type AgentMcpServer,
  type AgentMcpServerStatus,
} from "../../../domain/agentMcpServers";
import type { AgentCliKind } from "../../../domain/agentTask";
import { IconButton } from "../../../ui/foundation/IconButton";
import { useNowMs } from "../../../ui/foundation/useNowMs";
import { AgentProviderGlyph } from "../../agentMode/AgentProviderGlyph";
import { agentProviderLabel } from "../../agentMode/agentSidebarPresentation";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSelect } from "../primitives/SettingsSelect";
import type { SettingsEnvironment, SettingsPageProps } from "../settingsPageProps";
import { useSettingsRowTarget } from "../settingsTargetContext";
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
  mcpCopySignInLabel,
  mcpProviderSummary,
  mcpServerSecondaryText,
  mcpServerStatusLabel,
  mcpServerStatusTone,
  mcpSignInLead,
  orderedMcpServers,
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
  const store = env.agentMcpServers?.store ?? null;
  const project = useMcpServersProject(env);
  const nowMs = useNowMs();
  useMcpServerProjectsLoad(env.agentMcpServers?.serverProjects ?? null);
  if (store === null) return <McpNotice notes={NO_NOTES} text={MCP_UNAVAILABLE_NOTICE} />;
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
              key={provider}
              nowMs={nowMs}
              onCopy={env.onCopyInstallCommand}
              place={selection.option.project.kind}
              projectKey={selection.option.key}
              provider={provider}
              store={store}
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
  store,
}: {
  readonly nowMs: number;
  readonly place: McpProjectPlace;
  readonly projectKey: string;
  readonly provider: AgentCliKind;
  readonly store: AgentMcpServersStore;
  onCopy(command: string): void;
}) {
  const target = useAgentMcpServersTarget(projectKey, provider);
  const state = useAgentMcpServersState(store, target);
  useEffect(() => {
    if (target === null) return;
    if (store.state(target).kind !== "idle") return;
    store.refresh(target);
  }, [store, target]);
  const snapshot = agentMcpServersSnapshot(state);
  const servers = useMemo(
    () => (snapshot === null ? NO_SERVERS : orderedMcpServers(snapshot.result.servers)),
    [snapshot],
  );
  return (
    <SettingsSectionHeading
      actions={
        snapshot === null ? undefined : (
          <span className="settings-section__note">
            {mcpCheckedLabel(snapshot.checkedAtMs, nowMs)}
          </span>
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
          place={place}
          provider={provider}
          summary={mcpProviderSummary(state, provider)}
        />
        {servers.map((server) => (
          <McpServerRow
            key={server.name}
            onCopy={onCopy}
            place={place}
            provider={provider}
            server={server}
          />
        ))}
        {snapshot?.result.truncated === true ? (
          <p className="settings-empty">{MCP_TRUNCATED_NOTICE}</p>
        ) : null}
      </div>
    </SettingsSectionHeading>
  );
}

function McpProviderSummaryRow({
  place,
  provider,
  summary,
}: {
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
      {summary.hintCommand === null ? null : (
        <p className="settings-row__description">
          {mcpAddServerLead(place)} <code>{summary.hintCommand}</code>, then check again.
        </p>
      )}
    </div>
  );
}

function McpServerRow({
  onCopy,
  place,
  provider,
  server,
}: {
  readonly place: McpProjectPlace;
  readonly provider: AgentCliKind;
  readonly server: AgentMcpServer;
  onCopy(command: string): void;
}) {
  const secondary = mcpServerSecondaryText(server);
  const signInCommand = agentMcpServerSignInCommand(provider, server);
  const StatusIcon = statusIcon(server.status);
  return (
    <div className="settings-row settings-mcp-server" data-mcp-server={server.name}>
      <div className="settings-row__text">
        <div className="settings-row__head">
          <h3 className="settings-row__title">{server.name}</h3>
        </div>
        {secondary === null ? null : <p className="settings-row__description">{secondary}</p>}
        {server.detail === null ? null : (
          <p className="settings-row__description settings-mcp-server__detail">{server.detail}</p>
        )}
        {signInCommand === null ? null : (
          <McpSignInHint
            command={signInCommand}
            lead={mcpSignInLead(place)}
            name={server.name}
            onCopy={onCopy}
          />
        )}
      </div>
      <div className="settings-row__control">
        <span className="settings-mcp-status" data-tone={mcpServerStatusTone(server.status)}>
          <StatusIcon aria-hidden="true" size={14} />
          {mcpServerStatusLabel(server.status)}
        </span>
      </div>
    </div>
  );
}

function McpSignInHint({
  command,
  lead,
  name,
  onCopy,
}: {
  readonly command: string;
  readonly lead: string;
  readonly name: string;
  onCopy(command: string): void;
}) {
  return (
    <p className="settings-row__description settings-mcp-signin">
      <span>{lead}</span>
      <code>{command}</code>
      <IconButton
        icon={<Copy aria-hidden="true" size={12} />}
        label={mcpCopySignInLabel(name)}
        onClick={() => onCopy(command)}
        size="xs"
      />
    </p>
  );
}

function statusIcon(status: AgentMcpServerStatus): LucideIcon {
  switch (status) {
    case "connected":
      return CircleCheck;
    case "connecting":
      return LoaderCircle;
    case "needsAuth":
      return KeyRound;
    case "failed":
      return CircleAlert;
    case "disabled":
      return CircleSlash;
    case "unknown":
      return CircleHelp;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

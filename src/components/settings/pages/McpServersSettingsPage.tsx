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
import { useRemoteRunnerContext } from "../../remoteRunner/remoteRunnerContext";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSelect } from "../primitives/SettingsSelect";
import type { SettingsEnvironment, SettingsPageProps } from "../settingsPageProps";
import { useSettingsRowTarget } from "../settingsTargetContext";
import {
  MCP_CHECK_NOTICE,
  MCP_NO_PROJECT_NOTICE,
  MCP_PROVIDERS,
  MCP_REFRESH_LABEL,
  MCP_SERVER_PROJECTS_NOTICE,
  MCP_TRUNCATED_NOTICE,
  MCP_UNAVAILABLE_NOTICE,
  mcpCheckedLabel,
  mcpCopySignInLabel,
  mcpProviderSummary,
  mcpServerSecondaryText,
  mcpServerStatusLabel,
  mcpServerStatusTone,
  orderedMcpServers,
  type McpProviderSummary,
} from "./mcpServersPresentation";
import { useMcpServersProject, type McpServersProject } from "./useMcpServersProject";
import "./mcpServersSettings.css";

const NO_SERVERS: ReadonlyArray<AgentMcpServer> = [];

export function McpServersSettingsPage({ env }: SettingsPageProps) {
  const rowRef = useSettingsRowTarget("mcp.servers");
  return (
    <div className="settings-stack" data-settings-row="mcp.servers" ref={rowRef} tabIndex={-1}>
      <McpServersContent env={env} />
    </div>
  );
}

export function McpServersPageActions({ env }: { readonly env: SettingsEnvironment }) {
  const store = env.agentMcpServers?.store ?? null;
  const { selectedRoot } = useMcpServersProject(env);
  const claudeTarget = useAgentMcpServersTarget(selectedRoot, "claudeCode");
  const codexTarget = useAgentMcpServersTarget(selectedRoot, "codex");
  const claude = useAgentMcpServersState(store, claudeTarget);
  const codex = useAgentMcpServersState(store, codexTarget);
  if (store === null || claudeTarget === null || codexTarget === null) return null;
  const checking = claude.kind === "loading" || codex.kind === "loading";
  const refresh = () => {
    store.refresh(claudeTarget);
    store.refresh(codexTarget);
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
  const remote = useRemoteRunnerContext();
  const serverProjectsNote = (remote?.servers.length ?? 0) > 0 ? MCP_SERVER_PROJECTS_NOTICE : null;
  if (store === null) return <McpNotice note={null} text={MCP_UNAVAILABLE_NOTICE} />;
  const repositoryRoot = project.selectedRoot;
  if (repositoryRoot === null)
    return <McpNotice note={serverProjectsNote} text={MCP_NO_PROJECT_NOTICE} />;
  return (
    <>
      <McpProjectSection
        note={serverProjectsNote}
        project={project}
        selectedRoot={repositoryRoot}
      />
      {MCP_PROVIDERS.map((provider) => (
        <McpProviderGroup
          key={provider}
          nowMs={nowMs}
          onCopy={env.onCopyInstallCommand}
          provider={provider}
          repositoryRoot={repositoryRoot}
          store={store}
        />
      ))}
    </>
  );
}

function McpNotice({ note, text }: { readonly note: string | null; readonly text: string }) {
  return (
    <SettingsSectionHeading title="MCP servers">
      <p className="settings-empty">{text}</p>
      {note === null ? null : <p className="settings-empty">{note}</p>}
    </SettingsSectionHeading>
  );
}

function McpProjectSection({
  note,
  project,
  selectedRoot,
}: {
  readonly note: string | null;
  readonly project: McpServersProject;
  readonly selectedRoot: string;
}) {
  const selected = project.options.find((option) => option.repositoryRoot === selectedRoot);
  const options = useMemo(
    () => project.options.map(({ label, repositoryRoot }) => ({ label, value: repositoryRoot })),
    [project.options],
  );
  return (
    <SettingsSectionHeading title="Project">
      <div className="settings-row">
        <div className="settings-row__text">
          <div className="settings-row__head">
            <h3 className="settings-row__title">{selected?.label ?? selectedRoot}</h3>
          </div>
          <p className="settings-row__description settings-mcp-project__path">{selectedRoot}</p>
        </div>
        {options.length < 2 ? null : (
          <div className="settings-row__control">
            <SettingsSelect
              label="Project"
              onChange={project.select}
              options={options}
              value={selectedRoot}
              width="md"
            />
          </div>
        )}
      </div>
      <div className="settings-row" data-layout="stacked">
        <p className="settings-row__description">{MCP_CHECK_NOTICE}</p>
        {note === null ? null : <p className="settings-row__description">{note}</p>}
      </div>
    </SettingsSectionHeading>
  );
}

function McpProviderGroup({
  nowMs,
  onCopy,
  provider,
  repositoryRoot,
  store,
}: {
  readonly nowMs: number;
  readonly provider: AgentCliKind;
  readonly repositoryRoot: string;
  readonly store: AgentMcpServersStore;
  onCopy(command: string): void;
}) {
  const target = useAgentMcpServersTarget(repositoryRoot, provider);
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
        <McpProviderSummaryRow provider={provider} summary={mcpProviderSummary(state, provider)} />
        {servers.map((server) => (
          <McpServerRow key={server.name} onCopy={onCopy} provider={provider} server={server} />
        ))}
        {snapshot?.result.truncated === true ? (
          <p className="settings-empty">{MCP_TRUNCATED_NOTICE}</p>
        ) : null}
      </div>
    </SettingsSectionHeading>
  );
}

function McpProviderSummaryRow({
  provider,
  summary,
}: {
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
          Add one with <code>{summary.hintCommand}</code>, then check again.
        </p>
      )}
    </div>
  );
}

function McpServerRow({
  onCopy,
  provider,
  server,
}: {
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
          <McpSignInHint command={signInCommand} name={server.name} onCopy={onCopy} />
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
  name,
  onCopy,
}: {
  readonly command: string;
  readonly name: string;
  onCopy(command: string): void;
}) {
  return (
    <p className="settings-row__description settings-mcp-signin">
      <span>To sign in, run</span>
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

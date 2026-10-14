import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { agentMcpServersSnapshot } from "../../../application/agentMcpServersStore";
import type { AgentMcpServersSurface } from "../../../application/agentMcpServersSurface";
import { useAgentMcpServerManagementSupport } from "../../../application/useAgentMcpServerManagement";
import {
  useAgentMcpServersState,
  useAgentMcpServersTarget,
} from "../../../application/useAgentMcpServers";
import type { AgentMcpServer } from "../../../domain/agentMcpServers";
import type { AgentCliKind } from "../../../domain/agentTask";
import { AgentProviderGlyph } from "../../agentMode/AgentProviderGlyph";
import { agentProviderLabel } from "../../agentMode/agentSidebarPresentation";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { McpAddServer } from "./McpAddServer";
import { McpServerList } from "./McpServerList";
import {
  filterMcpServerLayout,
  mcpServerLayout,
  mcpServerLayoutHasEntries,
} from "./mcpServerGroupsPresentation";
import {
  MCP_TRUNCATED_NOTICE,
  mcpAddServerLead,
  mcpCheckedLabel,
  mcpProviderSummary,
  type McpProjectPlace,
  type McpProviderSummary,
} from "./mcpServersPresentation";

const NO_SERVERS: ReadonlyArray<AgentMcpServer> = [];

interface McpServerGroupsProps {
  readonly nowMs: number;
  readonly place: McpProjectPlace;
  readonly projectKey: string;
  readonly surface: AgentMcpServersSurface;
  onCopy(command: string): void;
}

export function McpServerGroups(props: McpServerGroupsProps) {
  const [query, setQuery] = useState("");
  const claude = useMcpProvider(props.projectKey, "claudeCode", props.surface);
  const codex = useMcpProvider(props.projectKey, "codex", props.surface);
  const claudeLayout = useMemo(
    () =>
      filterMcpServerLayout(claude.provider, claude.layout, query, {
        place: props.place,
        management:
          claude.management === null || claude.target === null ? "unsupported" : "supported",
      }),
    [claude.provider, claude.layout, claude.management, claude.target, props.place, query],
  );
  const codexLayout = useMemo(
    () =>
      filterMcpServerLayout(codex.provider, codex.layout, query, {
        place: props.place,
        management:
          codex.management === null || codex.target === null ? "unsupported" : "supported",
      }),
    [codex.provider, codex.layout, codex.management, codex.target, props.place, query],
  );
  const filtering = query.trim() !== "";
  const noMatches =
    !mcpServerLayoutHasEntries(claudeLayout) && !mcpServerLayoutHasEntries(codexLayout);
  const complete = [claude, codex].every(
    ({ state, snapshot }) => state.kind === "loaded" && snapshot?.result.truncated === false,
  );
  return (
    <div className="settings-stack">
      <div className="settings-mcp-toolbar">
        <span className="settings-mcp-search">
          <Search aria-hidden="true" size={14} />
          <input
            aria-label="Search MCP servers"
            autoComplete="off"
            className="settings-input"
            data-width="full"
            maxLength={256}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }}
            placeholder="Search MCP servers"
            spellCheck={false}
            type="search"
            value={query}
          />
        </span>
        {[claude, codex].map((model) => (
          <McpProviderAdd key={model.provider} model={model} />
        ))}
      </div>
      {filtering && noMatches && complete ? (
        <p className="settings-empty" role="status">{`No MCP servers match "${query}"`}</p>
      ) : null}
      <McpProviderGroup {...props} filtering={filtering} layout={claudeLayout} model={claude} />
      <McpProviderGroup {...props} filtering={filtering} layout={codexLayout} model={codex} />
    </div>
  );
}

function useMcpProvider(
  projectKey: string,
  provider: AgentCliKind,
  surface: AgentMcpServersSurface,
) {
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
  const layout = useMemo(() => mcpServerLayout(provider, servers), [provider, servers]);
  return { provider, target, state, management, snapshot, names, layout };
}

type McpProviderModel = ReturnType<typeof useMcpProvider>;

function McpProviderAdd({ model }: { readonly model: McpProviderModel }) {
  if (model.snapshot === null || model.management === null || model.target === null) return null;
  return (
    <span className="settings-mcp-toolbar__add">
      <span>{agentProviderLabel(model.provider)}</span>
      <McpAddServer
        configuredNames={model.names}
        management={model.management}
        provider={model.provider}
        target={model.target}
      />
    </span>
  );
}

function McpProviderGroup({
  filtering,
  layout,
  model,
  nowMs,
  onCopy,
  place,
}: McpServerGroupsProps & {
  readonly filtering: boolean;
  readonly layout: McpProviderModel["layout"];
  readonly model: McpProviderModel;
}) {
  const { management, provider, snapshot, state, target } = model;
  if (
    filtering &&
    !mcpServerLayoutHasEntries(layout) &&
    state.kind === "loaded" &&
    snapshot?.result.truncated !== true
  )
    return null;
  const summary = mcpProviderSummary(state, provider);
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
          layout={layout}
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

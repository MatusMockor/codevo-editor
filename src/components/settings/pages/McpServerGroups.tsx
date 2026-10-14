import { useEffect, useMemo, useRef, useState } from "react";
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
import type { McpAddServerOption } from "./McpAddServer";
import { McpServerList } from "./McpServerList";
import { McpServersNoMatch, McpServersToolbar } from "./McpServersToolbar";
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
  const searchRef = useRef<HTMLInputElement | null>(null);
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
  const addOptions = [claude, codex].flatMap((model) => mcpAddServerOption(model) ?? []);
  const complete = [claude, codex].every(
    ({ state, snapshot }) => state.kind === "loaded" && snapshot?.result.truncated === false,
  );
  const clearQuery = (): void => {
    setQuery("");
    searchRef.current?.focus();
  };
  return (
    <div className="settings-stack">
      <McpServersToolbar
        addOptions={addOptions}
        inputRef={searchRef}
        onQueryChange={setQuery}
        query={query}
      />
      {filtering && noMatches && complete ? (
        <McpServersNoMatch onClear={clearQuery} query={query} />
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

function mcpAddServerOption(model: McpProviderModel): McpAddServerOption | null {
  const { management, names, provider, snapshot, target } = model;
  if (snapshot === null || management === null || target === null) return null;
  return { configuredNames: names, management, provider, target };
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

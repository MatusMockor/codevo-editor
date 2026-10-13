import { Puzzle } from "lucide-react";
import { useId, useMemo } from "react";
import type { AgentMcpServerManagementStore } from "../../../application/agentMcpServerManagementStore";
import type { AgentMcpServer } from "../../../domain/agentMcpServers";
import type { AgentMcpServersTarget } from "../../../domain/agentMcpServersTarget";
import type { AgentCliKind } from "../../../domain/agentTask";
import { McpServerRow, type McpServerTitleTag } from "./McpServerRow";
import {
  MCP_FROM_PLUGINS_TITLE,
  mcpFromPluginsNote,
  mcpServerLayout,
  type McpPluginSection,
  type McpServerEntry,
} from "./mcpServerGroupsPresentation";
import type { McpProjectPlace } from "./mcpServersPresentation";

export interface McpServerListProps {
  readonly management: AgentMcpServerManagementStore | null;
  readonly place: McpProjectPlace;
  readonly provider: AgentCliKind;
  readonly servers: ReadonlyArray<AgentMcpServer>;
  readonly target: AgentMcpServersTarget | null;
  onCopy(command: string): void;
}

type RowContext = Omit<McpServerListProps, "servers">;

export function McpServerList({ servers, ...context }: McpServerListProps) {
  const provider = context.provider;
  const layout = useMemo(() => mcpServerLayout(provider, servers), [provider, servers]);
  const headingId = `${useId()}-plugins`;
  return (
    <>
      <McpServerRows context={context} entries={layout.own} titleTag="h3" />
      {layout.plugins.length === 0 ? null : (
        <div aria-labelledby={headingId} className="settings-mcp-plugins" role="group">
          <div className="settings-mcp-plugins__head">
            <h3 className="settings-mcp-plugins__title" id={headingId}>
              {MCP_FROM_PLUGINS_TITLE}
            </h3>
            <p className="settings-row__description">
              {mcpFromPluginsNote(context.management === null ? "unsupported" : "supported")}
            </p>
          </div>
          {layout.plugins.map((section) => (
            <McpPluginServers context={context} key={section.key} section={section} />
          ))}
        </div>
      )}
    </>
  );
}

function McpPluginServers({
  context,
  section,
}: {
  readonly context: RowContext;
  readonly section: McpPluginSection;
}) {
  const headingId = `${useId()}-plugin`;
  return (
    <div
      aria-labelledby={headingId}
      className="settings-mcp-plugin"
      data-mcp-plugin={section.key}
      role="group"
    >
      <h4 className="settings-mcp-plugin__name" id={headingId}>
        <Puzzle aria-hidden="true" size={12} />
        {section.label}
      </h4>
      <McpServerRows context={context} entries={section.entries} titleTag="h5" />
    </div>
  );
}

function McpServerRows({
  context,
  entries,
  titleTag,
}: {
  readonly context: RowContext;
  readonly entries: ReadonlyArray<McpServerEntry>;
  readonly titleTag: McpServerTitleTag;
}) {
  return entries.map((entry) => (
    <McpServerRow
      key={entry.server.name}
      management={context.management}
      onCopy={context.onCopy}
      place={context.place}
      provider={context.provider}
      secondary={entry.secondary}
      server={entry.server}
      target={context.target}
      title={entry.title}
      titleTag={titleTag}
    />
  ));
}

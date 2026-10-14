import type { AgentMcpServerManagementSupport } from "../../../application/agentMcpServerManagementGateway";
import { agentMcpServerOrigin } from "../../../domain/agentMcpServerOrigin";
import type { AgentMcpServer } from "../../../domain/agentMcpServers";
import type { AgentCliKind } from "../../../domain/agentTask";
import { agentProviderLabel } from "../../agentMode/agentSidebarPresentation";
import {
  compareMcpNames,
  mcpPluginServerSecondaryText,
  mcpServerSecondaryText,
  mcpServerSignInHintCommand,
  mcpServerStatusLabel,
  mcpSignInLead,
  orderedMcpServers,
  type McpProjectPlace,
} from "./mcpServersPresentation";

export const MCP_FROM_PLUGINS_TITLE = "From plugins";
export const MCP_UNKNOWN_PLUGIN_LABEL = "Unknown plugin";

export interface McpServerEntry {
  readonly server: AgentMcpServer;
  readonly title: string;
  readonly secondary: string | null;
}

export interface McpPluginSection {
  readonly key: string;
  readonly label: string;
  readonly entries: ReadonlyArray<McpServerEntry>;
}

export interface McpServerLayout {
  readonly own: ReadonlyArray<McpServerEntry>;
  readonly plugins: ReadonlyArray<McpPluginSection>;
}

export interface McpServerSearchContext {
  readonly place: McpProjectPlace;
  readonly management: AgentMcpServerManagementSupport;
}

const UNKNOWN_PLUGIN_KEY = "unnamed";

export function mcpFromPluginsNote(support: AgentMcpServerManagementSupport): string {
  switch (support) {
    case "supported":
      return "These servers are installed by plugins. Sign in to them here; to remove one, remove its plugin.";
    case "unsupported":
      return "These servers are installed by plugins. To remove one, remove its plugin.";
    default: {
      const unreachable: never = support;
      return unreachable;
    }
  }
}

export function mcpServerLayout(
  provider: AgentCliKind,
  servers: ReadonlyArray<AgentMcpServer>,
): McpServerLayout {
  const own: Array<McpServerEntry> = [];
  const named = new Map<string, Array<McpServerEntry>>();
  const unnamed: Array<McpServerEntry> = [];
  for (const server of orderedMcpServers(servers)) {
    const origin = agentMcpServerOrigin(provider, server);
    switch (origin.kind) {
      case "own":
        own.push({ server, title: server.name, secondary: mcpServerSecondaryText(server) });
        break;
      case "plugin":
        pluginEntries(named, unnamed, origin.plugin).push({
          server,
          title: origin.shortName,
          secondary: mcpPluginServerSecondaryText(server),
        });
        break;
      default: {
        const unreachable: never = origin;
        return unreachable;
      }
    }
  }
  return { own, plugins: pluginSections(named, unnamed) };
}

export function filterMcpServerLayout(
  provider: AgentCliKind,
  layout: McpServerLayout,
  query: string,
  context: McpServerSearchContext,
): McpServerLayout {
  const normalizedQuery = normalizeMcpSearchText(query.trim());
  if (normalizedQuery === "") return layout;
  const providerLabel = agentProviderLabel(provider);
  const matches = (entry: McpServerEntry, labels: ReadonlyArray<string>): boolean => {
    const command = mcpServerSignInHintCommand(provider, entry.server, context.management);
    return [
      entry.server.name,
      entry.title,
      entry.secondary,
      entry.server.detail,
      mcpServerStatusLabel(entry.server.status),
      command === null ? null : `${mcpSignInLead(context.place)} ${command}`,
      ...labels,
    ].some((field) => field !== null && normalizeMcpSearchText(field).includes(normalizedQuery));
  };
  return {
    own: layout.own.filter((entry) => matches(entry, [providerLabel])),
    plugins: layout.plugins.flatMap((section) => {
      const entries = section.entries.filter((entry) =>
        matches(entry, [providerLabel, MCP_FROM_PLUGINS_TITLE, section.label]),
      );
      if (entries.length === 0) return [];
      return [{ ...section, entries }];
    }),
  };
}

export function mcpServerLayoutHasEntries(layout: McpServerLayout): boolean {
  return layout.own.length > 0 || layout.plugins.length > 0;
}

function normalizeMcpSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function pluginEntries(
  named: Map<string, Array<McpServerEntry>>,
  unnamed: Array<McpServerEntry>,
  plugin: string | null,
): Array<McpServerEntry> {
  if (plugin === null) return unnamed;
  const known = named.get(plugin);
  if (known !== undefined) return known;
  const entries: Array<McpServerEntry> = [];
  named.set(plugin, entries);
  return entries;
}

function pluginSections(
  named: ReadonlyMap<string, ReadonlyArray<McpServerEntry>>,
  unnamed: ReadonlyArray<McpServerEntry>,
): ReadonlyArray<McpPluginSection> {
  const sections = [...named.keys()]
    .sort(compareMcpNames)
    .map((plugin) => ({ key: `named:${plugin}`, label: plugin, entries: named.get(plugin) ?? [] }));
  if (unnamed.length === 0) return sections;
  return [
    ...sections,
    { key: UNKNOWN_PLUGIN_KEY, label: MCP_UNKNOWN_PLUGIN_LABEL, entries: unnamed },
  ];
}

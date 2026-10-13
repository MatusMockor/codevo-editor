import type { AgentMcpServer, AgentMcpServerScope } from "./agentMcpServers";
import type { AgentCliKind } from "./agentTask";

export type AgentMcpServerOrigin =
  | { readonly kind: "own" }
  | { readonly kind: "plugin"; readonly plugin: string | null; readonly shortName: string };

type OriginServer = Pick<AgentMcpServer, "name" | "scope">;
type PluginEvidence = "reported" | "named" | "none";

const OWN_ORIGIN: AgentMcpServerOrigin = Object.freeze({ kind: "own" });
const PLUGIN_NAME_PREFIX = "plugin";
const PLUGIN_NAME_SEPARATOR = ":";
const PLUGIN_NAME_PARTS = 3;

export function agentMcpServerOrigin(
  provider: AgentCliKind,
  server: OriginServer,
): AgentMcpServerOrigin {
  const evidence = pluginEvidence(provider, server.scope);
  if (evidence === "none") return OWN_ORIGIN;
  const named = namedPluginOrigin(server.name);
  if (named !== null) return named;
  if (evidence === "named") return OWN_ORIGIN;
  return Object.freeze({ kind: "plugin", plugin: null, shortName: server.name });
}

function pluginEvidence(provider: AgentCliKind, scope: AgentMcpServerScope): PluginEvidence {
  switch (scope) {
    case "plugin":
      return "reported";
    case "unknown":
      return unattributedEvidence(provider);
    case "user":
    case "project":
    case "local":
    case "account":
    case "managed":
      return "none";
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

function unattributedEvidence(provider: AgentCliKind): PluginEvidence {
  switch (provider) {
    case "claudeCode":
      return "named";
    case "codex":
      return "none";
    default: {
      const unreachable: never = provider;
      return unreachable;
    }
  }
}

function namedPluginOrigin(name: string): AgentMcpServerOrigin | null {
  const parts = name.split(PLUGIN_NAME_SEPARATOR);
  if (parts.length !== PLUGIN_NAME_PARTS) return null;
  const [prefix, plugin, shortName] = parts;
  if (prefix !== PLUGIN_NAME_PREFIX) return null;
  if (!isNamePart(plugin) || !isNamePart(shortName)) return null;
  return Object.freeze({ kind: "plugin", plugin, shortName });
}

function isNamePart(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && value === value.trim();
}

import {
  NO_AGENT_MCP_SERVER_HOSTS,
  type AgentMcpServerHost,
  type AgentMcpServerHosts,
} from "../../../application/agentMcpServerProjects";
import {
  agentMcpServersProjectKey,
  localAgentMcpServersProject,
  serverAgentMcpServersProject,
  type AgentMcpServersProject,
} from "../../../domain/agentMcpServersTarget";
import { MAX_AGENT_PROJECT_ROOTS, type AgentProjectDescriptor } from "../../../domain/agentProject";
import { agentCheckoutLabel } from "../../../domain/agentWorkspaceLocation";
import { normalizedWorkspaceRootKey, workspaceDisplayName } from "../../../domain/workspaceRootKey";

export const MAX_MCP_PROJECT_OPTIONS = MAX_AGENT_PROJECT_ROOTS + 1;
export const MAX_MCP_SERVER_PROJECT_OPTIONS = 64;
export const MCP_SERVER_PROJECTS_TRUNCATED_NOTICE = "Some server projects are not listed.";

export type McpProjectSource = Pick<AgentProjectDescriptor, "rootPath" | "label">;
export type McpProjectNoteTone = "neutral" | "problem";

export interface McpProjectOption {
  readonly key: string;
  readonly project: AgentMcpServersProject;
  readonly label: string;
  readonly name: string;
  readonly location: string;
}

export interface McpProjectNote {
  readonly serverId: string | null;
  readonly text: string;
  readonly tone: McpProjectNoteTone;
}

export type McpProjectSelection =
  | { readonly kind: "selected"; readonly option: McpProjectOption }
  | { readonly kind: "waiting" }
  | { readonly kind: "none" };

interface OptionSeed extends McpProjectOption {
  readonly distinction: string;
}

const NO_SELECTION: McpProjectSelection = Object.freeze({ kind: "none" });
const WAITING_SELECTION: McpProjectSelection = Object.freeze({ kind: "waiting" });

export function mcpProjectOptions(
  workspaceRoot: string | null,
  projects: ReadonlyArray<McpProjectSource>,
  servers: AgentMcpServerHosts = NO_AGENT_MCP_SERVER_HOSTS,
): ReadonlyArray<McpProjectOption> {
  const seeds = [
    ...localSeeds(workspaceRoot, projects),
    ...serverSeeds(servers).slice(0, MAX_MCP_SERVER_PROJECT_OPTIONS),
  ];
  return withDistinctLabels(seeds);
}

export function mcpProjectNotes(servers: AgentMcpServerHosts): ReadonlyArray<McpProjectNote> {
  const names = serverDisplayNames(servers);
  const notes = servers.hosts.flatMap((host) => hostNotes(host, names));
  if (!serverProjectsTruncated(servers)) return notes;
  return [
    ...notes,
    { serverId: null, text: MCP_SERVER_PROJECTS_TRUNCATED_NOTICE, tone: "neutral" },
  ];
}

export function mcpProjectSelection(
  options: ReadonlyArray<McpProjectOption>,
  chosen: AgentMcpServersProject | null,
  servers: AgentMcpServerHosts = NO_AGENT_MCP_SERVER_HOSTS,
): McpProjectSelection {
  const chosenKey = chosen === null ? null : agentMcpServersProjectKey(chosen);
  const match = options.find((option) => option.key === chosenKey);
  if (match !== undefined) return { kind: "selected", option: match };
  if (chosenServerIsLoading(chosen, servers)) return WAITING_SELECTION;
  const first = options[0];
  if (first === undefined) return NO_SELECTION;
  return { kind: "selected", option: first };
}

export function selectedMcpProjectKey(selection: McpProjectSelection): string | null {
  if (selection.kind !== "selected") return null;
  return selection.option.key;
}

function chosenServerIsLoading(
  chosen: AgentMcpServersProject | null,
  servers: AgentMcpServerHosts,
): boolean {
  if (chosen?.kind !== "server") return false;
  const host = servers.hosts.find((candidate) => candidate.server.id === chosen.serverId);
  return host?.inventory.kind === "idle" || host?.inventory.kind === "loading";
}

function localSeeds(
  workspaceRoot: string | null,
  projects: ReadonlyArray<McpProjectSource>,
): ReadonlyArray<OptionSeed> {
  const seeds = new Map<string, OptionSeed>();
  for (const candidate of localCandidates(workspaceRoot, projects)) {
    if (seeds.size >= MAX_MCP_PROJECT_OPTIONS) break;
    const project = localAgentMcpServersProject(candidate.rootPath);
    if (project === null) continue;
    const rootKey = normalizedWorkspaceRootKey(project.repositoryRoot);
    if (seeds.has(rootKey)) continue;
    seeds.set(rootKey, {
      key: agentMcpServersProjectKey(project),
      project,
      label: candidate.label,
      name: candidate.label,
      location: project.repositoryRoot,
      distinction: project.repositoryRoot,
    });
  }
  return [...seeds.values()];
}

function localCandidates(
  workspaceRoot: string | null,
  projects: ReadonlyArray<McpProjectSource>,
): ReadonlyArray<McpProjectSource> {
  if (workspaceRoot === null) return projects;
  const workspaceKey = normalizedWorkspaceRootKey(workspaceRoot);
  const own = projects.find(
    (candidate) => normalizedWorkspaceRootKey(candidate.rootPath) === workspaceKey,
  );
  const label = own?.label ?? workspaceDisplayName(workspaceRoot);
  return [{ rootPath: workspaceRoot, label }, ...projects];
}

function serverSeeds(servers: AgentMcpServerHosts): ReadonlyArray<OptionSeed> {
  const names = serverDisplayNames(servers);
  const seeds = new Map<string, OptionSeed>();
  for (const host of servers.hosts) {
    for (const seed of hostSeeds(host, names)) {
      if (!seeds.has(seed.key)) seeds.set(seed.key, seed);
    }
  }
  return [...seeds.values()];
}

function hostSeeds(
  { server, inventory }: AgentMcpServerHost,
  names: ReadonlyMap<string, string>,
): ReadonlyArray<OptionSeed> {
  if (inventory.kind !== "ready") return [];
  const serverName = names.get(server.id) ?? server.name;
  return inventory.projects.flatMap((listed) => {
    const project = serverAgentMcpServersProject({
      serverId: server.id,
      runnerId: inventory.runnerId,
      projectId: listed.id,
    });
    if (project === null) return [];
    return [
      {
        key: agentMcpServersProjectKey(project),
        project,
        label: `${listed.name} — ${serverName}`,
        name: listed.name,
        location: `${serverName} · ${agentCheckoutLabel("serverCheckout")}`,
        distinction: listed.id,
      },
    ];
  });
}

function serverDisplayNames(servers: AgentMcpServerHosts): ReadonlyMap<string, string> {
  const counts = new Map<string, number>();
  for (const { server } of servers.hosts)
    counts.set(server.name, (counts.get(server.name) ?? 0) + 1);
  return new Map(
    servers.hosts.map(({ server }) => {
      if ((counts.get(server.name) ?? 0) < 2) return [server.id, server.name];
      return [server.id, `${server.name} (${server.id})`];
    }),
  );
}

function hostNotes(
  { server, inventory }: AgentMcpServerHost,
  names: ReadonlyMap<string, string>,
): ReadonlyArray<McpProjectNote> {
  const serverName = names.get(server.id) ?? server.name;
  switch (inventory.kind) {
    case "idle":
      return [];
    case "ready":
      return staleNotes(server.id, serverName, inventory.stale);
    case "loading":
      return [{ serverId: server.id, text: `Loading projects on ${serverName}…`, tone: "neutral" }];
    case "failed":
      return [
        {
          serverId: server.id,
          text: `Could not load projects on ${serverName}. Check again to retry.`,
          tone: "problem",
        },
      ];
    default: {
      const unreachable: never = inventory;
      return unreachable;
    }
  }
}

function staleNotes(
  serverId: string,
  serverName: string,
  stale: boolean,
): ReadonlyArray<McpProjectNote> {
  if (!stale) return [];
  return [
    {
      serverId,
      text: `Could not refresh projects on ${serverName}. Check again to retry.`,
      tone: "problem",
    },
  ];
}

function serverProjectsTruncated(servers: AgentMcpServerHosts): boolean {
  if (servers.truncated) return true;
  if (serverSeeds(servers).length > MAX_MCP_SERVER_PROJECT_OPTIONS) return true;
  return servers.hosts.some(({ inventory }) => inventory.kind === "ready" && inventory.truncated);
}

function withDistinctLabels(seeds: ReadonlyArray<OptionSeed>): ReadonlyArray<McpProjectOption> {
  const counts = new Map<string, number>();
  for (const seed of seeds) counts.set(seed.label, (counts.get(seed.label) ?? 0) + 1);
  return seeds.map(({ distinction, ...option }) => {
    if ((counts.get(option.label) ?? 0) < 2) return option;
    return { ...option, label: `${option.label} (${distinction})` };
  });
}

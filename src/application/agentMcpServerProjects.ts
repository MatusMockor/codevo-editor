import { AGENT_MCP_SERVERS_RUNNER_CAPABILITY } from "../domain/agentMcpServersTarget";
import type { RemoteRunnerGateway, RemoteRunnerProject } from "../domain/remoteRunner";
import type { AgentMcpRunnerSupport, AgentMcpServersRunners } from "./agentMcpServersGateway";

export const MAX_AGENT_MCP_SERVER_HOSTS = 16;
export const MAX_AGENT_MCP_SERVER_HOST_PROJECTS = 64;

export type AgentMcpServerProjectsGateway = Pick<RemoteRunnerGateway, "getRunner" | "listProjects">;

export interface AgentMcpServerName {
  readonly id: string;
  readonly name: string;
}

export interface AgentMcpConnectedServer extends AgentMcpServerName {
  readonly connection: object;
}

export type AgentMcpServerInventory =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly runnerId: string;
      readonly supported: boolean;
      readonly projects: ReadonlyArray<RemoteRunnerProject>;
      readonly truncated: boolean;
      readonly stale: boolean;
    };

export interface AgentMcpServerHost {
  readonly server: AgentMcpServerName;
  readonly inventory: AgentMcpServerInventory;
}

export interface AgentMcpServerHosts {
  readonly hosts: ReadonlyArray<AgentMcpServerHost>;
  readonly truncated: boolean;
}

export interface AgentMcpServerProjects {
  state(): AgentMcpServerHosts;
  connect(servers: ReadonlyArray<AgentMcpConnectedServer>): void;
  load(): void;
  subscribe(listener: () => void): () => void;
}

interface Entry {
  readonly connection: object;
  host: AgentMcpServerHost;
  pending: Promise<void> | null;
}

export const NO_AGENT_MCP_SERVER_HOSTS: AgentMcpServerHosts = Object.freeze({
  hosts: Object.freeze([]),
  truncated: false,
});

const IDLE: AgentMcpServerInventory = Object.freeze({ kind: "idle" });
const LOADING: AgentMcpServerInventory = Object.freeze({ kind: "loading" });
const FAILED: AgentMcpServerInventory = Object.freeze({ kind: "failed" });

export class AgentMcpServerProjectsStore implements AgentMcpServerProjects, AgentMcpServersRunners {
  private readonly gateway: AgentMcpServerProjectsGateway | null;
  private readonly listeners = new Set<() => void>();
  private entries = new Map<string, Entry>();
  private truncated = false;
  private snapshot = NO_AGENT_MCP_SERVER_HOSTS;

  constructor(gateway: AgentMcpServerProjectsGateway | null) {
    this.gateway = gateway;
  }

  state(): AgentMcpServerHosts {
    return this.snapshot;
  }

  connect(servers: ReadonlyArray<AgentMcpConnectedServer>): void {
    if (this.gateway === null) return;
    const entries = new Map<string, Entry>();
    let truncated = false;
    for (const server of servers) {
      if (entries.has(server.id)) continue;
      truncated = entries.size >= MAX_AGENT_MCP_SERVER_HOSTS;
      if (truncated) break;
      entries.set(server.id, this.entryFor(server));
    }
    this.entries = entries;
    this.truncated = truncated;
    if (this.listeners.size > 0) this.read((entry) => entry.host.inventory.kind === "idle");
    this.publish();
  }

  load(): void {
    this.read(() => true);
    this.publish();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async confirm(serverId: string, runnerId: string): Promise<AgentMcpRunnerSupport> {
    await this.entries.get(serverId)?.pending;
    return this.support(serverId, runnerId);
  }

  support(serverId: string, runnerId: string): AgentMcpRunnerSupport {
    const inventory = this.entries.get(serverId)?.host.inventory;
    if (inventory?.kind !== "ready" || inventory.runnerId !== runnerId) return "unavailable";
    if (!inventory.supported) return "unsupported";
    return "supported";
  }

  private entryFor(server: AgentMcpConnectedServer): Entry {
    const known = this.entries.get(server.id);
    if (known?.connection !== server.connection)
      return { connection: server.connection, host: hostOf(server, IDLE), pending: null };
    if (known.host.server.name !== server.name) known.host = hostOf(server, known.host.inventory);
    return known;
  }

  private read(wanted: (entry: Entry) => boolean): void {
    const gateway = this.gateway;
    if (gateway === null) return;
    for (const [serverId, entry] of this.entries) {
      if (entry.pending !== null || !wanted(entry)) continue;
      if (entry.host.inventory.kind !== "ready") entry.host = hostOf(entry.host.server, LOADING);
      entry.pending = this.settle(gateway, serverId, entry);
    }
  }

  private async settle(
    gateway: AgentMcpServerProjectsGateway,
    serverId: string,
    entry: Entry,
  ): Promise<void> {
    const inventory = await readInventory(gateway, serverId);
    entry.pending = null;
    if (this.entries.get(serverId) !== entry) return;
    entry.host = hostOf(entry.host.server, settledInventory(entry.host.inventory, inventory));
    this.publish();
  }

  private publish(): void {
    const hosts = [...this.entries.values()].map((entry) => entry.host);
    if (sameHosts(this.snapshot, hosts, this.truncated)) return;
    this.snapshot = Object.freeze({ hosts: Object.freeze(hosts), truncated: this.truncated });
    for (const listener of [...this.listeners]) listener();
  }
}

async function readInventory(
  gateway: AgentMcpServerProjectsGateway,
  serverId: string,
): Promise<AgentMcpServerInventory> {
  try {
    const [runner, projects] = await Promise.all([
      gateway.getRunner({ serverId }),
      gateway.listProjects({ serverId }),
    ]);
    return Object.freeze({
      kind: "ready",
      runnerId: runner.runnerId,
      supported: runner.capabilities[AGENT_MCP_SERVERS_RUNNER_CAPABILITY] === true,
      projects: Object.freeze(projects.items.slice(0, MAX_AGENT_MCP_SERVER_HOST_PROJECTS)),
      truncated: projects.items.length > MAX_AGENT_MCP_SERVER_HOST_PROJECTS,
      stale: false,
    });
  } catch {
    return FAILED;
  }
}

function settledInventory(
  known: AgentMcpServerInventory,
  read: AgentMcpServerInventory,
): AgentMcpServerInventory {
  if (read.kind !== "failed" || known.kind !== "ready") return read;
  return Object.freeze({ ...known, stale: true });
}

function hostOf(
  server: AgentMcpServerName,
  inventory: AgentMcpServerInventory,
): AgentMcpServerHost {
  return Object.freeze({
    server: Object.freeze({ id: server.id, name: server.name }),
    inventory,
  });
}

function sameHosts(
  current: AgentMcpServerHosts,
  hosts: ReadonlyArray<AgentMcpServerHost>,
  truncated: boolean,
): boolean {
  if (current.truncated !== truncated || current.hosts.length !== hosts.length) return false;
  return hosts.every((host, index) => current.hosts[index] === host);
}

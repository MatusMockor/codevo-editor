import type { AgentMcpServersGateway } from "../application/agentMcpServersGateway";
import {
  parseAgentMcpServers,
  type AgentMcpServer,
  type AgentMcpServers,
  type AgentMcpServersRequest,
} from "../domain/agentMcpServers";
import type { AgentCliKind } from "../domain/agentTask";
import type { RemoteRunnerDescriptor, RemoteRunnerProject } from "../domain/remoteRunner";
import {
  REMOTE_RUNNER_COMMANDS,
  type InvokeRemoteRunnerCommand,
} from "../infrastructure/tauriRemoteRunnerGateway";

interface PendingAgentMcpServersCheck {
  readonly request: AgentMcpServersRequest;
  resolve(result: AgentMcpServers): void;
  reject(reason: unknown): void;
}

export class DeferredAgentMcpServersGateway implements AgentMcpServersGateway {
  readonly checks: Array<PendingAgentMcpServersCheck> = [];

  requests(): ReadonlyArray<AgentMcpServersRequest> {
    return this.checks.map((check) => check.request);
  }

  check(request: AgentMcpServersRequest): Promise<AgentMcpServers> {
    return new Promise((resolve, reject) => {
      this.checks.push({ request, resolve, reject });
    });
  }
}

export function agentMcpServersFixture(
  provider: AgentCliKind,
  servers: ReadonlyArray<Partial<AgentMcpServer> & { readonly name: string }>,
  truncated = false,
): AgentMcpServers {
  return parseAgentMcpServers({
    version: 1,
    provider,
    truncated,
    servers: servers.map((server) => ({
      status: "connected",
      scope: "user",
      transport: "stdio",
      endpointOrigin: null,
      toolCount: null,
      detail: null,
      ...server,
    })),
  });
}

interface PendingRunnerCall {
  readonly command: string;
  readonly request: unknown;
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

export class DeferredRunnerTunnel {
  readonly calls: Array<PendingRunnerCall> = [];
  private readonly open = new Set<PendingRunnerCall>();

  readonly invoke: InvokeRemoteRunnerCommand = (command, args) =>
    new Promise((resolve, reject) => {
      const call: PendingRunnerCall = {
        command,
        request: args?.request,
        resolve: (value) => {
          this.open.delete(call);
          resolve(value);
        },
        reject: (reason) => {
          this.open.delete(call);
          reject(reason);
        },
      };
      this.calls.push(call);
      this.open.add(call);
    });

  requests(command: string): ReadonlyArray<unknown> {
    return this.calls.filter((call) => call.command === command).map((call) => call.request);
  }

  checks(): ReadonlyArray<unknown> {
    return this.requests(REMOTE_RUNNER_COMMANDS.getMcpServers);
  }

  waiting(command: string): ReadonlyArray<PendingRunnerCall> {
    return [...this.open].filter((call) => call.command === command);
  }

  pending(command: string, serverId: string): ReadonlyArray<PendingRunnerCall> {
    return [...this.open].filter(
      (call) => call.command === command && requestField(call.request, "serverId") === serverId,
    );
  }

  serve(
    serverId: string,
    runner: RemoteRunnerDescriptor,
    projects: ReadonlyArray<RemoteRunnerProject>,
  ): void {
    for (const call of this.pending(REMOTE_RUNNER_COMMANDS.getRunner, serverId))
      call.resolve(runner);
    for (const call of this.pending(REMOTE_RUNNER_COMMANDS.listProjects, serverId))
      call.resolve({ items: projects });
  }

  refuse(serverId: string, reason: string): void {
    for (const call of this.pending(REMOTE_RUNNER_COMMANDS.getRunner, serverId))
      call.reject(reason);
    for (const call of this.pending(REMOTE_RUNNER_COMMANDS.listProjects, serverId))
      call.reject(reason);
  }

  pendingChecks(serverId: string, provider?: string): ReadonlyArray<PendingRunnerCall> {
    const pending = this.pending(REMOTE_RUNNER_COMMANDS.getMcpServers, serverId);
    if (provider === undefined) return pending;
    return pending.filter((call) => requestField(call.request, "provider") === provider);
  }
}

export function mcpRunnerFixture(
  runnerId: string,
  mcpServers: boolean | "absent" = true,
): RemoteRunnerDescriptor {
  return {
    protocolVersion: 1,
    runnerId,
    name: runnerId,
    capabilities: {
      taskExecution: true,
      eventReplay: true,
      ...(mcpServers === "absent" ? {} : { mcpServers }),
    },
  };
}

function requestField(request: unknown, field: "serverId" | "provider"): unknown {
  if (typeof request !== "object" || request === null) return null;
  return Object.entries(request).find(([key]) => key === field)?.[1] ?? null;
}

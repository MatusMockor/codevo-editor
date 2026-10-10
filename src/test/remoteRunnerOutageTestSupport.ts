import { vi } from "vitest";
import type {
  RemoteRunnerEvent,
  RemoteRunnerGateway,
  RemoteRunnerInventoryEvent,
  RemoteRunnerServer,
  RemoteRunnerServerInput,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import { remoteAgentThreadKey } from "../application/remoteAgentProjection";

const CREATED_AT = "2026-09-13T00:00:00Z";

export interface FakeRunnerHostOptions {
  readonly id: string;
  readonly name: string;
  readonly connected?: boolean;
  readonly runnerId?: string;
  readonly capabilities?: Readonly<Record<string, boolean>>;
}

export class FakeRunnerHost {
  up = true;
  runnerId: string;
  connected: boolean;
  failure: unknown = new Error("The runner is unreachable.");
  invalidHistory = false;
  tasks: RemoteRunnerTask[];
  private events: RemoteRunnerEvent[] = [];
  private sequence = 0;
  private readonly listeners = new Set<(event: RemoteRunnerInventoryEvent) => void>();

  constructor(readonly options: FakeRunnerHostOptions) {
    this.runnerId = options.runnerId ?? "runner";
    this.connected = options.connected ?? true;
    this.tasks = [
      {
        id: "first",
        runnerId: this.runnerId,
        sequence: 1,
        provider: "claude",
        projectId: "project",
        status: "running",
        launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
        parts: [{ type: "text", text: `Prompt on ${options.name}` }],
        createdAt: CREATED_AT,
      },
    ];
    this.output(`Answer from ${options.name}`);
  }

  get threadId(): string {
    return remoteAgentThreadKey(this.options.id, this.runnerId, "first");
  }

  get server(): RemoteRunnerServer {
    return {
      id: this.options.id,
      name: this.options.name,
      host: this.options.id,
      username: "codex",
      port: 22,
      connected: this.connected,
    };
  }

  output(text: string): void {
    this.assistant({ type: "text", text });
  }

  runCommand(command: string): void {
    this.assistant({
      type: "tool_use",
      id: `tool-${this.sequence + 1}`,
      name: "Bash",
      input: { command },
    });
  }

  emit(type: RemoteRunnerInventoryEvent["type"]): void {
    for (const listener of [...this.listeners]) listener({ type });
  }

  goDown(): void {
    this.up = false;
    this.emit("disconnected");
  }

  comeBack(): void {
    this.up = true;
    this.emit("connected");
  }

  interruptTasks(): void {
    this.tasks = this.tasks.map((task) => ({ ...task, status: "interrupted" }));
    this.append({ type: "task.interrupted" });
  }

  watch(listener: (event: RemoteRunnerInventoryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  reach<T>(respond: () => T): Promise<T> {
    if (!this.up) return Promise.reject(this.failure);
    return Promise.resolve(respond());
  }

  eventsAfter(after: number): readonly RemoteRunnerEvent[] {
    return this.events.filter((event) => event.sequence > after);
  }

  private assistant(content: Readonly<Record<string, unknown>>): void {
    this.append({
      type: "task.output",
      channel: "stdout",
      text: `${JSON.stringify({ type: "assistant", message: { content: [content] } })}\n`,
    });
  }

  private append(event: Pick<RemoteRunnerEvent, "type"> & Partial<RemoteRunnerEvent>): void {
    this.sequence += 1;
    this.events.push({ ...event, taskId: "first", sequence: this.sequence, createdAt: CREATED_AT });
  }
}

export function fakeRunnerFleetGateway(hosts: readonly FakeRunnerHost[]) {
  const host = (serverId: string): FakeRunnerHost => {
    const found = hosts.find((entry) => entry.options.id === serverId);
    if (found === undefined) return unknownHost;
    return found;
  };
  const spies = {
    collectInstructions: vi.fn().mockResolvedValue({ version: 1, files: [] }),
    listServers: vi.fn(async () => hosts.map((entry) => entry.server)),
    connectServer: vi.fn(async (input: RemoteRunnerServerInput) => {
      const target = host(input.id);
      await target.reach(() => undefined);
      target.connected = true;
      return target.server;
    }),
    disconnectServer: vi.fn(async ({ serverId }: { serverId: string }) => {
      host(serverId).connected = false;
    }),
    removeServer: vi.fn(),
    getRunner: vi.fn(({ serverId }: { serverId: string }) =>
      host(serverId).reach(() => ({
        protocolVersion: 1 as const,
        runnerId: host(serverId).runnerId,
        name: host(serverId).options.name,
        capabilities: {
          taskExecution: true,
          instructionSync: true,
          eventReplay: true,
          taskContinuation: true,
          taskLaunchOptions: true,
          ...host(serverId).options.capabilities,
        },
      })),
    ),
    listProjects: vi.fn(({ serverId }: { serverId: string }) =>
      host(serverId).reach(() => ({
        items: [{ id: "project", name: `${host(serverId).options.name} app` }],
      })),
    ),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn(({ serverId, after }: { serverId: string; after: number }) =>
      host(serverId).reach(() => ({
        items: host(serverId).invalidHistory
          ? host(serverId).tasks
          : host(serverId).tasks.filter((entry) => entry.sequence > after),
        nextCursor: null,
      })),
    ),
    createTask: vi.fn(),
    startTask: vi.fn(),
    getTask: vi.fn(({ serverId, taskId }: { serverId: string; taskId: string }) =>
      host(serverId).reach(() => host(serverId).tasks.find((entry) => entry.id === taskId)),
    ),
    getTaskResume: vi.fn(({ serverId }: { serverId: string }) =>
      host(serverId).reach(() => ({ available: true, reason: null })),
    ),
    continueTask: vi.fn(),
    cancelTask: vi.fn(),
    listEvents: vi.fn(({ serverId, after }: { serverId: string; after: number }) =>
      host(serverId).reach(() => ({ items: host(serverId).eventsAfter(after), nextCursor: null })),
    ),
    listPendingMessages: vi.fn(({ serverId }: { serverId: string }) =>
      host(serverId).reach(() => ({ items: [] })),
    ),
    enqueueMessage: vi.fn(),
    steerTask: vi.fn(),
    getDiff: vi.fn().mockResolvedValue({ diff: "", truncated: false }),
    uploadAttachment: vi.fn(),
    watchInventory: vi.fn(
      async (
        { serverId }: { serverId: string },
        listener: (event: RemoteRunnerInventoryEvent) => void,
      ) => host(serverId).watch(listener),
    ),
  };
  return { gateway: spies as unknown as RemoteRunnerGateway, spies };
}

const unknownHost = new FakeRunnerHost({ id: "unknown", name: "Unknown", connected: false });
unknownHost.up = false;

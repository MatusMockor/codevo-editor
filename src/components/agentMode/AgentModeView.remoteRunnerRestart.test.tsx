// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type {
  RemoteRunnerEvent,
  RemoteRunnerGateway,
  RemoteRunnerInventoryEvent,
  RemoteRunnerTask,
} from "../../domain/remoteRunner";
import type { AgentQuestionGateway } from "../../application/agentQuestionPorts";
import {
  AGENT_PENDING_REQUEST_FAILURE_NOTICE_THRESHOLD,
  AGENT_PENDING_REQUEST_POLL_MS,
} from "../../application/agentPendingRequestPolling";
import type { AgentQuestionRequest } from "../../domain/agentQuestion";
import { remoteAgentThreadKey } from "../../application/remoteAgentProjection";
import { workbenchAgentPaletteProvider } from "../../application/commandPalette/commandPaletteProvider";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { retryableLazy } from "../retryableLazy";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentModeView } from "./AgentModeView";
import { AGENT_SERVER_RECONNECTING_GRACE_MS } from "./agentServerReachabilityPresentation";
import { SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const THREAD_ID = remoteAgentThreadKey("linux", "runner", "first");
const CREATED_AT = "2026-09-13T00:00:00Z";
const QUESTION_NOTICE_AFTER_MS =
  (AGENT_PENDING_REQUEST_FAILURE_NOTICE_THRESHOLD + 1) * AGENT_PENDING_REQUEST_POLL_MS + 500;
const REMOTE_QUESTION: AgentQuestionRequest = {
  id: "q1",
  taskId: "first",
  provider: "claudeCode",
  status: "pending",
  questions: [
    {
      id: "question-0",
      header: "",
      prompt: "Which layout?",
      options: [{ id: "option-0", label: "Sidebar", description: "" }],
      multiple: false,
      allowCustom: true,
    },
  ],
};
const LazyAgentWorkspace = retryableLazy<ComponentProps<typeof AgentModeView>>(
  () => Promise.resolve({ default: AgentModeView }),
  "agent workspace",
);

interface RunnerOptions {
  readonly outputSteps: number;
  readonly backwardPaging: boolean;
  readonly interactiveQuestions?: boolean;
}

function claudeText(text: string): string {
  return `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } })}\n`;
}

const SERVER = {
  id: "linux",
  name: "Linux server",
  host: "linux",
  username: "codex",
  port: 22,
  connected: true,
};

class FakeRunner {
  up = true;
  questionCalls = 0;
  pendingQuestions: AgentQuestionRequest[] = [];
  tasks: RemoteRunnerTask[] = [
    {
      id: "first",
      runnerId: "runner",
      sequence: 1,
      provider: "claude",
      projectId: "project",
      status: "running",
      parts: [{ type: "text", text: "Long remote prompt" }],
      createdAt: CREATED_AT,
    },
  ];
  private events: RemoteRunnerEvent[] = [];
  private sequence = 0;
  private readonly listeners = new Set<(event: RemoteRunnerInventoryEvent) => void>();

  constructor(private readonly options: RunnerOptions) {
    for (let index = 0; index < options.outputSteps; index += 1)
      this.append({
        type: "task.output",
        channel: "stdout",
        text: claudeText(`step ${String(index).padStart(5, "0")} ${"x".repeat(2_000)}`),
      });
  }

  lifecycle(type: RemoteRunnerEvent["type"]): void {
    this.append({ type });
  }

  emit(type: RemoteRunnerInventoryEvent["type"]): void {
    for (const listener of [...this.listeners]) listener({ type });
  }

  questionGateway(): AgentQuestionGateway {
    const gateway = {
      list: () => {
        this.questionCalls += 1;
        return this.reach(() => this.pendingQuestions);
      },
      answer: vi.fn(),
      listApprovals: () => this.reach(() => []),
      answerApproval: vi.fn(),
    };
    return gateway;
  }

  gateway(): RemoteRunnerGateway {
    const gateway = {
      collectInstructions: vi.fn().mockResolvedValue({ version: 1, files: [] }),
      listServers: vi.fn().mockResolvedValue([SERVER]),
      connectServer: vi.fn(() => this.reach(() => SERVER)),
      disconnectServer: vi.fn(),
      removeServer: vi.fn(),
      getRunner: vi.fn(() =>
        this.reach(() => ({
          protocolVersion: 1,
          runnerId: "runner",
          name: "Linux server",
          capabilities: {
            taskExecution: true,
            instructionSync: true,
            eventReplay: true,
            taskContinuation: true,
            taskLaunchOptions: true,
            ...(this.options.backwardPaging ? { eventBackwardPaging: true } : {}),
            ...(this.options.interactiveQuestions ? { interactiveQuestions: true } : {}),
          },
        })),
      ),
      listProjects: vi.fn(() =>
        this.reach(() => ({ items: [{ id: "project", name: "Server app" }] })),
      ),
      cloneProject: vi.fn(),
      getProjectClone: vi.fn(),
      cancelProjectClone: vi.fn(),
      listTasks: vi.fn(({ after }: { after: number }) =>
        this.reach(() => ({
          items: this.tasks.filter((entry) => entry.sequence > after),
          nextCursor: null,
        })),
      ),
      createTask: vi.fn(),
      startTask: vi.fn(),
      getTask: vi.fn(({ taskId }: { taskId: string }) =>
        this.reach(() => this.tasks.find((entry) => entry.id === taskId)),
      ),
      getTaskResume: vi.fn(() => this.reach(() => ({ available: true, reason: null }))),
      continueTask: vi.fn(),
      cancelTask: vi.fn(),
      listEvents: vi.fn(({ after }: { after: number }) =>
        this.reach(() => {
          const newer = this.events.filter((event) => event.sequence > after);
          const items = newer.slice(0, 50);
          return {
            items,
            nextCursor: newer.length > items.length ? items[items.length - 1]!.sequence : null,
          };
        }),
      ),
      listEventsBefore: vi.fn(({ before }: { before: number }) =>
        this.reach(() => {
          const older = this.events.filter((event) => event.sequence < before);
          const items = older.slice(-50);
          return { items, nextCursor: items.length < older.length ? items[0]!.sequence : null };
        }),
      ),
      getDiff: vi.fn().mockResolvedValue({ diff: "", truncated: false }),
      uploadAttachment: vi.fn(),
      watchInventory: vi.fn(
        async (
          _request: { serverId: string },
          listener: (event: RemoteRunnerInventoryEvent) => void,
        ) => {
          this.listeners.add(listener);
          return () => {
            this.listeners.delete(listener);
          };
        },
      ),
    };
    return gateway as unknown as RemoteRunnerGateway;
  }

  private reach<T>(respond: () => T): Promise<T> {
    if (!this.up) return Promise.reject(new Error("The runner is unreachable."));
    return Promise.resolve(respond());
  }

  private append(event: Pick<RemoteRunnerEvent, "type"> & Partial<RemoteRunnerEvent>): void {
    this.sequence += 1;
    this.events.push({
      ...event,
      taskId: "first",
      sequence: this.sequence,
      createdAt: CREATED_AT,
    });
  }
}

describe("remote runner restart during a running turn", () => {
  let host: HTMLDivElement;
  let root: Root;
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    consoleError = vi.spyOn(console, "error");
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    consoleError.mockRestore();
    vi.restoreAllMocks();
  });

  async function mount(runner: FakeRunner, questionGateway: AgentQuestionGateway | null = null) {
    const gateway = runner.gateway();
    await act(async () =>
      root.render(
        <RemoteRunnerProvider gateway={gateway}>
          <LazyAgentWorkspace
            agents={{
              ...threadsSurfaceFixture(),
              providerManagement: unconfiguredAgentProviderManagement(),
            }}
            projects={[projectFixture()]}
            workspaceRoot={SURFACE_FIXTURE_ROOT}
            overflowRootPaths={[]}
            providerEnabled={{ claudeCode: true, codex: true }}
            chrome={chromeFixture()}
            questionGateway={questionGateway}
            onTrustProject={() => undefined}
            onReleaseProject={() => undefined}
            onOpenEnvironmentSettings={() => undefined}
          />
        </RemoteRunnerProvider>,
      ),
    );
    await openRemoteThread();
    return gateway;
  }

  async function openRemoteThread(): Promise<void> {
    await waitForReact(() => {
      const palette = workbenchAgentPaletteProvider.current();
      expect(palette?.projects.find((entry) => entry.label === "Server app")).toBeDefined();
    });
    const palette = workbenchAgentPaletteProvider.current();
    const project = palette!.projects.find((entry) => entry.label === "Server app")!;
    act(() => {
      palette!.switchProject(project.key);
    });
    await waitForReact(() =>
      expect(host.querySelector(`[data-thread-id="${THREAD_ID}"]`)).not.toBeNull(),
    );
    act(() =>
      host
        .querySelector(`[data-thread-id="${THREAD_ID}"]`)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await waitForReact(() => expect(threadSection() !== null || fallback() !== null).toBe(true));
  }

  function threadSection(): Element | null {
    return host.querySelector(`section[aria-label="Agent thread ${THREAD_ID}"]`);
  }

  async function settle(milliseconds: number): Promise<void> {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    });
  }

  function fallback(): string | null {
    const element = host.querySelector(".error-boundary-fallback");
    return element === null ? null : (element.textContent ?? "");
  }

  function lastRenderedStep(): string | null {
    const steps = (host.textContent ?? "").match(/step \d{5}/g);
    return steps?.[steps.length - 1] ?? null;
  }

  function updateDepthErrors(): string[] {
    return consoleError.mock.calls
      .map((args) =>
        args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "),
      )
      .filter((entry) => /Maximum update depth|Too many re-renders/.test(entry));
  }

  function restartRunner(runner: FakeRunner): void {
    runner.tasks = runner.tasks.map((task) => ({ ...task, status: "interrupted" }));
    runner.lifecycle("task.interrupted");
    runner.up = true;
    runner.emit("connected");
  }

  it("keeps the agent workspace mounted while a running remote turn cannot refresh its questions", async () => {
    const runner = new FakeRunner({
      outputSteps: 5,
      backwardPaging: false,
      interactiveQuestions: true,
    });
    await mount(runner, runner.questionGateway());
    await settle(400);
    expect(fallback()).toBeNull();
    expect(runner.questionCalls).toBeGreaterThan(0);

    runner.up = false;
    runner.emit("disconnected");
    await settle(700);
    const questionCallsAtOutage = runner.questionCalls;
    await settle(QUESTION_NOTICE_AFTER_MS);

    expect(fallback()).toBeNull();
    expect(threadSection()).not.toBeNull();
    expect(updateDepthErrors()).toEqual([]);
    expect(host.textContent).toContain("Linux server is reconnecting…");
    expect(host.textContent).not.toContain("Questions could not be refreshed. Reconnecting…");
    expect(runner.questionCalls).toBe(questionCallsAtOutage);

    restartRunner(runner);
    await settle(700);

    expect(fallback()).toBeNull();
    expect(host.textContent).toContain("The remote run ended before this turn finished.");
  }, 60_000);

  it("keeps the agent workspace mounted when a running remote turn asks a question", async () => {
    const runner = new FakeRunner({
      outputSteps: 5,
      backwardPaging: false,
      interactiveQuestions: true,
    });
    runner.pendingQuestions = [REMOTE_QUESTION];
    await mount(runner, runner.questionGateway());
    await settle(400);

    expect(fallback()).toBeNull();
    expect(updateDepthErrors()).toEqual([]);
    expect(host.textContent).toContain("Which layout?");
  }, 60_000);

  const scenarios = [
    { name: "short replay", outputSteps: 5, backwardPaging: true },
    { name: "truncated replay with backward paging", outputSteps: 2_000, backwardPaging: true },
  ] as const;

  it.each(scenarios)(
    "shows the unreachable runner and then the interrupted turn without question polling: $name",
    async ({ outputSteps, backwardPaging }) => {
      const runner = new FakeRunner({ outputSteps, backwardPaging });
      await mount(runner);
      await settle(400);
      expect(fallback()).toBeNull();
      expect(host.textContent).toContain("Working…");
      const renderedStep = lastRenderedStep();
      expect(renderedStep).not.toBeNull();

      runner.up = false;
      runner.emit("disconnected");
      await settle(700);

      expect(fallback()).toBeNull();
      expect(updateDepthErrors()).toEqual([]);
      expect(host.textContent).not.toContain("The runner is unreachable.");
      expect(host.textContent).not.toContain("Working…");
      expect(host.textContent).toContain("Waiting for Linux server…");
      expect(host.textContent).not.toContain("Linux server is reconnecting…");
      expect(host.textContent).toContain(renderedStep);

      await settle(AGENT_SERVER_RECONNECTING_GRACE_MS);

      expect(fallback()).toBeNull();
      expect(updateDepthErrors()).toEqual([]);
      expect(host.textContent).toContain("Linux server is reconnecting…");
      expect(host.textContent).toContain("Retry now");
      expect(host.textContent).toContain(renderedStep);

      restartRunner(runner);
      await settle(700);

      expect(fallback()).toBeNull();
      expect(updateDepthErrors()).toEqual([]);
      expect(host.textContent).not.toContain("The runner is unreachable.");
      expect(host.textContent).not.toContain("Linux server is reconnecting…");
      expect(host.textContent).not.toContain("Waiting for Linux server…");
      expect(host.textContent).toContain("The remote run ended before this turn finished.");
    },
    60_000,
  );
});

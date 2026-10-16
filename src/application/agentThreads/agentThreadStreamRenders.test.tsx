// @vitest-environment jsdom

import { act, memo, type ComponentType, type NamedExoticComponent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentTaskGateway,
  AgentTaskOutputEvent,
  AgentTaskStatusEvent,
  StartAgentTaskRequest,
} from "../../domain/agentTask";
import { defaultAppSettings, type AppSettings } from "../../domain/settings";
import { emptyGitStatus, type GitGateway } from "../../domain/git";
import {
  agentAppProviderGateway,
  renderAgentApp,
  settleAgentApp,
  unmountAgentAppHarnesses,
} from "../../test/agentAppTestHarness";
import { waitForReact } from "../../test/reactTestLifecycle";

const renders = vi.hoisted(() => ({
  app: 0,
  screen: 0,
  modeView: 0,
  rail: 0,
  composer: 0,
  transcript: 0,
}));

type RenderKey = keyof typeof renders;

function countedComponent<P extends object>(
  key: RenderKey,
  component: ComponentType<P> | NamedExoticComponent<P>,
): ComponentType<P> | NamedExoticComponent<P> {
  const exotic = component as unknown as {
    readonly type?: (props: P) => React.ReactNode;
    readonly compare?: ((previous: P, next: P) => boolean) | null;
  };
  if (typeof exotic.type === "function") {
    const inner = exotic.type;
    const Counted = (props: P) => {
      renders[key] += 1;
      return inner(props);
    };
    return memo(Counted, exotic.compare ?? undefined);
  }
  const render = component as (props: P) => React.ReactNode;
  return function Counted(props: P) {
    renders[key] += 1;
    return render(props);
  };
}

vi.mock("../agentApp/useAgentAppController", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agentApp/useAgentAppController")>();
  return {
    ...actual,
    useAgentAppController: (...args: Parameters<typeof actual.useAgentAppController>) => {
      renders.app += 1;
      return actual.useAgentAppController(...args);
    },
  };
});

vi.mock("../../components/agentMode/AgentWorkbenchScreen", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../components/agentMode/AgentWorkbenchScreen")>();
  return {
    ...actual,
    AgentWorkbenchScreen: countedComponent("screen", actual.AgentWorkbenchScreen),
  };
});

vi.mock("../../components/agentMode/AgentModeView", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/agentMode/AgentModeView")>();
  return { ...actual, AgentModeView: countedComponent("modeView", actual.AgentModeView) };
});

vi.mock("../../components/agentMode/AgentThreadsSidebar", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../components/agentMode/AgentThreadsSidebar")>();
  return {
    ...actual,
    AgentThreadsSidebar: countedComponent("rail", actual.AgentThreadsSidebar),
  };
});

vi.mock("../../components/agentMode/AgentComposerController", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../components/agentMode/AgentComposerController")>();
  return {
    ...actual,
    AgentComposerController: countedComponent("composer", actual.AgentComposerController),
  };
});

vi.mock("../../components/agentMode/AgentThreadSession", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../components/agentMode/AgentThreadSession")>();
  return {
    ...actual,
    AgentThreadSession: countedComponent("transcript", actual.AgentThreadSession),
  };
});

const STREAMED_FRAMES = 20;

const APP_SETTINGS: AppSettings = {
  ...defaultAppSettings(),
  agentCliPaths: { claudeCode: "/usr/local/bin/claude", codex: null },
  recentWorkspacePath: "/workspace-a",
  workspaceTabs: ["/workspace-a"],
};

let frames: Array<FrameRequestCallback> = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  unmountAgentAppHarnesses();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("agent thread streaming render isolation", () => {
  it("re-renders only the transcript of the streaming thread for each output frame", async () => {
    const tasks = fakeAgentTaskGateway();
    const app = await renderAgentApp({
      agentGateways: {
        agentProviderGateway: {
          ...agentAppProviderGateway(),
          probeAgentProviderHealth: async () => ({
            installedVersion: "1.0.0",
            auth: { kind: "unknown" },
            update: { kind: "checksDisabled" },
            checkedAtEpochMs: 1,
          }),
        },
        agentTaskGateway: tasks.gateway,
      },
      appSettings: APP_SETTINGS,
      gitGateway: cleanRepositoryGitGateway(),
      strictMode: false,
    });
    await waitForReact(() =>
      expect(app.host.querySelector("textarea#agent-prompt")).not.toBeNull(),
    );
    await settleAgentApp();

    await typePrompt(app.host, "Stream a long answer.");
    await waitForReact(async () => {
      await submitComposer(app.host);
      expect(tasks.started).toHaveLength(1);
    });
    await settleAgentApp();
    const turnId = tasks.started[0]?.taskId ?? "";
    await streamFrame(tasks, turnId, 1, assistantLine("first segment ", false));
    await waitForReact(() => expect(app.host.textContent).toContain("first segment"));

    for (const key of Object.keys(renders) as RenderKey[]) renders[key] = 0;
    for (let frame = 2; frame <= STREAMED_FRAMES + 1; frame += 1) {
      await streamFrame(tasks, turnId, frame, assistantLine(`chunk-${frame} `, frame % 2 === 0));
    }
    await settleAgentApp();

    expect(app.host.textContent).toContain(`chunk-${STREAMED_FRAMES + 1}`);
    const counts = { ...renders };
    console.info(`agent stream render counts over ${STREAMED_FRAMES} frames`, counts);
    expect(counts).toEqual({
      app: 0,
      screen: 0,
      modeView: 0,
      rail: 0,
      composer: 0,
      transcript: STREAMED_FRAMES,
    });

    for (const key of Object.keys(renders) as RenderKey[]) renders[key] = 0;
    await streamFrame(
      tasks,
      turnId,
      STREAMED_FRAMES + 2,
      claudeLine({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "ls" } }],
        },
      }),
    );
    await settleAgentApp();

    expect(renders.transcript).toBeGreaterThan(0);
    expect(renders.app).toBeGreaterThan(0);
    expect(renders.modeView).toBeGreaterThan(0);
  });
});

function assistantLine(text: string, withUsage: boolean): string {
  return claudeLine({
    type: "assistant",
    message: {
      model: "claude-test",
      content: [{ type: "text", text }],
      ...(withUsage ? { usage: { input_tokens: 1_000, output_tokens: 10 } } : {}),
    },
  });
}

function claudeLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

async function streamFrame(
  tasks: ReturnType<typeof fakeAgentTaskGateway>,
  taskId: string,
  sequence: number,
  chunk: string,
): Promise<void> {
  await act(async () => {
    tasks.emitOutput({ taskId, sequence, stream: "stdout", chunk, truncated: false });
    const pending = frames;
    frames = [];
    for (const callback of pending) callback(sequence * 16);
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  });
}

async function typePrompt(host: HTMLElement, value: string): Promise<void> {
  const textarea = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt");
  expect(textarea).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      value,
    );
    textarea?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitComposer(host: HTMLElement): Promise<void> {
  const form = host.querySelector("form");
  expect(form).not.toBeNull();
  await act(async () => {
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    for (let turn = 0; turn < 24; turn += 1) await Promise.resolve();
  });
}

function fakeAgentTaskGateway() {
  const started: StartAgentTaskRequest[] = [];
  const outputHandlers = new Set<(event: AgentTaskOutputEvent) => void>();
  const gateway: AgentTaskGateway = {
    startAgentTask: async (request) => {
      started.push(request);
      return { taskId: request.taskId };
    },
    acknowledgeAgentTaskStart: async () => undefined,
    stopAgentTask: async () => undefined,
    stopAgentTasksForRoot: async () => undefined,
    steerAgentTask: async () => ({ kind: "accepted" }) as const,
    closeAgentTaskInput: async () => undefined,
    subscribeAgentTaskStatus: async (_handler: (event: AgentTaskStatusEvent) => void) => () =>
      undefined,
    subscribeAgentTaskOutput: async (handler: (event: AgentTaskOutputEvent) => void) => {
      outputHandlers.add(handler);
      return () => {
        outputHandlers.delete(handler);
      };
    },
  };
  return {
    gateway,
    started,
    emitOutput(event: AgentTaskOutputEvent): void {
      for (const handler of [...outputHandlers]) handler(event);
    },
  };
}

function cleanRepositoryGitGateway(): GitGateway {
  const status = (rootPath: string) => ({
    ...emptyGitStatus(rootPath),
    branch: "main",
    isRepository: true,
  });
  return {
    branchList: vi.fn(async () => []),
    commit: vi.fn(async (rootPath: string) => status(rootPath)),
    createBranch: vi.fn(async () => undefined),
    currentBranch: vi.fn(async () => "main"),
    getDiff: vi.fn(async (_rootPath, change) => ({
      change,
      language: "plaintext",
      modifiedContent: "",
      originalContent: "",
    })),
    getStatus: vi.fn(async (rootPath: string) => status(rootPath)),
    push: vi.fn(async (rootPath: string) => status(rootPath)),
    stageFiles: vi.fn(async (rootPath: string) => status(rootPath)),
    switchBranch: vi.fn(async () => undefined),
  };
}

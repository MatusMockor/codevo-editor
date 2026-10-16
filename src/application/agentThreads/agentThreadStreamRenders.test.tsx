// @vitest-environment jsdom

import { act } from "react";
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
import { WORKBENCH_SURFACE_ENTER_CLASS } from "../../components/workbenchFrameBootContext";

const renders = vi.hoisted(() => ({
  app: 0,
  screen: 0,
  modeView: 0,
  localView: 0,
  railRegion: 0,
  headerRegion: 0,
  conversationRegion: 0,
  sessionRegion: 0,
  footerRegion: 0,
  overlaysRegion: 0,
  surfaceRegion: 0,
  rail: 0,
  composer: 0,
  transcript: 0,
}));

type RenderKey = keyof typeof renders;
type RenderCounts = Record<RenderKey, number>;

const MAX_SETTLE_PASSES = 40;

function renderDelta(before: RenderCounts): RenderCounts {
  const delta = { ...renders };
  for (const key of Object.keys(delta) as RenderKey[]) delta[key] -= before[key];
  return delta;
}

function zeroCounts(): RenderCounts {
  const zero = { ...renders };
  for (const key of Object.keys(zero) as RenderKey[]) zero[key] = 0;
  return zero;
}

function totalOf(deltas: ReadonlyArray<RenderCounts>): RenderCounts {
  const total = zeroCounts();
  for (const delta of deltas) {
    for (const key of Object.keys(total) as RenderKey[]) total[key] += delta[key];
  }
  return total;
}

async function settleUntilQuiet(): Promise<void> {
  let quietPasses = 0;
  for (let pass = 0; pass < MAX_SETTLE_PASSES && quietPasses < 2; pass += 1) {
    const before = { ...renders };
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      for (let turn = 0; turn < 24; turn += 1) await Promise.resolve();
    });
    const delta = renderDelta(before);
    quietPasses = Object.values(delta).every((count) => count === 0) ? quietPasses + 1 : 0;
  }
  expect(quietPasses).toBe(2);
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
  const support = await import("../../test/renderCounterTestSupport");
  const actual =
    await importOriginal<typeof import("../../components/agentMode/AgentWorkbenchScreen")>();
  return {
    ...actual,
    AgentWorkbenchScreen: support.countedComponent(renders, "screen", actual.AgentWorkbenchScreen),
  };
});

vi.mock("../../components/agentMode/AgentModeView", async (importOriginal) => {
  const support = await import("../../test/renderCounterTestSupport");
  const actual = await importOriginal<typeof import("../../components/agentMode/AgentModeView")>();
  return {
    ...actual,
    AgentModeView: support.countedComponent(renders, "modeView", actual.AgentModeView),
  };
});

vi.mock("../../components/agentMode/AgentThreadsSidebar", async (importOriginal) => {
  const support = await import("../../test/renderCounterTestSupport");
  const actual =
    await importOriginal<typeof import("../../components/agentMode/AgentThreadsSidebar")>();
  return {
    ...actual,
    AgentThreadsSidebar: support.countedComponent(renders, "rail", actual.AgentThreadsSidebar),
  };
});

vi.mock("../../components/agentMode/AgentComposerController", async (importOriginal) => {
  const support = await import("../../test/renderCounterTestSupport");
  const actual =
    await importOriginal<typeof import("../../components/agentMode/AgentComposerController")>();
  return {
    ...actual,
    AgentComposerController: support.countedComponent(
      renders,
      "composer",
      actual.AgentComposerController,
    ),
  };
});

vi.mock("../../components/agentMode/AgentThreadSession", async (importOriginal) => {
  const support = await import("../../test/renderCounterTestSupport");
  const actual =
    await importOriginal<typeof import("../../components/agentMode/AgentThreadSession")>();
  return {
    ...actual,
    AgentThreadSession: support.countedComponent(renders, "transcript", actual.AgentThreadSession),
  };
});

vi.mock("../../components/agentMode/modeView/AgentModeRail", async (importOriginal) => {
  const support = await import("../../test/renderCounterTestSupport");
  const actual =
    await importOriginal<typeof import("../../components/agentMode/modeView/AgentModeRail")>();
  return {
    ...actual,
    AgentModeRail: support.countedComponent(renders, "railRegion", actual.AgentModeRail),
  };
});

vi.mock("../../components/agentMode/modeView/AgentModeHeader", async (importOriginal) => {
  const support = await import("../../test/renderCounterTestSupport");
  const actual =
    await importOriginal<typeof import("../../components/agentMode/modeView/AgentModeHeader")>();
  return {
    ...actual,
    AgentModeHeader: support.countedComponent(renders, "headerRegion", actual.AgentModeHeader),
  };
});

vi.mock("../../components/agentMode/modeView/AgentModeConversation", async (importOriginal) => {
  const support = await import("../../test/renderCounterTestSupport");
  const actual =
    await importOriginal<
      typeof import("../../components/agentMode/modeView/AgentModeConversation")
    >();
  return {
    ...actual,
    AgentModeConversation: support.countedComponent(
      renders,
      "conversationRegion",
      actual.AgentModeConversation,
    ),
  };
});

vi.mock("../../components/agentMode/modeView/AgentModeThreadSession", async (importOriginal) => {
  const support = await import("../../test/renderCounterTestSupport");
  const actual =
    await importOriginal<
      typeof import("../../components/agentMode/modeView/AgentModeThreadSession")
    >();
  return {
    ...actual,
    AgentModeThreadSession: support.countedComponent(
      renders,
      "sessionRegion",
      actual.AgentModeThreadSession,
    ),
  };
});

vi.mock("../../components/agentMode/modeView/AgentModeThreadFooter", async (importOriginal) => {
  const support = await import("../../test/renderCounterTestSupport");
  const actual =
    await importOriginal<
      typeof import("../../components/agentMode/modeView/AgentModeThreadFooter")
    >();
  return {
    ...actual,
    AgentModeThreadFooter: support.countedComponent(
      renders,
      "footerRegion",
      actual.AgentModeThreadFooter,
    ),
  };
});

vi.mock("../../components/agentMode/modeView/AgentModeOverlays", async (importOriginal) => {
  const support = await import("../../test/renderCounterTestSupport");
  const actual =
    await importOriginal<typeof import("../../components/agentMode/modeView/AgentModeOverlays")>();
  return {
    ...actual,
    AgentModeOverlays: support.countedComponent(
      renders,
      "overlaysRegion",
      actual.AgentModeOverlays,
    ),
  };
});

vi.mock("../../components/agentMode/modeView/AgentModeSurfaceRegion", async (importOriginal) => {
  const support = await import("../../test/renderCounterTestSupport");
  const actual =
    await importOriginal<
      typeof import("../../components/agentMode/modeView/AgentModeSurfaceRegion")
    >();
  return {
    ...actual,
    AgentModeSurfaceRegion: support.countedComponent(
      renders,
      "surfaceRegion",
      actual.AgentModeSurfaceRegion,
    ),
  };
});

vi.mock("../../components/agentMode/modeView/useAgentModeProjects", async (importOriginal) => {
  const support = await import("../../test/renderCounterTestSupport");
  const actual =
    await importOriginal<
      typeof import("../../components/agentMode/modeView/useAgentModeProjects")
    >();
  return {
    ...actual,
    useAgentModeProjects: support.countedHook(renders, "localView", actual.useAgentModeProjects),
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
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("agent thread streaming render isolation", () => {
  it(
    "re-renders only the transcript of the streaming thread for each output frame",
    {
      timeout: 30_000,
    },
    async () => {
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
      await waitForReact(() =>
        expect(app.host.querySelector(`.${WORKBENCH_SURFACE_ENTER_CLASS}`)).toBeNull(),
      );
      await settleUntilQuiet();

      const perFrame: RenderCounts[] = [];
      for (let frame = 2; frame <= STREAMED_FRAMES + 1; frame += 1) {
        const before = { ...renders };
        await streamFrame(tasks, turnId, frame, assistantLine(`chunk-${frame} `, frame % 2 === 0));
        perFrame.push(renderDelta(before));
      }

      expect(app.host.textContent).toContain(`chunk-${STREAMED_FRAMES + 1}`);
      console.info(`agent stream render counts over ${STREAMED_FRAMES} frames`, totalOf(perFrame));
      expect(perFrame).toEqual(
        Array.from({ length: STREAMED_FRAMES }, () => ({ ...zeroCounts(), transcript: 1 })),
      );
      const afterBurst = { ...renders };
      await settleUntilQuiet();
      expect({ ...renderDelta(afterBurst), transcript: 0 }).toEqual(zeroCounts());

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
      expect(renders.localView).toBeGreaterThan(0);
    },
  );
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
    expect(pending).toHaveLength(1);
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

// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentLaunchOptions, ClaudeLaunchOptions } from "../domain/agentLaunch";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import type { AgentThreadStartRequest } from "./agentThreadPorts";
import { useRemoteAgentMutations } from "./useRemoteAgentMutations";

const target = { serverId: "s", runnerId: "r", projectId: "p" };
const continuationTarget = { ...target, conversationId: "t", latestTaskId: "t" };
const fixedWindow = {
  provider: "claudeCode",
  model: "claude-opus-5-5",
  mode: "bypassPermissions",
  effort: "high",
} as const satisfies ClaudeLaunchOptions;
const selectable = {
  ...fixedWindow,
  model: "claude-opus-4-6",
  context: "1m",
} as const satisfies ClaudeLaunchOptions;
const selectableAt200k = {
  ...selectable,
  context: "200k",
} as const satisfies ClaudeLaunchOptions;
const legacyRunnerEcho = (launch: ClaudeLaunchOptions): ClaudeLaunchOptions => ({
  ...launch,
  context: launch.context ?? "200k",
  fastMode: false,
  thinkingMode: false,
});
const startRequest = (launch: AgentLaunchOptions): AgentThreadStartRequest => ({
  projectRootKey: "",
  repositoryRoot: "",
  prompt: "hello",
  isolation: "worktree",
  unsafeInPlaceConfirmationKey: null,
  launch,
});
const task = (
  launch: AgentLaunchOptions,
  overrides: Partial<RemoteRunnerTask> = {},
): RemoteRunnerTask => ({
  id: "t",
  runnerId: "r",
  sequence: 1,
  provider: "claude",
  launch,
  projectId: "p",
  status: "queued",
  parts: [{ type: "text", text: "hello" }],
  createdAt: "now",
  ...overrides,
});
function gateway(echoed: AgentLaunchOptions) {
  return {
    collectInstructions: vi.fn().mockResolvedValue({ version: 1, files: [] }),
    listServers: vi.fn(),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi
      .fn()
      .mockResolvedValue({ runnerId: "r", capabilities: { instructionSync: true } }),
    listProjects: vi.fn(),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn(),
    createTask: vi.fn().mockResolvedValue({
      task: task(echoed, { status: "draft", projectId: undefined }),
      created: true,
    }),
    startTask: vi.fn().mockResolvedValue(task(echoed)),
    getTask: vi.fn().mockResolvedValue(task(echoed, { status: "succeeded" })),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn().mockResolvedValue({
      task: task(echoed, { id: "child", sequence: 2, parentTaskId: "t", conversationId: "t" }),
      created: true,
    }),
    cancelTask: vi.fn(),
    listEvents: vi.fn(),
    getDiff: vi.fn(),
    uploadAttachment: vi.fn(),
  } satisfies RemoteRunnerGateway;
}
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});
async function render(echoed: AgentLaunchOptions) {
  const gw = gateway(echoed);
  const root = createRoot(document.createElement("div"));
  const publish = vi.fn();
  const report = vi.fn();
  const owner = {};
  let surface!: ReturnType<typeof useRemoteAgentMutations>;
  function Harness() {
    surface = useRemoteAgentMutations({
      gateway: gw,
      owner,
      valid: (candidate) => candidate === owner,
      publish,
      report,
    });
    return null;
  }
  await act(async () => {
    root.render(createElement(Harness));
  });
  disposers.push(() => act(() => root.unmount()));
  return { gw, publish, report, current: () => surface };
}

describe("remote launch echo for Claude context windows", () => {
  it.each([
    ["omitted by the runner", fixedWindow],
    ["filled with 200k by an earlier runner", legacyRunnerEcho(fixedWindow)],
  ])("starts a fixed-window model whose context is %s", async (_name, echoed) => {
    const h = await render(echoed);
    await act(async () => {
      expect(await h.current().start(startRequest(fixedWindow), target)).toEqual(task(echoed));
    });
    const [wire] = vi.mocked<RemoteRunnerGateway["createTask"]>(h.gw.createTask).mock.calls[0]!;
    expect(wire.launch).toEqual(fixedWindow);
    expect(wire.launch).not.toHaveProperty("context");
    expect(h.gw.startTask).toHaveBeenCalledOnce();
    expect(h.publish).toHaveBeenCalledOnce();
    expect(h.report).not.toHaveBeenCalled();
  });

  it.each([
    ["omitted by the runner", fixedWindow],
    ["filled with 200k by an earlier runner", legacyRunnerEcho(fixedWindow)],
  ])("continues a fixed-window model whose context is %s", async (_name, echoed) => {
    const h = await render(echoed);
    await act(async () => {
      expect(
        await h
          .current()
          .followUp(
            { prompt: "hello", launch: fixedWindow, threadId: "display" },
            continuationTarget,
          ),
      ).not.toBeNull();
    });
    expect(h.publish).toHaveBeenCalledOnce();
    expect(h.report).not.toHaveBeenCalled();
  });

  it("starts a selectable model echoed with the chosen context", async () => {
    const h = await render(legacyRunnerEcho(selectable));
    await act(async () => {
      expect(await h.current().start(startRequest(selectable), target)).not.toBeNull();
    });
    expect(h.report).not.toHaveBeenCalled();
  });

  it.each([
    ["a different context for a selectable model", selectable, selectableAt200k],
    ["a 1m context the editor never sent", fixedWindow, { ...fixedWindow, context: "1m" }],
  ] as const)("rejects a draft echoed with %s", async (_name, sent, echoed) => {
    const h = await render(echoed);
    await act(async () => {
      expect(await h.current().start(startRequest(sent), target)).toBeNull();
    });
    expect(h.gw.startTask).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledWith(
      "Remote execution was not confirmed. The runner returned a different task draft. Retry the same message to recover it safely.",
    );
  });

  it("rejects a continuation echoed with a different context", async () => {
    const h = await render(selectableAt200k);
    await act(async () => {
      expect(
        await h
          .current()
          .followUp(
            { prompt: "hello", launch: selectable, threadId: "display" },
            continuationTarget,
          ),
      ).toBeNull();
    });
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledWith(
      "Remote execution was not confirmed. The runner returned a different remote task. Retry the same message to recover it safely.",
    );
  });
});

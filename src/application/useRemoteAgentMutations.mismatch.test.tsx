// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import type { AgentThreadStartRequest } from "./agentThreadPorts";
import {
  REMOTE_POSSIBLY_RUNNING_NOTICE,
  REMOTE_UNSTARTED_DRAFT_NOTICE,
  useRemoteAgentMutations,
} from "./useRemoteAgentMutations";

const target = { serverId: "s", runnerId: "r", projectId: "p" };
const continuationTarget = { ...target, conversationId: "t", latestTaskId: "t" };
const launch = { provider: "codex", model: "default", mode: "workspaceWrite" } as const;
const request: AgentThreadStartRequest = {
  projectRootKey: "",
  repositoryRoot: "",
  prompt: "hello",
  isolation: "worktree",
  unsafeInPlaceConfirmationKey: null,
  launch,
};
const followUp = { prompt: "hello", launch, threadId: "display" };
const task = (overrides: Partial<RemoteRunnerTask> = {}): RemoteRunnerTask => ({
  id: "t",
  runnerId: "r",
  sequence: 1,
  provider: "codex",
  launch,
  projectId: "p",
  status: "queued",
  parts: [{ type: "text", text: "hello" }],
  createdAt: "now",
  ...overrides,
});
const draft = (overrides: Partial<RemoteRunnerTask> = {}) =>
  task({ status: "draft", projectId: undefined, ...overrides });
const child = (overrides: Partial<RemoteRunnerTask> = {}) =>
  task({ id: "child", sequence: 2, parentTaskId: "t", conversationId: "t", ...overrides });
function gateway() {
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
    createTask: vi.fn().mockResolvedValue({ task: draft(), created: true }),
    startTask: vi.fn().mockResolvedValue(task()),
    getTask: vi.fn().mockResolvedValue(task({ status: "succeeded" })),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn().mockResolvedValue({ task: child(), created: true }),
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
async function render() {
  const gw = gateway();
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
const createKeys = (gw: ReturnType<typeof gateway>) =>
  vi
    .mocked<RemoteRunnerGateway["createTask"]>(gw.createTask)
    .mock.calls.map(([wire]) => wire.idempotencyKey);
const continueKeys = (gw: ReturnType<typeof gateway>) =>
  vi
    .mocked<RemoteRunnerGateway["continueTask"]>(gw.continueTask)
    .mock.calls.map(([wire]) => wire.idempotencyKey);

describe("a runner answer that does not match the sent message", () => {
  it("drops an unstarted mismatching draft so a changed message can be sent", async () => {
    const h = await render();
    h.gw.createTask.mockResolvedValueOnce({
      task: draft({ launch: { ...launch, mode: "readOnly" } }),
      created: true,
    });
    await act(async () => {
      expect(await h.current().start(request, target)).toBeNull();
    });
    expect(h.gw.startTask).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenLastCalledWith(
      `The runner returned a different task draft. ${REMOTE_UNSTARTED_DRAFT_NOTICE}`,
    );

    h.gw.createTask.mockResolvedValue({
      task: draft({ parts: [{ type: "text", text: "changed" }] }),
      created: true,
    });
    h.gw.startTask.mockResolvedValue(task({ parts: [{ type: "text", text: "changed" }] }));
    await act(async () => {
      expect(await h.current().start({ ...request, prompt: "changed" }, target)).not.toBeNull();
    });
    const keys = createKeys(h.gw);
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
    expect(h.publish).toHaveBeenCalledOnce();
  });

  it.each([
    ["an unconfirmed start", task({ id: "other" }), "The runner did not confirm the task start."],
    [
      "a started task with other settings",
      task({ launch: { ...launch, mode: "dangerFullAccess" } }),
      "The runner returned a different remote task.",
    ],
  ])(
    "reports %s as possibly running and lets another conversation start",
    async (_name, started, reason) => {
      const h = await render();
      h.gw.startTask.mockResolvedValueOnce(started);
      await act(async () => {
        expect(await h.current().start(request, target)).toBeNull();
      });
      expect(h.publish).not.toHaveBeenCalled();
      expect(h.report).toHaveBeenLastCalledWith(`${reason} ${REMOTE_POSSIBLY_RUNNING_NOTICE}`);

      h.gw.createTask.mockResolvedValue({
        task: draft({ id: "next", parts: [{ type: "text", text: "changed" }] }),
        created: true,
      });
      h.gw.startTask.mockResolvedValue(
        task({ id: "next", parts: [{ type: "text", text: "changed" }] }),
      );
      await act(async () => {
        expect(await h.current().start({ ...request, prompt: "changed" }, target)).not.toBeNull();
      });
      const keys = createKeys(h.gw);
      expect(keys).toHaveLength(2);
      expect(keys[1]).not.toBe(keys[0]);
    },
  );

  it("reports a mismatching continuation as possibly running and lets a changed follow-up through", async () => {
    const h = await render();
    const mismatched = child({ parts: [{ type: "text", text: "other" }] });
    h.gw.continueTask.mockResolvedValueOnce({ task: mismatched, created: true });
    await act(async () => {
      expect(await h.current().followUp(followUp, continuationTarget)).toBeNull();
    });
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenLastCalledWith(
      `The runner returned a different remote task. ${REMOTE_POSSIBLY_RUNNING_NOTICE}`,
    );

    h.gw.continueTask.mockResolvedValue({
      task: child({ parts: [{ type: "text", text: "changed" }] }),
      created: true,
    });
    await act(async () => {
      expect(
        await h.current().followUp({ ...followUp, prompt: "changed" }, continuationTarget),
      ).not.toBeNull();
    });
    const keys = continueKeys(h.gw);
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("reports a continuation the runner placed in another conversation as possibly running", async () => {
    const h = await render();
    h.gw.continueTask.mockResolvedValueOnce({
      task: child({ runnerId: "foreign", conversationId: "elsewhere" }),
      created: true,
    });
    await act(async () => {
      expect(await h.current().followUp(followUp, continuationTarget)).toBeNull();
    });
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenLastCalledWith(
      `The runner returned a different continuation. ${REMOTE_POSSIBLY_RUNNING_NOTICE}`,
    );
  });

  it("treats a mismatch after an uncertain start as possibly running", async () => {
    const h = await render();
    h.gw.startTask.mockRejectedValueOnce(new Error("disconnected"));
    await act(async () => {
      expect(await h.current().start(request, target)).toBeNull();
    });
    h.gw.createTask.mockResolvedValueOnce({ task: draft({ id: "other" }), created: false });
    await act(async () => {
      expect(await h.current().start(request, target)).toBeNull();
    });
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenLastCalledWith(
      `The runner returned a different task draft. ${REMOTE_POSSIBLY_RUNNING_NOTICE}`,
    );
  });
});

describe("an uncertain transport failure", () => {
  it.each(["createTask", "startTask"] as const)(
    "keeps the command after a lost %s answer and recovers it with the same key",
    async (stage) => {
      const h = await render();
      h.gw[stage].mockRejectedValueOnce(new Error("disconnected"));
      await act(async () => {
        expect(await h.current().start(request, target)).toBeNull();
      });
      expect(h.report).toHaveBeenLastCalledWith(
        "Remote execution was not confirmed. disconnected Retry the same message to recover it safely.",
      );
      await act(async () => {
        expect(await h.current().start({ ...request, prompt: "changed" }, target)).toBeNull();
      });
      expect(h.gw.createTask).toHaveBeenCalledTimes(1);
      await act(async () => {
        expect(await h.current().start(request, target)).toEqual(task());
      });
      const keys = createKeys(h.gw);
      expect(keys).toHaveLength(2);
      expect(keys[1]).toBe(keys[0]);
      expect(h.publish).toHaveBeenCalledOnce();
    },
  );

  it("keeps a continuation after a lost answer and recovers it with the same key", async () => {
    const h = await render();
    h.gw.continueTask.mockRejectedValueOnce(new Error("disconnected"));
    await act(async () => {
      expect(await h.current().followUp(followUp, continuationTarget)).toBeNull();
    });
    await act(async () => {
      expect(
        await h.current().followUp({ ...followUp, prompt: "changed" }, continuationTarget),
      ).toBeNull();
    });
    expect(h.gw.continueTask).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await h.current().followUp(followUp, continuationTarget)).toEqual(child());
    });
    const keys = continueKeys(h.gw);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });
});

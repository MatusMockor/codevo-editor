// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import type { AgentThreadStartRequest } from "./agentThreadPorts";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import { remoteAgentThreadKey } from "./remoteAgentProjection";
import {
  REMOTE_CONVERSATION_BUSY_NOTICE,
  REMOTE_ORIGIN_BASE_NEEDS_WORKTREE,
  REMOTE_ORIGIN_BASE_UNSUPPORTED,
  REMOTE_START_OBSERVER_FAILED_NOTICE,
  REMOTE_STOP_UNAPPLIED_NOTICE,
  useRemoteAgentMutations,
} from "./useRemoteAgentMutations";
const target = { serverId: "s", runnerId: "r", projectId: "p" };
const codexLaunch = { provider: "codex", model: "default", mode: "default" } as const;
const request: AgentThreadStartRequest = {
  projectRootKey: "",
  repositoryRoot: "",
  prompt: "hello",
  isolation: "worktree",
  unsafeInPlaceConfirmationKey: null,
  launch: codexLaunch,
};
const task = (overrides: Partial<RemoteRunnerTask> = {}): RemoteRunnerTask => ({
  id: "t",
  runnerId: "r",
  sequence: 1,
  provider: "codex",
  launch: request.launch,
  projectId: "p",
  status: "queued",
  parts: [{ type: "text", text: "hello" }],
  createdAt: "now",
  ...overrides,
});
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
    createTask: vi
      .fn()
      .mockResolvedValue({ task: task({ status: "draft", projectId: undefined }), created: true }),
    startTask: vi.fn().mockResolvedValue(task()),
    getTask: vi.fn().mockResolvedValue(task({ status: "succeeded" })),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn().mockResolvedValue({
      task: task({ id: "child", sequence: 2, parentTaskId: "t", conversationId: "t" }),
      created: true,
    }),
    cancelTask: vi.fn().mockResolvedValue(task({ status: "cancelled" })),
    listEvents: vi.fn(),
    getDiff: vi.fn(),
    uploadAttachment: vi.fn(),
  } satisfies RemoteRunnerGateway;
}
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});
async function render(
  gw = gateway(),
  resolveAttachments?: Parameters<typeof useRemoteAgentMutations>[0]["resolveAttachments"],
) {
  const root = createRoot(document.createElement("div"));
  const publish = vi.fn();
  const report = vi.fn();
  let owner = {};
  let surface!: ReturnType<typeof useRemoteAgentMutations>;
  function Harness() {
    surface = useRemoteAgentMutations({
      gateway: gw,
      owner,
      valid: (candidate) => candidate === owner,
      publish,
      report,
      resolveAttachments,
    });
    return null;
  }
  async function rerender() {
    await act(async () => {
      root.render(createElement(Harness));
    });
  }
  await rerender();
  disposers.push(() => act(() => root.unmount()));
  return {
    gw,
    publish,
    report,
    current: () => surface,
    replace: async () => {
      owner = {};
      await rerender();
    },
  };
}
describe("remote agent mutations", () => {
  it("creates and starts the original launch on the explicit remote project", async () => {
    const h = await render();
    await act(async () => {
      expect(await h.current().start(request, target)).toEqual(task());
    });
    expect(h.gw.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ launch: request.launch, provider: "codex" }),
    );
    expect(h.gw.startTask).toHaveBeenCalledWith({ serverId: "s", taskId: "t", projectId: "p" });
    expect(h.publish).toHaveBeenCalledOnce();
  });
  it("never puts the local browser flag on the wire for a remote runner", async () => {
    const claudeLaunch: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "sonnet",
      mode: "acceptEdits",
      effort: "high",
      context: "1m",
      chrome: false,
    };
    const wireLaunch: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "sonnet",
      mode: "acceptEdits",
      effort: "high",
      context: "1m",
    };
    const claudeTask = task({ provider: "claude", launch: wireLaunch });
    const gw = gateway();
    gw.createTask.mockResolvedValue({
      task: task({ provider: "claude", launch: wireLaunch, status: "draft", projectId: undefined }),
      created: true,
    });
    gw.startTask.mockResolvedValue(claudeTask);
    const h = await render(gw);

    await act(async () => {
      expect(await h.current().start({ ...request, launch: claudeLaunch }, target)).toEqual(
        claudeTask,
      );
    });

    const [wire] = vi.mocked<RemoteRunnerGateway["createTask"]>(h.gw.createTask).mock.calls[0] as [
      { readonly launch: AgentLaunchOptions },
    ];
    expect(wire.launch).not.toHaveProperty("chrome");
    expect(wire.launch).toEqual(wireLaunch);
    expect(h.report).not.toHaveBeenCalled();
  });
  it("reuses the exact request after unknown create failure and blocks changed intent", async () => {
    const h = await render();
    h.gw.createTask.mockRejectedValueOnce(new Error("disconnected"));
    await act(async () => {
      await h.current().start(request, target);
    });
    await act(async () => {
      await h.current().start({ ...request, prompt: "changed" }, target);
    });
    expect(h.gw.createTask).toHaveBeenCalledTimes(1);
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(vi.mocked<RemoteRunnerGateway["createTask"]>(h.gw.createTask).mock.calls[0]).toEqual(
      vi.mocked<RemoteRunnerGateway["createTask"]>(h.gw.createTask).mock.calls[1],
    );
  });
  it("recovers a lost start by idempotent create without another start", async () => {
    const h = await render();
    h.gw.startTask.mockRejectedValueOnce(new Error("disconnected"));
    await act(async () => {
      await h.current().start(request, target);
    });
    h.gw.createTask.mockResolvedValueOnce({ task: task(), created: false });
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(h.gw.startTask).toHaveBeenCalledTimes(1);
    expect(h.publish).toHaveBeenCalledOnce();
  });
  it.each(["create", "start", "continuation"])(
    "retries uncertain %s delivery when default Codex effort changes representation",
    async (stage) => {
      for (const explicitFirst of [false, true]) {
        const h = await render();
        h.gw[
          stage === "create" ? "createTask" : stage === "start" ? "startTask" : "continueTask"
        ].mockRejectedValueOnce(new Error("disconnected"));
        const omitted = codexLaunch;
        const explicit = { ...codexLaunch, effort: "default" } as const;
        const first = explicitFirst ? explicit : omitted;
        const second = explicitFirst ? omitted : explicit;
        const send = (launch: AgentLaunchOptions) =>
          stage === "continuation"
            ? h
                .current()
                .followUp(
                  { prompt: request.prompt, launch, threadId: "display" },
                  { ...target, conversationId: "t", latestTaskId: "t" },
                )
            : h.current().start({ ...request, launch }, target);
        await act(async () => {
          expect(await send(first)).toBeNull();
        });
        await act(async () => {
          expect(await send(second)).not.toBeNull();
        });
        const calls =
          stage === "continuation"
            ? h.gw.continueTask.mock.calls
            : vi.mocked<RemoteRunnerGateway["createTask"]>(h.gw.createTask).mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls[1]![0].idempotencyKey).toBe(calls[0]![0].idempotencyKey);
        expect(h.publish).toHaveBeenCalledOnce();
      }
    },
  );
  it.each(["create", "start", "continuation"])(
    "blocks a changed Codex effort while %s delivery is uncertain",
    async (stage) => {
      const h = await render();
      const original = { ...codexLaunch, effort: "high" } as const;
      h.gw.createTask.mockResolvedValue({
        task: task({ status: "draft", launch: original }),
        created: true,
      });
      h.gw.startTask.mockResolvedValue(task({ launch: original }));
      h.gw.continueTask.mockResolvedValue({
        task: task({ id: "child", parentTaskId: "t", conversationId: "t", launch: original }),
        created: true,
      });
      h.gw[
        stage === "create" ? "createTask" : stage === "start" ? "startTask" : "continueTask"
      ].mockRejectedValueOnce(new Error("disconnected"));
      const send = (launch: AgentLaunchOptions) =>
        stage === "continuation"
          ? h
              .current()
              .followUp(
                { prompt: request.prompt, launch, threadId: "display" },
                { ...target, conversationId: "t", latestTaskId: "t" },
              )
          : h.current().start({ ...request, launch }, target);
      await act(async () => {
        expect(await send(original)).toBeNull();
      });
      await act(async () => {
        expect(await send({ ...original, effort: "low" })).toBeNull();
      });
      const mutation = stage === "continuation" ? h.gw.continueTask : h.gw.createTask;
      expect(mutation).toHaveBeenCalledTimes(1);
      expect(h.publish).not.toHaveBeenCalled();
      await act(async () => {
        expect(await send(original)).not.toBeNull();
      });
      expect(mutation).toHaveBeenCalledTimes(2);
      expect(h.publish).toHaveBeenCalledOnce();
    },
  );
  it("retries uncertain continuation without invalidating it through newer-turn preflight", async () => {
    const h = await render();
    h.gw.continueTask.mockRejectedValueOnce(new Error("disconnected"));
    const follow = { prompt: "hello", launch: request.launch, threadId: "display" };
    const destination = { ...target, conversationId: "t", latestTaskId: "t" };
    await act(async () => {
      await h.current().followUp(follow, destination);
    });
    await act(async () => {
      await h.current().followUp(follow, { ...destination, latestTaskId: "child" });
    });
    expect(h.gw.getTaskResume).toHaveBeenCalledTimes(1);
    expect(h.gw.continueTask.mock.calls[0]).toEqual(h.gw.continueTask.mock.calls[1]);
    expect(h.publish).toHaveBeenCalledOnce();
  });
  it("blocks foreign parent before continuation", async () => {
    const h = await render();
    h.gw.getTask.mockResolvedValueOnce(task({ runnerId: "foreign" }));
    await act(async () => {
      await h
        .current()
        .followUp(
          { ...request, threadId: "display" },
          { ...target, conversationId: "t", latestTaskId: "t" },
        );
    });
    expect(h.gw.continueTask).not.toHaveBeenCalled();
  });
  it("rejects stale creation before starting or publishing", async () => {
    const h = await render();
    let resolve!: (value: { task: RemoteRunnerTask; created: boolean }) => void;
    h.gw.createTask.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let operation!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      operation = h.current().start(request, target);
    });
    await h.replace();
    await act(async () => {
      resolve({ task: task({ status: "draft" }), created: true });
      await operation;
    });
    expect(h.gw.startTask).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("retains uploaded parts on uncertain retry", async () => {
    const upload = vi.fn().mockResolvedValue([{ type: "attachment", attachmentId: "image" }]);
    const h = await render(gateway(), upload);
    h.gw.createTask.mockRejectedValue(new Error("disconnected"));
    const imageRequest = {
      ...request,
      attachments: [
        {
          kind: "reference" as const,
          path: "/image.png",
          name: "image.png",
          bytes: 10,
          entry: "file" as const,
        },
      ],
    };
    await act(async () => {
      await h.current().start(imageRequest, target);
    });
    await act(async () => {
      await h.current().start(imageRequest, target);
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(vi.mocked<RemoteRunnerGateway["createTask"]>(h.gw.createTask).mock.calls[0]).toEqual(
      vi.mocked<RemoteRunnerGateway["createTask"]>(h.gw.createTask).mock.calls[1],
    );
  });
  it.each(["draft", "start"])("rejects foreign root lineage from %s", async (stage) => {
    const h = await render();
    if (stage === "draft")
      h.gw.createTask.mockResolvedValueOnce({
        task: task({ status: "draft", conversationId: "foreign" }),
        created: true,
      });
    else h.gw.startTask.mockResolvedValueOnce(task({ parentTaskId: "foreign" }));
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("rejects an omitted or different launch echo", async () => {
    const h = await render();
    h.gw.createTask.mockResolvedValueOnce({
      task: task({ status: "draft", launch: undefined }),
      created: true,
    });
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(h.gw.startTask).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });
  it.each(["draft", "start", "continuation"])(
    "rejects a Codex effort mismatch from %s",
    async (stage) => {
      const h = await render();
      const launch: AgentLaunchOptions = { ...codexLaunch, effort: "high" };
      const otherLaunch: AgentLaunchOptions = { ...codexLaunch, effort: "low" };
      if (stage === "draft") {
        h.gw.createTask.mockResolvedValueOnce({
          task: task({ status: "draft", launch: otherLaunch }),
          created: true,
        });
      } else if (stage === "start") {
        h.gw.createTask.mockResolvedValueOnce({
          task: task({ status: "draft", launch }),
          created: true,
        });
        h.gw.startTask.mockResolvedValueOnce(task({ launch: otherLaunch }));
      } else {
        h.gw.continueTask.mockResolvedValueOnce({
          task: task({
            id: "child",
            sequence: 2,
            parentTaskId: "t",
            conversationId: "t",
            launch: otherLaunch,
          }),
          created: true,
        });
      }
      await act(async () => {
        const result =
          stage === "continuation"
            ? await h
                .current()
                .followUp(
                  { ...request, launch, threadId: "display" },
                  { ...target, conversationId: "t", latestTaskId: "t" },
                )
            : await h.current().start({ ...request, launch }, target);
        expect(result).toBeNull();
      });
      if (stage === "draft") expect(h.gw.startTask).not.toHaveBeenCalled();
      expect(h.publish).not.toHaveBeenCalled();
      expect(h.report).toHaveBeenCalledWith(expect.stringContaining("different"));
    },
  );
  it.each([undefined, "default"] as const)(
    "accepts the semantic Codex default effort when the request uses %s",
    async (effort) => {
      const h = await render();
      const launch: AgentLaunchOptions = { ...codexLaunch, effort };
      const echo: AgentLaunchOptions = {
        ...codexLaunch,
        ...(effort === undefined ? { effort: "default" as const } : {}),
      };
      h.gw.createTask.mockResolvedValueOnce({
        task: task({ status: "draft", launch: echo }),
        created: true,
      });
      h.gw.startTask.mockResolvedValueOnce(task({ launch: echo }));
      h.gw.continueTask.mockResolvedValueOnce({
        task: task({ id: "child", parentTaskId: "t", conversationId: "t", launch: echo }),
        created: true,
      });
      await act(async () => {
        expect(await h.current().start({ ...request, launch }, target)).not.toBeNull();
      });
      await act(async () => {
        expect(
          await h
            .current()
            .followUp(
              { ...request, launch, threadId: "display" },
              { ...target, conversationId: "t", latestTaskId: "t" },
            ),
        ).not.toBeNull();
      });
      expect(h.report).not.toHaveBeenCalled();
      expect(h.publish).toHaveBeenCalledTimes(2);
    },
  );
  it("preserves authoritative rejection details and permits corrected intent", async () => {
    const h = await render();
    const rejection = "Runner request failed (HTTP 400): Unsupported Codex effort ultra.";
    h.gw.createTask.mockRejectedValueOnce(new RemoteRunnerRequestRejectedError(rejection));
    await act(async () => {
      expect(
        await h
          .current()
          .start({ ...request, launch: { ...codexLaunch, effort: "ultra" } }, target),
      ).toBeNull();
    });
    expect(h.report).toHaveBeenLastCalledWith(rejection);
    await act(async () => {
      expect(await h.current().start({ ...request, launch: request.launch }, target)).toEqual(
        task(),
      );
    });
    expect(h.gw.createTask).toHaveBeenCalledTimes(2);
  });
  it.each(["create", "start", "continuation"])(
    "preserves the actual failure detail when %s delivery is uncertain",
    async (stage) => {
      const h = await render();
      h.gw[
        stage === "create" ? "createTask" : stage === "start" ? "startTask" : "continueTask"
      ].mockRejectedValueOnce(new Error("Server disconnected before confirmation."));
      await act(async () => {
        if (stage === "continuation")
          await h
            .current()
            .followUp(
              { ...request, threadId: "display" },
              { ...target, conversationId: "t", latestTaskId: "t" },
            );
        else await h.current().start(request, target);
      });
      expect(h.report).toHaveBeenLastCalledWith(
        expect.stringContaining("Server disconnected before confirmation."),
      );
      expect(h.report).toHaveBeenLastCalledWith(
        expect.stringContaining("Retry the same message to recover it safely."),
      );
    },
  );
  it.each(["x".repeat(1001), { detail: "private" }])(
    "uses a safe fallback for an unbounded or unknown uncertain failure",
    async (failure) => {
      const h = await render();
      h.gw.createTask.mockRejectedValueOnce(failure);
      await act(async () => {
        await h.current().start(request, target);
      });
      expect(h.report).toHaveBeenLastCalledWith(
        "Remote execution was not confirmed. Remote execution failed. Retry the same message to recover it safely.",
      );
    },
  );
  it("bounds the complete uncertain notice including its retry guidance", async () => {
    const h = await render();
    h.gw.createTask.mockRejectedValueOnce(new Error("x".repeat(1000)));
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(h.report).toHaveBeenLastCalledWith(
      "Remote execution was not confirmed. Retry the same message to recover it safely.",
    );
  });
  it("rejects foreign cancellation lineage", async () => {
    const h = await render();
    h.gw.cancelTask.mockResolvedValueOnce(task({ status: "cancelled", conversationId: "foreign" }));
    await act(async () => {
      await h.current().stop({ ...target, conversationId: "t", latestTaskId: "t" });
    });
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("serializes mutations and verifies stop ownership", async () => {
    const h = await render();
    h.gw.getTask.mockResolvedValueOnce(task({ projectId: "foreign" }));
    await act(async () => {
      await h.current().stop({ ...target, conversationId: "t", latestTaskId: "t" });
    });
    expect(h.gw.cancelTask).not.toHaveBeenCalled();
  });
});

const instructionSnapshot = (content: string) => ({
  version: 1 as const,
  files: [{ scope: "global" as const, path: "CLAUDE.md", content }],
});
const claudeRequest: AgentThreadStartRequest = {
  ...request,
  launch: { provider: "claudeCode", model: "default", mode: "default", effort: "high" },
};
function synchronizingGateway() {
  const gw = gateway();
  const claudeTask = (overrides: Partial<RemoteRunnerTask> = {}) =>
    task({ provider: "claude", launch: claudeRequest.launch, ...overrides });
  gw.createTask.mockResolvedValue({
    task: claudeTask({ status: "draft", projectId: undefined }),
    created: true,
  });
  gw.startTask.mockResolvedValue(claudeTask());
  gw.getTask.mockResolvedValue(claudeTask({ status: "succeeded" }));
  gw.continueTask.mockResolvedValue({
    task: claudeTask({ id: "child", sequence: 2, parentTaskId: "t", conversationId: "t" }),
    created: true,
  });
  gw.getRunner.mockResolvedValue({ runnerId: "r", capabilities: { instructionSync: true } });
  return { ...gw, collectInstructions: vi.fn().mockResolvedValue(instructionSnapshot("first")) };
}
describe("automatic instruction snapshots", () => {
  const request = claudeRequest;
  it("collects fresh rules on each confirmed send but pins rules across uncertain retries", async () => {
    const gw = synchronizingGateway();
    gw.createTask.mockRejectedValueOnce(new Error("connection lost"));
    const h = await render(gw);
    await act(async () => {
      await h.current().start(request, target);
    });
    const first = vi.mocked<RemoteRunnerGateway["createTask"]>(gw.createTask).mock.calls[0]?.[0];
    gw.collectInstructions.mockResolvedValue(instructionSnapshot("edited"));
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(vi.mocked<RemoteRunnerGateway["createTask"]>(gw.createTask).mock.calls[1]?.[0]).toEqual(
      first,
    );
    expect(gw.collectInstructions).toHaveBeenCalledTimes(1);
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(gw.collectInstructions).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked<RemoteRunnerGateway["createTask"]>(gw.createTask).mock.calls[2]?.[0],
    ).toMatchObject({ instructions: instructionSnapshot("edited") });
  });
  it.each(["Cannot read rules", "x".repeat(2000), { detail: "private" }])(
    "handles native instruction failures safely: %s",
    async (failure) => {
      const gw = synchronizingGateway();
      gw.collectInstructions.mockRejectedValue(failure);
      const h = await render(gw);
      await act(async () => {
        await h.current().start(request, target);
      });
      expect(gw.createTask).not.toHaveBeenCalled();
      expect(h.report).toHaveBeenCalledWith(
        failure === "Cannot read rules" ? failure : "Remote execution failed.",
      );
    },
  );
  it("does not dispatch when collecting fails or the server lacks support", async () => {
    const gw = synchronizingGateway();
    gw.collectInstructions.mockRejectedValue(new Error("Cannot read rules"));
    const h = await render(gw);
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(gw.createTask).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledWith("Cannot read rules");
    gw.getRunner.mockResolvedValue({ runnerId: "r", capabilities: {} });
    gw.collectInstructions.mockClear();
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(gw.collectInstructions).not.toHaveBeenCalled();
    expect(gw.createTask).not.toHaveBeenCalled();
  });
  it("revokes a collected snapshot when the workspace owner changes", async () => {
    const gw = synchronizingGateway();
    let resolve!: (value: ReturnType<typeof instructionSnapshot>) => void;
    gw.collectInstructions.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const h = await render(gw);
    let sending!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      sending = h.current().start(request, target);
    });
    await h.replace();
    await act(async () => {
      resolve(instructionSnapshot("stale"));
      await sending;
    });
    expect(gw.createTask).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("includes fresh instructions in a continuation", async () => {
    const gw = synchronizingGateway();
    const h = await render(gw);
    await act(async () => {
      await h
        .current()
        .followUp(
          { threadId: "thread", prompt: request.prompt, launch: request.launch },
          { ...target, latestTaskId: "t", conversationId: "t" },
        );
    });
    expect(gw.continueTask).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: instructionSnapshot("first") }),
    );
  });
});

it("sends Codex starts and continuations without collecting rules or requiring runner support", async () => {
  const gw = gateway();
  gw.getRunner.mockResolvedValue({ runnerId: "r", capabilities: {} });
  gw.collectInstructions.mockRejectedValue(new Error("must not collect"));
  const h = await render(gw);
  await act(async () => {
    expect(await h.current().start(request, target)).not.toBeNull();
  });
  await act(async () => {
    expect(
      await h
        .current()
        .followUp(
          { threadId: "thread", prompt: request.prompt, launch: request.launch },
          { ...target, latestTaskId: "t", conversationId: "t" },
        ),
    ).not.toBeNull();
  });
  expect(gw.collectInstructions).not.toHaveBeenCalled();
  expect(gw.getRunner).toHaveBeenCalledTimes(1);
  expect(
    vi.mocked<RemoteRunnerGateway["createTask"]>(gw.createTask).mock.calls[0]?.[0],
  ).not.toHaveProperty("instructions");
  expect(
    vi.mocked<RemoteRunnerGateway["continueTask"]>(gw.continueTask).mock.calls[0]?.[0],
  ).not.toHaveProperty("instructions");
});

describe("remote checkout isolation", () => {
  it("rejects in-place on legacy runners before creating a task", async () => {
    const h = await render();
    await act(async () => {
      expect(await h.current().start({ ...request, isolation: "in-place" }, target)).toBeNull();
    });
    expect(h.gw.createTask).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledWith(expect.stringContaining("Update the server runner"));
  });
  it("sends the selected mode to capable runners and rejects mismatched drafts", async () => {
    const gw = gateway();
    gw.getRunner.mockResolvedValue({
      runnerId: "r",
      capabilities: { instructionSync: true, taskIsolation: true },
    });
    const h = await render(gw);
    await act(async () => {
      expect(await h.current().start({ ...request, isolation: "in-place" }, target)).toBeNull();
    });
    expect(gw.createTask).toHaveBeenCalledWith(expect.objectContaining({ isolation: "in-place" }));
    expect(gw.startTask).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("starts in-place and freezes the mode during an uncertain retry", async () => {
    const gw = gateway();
    gw.getRunner.mockResolvedValue({
      runnerId: "r",
      capabilities: { instructionSync: true, taskIsolation: true },
    });
    gw.createTask.mockRejectedValueOnce(new Error("timeout"));
    gw.createTask.mockResolvedValue({
      task: task({ isolation: "in-place", status: "draft" }),
      created: true,
    });
    gw.startTask.mockResolvedValue(task({ isolation: "in-place" }));
    const h = await render(gw);
    await act(async () => {
      await h.current().start({ ...request, isolation: "in-place" }, target);
    });
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(gw.createTask).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await h.current().start({ ...request, isolation: "in-place" }, target)).toEqual(
        task({ isolation: "in-place" }),
      );
    });
    expect(gw.getRunner).toHaveBeenCalledTimes(1);
    expect(gw.createTask.mock.calls[0]).toEqual(gw.createTask.mock.calls[1]);
  });
  it("rejects continuation responses changing the parent isolation", async () => {
    const gw = gateway();
    gw.getTask.mockResolvedValue(task({ isolation: "in-place", status: "succeeded" }));
    const h = await render(gw);
    await act(async () => {
      expect(
        await h
          .current()
          .followUp(
            { ...request, threadId: "thread" },
            { ...target, latestTaskId: "t", conversationId: "t" },
          ),
      ).toBeNull();
    });
    expect(h.publish).not.toHaveBeenCalled();
  });
});

describe("per-conversation remote run control", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
      resolve = settle;
    });
    return { promise, resolve };
  }

  it("sends Stop for one conversation while another conversation is still starting", async () => {
    const h = await render();
    const created = deferred<{ task: RemoteRunnerTask; created: boolean }>();
    h.gw.createTask.mockReturnValueOnce(created.promise);
    let starting!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      starting = h.current().start(request, target, "new:remote-project");
    });
    expect(h.current().busyKeys).toEqual(new Set(["new:remote-project"]));
    expect(h.current().busy).toBe(true);

    h.gw.getTask.mockResolvedValueOnce(task({ id: "other", status: "running" }));
    h.gw.cancelTask.mockResolvedValueOnce(task({ id: "other", status: "cancelled" }));
    await act(async () => {
      await h.current().stop({ ...target, conversationId: "other", latestTaskId: "other" });
    });
    expect(h.gw.cancelTask).toHaveBeenCalledWith({ serverId: "s", taskId: "other" });

    await act(async () => {
      created.resolve({ task: task({ status: "draft", projectId: undefined }), created: true });
      await starting;
    });
    expect(h.current().busyKeys.size).toBe(0);
    expect(h.current().busy).toBe(false);
  });

  it("applies a Stop pressed during a continuation to the task it creates", async () => {
    const h = await render();
    const continued = deferred<{ task: RemoteRunnerTask; created: boolean }>();
    h.gw.continueTask.mockReturnValueOnce(continued.promise);
    const destination = { ...target, conversationId: "t", latestTaskId: "t" };
    let sending!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      sending = h
        .current()
        .followUp(
          { prompt: "hello", launch: request.launch, threadId: "display" },
          destination,
          "display",
        );
    });
    await vi.waitFor(() => expect(h.gw.continueTask).toHaveBeenCalledTimes(1));
    expect(h.current().busyKeys).toEqual(new Set(["display"]));
    await act(async () => {
      await h.current().stop(destination);
    });
    expect(h.gw.cancelTask).not.toHaveBeenCalled();

    const child = task({ id: "child", sequence: 2, parentTaskId: "t", conversationId: "t" });
    h.gw.getTask.mockResolvedValueOnce(child);
    h.gw.cancelTask.mockResolvedValueOnce({ ...child, status: "cancelled" });
    await act(async () => {
      continued.resolve({ task: child, created: true });
      await sending;
    });
    expect(h.gw.cancelTask).toHaveBeenCalledWith({ serverId: "s", taskId: "child" });
    expect(h.report).not.toHaveBeenCalled();
  });

  it("tells the user when a Stop recorded during an unconfirmed continuation cannot be applied", async () => {
    const h = await render();
    let failContinuation!: (error: Error) => void;
    h.gw.continueTask.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failContinuation = reject;
      }),
    );
    const destination = { ...target, conversationId: "t", latestTaskId: "t" };
    let sending!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      sending = h
        .current()
        .followUp(
          { prompt: "hello", launch: request.launch, threadId: "display" },
          destination,
          "display",
        );
    });
    await vi.waitFor(() => expect(h.gw.continueTask).toHaveBeenCalledTimes(1));
    await act(async () => {
      await h.current().stop({ ...destination, latestTaskId: undefined });
      failContinuation(new Error("disconnected"));
      expect(await sending).toBeNull();
    });
    expect(h.gw.cancelTask).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenLastCalledWith(REMOTE_STOP_UNAPPLIED_NOTICE);
  });

  it("refuses a second send to the same conversation with a visible notice", async () => {
    const h = await render();
    const created = deferred<{ task: RemoteRunnerTask; created: boolean }>();
    h.gw.createTask.mockReturnValueOnce(created.promise);
    let starting!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      starting = h.current().start(request, target);
    });
    await act(async () => {
      expect(await h.current().start(request, target)).toBeNull();
    });
    expect(h.report).toHaveBeenCalledWith(REMOTE_CONVERSATION_BUSY_NOTICE);
    await act(async () => {
      created.resolve({ task: task({ status: "draft", projectId: undefined }), created: true });
      await starting;
    });
  });
});

describe("remote agent start base", () => {
  const withGitSync = (gitSync: boolean | undefined) => {
    const gw = gateway();
    gw.getRunner.mockResolvedValue({
      runnerId: "r",
      capabilities: { instructionSync: true, taskIsolation: true, gitSync },
    });
    return gw;
  };

  it("sends the origin base only when the runner announces gitSync", async () => {
    const h = await render(withGitSync(true));
    await act(async () => {
      await h
        .current()
        .start(request, target, undefined, { kind: "origin-branch", branch: "feature/x" });
    });
    expect(h.gw.startTask).toHaveBeenCalledWith({
      serverId: "s",
      taskId: "t",
      projectId: "p",
      base: { kind: "origin-branch", branch: "feature/x" },
    });
    expect(h.report).not.toHaveBeenCalled();
  });

  it("keeps the legacy start body when no base is chosen", async () => {
    const h = await render(withGitSync(true));
    await act(async () => {
      await h.current().start(request, target);
    });
    expect(h.gw.startTask).toHaveBeenCalledWith({ serverId: "s", taskId: "t", projectId: "p" });
  });

  it("omits the checkout-head base for a runner without gitSync", async () => {
    const h = await render(withGitSync(undefined));
    await act(async () => {
      await h.current().start(request, target, undefined, { kind: "checkout-head" });
    });
    expect(h.gw.startTask).toHaveBeenCalledWith({ serverId: "s", taskId: "t", projectId: "p" });
  });

  it("refuses an origin base on a runner without gitSync before creating a task", async () => {
    const h = await render(withGitSync(false));
    await act(async () => {
      expect(
        await h
          .current()
          .start(request, target, undefined, { kind: "origin-branch", branch: "main" }),
      ).toBeNull();
    });
    expect(h.gw.createTask).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledWith(REMOTE_ORIGIN_BASE_UNSUPPORTED);
  });

  it("refuses an origin base for the server checkout", async () => {
    const h = await render(withGitSync(true));
    await act(async () => {
      await h.current().start({ ...request, isolation: "in-place" }, target, undefined, {
        kind: "origin-branch",
        branch: "main",
      });
    });
    expect(h.gw.createTask).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledWith(REMOTE_ORIGIN_BASE_NEEDS_WORKTREE);
  });

  it("rejects a malformed base before any runner call", async () => {
    const h = await render(withGitSync(true));
    await act(async () => {
      await h
        .current()
        .start(request, target, undefined, { kind: "origin-branch", branch: "+refs/heads/main" });
    });
    expect(h.gw.getRunner).not.toHaveBeenCalled();
    expect(h.gw.createTask).not.toHaveBeenCalled();
  });

  it("retries an unconfirmed start with the original base only", async () => {
    const h = await render(withGitSync(true));
    h.gw.startTask.mockRejectedValueOnce(new Error("disconnected"));
    const base = { kind: "origin-branch", branch: "main" } as const;
    await act(async () => {
      expect(await h.current().start(request, target, undefined, base)).toBeNull();
    });
    await act(async () => {
      expect(
        await h
          .current()
          .start(request, target, undefined, { kind: "origin-branch", branch: "other" }),
      ).toBeNull();
    });
    expect(h.gw.startTask).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(
        await h
          .current()
          .start(request, target, undefined, { branch: "main", kind: "origin-branch" }),
      ).toEqual(task());
    });
    expect(h.gw.startTask).toHaveBeenLastCalledWith({
      serverId: "s",
      taskId: "t",
      projectId: "p",
      base,
    });
  });
});

describe("remote agent start identification", () => {
  const threadKey = remoteAgentThreadKey("s", "r", "t");

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  it("identifies the unified thread key once the draft is created, before the start responds", async () => {
    const h = await render();
    const created = deferred<{ task: RemoteRunnerTask; created: boolean }>();
    const started = deferred<RemoteRunnerTask>();
    h.gw.createTask.mockReturnValueOnce(created.promise);
    h.gw.startTask.mockReturnValueOnce(started.promise);
    const onThreadIdentified = vi.fn();
    let starting!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      starting = h.current().start({ ...request, onThreadIdentified }, target);
    });
    await vi.waitFor(() => expect(h.gw.createTask).toHaveBeenCalledTimes(1));
    expect(onThreadIdentified).not.toHaveBeenCalled();

    await act(async () => {
      created.resolve({ task: task({ status: "draft", projectId: undefined }), created: true });
    });
    await vi.waitFor(() => expect(h.gw.startTask).toHaveBeenCalledTimes(1));
    expect(onThreadIdentified).toHaveBeenCalledTimes(1);
    expect(onThreadIdentified).toHaveBeenCalledWith(threadKey);
    expect(h.publish).not.toHaveBeenCalled();

    await act(async () => {
      started.resolve(task());
      expect(await starting).toEqual(task());
    });
    expect(onThreadIdentified).toHaveBeenCalledTimes(1);
    expect(h.publish).toHaveBeenCalledOnce();
  });

  it("identifies a retried start from its retained draft before asking the runner again", async () => {
    const h = await render();
    h.gw.startTask.mockRejectedValueOnce(new Error("disconnected"));
    const first = vi.fn();
    await act(async () => {
      expect(await h.current().start({ ...request, onThreadIdentified: first }, target)).toBeNull();
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(threadKey);

    const recreated = deferred<{ task: RemoteRunnerTask; created: boolean }>();
    h.gw.createTask.mockReturnValueOnce(recreated.promise);
    const retried = vi.fn();
    let retrying!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      retrying = h.current().start({ ...request, onThreadIdentified: retried }, target);
    });
    await vi.waitFor(() => expect(h.gw.createTask).toHaveBeenCalledTimes(2));
    expect(retried).toHaveBeenCalledTimes(1);
    expect(retried).toHaveBeenCalledWith(threadKey);

    await act(async () => {
      recreated.resolve({ task: task(), created: false });
      expect(await retrying).toEqual(task());
    });
    expect(retried).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(h.gw.startTask).toHaveBeenCalledTimes(1);
  });

  it("never identifies a thread when no draft is confirmed", async () => {
    const rejected = await render();
    rejected.gw.createTask.mockRejectedValueOnce(new Error("disconnected"));
    const onRejected = vi.fn();
    await act(async () => {
      expect(
        await rejected.current().start({ ...request, onThreadIdentified: onRejected }, target),
      ).toBeNull();
    });
    expect(onRejected).not.toHaveBeenCalled();

    const mismatched = await render();
    mismatched.gw.createTask.mockResolvedValueOnce({
      task: task({ status: "draft", runnerId: "other" }),
      created: true,
    });
    const onMismatched = vi.fn();
    await act(async () => {
      expect(
        await mismatched.current().start({ ...request, onThreadIdentified: onMismatched }, target),
      ).toBeNull();
    });
    expect(onMismatched).not.toHaveBeenCalled();

    const stale = await render();
    const created = deferred<{ task: RemoteRunnerTask; created: boolean }>();
    stale.gw.createTask.mockReturnValueOnce(created.promise);
    const onStale = vi.fn();
    let operation!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      operation = stale.current().start({ ...request, onThreadIdentified: onStale }, target);
    });
    await stale.replace();
    await act(async () => {
      created.resolve({ task: task({ status: "draft" }), created: true });
      await operation;
    });
    expect(onStale).not.toHaveBeenCalled();
  });

  it("never identifies a thread for a continuation", async () => {
    const h = await render();
    const onThreadIdentified = vi.fn();
    const followUp = { prompt: "hello", launch: request.launch, threadId: "display" };
    await act(async () => {
      await h
        .current()
        .followUp(
          Object.assign(followUp, { onThreadIdentified }),
          { ...target, conversationId: "t", latestTaskId: "t" },
          "display",
        );
    });
    expect(h.gw.continueTask).toHaveBeenCalledTimes(1);
    expect(onThreadIdentified).not.toHaveBeenCalled();
  });

  it("returns and publishes the started task when the identification observer throws", async () => {
    const h = await render();
    const onThreadIdentified = vi.fn(() => {
      throw new Error("observer failed");
    });
    await act(async () => {
      expect(await h.current().start({ ...request, onThreadIdentified }, target)).toEqual(task());
    });
    expect(onThreadIdentified).toHaveBeenCalledTimes(1);
    expect(h.gw.startTask).toHaveBeenCalledExactlyOnceWith({
      serverId: "s",
      taskId: "t",
      projectId: "p",
    });
    expect(h.publish).toHaveBeenCalledExactlyOnceWith("s", task());
    expect(h.report).toHaveBeenCalledExactlyOnceWith(REMOTE_START_OBSERVER_FAILED_NOTICE);

    await act(async () => {
      expect(await h.current().start(request, target)).toEqual(task());
    });
    expect(h.gw.createTask).toHaveBeenCalledTimes(2);
    expect(h.gw.createTask.mock.calls[1]?.[0].idempotencyKey).not.toBe(
      h.gw.createTask.mock.calls[0]?.[0].idempotencyKey,
    );
  });

  it("honours a Stop pressed during the start when the identification observer throws", async () => {
    const h = await render();
    const started = deferred<RemoteRunnerTask>();
    h.gw.startTask.mockReturnValueOnce(started.promise);
    h.gw.getTask.mockResolvedValueOnce(task());
    const onThreadIdentified = vi.fn(() => {
      throw new Error("observer failed");
    });
    let starting!: Promise<RemoteRunnerTask | null>;
    await act(async () => {
      starting = h.current().start({ ...request, onThreadIdentified }, target);
    });
    await vi.waitFor(() => expect(h.gw.startTask).toHaveBeenCalledTimes(1));
    expect(onThreadIdentified).toHaveBeenCalledTimes(1);
    await act(async () => {
      await h.current().stop(target);
    });
    expect(h.gw.cancelTask).not.toHaveBeenCalled();

    await act(async () => {
      started.resolve(task());
      expect(await starting).toEqual(task());
    });
    expect(h.publish).toHaveBeenCalledWith("s", task());
    expect(h.gw.cancelTask).toHaveBeenCalledExactlyOnceWith({ serverId: "s", taskId: "t" });
    expect(h.report).toHaveBeenCalledExactlyOnceWith(REMOTE_START_OBSERVER_FAILED_NOTICE);
  });

  it("keeps the start alive when reporting the observer failure fails too", async () => {
    const h = await render();
    h.report.mockImplementationOnce(() => {
      throw new Error("report failed");
    });
    const onThreadIdentified = vi.fn(() => {
      throw new Error("observer failed");
    });
    await act(async () => {
      expect(await h.current().start({ ...request, onThreadIdentified }, target)).toEqual(task());
    });
    expect(h.publish).toHaveBeenCalledExactlyOnceWith("s", task());
    expect(h.report).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { surfaceThreadView } from "../components/agentMode/agentSurfaceTestFixtures";
import type {
  RemoteRunnerGateway,
  RemoteRunnerPendingMessage,
  RemoteRunnerPart,
} from "../domain/remoteRunner";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import { emptyRemoteInventory } from "./remoteAgentInventoryLoad";
import type { RemotePendingUpdate } from "./useRemoteAgentInventory";
import { useRemotePendingMessages } from "./useRemotePendingMessages";

const launch = { provider: "codex", model: "default", mode: "default" } as const;
const request = { threadId: "agt-1", prompt: "Next step", launch };
const pending = (
  overrides: Partial<RemoteRunnerPendingMessage> = {},
): RemoteRunnerPendingMessage => ({
  id: "pending-1",
  conversationId: "conversation",
  status: "queued",
  parts: [{ type: "text", text: request.prompt }],
  launch,
  createdAt: "2026-09-15T00:00:00Z",
  taskId: null,
  ...overrides,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  vi.unstubAllGlobals();
});
function setup(items: readonly RemoteRunnerPendingMessage[] = []) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const gateway = {
    listServers: vi.fn(),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi.fn(),
    listProjects: vi.fn(),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn(),
    createTask: vi.fn(),
    startTask: vi.fn(),
    getTask: vi.fn(),
    getTaskResume: vi.fn(),
    continueTask: vi.fn(),
    cancelTask: vi.fn(),
    listEvents: vi.fn(),
    getDiff: vi.fn(),
    uploadAttachment: vi.fn(),
    enqueueMessage: vi.fn().mockResolvedValue({ pending: pending(), created: true }),
    cancelPendingMessage: vi.fn().mockResolvedValue(pending({ status: "cancelled" })),
    resumePendingMessages: vi.fn().mockResolvedValue({ items: [pending()] }),
  } satisfies RemoteRunnerGateway;
  const published =
    vi.fn<(serverId: string, threadId: string, items: RemotePendingUpdate) => void>();
  const applyPublished = (current: readonly RemoteRunnerPendingMessage[]) => {
    const update = published.mock.calls[published.mock.calls.length - 1]?.[2];
    if (update === undefined) throw new Error("No queue update was published");
    return typeof update === "function" ? update(current) : update;
  };
  let options: Parameters<typeof useRemotePendingMessages>[0] = {
    gateway,
    owner: {},
    valid: () => true,
    snapshots: [
      {
        ...emptyRemoteInventory("server", true),
        descriptor: {
          protocolVersion: 1,
          runnerId: "runner",
          name: "Linux",
          capabilities: { taskExecution: true, eventReplay: true, pendingMessages: true },
        },
        pendingMessages: new Map([[request.threadId, items]]),
      },
    ],
    views: new Map([
      [
        request.threadId,
        surfaceThreadView({
          thread: {
            ...surfaceThreadView().thread,
            provider: { kind: "codex", sessionId: "session-abcdefgh" },
          },
          execution: {
            kind: "remote",
            serverId: "server",
            runnerId: "runner",
            projectId: "project",
            conversationId: "conversation",
            latestTaskId: "task",
            resume: null,
          },
        }),
      ],
    ]),
    resolveAttachments: vi.fn(async () => []),
    publish: published,
    refresh: vi.fn(async () => {}),
    report: vi.fn(),
  };
  let result!: ReturnType<typeof useRemotePendingMessages>;
  function Probe() {
    result = useRemotePendingMessages(options);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = () => act(() => root.render(createElement(Probe)));
  render();
  cleanup.push(() => act(() => root.unmount()));
  return {
    gateway,
    applyPublished,
    get result() {
      return result;
    },
    get options() {
      return options;
    },
    update(patch: Partial<typeof options>) {
      options = { ...options, ...patch };
      render();
    },
  };
}

describe("server-owned pending message orchestration", () => {
  it("projects confirmed queued and paused messages without sending them", () => {
    const h = setup([pending(), pending({ id: "second", status: "paused" })]);
    expect(
      h.result.deferred
        .get(request.threadId)
        ?.map((item) => [item.id, item.state, item.request.prompt]),
    ).toEqual([
      ["pending-1", "queued", "Next step"],
      ["second", "paused", "Next step"],
    ]);
    expect(h.gateway.enqueueMessage).not.toHaveBeenCalled();
  });
  it("projects image-only and text-plus-image attachment counts without executable references", () => {
    const h = setup([
      pending({ parts: [{ type: "attachment", attachmentId: "private-image-1" }] }),
      pending({
        id: "mixed",
        parts: [
          { type: "text", text: "Review screenshots" },
          { type: "attachment", attachmentId: "private-image-2" },
          { type: "attachment", attachmentId: "private-image-3" },
        ],
      }),
    ]);
    const projected = h.result.deferred.get(request.threadId)!;
    expect(projected.map((item) => [item.request.prompt, item.displayAttachmentCount])).toEqual([
      ["Image attachment", 1],
      ["Review screenshots", 2],
    ]);
    expect(projected.every((item) => item.request.attachments === undefined)).toBe(true);
    expect(JSON.stringify(projected)).not.toContain("private-image");
    expect(h.options.resolveAttachments).not.toHaveBeenCalled();
  });
  it("accepts equivalent response fields in a different insertion order", async () => {
    const h = setup();
    h.gateway.enqueueMessage.mockResolvedValue({
      pending: pending({
        parts: [{ text: request.prompt, type: "text" }],
        launch: { mode: "default", model: "default", provider: "codex" },
      }),
      created: true,
    });
    await act(async () => {
      expect(await h.result.enqueue(request)).toBe(true);
    });
    expect(h.options.report).not.toHaveBeenCalled();
  });
  it("accepts runner-normalized Claude context and optional flags", async () => {
    const h = setup();
    const view = h.options.views.get(request.threadId)!;
    h.update({
      views: new Map([
        [
          request.threadId,
          {
            ...view,
            thread: {
              ...view.thread,
              provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
            },
          },
        ],
      ]),
    });
    const claudeLaunch = {
      provider: "claudeCode",
      model: "default",
      mode: "default",
      effort: "default",
    } as const;
    h.gateway.enqueueMessage.mockResolvedValue({
      pending: pending({
        launch: { ...claudeLaunch, context: "200k", fastMode: false, thinkingMode: false },
      }),
      created: true,
    });
    await act(async () => {
      expect(await h.result.enqueue({ ...request, launch: claudeLaunch })).toBe(true);
    });
    expect(h.options.report).not.toHaveBeenCalled();
    expect(h.applyPublished([])).toHaveLength(1);
  });
  it("publishes only after server acknowledgement", async () => {
    const h = setup();
    const response = deferred<{ pending: RemoteRunnerPendingMessage; created: boolean }>();
    h.gateway.enqueueMessage.mockReturnValue(response.promise);
    let operation!: Promise<boolean>;
    act(() => {
      operation = h.result.enqueue(request);
    });
    expect(h.result.busy).toBe(true);
    expect(h.options.publish).not.toHaveBeenCalled();
    await act(async () => {
      response.resolve({ pending: pending(), created: true });
      expect(await operation).toBe(true);
    });
    expect(h.options.publish).toHaveBeenCalledWith(
      "server",
      request.threadId,
      expect.any(Function),
    );
    expect(h.applyPublished([])).toEqual([pending()]);
    expect(h.result.busy).toBe(false);
  });
  it("retains the exact key on uncertain delivery and never retries automatically", async () => {
    const h = setup();
    h.gateway.enqueueMessage.mockRejectedValueOnce(new Error("Connection lost"));
    await act(async () => {
      expect(await h.result.enqueue(request)).toBe(false);
    });
    h.update({});
    expect(h.gateway.enqueueMessage).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await h.result.enqueue({ ...request, prompt: "Changed" })).toBe(false);
    });
    expect(h.gateway.enqueueMessage).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await h.result.enqueue(request)).toBe(true);
    });
    expect(h.gateway.enqueueMessage.mock.calls[1]).toEqual(h.gateway.enqueueMessage.mock.calls[0]);
  });
  it("accepts an uncertain retry with equivalent reordered launch settings", async () => {
    const h = setup();
    h.gateway.enqueueMessage.mockRejectedValueOnce(new Error("Connection lost"));
    await act(async () => {
      expect(await h.result.enqueue(request)).toBe(false);
    });
    await act(async () => {
      expect(
        await h.result.enqueue({
          ...request,
          launch: { mode: "default", provider: "codex", model: "default" },
        }),
      ).toBe(true);
    });
    expect(h.gateway.enqueueMessage.mock.calls[1]).toEqual(h.gateway.enqueueMessage.mock.calls[0]);
  });
  it("applies a late enqueue acknowledgement to the latest inventory without resurrecting old items", async () => {
    const old = pending({ id: "already-dispatched" });
    const newer = pending({ id: "newer-message" });
    const h = setup([old]);
    const response = deferred<{ pending: RemoteRunnerPendingMessage; created: boolean }>();
    h.gateway.enqueueMessage.mockReturnValue(response.promise);
    let operation!: Promise<boolean>;
    act(() => {
      operation = h.result.enqueue(request);
    });
    await act(async () => {
      response.resolve({ pending: pending(), created: true });
      await operation;
    });
    expect(h.applyPublished([newer])).toEqual([newer, pending()]);
  });
  it("preserves newly inventoried messages when an older cancellation completes", async () => {
    const h = setup([pending(), pending({ id: "already-dispatched" })]);
    const response = deferred<RemoteRunnerPendingMessage>();
    h.gateway.cancelPendingMessage.mockReturnValue(response.promise);
    let operation!: Promise<void>;
    act(() => {
      operation = h.result.remove(request.threadId, "pending-1");
    });
    await act(async () => {
      response.resolve(pending({ status: "cancelled" }));
      await operation;
    });
    const newer = pending({ id: "newer-message" });
    expect(h.applyPublished([pending(), newer])).toEqual([newer]);
  });
  it("allows another message after authoritative rejection", async () => {
    const h = setup();
    h.gateway.enqueueMessage.mockRejectedValueOnce(
      new RemoteRunnerRequestRejectedError("Queue full"),
    );
    await act(async () => {
      await h.result.enqueue(request);
    });
    h.gateway.enqueueMessage.mockResolvedValue({
      pending: pending({ parts: [{ type: "text", text: "Changed" }] }),
      created: true,
    });
    await act(async () => {
      expect(await h.result.enqueue({ ...request, prompt: "Changed" })).toBe(true);
    });
    expect(h.gateway.enqueueMessage.mock.calls[1]?.[0].idempotencyKey).not.toEqual(
      h.gateway.enqueueMessage.mock.calls[0]?.[0].idempotencyKey,
    );
  });
  it("revokes submission during an attachment upload when the owner changes", async () => {
    const h = setup();
    const uploaded = deferred<readonly RemoteRunnerPart[]>();
    h.update({ resolveAttachments: vi.fn(() => uploaded.promise) });
    let operation!: Promise<boolean>;
    act(() => {
      operation = h.result.enqueue({
        ...request,
        attachments: [
          {
            kind: "staged",
            attachmentId: "image",
            name: "a.png",
            bytes: 12,
            mime: "image/png",
            width: 1,
            height: 1,
          },
        ],
      });
    });
    expect(h.options.resolveAttachments).toHaveBeenCalledTimes(1);
    h.update({ owner: {} });
    await act(async () => {
      uploaded.resolve([{ type: "attachment", attachmentId: "uploaded" }]);
      expect(await operation).toBe(false);
    });
    expect(h.gateway.enqueueMessage).not.toHaveBeenCalled();
    expect(h.options.publish).not.toHaveBeenCalled();
  });
  it("rejects concurrent sends and queue changes while a mutation is pending", async () => {
    const h = setup();
    const response = deferred<{ pending: RemoteRunnerPendingMessage; created: boolean }>();
    h.gateway.enqueueMessage.mockReturnValue(response.promise);
    let operation!: Promise<boolean>;
    act(() => {
      operation = h.result.enqueue(request);
    });
    await act(async () => {
      expect(await h.result.enqueue(request)).toBe(false);
      await h.result.remove(request.threadId, "pending-1");
      await h.result.resume(request.threadId);
    });
    expect(h.gateway.enqueueMessage).toHaveBeenCalledTimes(1);
    expect(h.gateway.cancelPendingMessage).not.toHaveBeenCalled();
    expect(h.gateway.resumePendingMessages).not.toHaveBeenCalled();
    await act(async () => {
      response.resolve({ pending: pending(), created: true });
      await operation;
    });
  });
  it.each(["disconnected", "replaced", "unsupported"] as const)(
    "rejects a %s server before dispatch",
    async (state) => {
      const h = setup();
      const snapshot = h.options.snapshots[0]!;
      h.update({
        snapshots: [
          {
            ...snapshot,
            connected: state !== "disconnected",
            descriptor: {
              ...snapshot.descriptor!,
              runnerId: state === "replaced" ? "another-runner" : "runner",
              capabilities: {
                ...snapshot.descriptor!.capabilities,
                pendingMessages: state !== "unsupported",
              },
            },
          },
        ],
      });
      await act(async () => {
        expect(await h.result.enqueue(request)).toBe(false);
      });
      expect(h.gateway.enqueueMessage).not.toHaveBeenCalled();
    },
  );
  it("does not send through unsupported gateways", async () => {
    const h = setup();
    h.update({ gateway: { ...h.gateway, enqueueMessage: undefined } });
    await act(async () => {
      expect(await h.result.enqueue(request)).toBe(false);
    });
    expect(h.gateway.enqueueMessage).not.toHaveBeenCalled();
  });
  it.each(["queued", "dispatched"] as const)(
    "keeps a pending message if cancellation returns %s",
    async (status) => {
      const h = setup([pending()]);
      h.gateway.cancelPendingMessage.mockResolvedValue(pending({ status }));
      await act(async () => {
        await h.result.remove(request.threadId, "pending-1");
      });
      expect(h.options.publish).not.toHaveBeenCalled();
      expect(h.options.report).toHaveBeenCalled();
    },
  );
  it("rejects a foreign conversation when resuming", async () => {
    const h = setup();
    h.gateway.resumePendingMessages.mockResolvedValue({
      items: [pending({ conversationId: "foreign" })],
    });
    await act(async () => {
      await h.result.resume(request.threadId);
    });
    expect(h.options.publish).not.toHaveBeenCalled();
    expect(h.options.report).toHaveBeenCalled();
  });
  it("ignores cancellation that completes after owner revocation", async () => {
    const h = setup([pending()]);
    const response = deferred<RemoteRunnerPendingMessage>();
    h.gateway.cancelPendingMessage.mockReturnValue(response.promise);
    let operation!: Promise<void>;
    act(() => {
      operation = h.result.remove(request.threadId, "pending-1");
    });
    h.update({ valid: () => false, owner: {} });
    await act(async () => {
      response.resolve(pending({ status: "cancelled" }));
      await operation;
    });
    expect(h.options.publish).not.toHaveBeenCalled();
    expect(h.options.refresh).not.toHaveBeenCalled();
  });
  it("publishes confirmed removal and resume", async () => {
    const h = setup([pending()]);
    await act(async () => {
      await h.result.remove(request.threadId, "pending-1");
    });
    expect(h.applyPublished([pending()])).toEqual([]);
    await act(async () => {
      await h.result.resume(request.threadId);
    });
    expect(h.applyPublished([])).toEqual([pending()]);
  });
});

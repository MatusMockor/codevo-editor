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
import { useRemoteAgentSteer } from "./useRemoteAgentSteer";

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
    collectInstructions: vi.fn().mockResolvedValue({ version: 1, files: [] }),
    listServers: vi.fn(),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi
      .fn()
      .mockResolvedValue({ runnerId: "runner", capabilities: { instructionSync: true } }),
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
    steerTask: vi.fn().mockImplementation(async (request) => ({
      taskId: request.taskId,
      messageId: request.idempotencyKey,
      status: "accepted" as const,
    })),
    steerPendingMessage: vi
      .fn()
      .mockResolvedValue({ taskId: "task", messageId: "pending-1", status: "accepted" }),
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
  let options: Parameters<typeof useRemoteAgentSteer>[0] = {
    gateway,
    owner: {},
    selectedThreadId: request.threadId,
    valid: () => true,
    snapshots: [
      {
        ...emptyRemoteInventory("server", true),
        descriptor: {
          protocolVersion: 1,
          runnerId: "runner",
          name: "Linux",
          capabilities: {
            taskExecution: true,
            eventReplay: true,
            pendingMessages: true,
            taskSteering: true,
          },
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
  let result!: ReturnType<typeof useRemoteAgentSteer>;
  function Probe() {
    result = useRemoteAgentSteer(options);
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

describe("remote immediate messages", () => {
  it("sends directly without enqueuing or changing providers", async () => {
    const h = setup();
    await act(async () => {
      expect(await h.result.send(request)).toBe(true);
    });
    expect(h.gateway.steerTask).toHaveBeenCalledWith({
      serverId: "server",
      taskId: "task",
      idempotencyKey: expect.any(String),
      parts: [{ type: "text", text: request.prompt }],
    });
    expect(h.gateway.enqueueMessage).not.toHaveBeenCalled();
    expect(h.options.refresh).toHaveBeenCalled();
  });
  it("preserves exact attachment references and key after uncertain delivery", async () => {
    const h = setup();
    h.update({
      resolveAttachments: vi.fn(async () => [
        { type: "attachment" as const, attachmentId: "uploaded" },
      ]),
    });
    const imageRequest = {
      ...request,
      attachments: [
        {
          kind: "staged" as const,
          attachmentId: "image",
          name: "a.png",
          bytes: 12,
          mime: "image/png" as const,
          width: 1,
          height: 1,
        },
      ],
    };
    h.gateway.steerTask.mockRejectedValueOnce(new Error("lost"));
    await act(async () => {
      expect(await h.result.send(imageRequest)).toBe(false);
    });
    await act(async () => {
      expect(await h.result.send({ ...imageRequest, prompt: "changed" })).toBe(false);
    });
    await act(async () => {
      expect(await h.result.send(imageRequest)).toBe(true);
    });
    expect(h.gateway.steerTask.mock.calls[1]).toEqual(h.gateway.steerTask.mock.calls[0]);
    expect(h.options.resolveAttachments).toHaveBeenCalledTimes(1);
  });
  it("revokes an upload on owner replacement", async () => {
    const h = setup();
    const upload = deferred<readonly RemoteRunnerPart[]>();
    h.update({ resolveAttachments: vi.fn(() => upload.promise) });
    let operation!: Promise<boolean>;
    act(() => {
      operation = h.result.send({
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
    h.update({ owner: {} });
    await act(async () => {
      upload.resolve([{ type: "attachment", attachmentId: "uploaded" }]);
      expect(await operation).toBe(false);
    });
    expect(h.gateway.steerTask).not.toHaveBeenCalled();
  });
  it("retains pending images until atomic server promotion is confirmed", async () => {
    const h = setup([pending({ parts: [{ type: "attachment", attachmentId: "image" }] })]);
    h.gateway.steerPendingMessage.mockRejectedValueOnce(new Error("lost"));
    await act(async () => {
      await h.result.sendPending(request.threadId, "pending-1");
    });
    expect(h.options.publish).not.toHaveBeenCalled();
    await act(async () => {
      await h.result.sendPending(request.threadId, "pending-1");
    });
    expect(h.applyPublished([pending()])).toEqual([]);
    expect(h.gateway.cancelPendingMessage).not.toHaveBeenCalled();
    expect(h.options.resolveAttachments).not.toHaveBeenCalled();
  });
  it("rejects old servers explicitly without queue or local fallback", async () => {
    const h = setup();
    h.update({
      snapshots: h.options.snapshots.map((s) => ({
        ...s,
        descriptor: {
          ...s.descriptor!,
          capabilities: { ...s.descriptor!.capabilities, taskSteering: false },
        },
      })),
    });
    await act(async () => {
      expect(await h.result.send(request)).toBe(false);
    });
    expect(h.gateway.steerTask).not.toHaveBeenCalled();
    expect(h.gateway.enqueueMessage).not.toHaveBeenCalled();
    expect(h.options.report).toHaveBeenCalledWith(
      "Update this server to send messages during a running turn.",
    );
  });
  it("rejects a turn replacement while uploading", async () => {
    const h = setup();
    const upload = deferred<readonly RemoteRunnerPart[]>();
    h.update({ resolveAttachments: vi.fn(() => upload.promise) });
    let operation!: Promise<boolean>;
    act(() => {
      operation = h.result.send({
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
    h.update({
      views: new Map(
        [...h.options.views].map(([key, v]) => [
          key,
          { ...v, execution: { ...v.execution!, latestTaskId: "replacement" } },
        ]),
      ),
    });
    await act(async () => {
      upload.resolve([{ type: "attachment", attachmentId: "uploaded" }]);
      expect(await operation).toBe(false);
    });
    expect(h.gateway.steerTask).not.toHaveBeenCalled();
  });
});

it("retains the original idempotency key when an uncertain retry is rejected", async () => {
  const h = setup();
  h.gateway.steerTask
    .mockRejectedValueOnce(new Error("lost"))
    .mockRejectedValueOnce(new Error("delivery_uncertain"));
  await act(async () => {
    await h.result.send(request);
    await h.result.send(request);
  });
  expect(h.result.hasUnconfirmed(request.threadId)).toBe(true);
  await act(async () => {
    expect(await h.result.send(request)).toBe(true);
  });
  expect(h.gateway.steerTask.mock.calls[2]).toEqual(h.gateway.steerTask.mock.calls[0]);
});

it("retains a first rejected dispatch because the provider may already have received it", async () => {
  const h = setup();
  h.gateway.steerTask.mockRejectedValueOnce(new Error("delivery_uncertain"));
  await act(async () => {
    expect(await h.result.send(request)).toBe(false);
  });
  expect(h.result.hasUnconfirmed(request.threadId)).toBe(true);
  await act(async () => {
    expect(await h.result.send({ ...request, prompt: "replacement" })).toBe(false);
  });
  expect(h.gateway.steerTask).toHaveBeenCalledTimes(1);
});

it("recovers the original receipt after the conversation advances without targeting the new task", async () => {
  const h = setup();
  h.gateway.steerTask.mockRejectedValueOnce(new Error("lost"));
  await act(async () => {
    await h.result.send(request);
  });
  h.update({
    views: new Map(
      [...h.options.views].map(([key, v]) => [
        key,
        { ...v, execution: { ...v.execution!, latestTaskId: "replacement" } },
      ]),
    ),
  });
  await act(async () => {
    expect(await h.result.send(request)).toBe(true);
  });
  expect(h.gateway.steerTask.mock.calls[1]).toEqual(h.gateway.steerTask.mock.calls[0]);
});

it("releases a definitely rejected command so a different message can be sent", async () => {
  const h = setup();
  h.gateway.steerTask.mockRejectedValueOnce(new RemoteRunnerRequestRejectedError("not running"));
  await act(async () => {
    expect(await h.result.send(request)).toBe(false);
  });
  expect(h.result.hasUnconfirmed(request.threadId)).toBe(false);
  await act(async () => {
    expect(await h.result.send({ ...request, prompt: "new" })).toBe(true);
  });
});
it("never promotes a provider-uncertain pending message again", async () => {
  const h = setup([pending({ status: "uncertain" })]);
  await act(async () => {
    await h.result.sendPending(request.threadId, "pending-1");
  });
  expect(h.gateway.steerPendingMessage).not.toHaveBeenCalled();
  expect(h.options.publish).not.toHaveBeenCalled();
  expect(h.options.report).toHaveBeenCalledWith(
    "Delivery could not be confirmed. Remove this message before sending it again.",
  );
});
it("only explicit dismissal unlocks a different message and never sends automatically", async () => {
  const h = setup();
  h.gateway.steerTask.mockRejectedValueOnce(new Error("delivery_uncertain"));
  await act(async () => {
    await h.result.send(request);
    expect(await h.result.send({ ...request, prompt: "different" })).toBe(false);
  });
  act(() => h.result.discardUnconfirmed(request.threadId));
  expect(h.result.hasUnconfirmed(request.threadId)).toBe(false);
  expect(h.gateway.steerTask).toHaveBeenCalledTimes(1);
  await act(async () => {
    expect(await h.result.send({ ...request, prompt: "different" })).toBe(true);
  });
  expect(h.gateway.steerTask.mock.calls[1]![0].idempotencyKey).not.toBe(
    h.gateway.steerTask.mock.calls[0]![0].idempotencyKey,
  );
});
it("ignores a stale dismissal after selecting another thread", async () => {
  const h = setup();
  h.gateway.steerTask.mockRejectedValueOnce(new Error("delivery_uncertain"));
  await act(async () => {
    await h.result.send(request);
  });
  const discard = h.result.discardUnconfirmed;
  h.update({ owner: {}, selectedThreadId: "other" });
  act(() => discard(request.threadId));
  expect(h.result.hasUnconfirmed(request.threadId)).toBe(true);
});

// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentImageSurfacePort } from "../domain/agentImageShrink";
import type {
  RemoteRunnerAttachment,
  RemoteRunnerGateway,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import { remoteAgentThreadKey } from "./remoteAgentProjection";
import { remoteAttachmentUnavailableMessage } from "./remoteAttachmentHistory";
import { agentAttachmentImageKey } from "./useAgentAttachmentImages";
import type { AgentAttachmentOwner } from "./useAgentComposerAttachments";
import { useRemoteAgentAttachments } from "./useRemoteAgentAttachments";

describe("remote attachment image normalization", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([1024, 5 * 1024 * 1024 + 1, 10 * 1024 * 1024 + 1])(
    "stages a %i-byte retina PNG within the runner and model limits",
    async (size) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const createObjectURL = vi.fn(() => "blob:remote-preview");
      const revokeObjectURL = vi.fn();
      vi.stubGlobal(
        "URL",
        class extends URL {
          static createObjectURL = createObjectURL;
          static revokeObjectURL = revokeObjectURL;
        },
      );
      const encode = vi.fn(async () => new ArrayBuffer(1024));
      const imageSurface: AgentImageSurfacePort = {
        decode: async () => ({ width: 4096, height: 2048 }),
        encodeMime: vi.fn(async () => "image/webp" as const),
        encode,
        release: vi.fn(),
      };
      const owner = {
        projectRootKey: "project",
        workspaceId: "project",
        ownerId: "owner",
        generation: 1,
      };
      const reportError = vi.fn();
      let result: ReturnType<typeof useRemoteAgentAttachments> | undefined;
      function Probe() {
        result = useRemoteAgentAttachments({
          gateway: null,
          imageSurface,
          resolveOwner: () => owner,
          resolveRetainedOwner: () => owner,
          resolveServer: () => "server",
          reportError,
        });
        return null;
      }
      const root = createRoot(document.createElement("div"));
      try {
        act(() => root.render(createElement(Probe)));
        await act(async () => {
          await result!.attachments.add("project", [
            { kind: "bytes", name: "large.png", mime: "image/png", bytes: new ArrayBuffer(size) },
          ]);
        });
        expect(result!.attachments.drafts).toMatchObject([
          { state: "ready", name: "large.png", mime: "image/png", bytes: 1024 },
        ]);
        expect(encode.mock.calls[0]).toEqual([
          { width: 4096, height: 2048 },
          1568,
          784,
          "image/png",
          1,
        ]);
        expect(imageSurface.encodeMime).not.toHaveBeenCalled();
        expect(reportError).not.toHaveBeenCalled();
      } finally {
        act(() => root.unmount());
      }
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:remote-preview");
    },
  );
});

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "33333333-3333-4333-8333-333333333333";
const workspaceId = "remote:server:runner:project";
const historyTask: RemoteRunnerTask = {
  id: "22222222-2222-4222-8222-222222222222",
  sequence: 1,
  runnerId: "runner",
  provider: "claude",
  status: "succeeded",
  projectId: "project",
  parts: [
    { type: "attachment", attachmentId: firstId },
    { type: "attachment", attachmentId: secondId },
  ],
  createdAt: "2026-09-13T00:00:00.000Z",
};
const firstOnly: RemoteRunnerTask = { ...historyTask, parts: [historyTask.parts[0]!] };
const secondOnly: RemoteRunnerTask = { ...historyTask, parts: [historyTask.parts[1]!] };
const threadId = remoteAgentThreadKey("server", "runner", historyTask.id);
const displayId = (attachmentId: string) => attachmentId.replace(/-/g, "");
const imageKey = (attachmentId: string) =>
  agentAttachmentImageKey(workspaceId, threadId, displayId(attachmentId));
const metadataFor = (attachmentId: string): RemoteRunnerAttachment => ({
  id: attachmentId,
  runnerId: "runner",
  name: "shot.png",
  mediaType: "image/png",
  bytes: 4,
  width: 1,
  height: 1,
  sha256: "a".repeat(64),
  createdAt: historyTask.createdAt,
});
function remoteGateway() {
  const getAttachment = vi.fn(async ({ attachmentId }: { attachmentId: string }) =>
    metadataFor(attachmentId),
  );
  const readAttachment = vi.fn(async () => ({
    mediaType: "image/png" as const,
    base64: "iVBORw==",
  }));
  return {
    getAttachment,
    readAttachment,
    port: { getAttachment, readAttachment } as unknown as RemoteRunnerGateway,
  };
}
function registryHarness() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let nextUrl = 0;
  const createObjectURL = vi.fn(() => `blob:remote-${(nextUrl += 1)}`);
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  const authority = {
    gateway: remoteGateway(),
    connected: true,
    present: true,
    generation: 1,
  };
  const reportError = vi.fn();
  const retained = (projectRootKey: string): AgentAttachmentOwner | null =>
    authority.present
      ? {
          projectRootKey,
          ownerId: projectRootKey,
          workspaceId: projectRootKey,
          generation: authority.generation,
        }
      : null;
  let result!: ReturnType<typeof useRemoteAgentAttachments>;
  function Probe() {
    result = useRemoteAgentAttachments({
      gateway: authority.gateway.port,
      imageSurface: null,
      resolveOwner: (projectRootKey) => (authority.connected ? retained(projectRootKey) : null),
      resolveRetainedOwner: retained,
      resolveServer: () => "server",
      reportError,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = () =>
    act(async () => {
      root.render(createElement(Probe));
    });
  const load = (task = historyTask) =>
    act(() => result.loadTaskAttachments(task, "server", retained(workspaceId)!, result.epoch));
  const ensure = (attachmentId: string) =>
    act(async () => {
      result.attachmentImages.ensure({
        workspaceId,
        threadId,
        attachmentId: displayId(attachmentId),
        mime: "image/png",
      });
    });
  return {
    authority,
    createObjectURL,
    revokeObjectURL,
    reportError,
    render,
    load,
    ensure,
    outcomeOf: (task: RemoteRunnerTask) =>
      result.loadTaskAttachments(task, "server", retained(workspaceId)!, result.epoch).then(
        () => "loaded",
        () => "rejected",
      ),
    settle: (assertion: () => void) =>
      act(async () => {
        await vi.waitFor(assertion);
      }),
    unmount: () => act(() => root.unmount()),
    imageOf: (attachmentId: string) => result.attachmentImages.images.get(imageKey(attachmentId)),
    get current() {
      return result;
    },
  };
}

describe("remote attachment registry authority", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps registered images and decoded previews across a connectivity drop", async () => {
    const h = registryHarness();
    try {
      await h.render();
      await h.load();
      await h.ensure(firstId);
      expect(h.imageOf(firstId)).toEqual({ kind: "ready", url: "blob:remote-1" });
      h.authority.connected = false;
      await h.render();
      expect(h.imageOf(firstId)).toEqual({ kind: "ready", url: "blob:remote-1" });
      h.authority.connected = true;
      await h.render();
      expect(h.imageOf(firstId)).toEqual({ kind: "ready", url: "blob:remote-1" });
      expect(h.current.epoch).toBe(0);
      expect(h.revokeObjectURL).not.toHaveBeenCalled();
      expect((await h.load()).attachments).toHaveLength(2);
      expect(h.authority.gateway.getAttachment).toHaveBeenCalledTimes(2);
      expect(h.authority.gateway.readAttachment).toHaveBeenCalledTimes(1);
    } finally {
      await h.unmount();
    }
  });

  it("fails closed while disconnected and reads the image again once the owner is restored", async () => {
    const h = registryHarness();
    try {
      await h.render();
      await h.load();
      await h.ensure(firstId);
      h.authority.connected = false;
      await h.render();
      await h.ensure(secondId);
      expect(h.imageOf(secondId)).toEqual({
        kind: "unavailable",
        reason: remoteAttachmentUnavailableMessage("notConnected"),
      });
      expect(h.authority.gateway.readAttachment).toHaveBeenCalledTimes(1);
      expect(h.reportError).not.toHaveBeenCalled();
      expect(h.current.epoch).toBe(0);
      h.authority.connected = true;
      await h.render();
      await h.settle(() =>
        expect(h.imageOf(secondId)).toEqual({ kind: "ready", url: "blob:remote-2" }),
      );
      expect(h.imageOf(firstId)).toEqual({ kind: "ready", url: "blob:remote-1" });
      expect(h.revokeObjectURL).not.toHaveBeenCalled();
      expect(h.current.epoch).toBe(0);
      expect(h.authority.gateway.getAttachment).toHaveBeenCalledTimes(2);
      expect(h.authority.gateway.readAttachment).toHaveBeenCalledTimes(2);
      await h.render();
      expect(h.authority.gateway.readAttachment).toHaveBeenCalledTimes(2);
    } finally {
      await h.unmount();
    }
  });

  it.each(["gateway replaced", "generation bumped", "server removed"] as const)(
    "wipes the registry and releases previews when the %s",
    async (change) => {
      const h = registryHarness();
      try {
        await h.render();
        await h.load(firstOnly);
        await h.ensure(firstId);
        expect(h.imageOf(firstId)).toEqual({ kind: "ready", url: "blob:remote-1" });
        const before = h.authority.gateway;
        let finish!: (value: RemoteRunnerAttachment) => void;
        before.getAttachment.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        );
        const late = h.outcomeOf(secondOnly);
        if (change === "gateway replaced") h.authority.gateway = remoteGateway();
        if (change === "generation bumped") h.authority.generation = 2;
        if (change === "server removed") h.authority.present = false;
        await h.render();
        expect(h.revokeObjectURL).toHaveBeenCalledWith("blob:remote-1");
        expect(h.imageOf(firstId)).toBeUndefined();
        expect(h.current.epoch).toBe(1);
        finish(metadataFor(secondId));
        expect(await late).toBe("rejected");
        await h.ensure(firstId);
        await h.ensure(secondId);
        const reason = remoteAttachmentUnavailableMessage(
          change === "server removed" ? "notConnected" : "notLoaded",
        );
        expect(h.imageOf(firstId)).toEqual({ kind: "unavailable", reason });
        expect(h.imageOf(secondId)).toEqual({ kind: "unavailable", reason });
        expect(before.readAttachment).toHaveBeenCalledTimes(1);
        expect(h.authority.gateway.readAttachment).toHaveBeenCalledTimes(
          change === "gateway replaced" ? 0 : 1,
        );
      } finally {
        await h.unmount();
      }
    },
  );

  it("does not serve workspace A entries after A to B to A and reloads them for the new owner", async () => {
    const h = registryHarness();
    try {
      await h.render();
      await h.load(firstOnly);
      await h.ensure(firstId);
      let finish!: (value: RemoteRunnerAttachment) => void;
      h.authority.gateway.getAttachment.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const late = h.outcomeOf(secondOnly);
      h.authority.generation = 2;
      await h.render();
      expect(h.revokeObjectURL).toHaveBeenCalledWith("blob:remote-1");
      h.authority.generation = 3;
      await h.render();
      finish(metadataFor(secondId));
      expect(await late).toBe("rejected");
      await h.ensure(firstId);
      expect(h.imageOf(firstId)).toEqual({
        kind: "unavailable",
        reason: remoteAttachmentUnavailableMessage("notLoaded"),
      });
      expect(h.authority.gateway.readAttachment).toHaveBeenCalledTimes(1);
      await h.load();
      await h.render();
      await h.ensure(firstId);
      expect(h.imageOf(firstId)).toMatchObject({ kind: "ready" });
      expect(h.authority.gateway.getAttachment).toHaveBeenCalledTimes(4);
      expect(h.authority.gateway.readAttachment).toHaveBeenCalledTimes(2);
    } finally {
      await h.unmount();
    }
  });

  it("drops a load that straddles a registry invalidation", async () => {
    const h = registryHarness();
    try {
      await h.render();
      await h.load(firstOnly);
      let finish!: (value: RemoteRunnerAttachment) => void;
      h.authority.gateway.getAttachment.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const straddling = h.outcomeOf(secondOnly);
      h.authority.present = false;
      await h.render();
      h.authority.present = true;
      await h.render();
      finish(metadataFor(secondId));
      expect(await straddling).toBe("rejected");
      expect(h.current.epoch).toBe(1);
      const reloaded = await h.load();
      expect(reloaded.epoch).toBe(1);
      expect(reloaded.attachments).toHaveLength(2);
    } finally {
      await h.unmount();
    }
  });

  it("settles a failed metadata load once and loads it again after an observed reconnect", async () => {
    const h = registryHarness();
    try {
      await h.render();
      h.authority.gateway.getAttachment.mockRejectedValueOnce(
        new Error("ssh: connect to host 10.0.0.7 port 22: refused"),
      );
      expect((await h.load(firstOnly)).discovered).toEqual(["loadFailed"]);
      expect((await h.load(firstOnly)).discovered).toEqual([]);
      await h.render();
      expect((await h.load(firstOnly)).discovered).toEqual([]);
      expect(h.authority.gateway.getAttachment).toHaveBeenCalledTimes(1);
      await h.ensure(firstId);
      expect(h.imageOf(firstId)).toEqual({
        kind: "unavailable",
        reason: remoteAttachmentUnavailableMessage("loadFailed"),
      });
      expect(h.reportError).toHaveBeenCalledTimes(1);
      expect(String(h.reportError.mock.calls[0]?.[1])).not.toContain("10.0.0.7");
      h.authority.connected = false;
      await h.render();
      h.authority.connected = true;
      await h.render();
      expect((await h.load(firstOnly)).attachments).toHaveLength(1);
      expect(h.authority.gateway.getAttachment).toHaveBeenCalledTimes(2);
      expect(h.current.epoch).toBe(0);
    } finally {
      await h.unmount();
    }
  });

  it("shares one metadata request between overlapping loads of the same turn", async () => {
    const h = registryHarness();
    try {
      await h.render();
      const owner = {
        projectRootKey: workspaceId,
        ownerId: workspaceId,
        workspaceId,
        generation: 1,
      };
      const overlapping = [
        h.current.loadTaskAttachments(firstOnly, "server", owner, 0),
        h.current.loadTaskAttachments({ ...firstOnly }, "server", owner, 0),
      ];
      const [first, second] = await Promise.all(overlapping);
      expect(first?.attachments).toHaveLength(1);
      expect(second).toBe(first);
      expect(h.authority.gateway.getAttachment).toHaveBeenCalledTimes(1);
      expect((await h.load(firstOnly)).attachments).toHaveLength(1);
      expect(h.authority.gateway.getAttachment).toHaveBeenCalledTimes(1);
    } finally {
      await h.unmount();
    }
  });

  it("drops unavailable previews of every workspace when the gateway is replaced", async () => {
    const h = registryHarness();
    try {
      await h.render();
      await h.ensure(firstId);
      expect(h.imageOf(firstId)).toEqual({
        kind: "unavailable",
        reason: remoteAttachmentUnavailableMessage("notLoaded"),
      });
      expect(h.current.epoch).toBe(0);
      h.authority.gateway = remoteGateway();
      await h.render();
      expect(h.imageOf(firstId)).toBeUndefined();
      await h.load(firstOnly);
      await h.render();
      expect(h.imageOf(firstId)).toBeUndefined();
      expect(h.authority.gateway.readAttachment).not.toHaveBeenCalled();
    } finally {
      await h.unmount();
    }
  });

  it("shows fixed copy when the server stays busy through every read retry", async () => {
    vi.useFakeTimers();
    const h = registryHarness();
    try {
      await h.render();
      await h.load(firstOnly);
      h.authority.gateway.readAttachment.mockRejectedValue(
        new Error("Runner request failed (HTTP 503)."),
      );
      await h.ensure(firstId);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(h.authority.gateway.readAttachment).toHaveBeenCalledTimes(4);
      expect(h.imageOf(firstId)).toEqual({
        kind: "unavailable",
        reason: remoteAttachmentUnavailableMessage("busy"),
      });
      expect(h.reportError).toHaveBeenCalledTimes(1);
      expect(h.reportError.mock.calls[0]?.[1]).toMatchObject({
        message: remoteAttachmentUnavailableMessage("busy"),
      });
    } finally {
      await h.unmount();
      vi.useRealTimers();
    }
  });

  it("advances the registry epoch once per load however many images it evicts", async () => {
    const h = registryHarness();
    const numbered = (index: number): string =>
      `${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
    const turnOf = (start: number, count: number, conversationId?: string): RemoteRunnerTask => ({
      ...historyTask,
      ...(conversationId === undefined ? {} : { conversationId }),
      parts: Array.from({ length: count }, (_, offset) => ({
        type: "attachment" as const,
        attachmentId: numbered(start + offset),
      })),
    });
    try {
      await h.render();
      for (let start = 1; start <= 512; start += 8) await h.load(turnOf(start, 8));
      expect(h.current.epoch).toBe(0);
      expect(h.authority.gateway.getAttachment).toHaveBeenCalledTimes(512);

      const other = await h.load(turnOf(9001, 8, "other"));
      expect(other.attachments).toHaveLength(8);
      expect(other.epoch).toBe(1);
      expect(h.current.epoch).toBe(1);
      expect((await h.load(turnOf(9001, 8, "other"))).epoch).toBe(1);
      expect((await h.load(turnOf(1, 8))).attachments).toHaveLength(8);
      expect(h.current.epoch).toBe(2);
      expect(h.authority.gateway.getAttachment).toHaveBeenCalledTimes(528);
      expect(h.revokeObjectURL).not.toHaveBeenCalled();
    } finally {
      await h.unmount();
    }
  });

  it("rejects a load whose own eviction coincides with a real invalidation", async () => {
    const h = registryHarness();
    const numbered = (index: number): string =>
      `${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
    const turnOf = (start: number, count: number, conversationId?: string): RemoteRunnerTask => ({
      ...historyTask,
      ...(conversationId === undefined ? {} : { conversationId }),
      parts: Array.from({ length: count }, (_, offset) => ({
        type: "attachment" as const,
        attachmentId: numbered(start + offset),
      })),
    });
    try {
      await h.render();
      for (let start = 1; start <= 512; start += 8) await h.load(turnOf(start, 8));
      let finish!: (value: RemoteRunnerAttachment) => void;
      const straddling = h.outcomeOf(turnOf(9001, 2, "other"));
      h.authority.gateway.getAttachment.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await h.settle(() => expect(finish).toBeTypeOf("function"));
      h.authority.present = false;
      await h.render();
      expect(h.current.epoch).toBe(1);
      h.authority.present = true;
      await h.render();
      await act(async () => {
        finish(metadataFor(numbered(9002)));
        expect(await straddling).toBe("rejected");
      });
      expect(h.current.epoch).toBe(2);
      await h.ensure(numbered(9001));
      expect(h.imageOf(numbered(9001))).toEqual({
        kind: "unavailable",
        reason: remoteAttachmentUnavailableMessage("notLoaded"),
      });
      expect(h.authority.gateway.readAttachment).not.toHaveBeenCalled();
      const reloaded = await h.load(turnOf(9001, 2, "other"));
      expect(reloaded.epoch).toBe(2);
      expect(reloaded.attachments).toHaveLength(2);
    } finally {
      await h.unmount();
    }
  });
});

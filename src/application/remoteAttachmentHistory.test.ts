import { describe, expect, it, vi } from "vitest";
import type {
  RemoteRunnerAttachment,
  RemoteRunnerGateway,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import {
  loadRemoteTaskAttachments,
  MAX_REMOTE_ATTACHMENT_ENTRIES,
  presentRemoteAttachmentError,
  readRemoteAttachment,
  remoteAttachmentBlocker,
  remoteAttachmentErrorRecovery,
  remoteAttachmentImageMime,
  remoteAttachmentLoadRetriesQuietly,
  remoteAttachmentRecovery,
  reviseRemoteAttachments,
  remoteAttachmentUnavailableMessage,
  RemoteAttachmentUnavailableError,
  type RemoteAttachmentRegistry,
  type RemoteAttachmentUnavailableReason,
} from "./remoteAttachmentHistory";
import { remoteAgentThreadKey } from "./remoteAgentProjection";
import type { AgentAttachmentOwner } from "./useAgentComposerAttachments";

const id = "11111111-1111-4111-8111-111111111111";
const task: RemoteRunnerTask = {
  id: "22222222-2222-4222-8222-222222222222",
  sequence: 1,
  runnerId: "runner",
  provider: "claude",
  status: "succeeded",
  projectId: "project",
  parts: [{ type: "attachment", attachmentId: id }],
  createdAt: "2026-09-13T00:00:00.000Z",
};
const metadata: RemoteRunnerAttachment = {
  id,
  runnerId: "runner",
  name: "shot.png",
  mediaType: "image/png",
  bytes: 4,
  width: 1,
  height: 1,
  sha256: "a".repeat(64),
  createdAt: task.createdAt,
};
function fixture() {
  let currentOwner: AgentAttachmentOwner = {
    projectRootKey: "project",
    workspaceId: "workspace",
    ownerId: "lease",
    generation: 1,
  };
  const registry: RemoteAttachmentRegistry = new Map();
  const getAttachment = vi.fn(
    async (_request: { readonly attachmentId: string }): Promise<RemoteRunnerAttachment> =>
      metadata,
  );
  const readAttachment = vi.fn(async () => ({
    mediaType: "image/png" as const,
    base64: "iVBORw==",
  }));
  const gateway = { getAttachment, readAttachment } as unknown as RemoteRunnerGateway;
  const ownerIsCurrent = (candidate: AgentAttachmentOwner) =>
    Object.entries(currentOwner).every(
      ([key, value]) => candidate[key as keyof AgentAttachmentOwner] === value,
    );
  const request = {
    workspaceId: "workspace",
    attachmentId: id.replace(/-/g, ""),
    threadId: remoteAgentThreadKey("server", "runner", task.id),
  };
  const dependencies = {
    gateway,
    ownerIsCurrent,
    resolveServer: () => "server",
    isGatewayCurrent: () => true,
    isWorkspaceConnected: () => true,
  };
  return {
    registry,
    gateway,
    getAttachment,
    readAttachment,
    request,
    dependencies,
    ownerIsCurrent,
    load: async (value = task) =>
      (await loadRemoteTaskAttachments(registry, value, "server", currentOwner, dependencies))
        .attachments,
    loadResult: (value = task) =>
      loadRemoteTaskAttachments(registry, value, "server", currentOwner, dependencies),
    replace: (change: Partial<AgentAttachmentOwner>) => {
      currentOwner = { ...currentOwner, ...change };
    },
  };
}

describe("remote attachment history", () => {
  it("projects text files as remote file chips without local paths", async () => {
    const f = fixture();
    f.getAttachment.mockResolvedValue({
      id,
      runnerId: "runner",
      name: "pasted-text.txt",
      mediaType: "text/plain",
      bytes: 4,
      sha256: "a".repeat(64),
      createdAt: task.createdAt,
    });
    expect(await f.load()).toEqual([
      {
        kind: "file",
        attachmentId: id.replace(/-/g, ""),
        name: "pasted-text.txt",
        bytes: 4,
        remote: { serverId: "server", attachmentId: id },
      },
    ]);
  });
  it("projects server images without a local path and reads only registered conversation images", async () => {
    const f = fixture();
    const [image] = await f.load();
    expect(image).toMatchObject({
      attachmentId: f.request.attachmentId,
      remote: { serverId: "server", attachmentId: id },
    });
    expect(image).not.toHaveProperty("storedPath");
    expect(
      new Uint8Array(await readRemoteAttachment(f.registry, f.request, f.dependencies)),
    ).toEqual(new Uint8Array([137, 80, 78, 71]));
    await f.load();
    expect(f.getAttachment).toHaveBeenCalledTimes(1);
  });
  it("rejects another thread on the same server before requesting image bytes", async () => {
    const f = fixture();
    await f.load();
    await expect(
      readRemoteAttachment(
        f.registry,
        { ...f.request, threadId: remoteAgentThreadKey("server", "runner", "other") },
        f.dependencies,
      ),
    ).rejects.toThrow();
    expect(f.readAttachment).not.toHaveBeenCalled();
  });
  it("uses conversation root identity for follow-up task attachments", async () => {
    const f = fixture();
    await f.load({ ...task, conversationId: "root" });
    await expect(readRemoteAttachment(f.registry, f.request, f.dependencies)).rejects.toThrow();
    await expect(
      readRemoteAttachment(
        f.registry,
        { ...f.request, threadId: remoteAgentThreadKey("server", "runner", "root") },
        f.dependencies,
      ),
    ).resolves.toBeInstanceOf(ArrayBuffer);
  });
  it("rejects foreign workspace and disconnected server reads", async () => {
    const f = fixture();
    await f.load();
    await expect(
      readRemoteAttachment(f.registry, { ...f.request, workspaceId: "other" }, f.dependencies),
    ).rejects.toThrow();
    await expect(
      readRemoteAttachment(f.registry, f.request, { ...f.dependencies, resolveServer: () => null }),
    ).rejects.toThrow();
    expect(f.readAttachment).not.toHaveBeenCalled();
  });
  it("does not publish metadata that arrives after A to B to A ownership changes", async () => {
    const f = fixture();
    let finish!: (value: RemoteRunnerAttachment) => void;
    f.getAttachment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const loading = f.load();
    f.replace({ generation: 3 });
    finish(metadata);
    await expect(loading).rejects.toThrow();
    expect(f.registry.size).toBe(0);
  });
  it("rejects late bytes after owner replacement or registry cleanup", async () => {
    for (const cleanup of [false, true]) {
      const f = fixture();
      await f.load();
      let finish!: (value: { mediaType: "image/png"; base64: string }) => void;
      f.readAttachment.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const reading = readRemoteAttachment(f.registry, f.request, f.dependencies);
      if (cleanup) f.registry.clear();
      else f.replace({ generation: 2 });
      finish({ mediaType: "image/png", base64: "iVBORw==" });
      await expect(reading).rejects.toThrow();
    }
  });
  it("refreshes cached metadata when owner identity changes with the same generation", async () => {
    const f = fixture();
    await f.load();
    f.replace({ ownerId: "replacement-lease" });
    await f.load();
    expect(f.getAttachment).toHaveBeenCalledTimes(2);
    await expect(
      readRemoteAttachment(f.registry, f.request, f.dependencies),
    ).resolves.toBeInstanceOf(ArrayBuffer);
  });
  it("never projects or reads foreign runner metadata", async () => {
    const f = fixture();
    f.getAttachment.mockResolvedValueOnce({ ...metadata, runnerId: "foreign" });
    expect(await f.load()).toEqual([]);
    expect(remoteAttachmentBlocker(f.registry, f.request, f.dependencies)).toBe("loadFailed");
    await expect(readRemoteAttachment(f.registry, f.request, f.dependencies)).rejects.toThrow();
    expect(f.readAttachment).not.toHaveBeenCalled();
  });
  it("rejects oversized turns and never requests malformed attachment IDs", async () => {
    const f = fixture();
    await expect(
      f.load({ ...task, parts: Array.from({ length: 9 }, () => task.parts[0]!) }),
    ).rejects.toThrow();
    const malformed = await f.loadResult({
      ...task,
      parts: [{ type: "attachment", attachmentId: "../../local" }],
    });
    expect(malformed).toEqual({ attachments: [], discovered: ["loadFailed"] });
    expect(f.getAttachment).not.toHaveBeenCalled();
  });
  it("rejects mismatched media type and byte length", async () => {
    const f = fixture();
    await f.load();
    f.readAttachment.mockResolvedValueOnce({ mediaType: "image/png", base64: "YQ==" });
    await expect(readRemoteAttachment(f.registry, f.request, f.dependencies)).rejects.toThrow(
      "length",
    );
    const foreign = {
      ...f.dependencies,
      gateway: {
        readAttachment: async () => ({ mediaType: "image/jpeg", base64: "iVBORw==" }),
      } as unknown as RemoteRunnerGateway,
    };
    await expect(readRemoteAttachment(f.registry, f.request, foreign)).rejects.toThrow();
  });
  it("rejects late image bytes when the gateway connection is replaced", async () => {
    const f = fixture();
    await f.load();
    let current = true;
    let finish!: (value: { mediaType: "image/png"; base64: string }) => void;
    f.readAttachment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const reading = readRemoteAttachment(f.registry, f.request, {
      ...f.dependencies,
      isGatewayCurrent: () => current,
    });
    current = false;
    finish({ mediaType: "image/png", base64: "iVBORw==" });
    await expect(reading).rejects.toThrow();
  });
  it("rejects late metadata when the gateway connection is replaced", async () => {
    const f = fixture();
    let current = true;
    let finish!: (value: RemoteRunnerAttachment) => void;
    f.getAttachment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const loading = loadRemoteTaskAttachments(
      f.registry,
      task,
      "server",
      { projectRootKey: "project", workspaceId: "workspace", ownerId: "lease", generation: 1 },
      { ...f.dependencies, isGatewayCurrent: () => current },
    );
    current = false;
    finish(metadata);
    await expect(loading).rejects.toThrow();
    expect(f.registry.size).toBe(0);
  });
  it("keeps metadata capacity bounded when concurrent loads settle together", async () => {
    const f = fixture();
    await f.load();
    const seed = [...f.registry.values()][0]!;
    for (let index = 1; index < 511; index += 1) f.registry.set(`retained-${index}`, seed);
    const ids = ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];
    const finishes: ((value: RemoteRunnerAttachment) => void)[] = [];
    f.getAttachment.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve);
        }),
    );
    const pending = ids.map((attachmentId) =>
      f.load({ ...task, parts: [{ type: "attachment", attachmentId }] }),
    );
    finishes.forEach((finish, index) => finish({ ...metadata, id: ids[index]! }));
    const outcomes = await Promise.all(pending);
    expect(outcomes.map((attachments) => attachments.length).sort()).toEqual([0, 1]);
    const blockers = ids.map((attachmentId) =>
      remoteAttachmentBlocker(
        f.registry,
        { ...f.request, attachmentId: attachmentId.replace(/-/g, "") },
        f.dependencies,
      ),
    );
    expect(blockers.sort()).toEqual(["limit", null]);
    const stored = [...f.registry.values()].filter((entry) => entry.kind === "stored");
    expect(stored).toHaveLength(MAX_REMOTE_ATTACHMENT_ENTRIES);
    f.getAttachment.mockClear();
    const again = await Promise.all(
      ids.map((attachmentId) =>
        f.loadResult({ ...task, parts: [{ type: "attachment", attachmentId }] }),
      ),
    );
    expect(again.flatMap((result) => result.discovered)).toEqual([]);
    expect(f.getAttachment).not.toHaveBeenCalled();
  });
  it("preserves both conversation authorizations when equivalent metadata loads settle concurrently", async () => {
    const f = fixture();
    const finishes: ((value: RemoteRunnerAttachment) => void)[] = [];
    f.getAttachment.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve);
        }),
    );
    const pending = [f.load(), f.load({ ...task, conversationId: "second-root" })];
    finishes.forEach((finish) => finish(metadata));
    await Promise.all(pending);
    expect(f.registry.size).toBe(1);
    await expect(
      readRemoteAttachment(f.registry, f.request, f.dependencies),
    ).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(
      readRemoteAttachment(
        f.registry,
        { ...f.request, threadId: remoteAgentThreadKey("server", "runner", "second-root") },
        f.dependencies,
      ),
    ).resolves.toBeInstanceOf(ArrayBuffer);
  });
});

const reasons: readonly RemoteAttachmentUnavailableReason[] = [
  "notConnected",
  "notLoaded",
  "foreign",
  "notStored",
  "loadFailed",
  "readFailed",
  "busy",
  "unsupported",
  "limit",
];
const retention = (connected: boolean) => ({
  ownerIsRetained: () => true,
  ownerIsCurrent: () => connected,
});
const notFound = () => new RemoteRunnerRequestRejectedError("Runner request failed (HTTP 404).");
async function reasonOf(
  operation: Promise<unknown>,
): Promise<RemoteAttachmentUnavailableReason | null> {
  const failure: unknown = await operation.then(
    () => null,
    (error: unknown) => error,
  );
  return failure instanceof RemoteAttachmentUnavailableError ? failure.reason : null;
}

describe("remote attachment availability reasons", () => {
  it("gives every closed reason short plain copy without backend detail", () => {
    const messages = reasons.map(remoteAttachmentUnavailableMessage);
    expect(new Set(messages).size).toBe(reasons.length);
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(160);
      expect(message).not.toMatch(/HTTP|[0-9a-f]{8}-|\//);
    }
    expect(reasons.map(remoteAttachmentRecovery)).toEqual([
      "whenReady",
      "whenReady",
      "never",
      "afterReconnect",
      "afterReconnect",
      "afterReconnect",
      "afterReconnect",
      "never",
      "afterReconnect",
    ]);
    expect(remoteAttachmentErrorRecovery(new RemoteAttachmentUnavailableError("foreign"))).toBe(
      "never",
    );
    expect(remoteAttachmentErrorRecovery(new Error("Runner request failed (HTTP 503)."))).toBe(
      "afterReconnect",
    );
  });
  it("reports missing image details as retryable before any metadata is registered", async () => {
    const f = fixture();
    expect(await reasonOf(readRemoteAttachment(f.registry, f.request, f.dependencies))).toBe(
      "notLoaded",
    );
    expect(
      remoteAttachmentBlocker(f.registry, f.request, {
        ...f.dependencies,
        isWorkspaceConnected: () => false,
      }),
    ).toBe("notConnected");
    expect(f.readAttachment).not.toHaveBeenCalled();
  });
  it("fails closed while the server is not connected and serves the retained entry afterwards", async () => {
    const f = fixture();
    await f.load();
    const disconnected = { ...f.dependencies, ownerIsCurrent: () => false };
    expect(remoteAttachmentBlocker(f.registry, f.request, disconnected)).toBe("notConnected");
    expect(await reasonOf(readRemoteAttachment(f.registry, f.request, disconnected))).toBe(
      "notConnected",
    );
    expect(
      await reasonOf(
        readRemoteAttachment(f.registry, f.request, { ...f.dependencies, gateway: null }),
      ),
    ).toBe("notConnected");
    expect(
      await reasonOf(
        readRemoteAttachment(f.registry, f.request, {
          ...f.dependencies,
          isGatewayCurrent: () => false,
        }),
      ),
    ).toBe("notConnected");
    expect(f.readAttachment).not.toHaveBeenCalled();
    expect(remoteAttachmentBlocker(f.registry, f.request, f.dependencies)).toBeNull();
    await expect(
      readRemoteAttachment(f.registry, f.request, f.dependencies),
    ).resolves.toBeInstanceOf(ArrayBuffer);
    expect(f.getAttachment).toHaveBeenCalledTimes(1);
  });
  it("does not load metadata while the owner is not connected", async () => {
    const f = fixture();
    const disconnected = { ...f.dependencies, ownerIsCurrent: () => false };
    expect(
      await reasonOf(
        loadRemoteTaskAttachments(
          f.registry,
          task,
          "server",
          { projectRootKey: "project", workspaceId: "workspace", ownerId: "lease", generation: 1 },
          disconnected,
        ),
      ),
    ).toBe("notConnected");
    expect(f.getAttachment).not.toHaveBeenCalled();
    expect(f.registry.size).toBe(0);
  });
  it("reports another thread or another server as not belonging to the conversation", async () => {
    const f = fixture();
    await f.load();
    expect(
      await reasonOf(
        readRemoteAttachment(
          f.registry,
          { ...f.request, threadId: remoteAgentThreadKey("server", "runner", "other") },
          f.dependencies,
        ),
      ),
    ).toBe("foreign");
    expect(
      await reasonOf(
        readRemoteAttachment(f.registry, f.request, {
          ...f.dependencies,
          resolveServer: () => "replacement",
        }),
      ),
    ).toBe("foreign");
    expect(f.readAttachment).not.toHaveBeenCalled();
  });
  it("reports content the runner answers 404 for as no longer stored", async () => {
    const f = fixture();
    await f.load();
    f.readAttachment.mockRejectedValueOnce(notFound());
    expect(await reasonOf(readRemoteAttachment(f.registry, f.request, f.dependencies))).toBe(
      "notStored",
    );
  });
  it("remembers metadata the runner answers 404 for and still loads sibling images", async () => {
    const f = fixture();
    const sibling = "33333333-3333-4333-8333-333333333333";
    f.getAttachment.mockRejectedValueOnce(notFound());
    f.getAttachment.mockResolvedValueOnce({ ...metadata, id: sibling });
    const turn = {
      ...task,
      parts: [
        { type: "attachment" as const, attachmentId: id },
        { type: "attachment" as const, attachmentId: sibling },
      ],
    };
    const first = await f.loadResult(turn);
    expect(first.discovered).toEqual(["notStored"]);
    expect(first.attachments.map((attachment) => attachment.name)).toEqual(["shot.png"]);
    expect(first.attachments[0]).toMatchObject({ remote: { attachmentId: sibling } });
    const second = await f.loadResult(turn);
    expect(second.discovered).toEqual([]);
    expect(second.attachments).toHaveLength(1);
    expect(f.getAttachment).toHaveBeenCalledTimes(2);
    expect(remoteAttachmentBlocker(f.registry, f.request, f.dependencies)).toBe("notStored");
    expect(await reasonOf(readRemoteAttachment(f.registry, f.request, f.dependencies))).toBe(
      "notStored",
    );
    expect(f.readAttachment).not.toHaveBeenCalled();
  });
  it("does not treat an untyped failure as a missing image", async () => {
    const f = fixture();
    f.getAttachment.mockRejectedValueOnce(new Error("Runner request failed (HTTP 404)."));
    expect((await f.loadResult()).discovered).toEqual(["loadFailed"]);
  });
  it.each([
    [
      "a server error",
      (f: ReturnType<typeof fixture>) =>
        f.getAttachment.mockRejectedValue(new Error("ssh: connect to host 10.0.0.7 refused")),
    ],
    [
      "invalid metadata",
      (f: ReturnType<typeof fixture>) =>
        f.getAttachment.mockResolvedValue({ ...metadata, bytes: 0 }),
    ],
    [
      "malformed metadata",
      (f: ReturnType<typeof fixture>) =>
        f.getAttachment.mockResolvedValue({ id } as unknown as RemoteRunnerAttachment),
    ],
  ] as const)(
    "settles %s as a failed load that is reported once and not requested again",
    async (_name, fail) => {
      const f = fixture();
      fail(f);
      expect(await f.loadResult()).toEqual({ attachments: [], discovered: ["loadFailed"] });
      expect(await f.loadResult()).toEqual({ attachments: [], discovered: [] });
      expect(f.getAttachment).toHaveBeenCalledTimes(1);
      expect(remoteAttachmentBlocker(f.registry, f.request, f.dependencies)).toBe("loadFailed");
      expect(await reasonOf(readRemoteAttachment(f.registry, f.request, f.dependencies))).toBe(
        "loadFailed",
      );
      expect(f.readAttachment).not.toHaveBeenCalled();
    },
  );
  it("settles a server without image metadata support as unsupported without a request", async () => {
    const f = fixture();
    const unsupported = {
      ...f.dependencies,
      gateway: { readAttachment: f.readAttachment } as unknown as RemoteRunnerGateway,
    };
    const owner = {
      projectRootKey: "project",
      workspaceId: "workspace",
      ownerId: "lease",
      generation: 1,
    };
    const first = await loadRemoteTaskAttachments(f.registry, task, "server", owner, unsupported);
    const second = await loadRemoteTaskAttachments(f.registry, task, "server", owner, unsupported);
    expect(first).toEqual({ attachments: [], discovered: ["unsupported"] });
    expect(second.discovered).toEqual([]);
    expect(remoteAttachmentBlocker(f.registry, f.request, unsupported)).toBe("unsupported");
  });
  it("keeps a settled failure until an outage has been observed and has ended", async () => {
    for (const rejection of [notFound(), new Error("Runner request failed (HTTP 500).")]) {
      const f = fixture();
      f.getAttachment.mockRejectedValueOnce(rejection);
      const [reason] = (await f.loadResult()).discovered;
      expect(reviseRemoteAttachments(f.registry, retention(true)).size).toBe(0);
      expect(remoteAttachmentBlocker(f.registry, f.request, f.dependencies)).toBe(reason);
      reviseRemoteAttachments(f.registry, retention(false));
      expect(remoteAttachmentBlocker(f.registry, f.request, f.dependencies)).toBe(reason);
      expect((await f.loadResult()).discovered).toEqual([]);
      expect(f.getAttachment).toHaveBeenCalledTimes(1);
      expect(reviseRemoteAttachments(f.registry, retention(true)).size).toBe(0);
      expect(remoteAttachmentBlocker(f.registry, f.request, f.dependencies)).toBe("notLoaded");
      expect(await f.load()).toHaveLength(1);
      expect(f.getAttachment).toHaveBeenCalledTimes(2);
      await expect(
        readRemoteAttachment(f.registry, f.request, f.dependencies),
      ).resolves.toBeInstanceOf(ArrayBuffer);
    }
  });
  it("retries busy metadata quietly instead of settling it as a failure", async () => {
    const f = fixture();
    f.getAttachment.mockRejectedValueOnce(new Error("Runner request failed (HTTP 503)."));
    const failure: unknown = await f.loadResult().then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ reason: "busy" });
    expect(remoteAttachmentLoadRetriesQuietly(failure)).toBe(true);
    expect(
      remoteAttachmentLoadRetriesQuietly(new RemoteAttachmentUnavailableError("notConnected")),
    ).toBe(true);
    expect(remoteAttachmentLoadRetriesQuietly(new RemoteAttachmentUnavailableError("limit"))).toBe(
      false,
    );
    expect(remoteAttachmentLoadRetriesQuietly(new Error("Too many server images."))).toBe(false);
    expect(f.registry.size).toBe(0);
    expect(await f.load()).toHaveLength(1);
  });
  it("does not let a concurrent failed load replace registered metadata", async () => {
    const f = fixture();
    const finishes: ((value: RemoteRunnerAttachment) => void)[] = [];
    const rejects: ((error: unknown) => void)[] = [];
    f.getAttachment.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finishes.push(resolve);
          rejects.push(reject);
        }),
    );
    const pending = [f.loadResult(), f.loadResult()];
    finishes[0]!(metadata);
    rejects[1]!(new Error("Runner request failed (HTTP 500)."));
    const [stored, failed] = await Promise.all(pending);
    expect(stored?.attachments).toHaveLength(1);
    expect(failed).toMatchObject({ discovered: [] });
    expect(failed?.attachments).toHaveLength(1);
    expect(remoteAttachmentBlocker(f.registry, f.request, f.dependencies)).toBeNull();
  });
  it("names the image type of registered images only", async () => {
    const f = fixture();
    expect(remoteAttachmentImageMime(f.registry, f.request)).toBeNull();
    await f.load();
    expect(remoteAttachmentImageMime(f.registry, f.request)).toBe("image/png");
  });
  it("presents an exhausted busy read with fixed copy", () => {
    const presented = presentRemoteAttachmentError(new Error("Runner request failed (HTTP 503)."));
    expect(presented).toMatchObject({
      reason: "busy",
      message: remoteAttachmentUnavailableMessage("busy"),
    });
    const other = new Error("Invalid server image content.");
    expect(presentRemoteAttachmentError(other)).toBe(other);
  });
  it("hides other read failures behind a closed reason and keeps runner-busy retries intact", async () => {
    const f = fixture();
    await f.load();
    f.readAttachment.mockRejectedValueOnce(new Error("ssh: connect to host 10.0.0.7 refused"));
    const failure: unknown = await readRemoteAttachment(f.registry, f.request, f.dependencies).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(RemoteAttachmentUnavailableError);
    expect(failure).toMatchObject({
      reason: "readFailed",
      message: remoteAttachmentUnavailableMessage("readFailed"),
    });
    f.readAttachment.mockRejectedValueOnce(new Error("Runner request failed (HTTP 503)."));
    await expect(readRemoteAttachment(f.registry, f.request, f.dependencies)).rejects.toThrow(
      "Runner request failed (HTTP 503).",
    );
  });
  it("reports bytes that arrive after connectivity dropped as not connected", async () => {
    const f = fixture();
    await f.load();
    let connected = true;
    let finish!: (value: { mediaType: "image/png"; base64: string }) => void;
    f.readAttachment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const reading = reasonOf(
      readRemoteAttachment(f.registry, f.request, {
        ...f.dependencies,
        ownerIsCurrent: (owner) => connected && f.ownerIsCurrent(owner),
      }),
    );
    connected = false;
    finish({ mediaType: "image/png", base64: "iVBORw==" });
    expect(await reading).toBe("notConnected");
  });
  it("prunes only owners that are no longer retained and names their workspaces", async () => {
    const f = fixture();
    await f.load();
    expect(reviseRemoteAttachments(f.registry, retention(false)).size).toBe(0);
    expect(f.registry.size).toBe(1);
    const owned = { ownerIsRetained: f.ownerIsCurrent, ownerIsCurrent: f.ownerIsCurrent };
    expect([...reviseRemoteAttachments(f.registry, owned)]).toEqual([]);
    f.replace({ generation: 2 });
    expect([...reviseRemoteAttachments(f.registry, owned)]).toEqual(["workspace"]);
    expect(f.registry.size).toBe(0);
    expect(await reasonOf(readRemoteAttachment(f.registry, f.request, f.dependencies))).toBe(
      "notLoaded",
    );
  });
});

const numbered = (index: number): string =>
  `${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const turnOf = (indexes: readonly number[], conversationId?: string): RemoteRunnerTask => ({
  ...task,
  ...(conversationId === undefined ? {} : { conversationId }),
  parts: indexes.map((index) => ({ type: "attachment", attachmentId: numbered(index) })),
});
const range = (start: number, count: number): readonly number[] =>
  Array.from({ length: count }, (_, offset) => start + offset);
async function fill(
  f: ReturnType<typeof fixture>,
  start: number,
  count: number,
  conversationId?: string,
) {
  const discovered: string[] = [];
  for (let offset = 0; offset < count; offset += 8) {
    const indexes = range(start + offset, Math.min(8, count - offset));
    discovered.push(...(await f.loadResult(turnOf(indexes, conversationId))).discovered);
  }
  return discovered;
}
function saturating() {
  const f = fixture();
  f.getAttachment.mockImplementation(async ({ attachmentId }) => ({
    ...metadata,
    id: attachmentId,
  }));
  const onEvicted = vi.fn();
  const dependencies = { ...f.dependencies, onEvicted };
  const owner = {
    projectRootKey: "project",
    workspaceId: "workspace",
    ownerId: "lease",
    generation: 1,
  };
  const requestFor = (index: number, conversationId: string = task.id) => ({
    workspaceId: "workspace",
    attachmentId: numbered(index).replace(/-/g, ""),
    threadId: remoteAgentThreadKey("server", "runner", conversationId),
  });
  return {
    ...f,
    onEvicted,
    requestFor,
    loadEvicting: (value: RemoteRunnerTask) =>
      loadRemoteTaskAttachments(f.registry, value, "server", owner, dependencies),
  };
}

describe("remote attachment registry saturation", () => {
  it("evicts the oldest images of other conversations to make room and says so", async () => {
    const f = saturating();
    await fill(f, 1, MAX_REMOTE_ATTACHMENT_ENTRIES, "other");
    expect(f.registry.size).toBe(MAX_REMOTE_ATTACHMENT_ENTRIES);
    const loaded = await f.loadEvicting(turnOf([9001, 9002]));
    expect(loaded.attachments).toHaveLength(2);
    expect(loaded.discovered).toEqual([]);
    expect(f.onEvicted).toHaveBeenCalledTimes(1);
    expect(f.registry.size).toBe(MAX_REMOTE_ATTACHMENT_ENTRIES);
    expect(remoteAttachmentBlocker(f.registry, f.requestFor(1, "other"), f.dependencies)).toBe(
      "notLoaded",
    );
    expect(remoteAttachmentBlocker(f.registry, f.requestFor(2, "other"), f.dependencies)).toBe(
      "notLoaded",
    );
    expect(
      remoteAttachmentBlocker(f.registry, f.requestFor(3, "other"), f.dependencies),
    ).toBeNull();
    expect(remoteAttachmentBlocker(f.registry, f.requestFor(9001), f.dependencies)).toBeNull();

    f.getAttachment.mockClear();
    const again = await f.loadEvicting(turnOf([1], "other"));
    expect(again.attachments).toHaveLength(1);
    expect(f.getAttachment).toHaveBeenCalledTimes(1);
    expect(f.onEvicted).toHaveBeenCalledTimes(2);
    expect(remoteAttachmentBlocker(f.registry, f.requestFor(9001), f.dependencies)).toBe(
      "notLoaded",
    );
    expect(remoteAttachmentBlocker(f.registry, f.requestFor(9002), f.dependencies)).toBeNull();
    expect(
      remoteAttachmentBlocker(f.registry, f.requestFor(3, "other"), f.dependencies),
    ).toBeNull();
  });
  it("never evicts images of the conversation being loaded and settles the overflow as a limit", async () => {
    const f = saturating();
    await fill(f, 1, MAX_REMOTE_ATTACHMENT_ENTRIES);
    f.getAttachment.mockClear();
    const overflow = await f.loadEvicting(turnOf([9001]));
    expect(overflow).toEqual({ attachments: [], discovered: ["limit"] });
    expect((await f.loadEvicting(turnOf([9001]))).discovered).toEqual([]);
    expect(f.onEvicted).not.toHaveBeenCalled();
    expect(f.getAttachment).not.toHaveBeenCalled();
    expect(remoteAttachmentBlocker(f.registry, f.requestFor(9001), f.dependencies)).toBe("limit");
    expect(remoteAttachmentBlocker(f.registry, f.requestFor(1), f.dependencies)).toBeNull();
  });
  it("keeps reporting a limit without throwing once every budget belongs to the conversation", async () => {
    const f = saturating();
    const discovered = await fill(f, 1, MAX_REMOTE_ATTACHMENT_ENTRIES + 128);
    expect(discovered.filter((reason) => reason === "limit").length).toBeGreaterThan(0);
    expect(f.getAttachment).toHaveBeenCalledTimes(MAX_REMOTE_ATTACHMENT_ENTRIES);
    const size = f.registry.size;
    const first = await f.loadEvicting(turnOf([9001]));
    const second = await f.loadEvicting(turnOf([9001]));
    expect(first).toEqual({ attachments: [], discovered: ["limit"] });
    expect(second).toEqual({ attachments: [], discovered: ["limit"] });
    expect(f.registry.size).toBe(size);
    expect(f.onEvicted).not.toHaveBeenCalled();
  });
  it("loads a limited image again once room has been freed", async () => {
    const f = saturating();
    await fill(f, 1, MAX_REMOTE_ATTACHMENT_ENTRIES);
    expect((await f.loadEvicting(turnOf([9001]))).discovered).toEqual(["limit"]);
    const [oldest] = f.registry.keys();
    f.registry.delete(oldest!);
    f.registry.delete([...f.registry.keys()][0]!);
    const freed = await f.loadEvicting(turnOf([9001]));
    expect(freed.attachments).toHaveLength(1);
    expect(remoteAttachmentBlocker(f.registry, f.requestFor(9001), f.dependencies)).toBeNull();
  });
  it("announces evictions once even when the load is rejected part way", async () => {
    const f = saturating();
    await fill(f, 1, MAX_REMOTE_ATTACHMENT_ENTRIES, "other");
    let connected = true;
    const loading = loadRemoteTaskAttachments(
      f.registry,
      turnOf([9001, 9002, 9003]),
      "server",
      { projectRootKey: "project", workspaceId: "workspace", ownerId: "lease", generation: 1 },
      {
        ...f.dependencies,
        onEvicted: f.onEvicted,
        ownerIsCurrent: (owner) => connected && f.ownerIsCurrent(owner),
      },
    );
    f.getAttachment.mockImplementationOnce(async ({ attachmentId }) => {
      connected = false;
      return { ...metadata, id: attachmentId };
    });
    expect(await reasonOf(loading)).toBe("notConnected");
    expect(f.onEvicted).toHaveBeenCalledTimes(1);
    expect(f.registry.size).toBe(MAX_REMOTE_ATTACHMENT_ENTRIES);
  });
  it("does not evict anything for a load that settles as a failure", async () => {
    const f = saturating();
    await fill(f, 1, MAX_REMOTE_ATTACHMENT_ENTRIES, "other");
    f.getAttachment.mockRejectedValueOnce(notFound());
    f.getAttachment.mockRejectedValueOnce(new Error("Runner request failed (HTTP 500)."));
    const failed = await f.loadEvicting(turnOf([9001, 9002]));
    expect(failed).toEqual({ attachments: [], discovered: ["notStored", "loadFailed"] });
    expect(f.onEvicted).not.toHaveBeenCalled();
    expect(f.registry.size).toBe(MAX_REMOTE_ATTACHMENT_ENTRIES + 2);
    expect(
      remoteAttachmentBlocker(f.registry, f.requestFor(1, "other"), f.dependencies),
    ).toBeNull();
  });
  it("remembers a real failure that replaces a stale limit instead of asking again", async () => {
    const f = saturating();
    await fill(f, 1, MAX_REMOTE_ATTACHMENT_ENTRIES);
    expect((await f.loadEvicting(turnOf([9001]))).discovered).toEqual(["limit"]);
    f.registry.delete([...f.registry.keys()][0]!);
    f.registry.delete([...f.registry.keys()][0]!);
    f.getAttachment.mockClear();
    f.getAttachment.mockRejectedValueOnce(new Error("Runner request failed (HTTP 500)."));
    expect((await f.loadEvicting(turnOf([9001]))).discovered).toEqual(["loadFailed"]);
    expect(remoteAttachmentBlocker(f.registry, f.requestFor(9001), f.dependencies)).toBe(
      "loadFailed",
    );
    expect((await f.loadEvicting(turnOf([9001]))).discovered).toEqual([]);
    expect((await f.loadEvicting(turnOf([9001]))).discovered).toEqual([]);
    expect(f.getAttachment).toHaveBeenCalledTimes(1);
  });
});

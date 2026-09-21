import { describe, expect, it, vi } from "vitest";
import type {
  RemoteRunnerAttachment,
  RemoteRunnerGateway,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import {
  loadRemoteTaskAttachments,
  readRemoteAttachment,
  type RemoteAttachmentRegistry,
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
  const getAttachment = vi.fn(async () => metadata);
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
  };
  return {
    registry,
    gateway,
    getAttachment,
    readAttachment,
    request,
    dependencies,
    load: (value = task) =>
      loadRemoteTaskAttachments(
        registry,
        value,
        "server",
        currentOwner,
        gateway,
        ownerIsCurrent,
        dependencies.isGatewayCurrent,
      ),
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
  it("rejects foreign runner metadata without registering it", async () => {
    const f = fixture();
    f.getAttachment.mockResolvedValueOnce({ ...metadata, runnerId: "foreign" });
    await expect(f.load()).rejects.toThrow();
    expect(f.registry.size).toBe(0);
  });
  it("rejects oversized turns and malformed attachment IDs before fetching", async () => {
    const f = fixture();
    await expect(
      f.load({ ...task, parts: Array.from({ length: 9 }, () => task.parts[0]!) }),
    ).rejects.toThrow();
    await expect(
      f.load({ ...task, parts: [{ type: "attachment", attachmentId: "../../local" }] }),
    ).rejects.toThrow();
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
      f.gateway,
      f.dependencies.ownerIsCurrent,
      () => current,
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
    const settled = Promise.allSettled(pending);
    finishes.forEach((finish, index) => finish({ ...metadata, id: ids[index]! }));
    const outcomes = await settled;
    expect(f.registry.size).toBe(512);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
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

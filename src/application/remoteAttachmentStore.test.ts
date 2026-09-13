import { describe, expect, it, vi } from "vitest";
import { RemoteAttachmentStore } from "./remoteAttachmentStore";
import type { RemoteRunnerGateway, RemoteRunnerUploadRequest } from "../domain/remoteRunner";
import type { StageAgentAttachmentBytesRequest } from "./agentAttachmentPorts";

const owner = {
  projectRootKey: "project",
  workspaceId: "workspace",
  ownerId: "lease",
  generation: 1,
};
const input = (): StageAgentAttachmentBytesRequest => ({
  workspaceId: "workspace",
  kind: "image",
  name: "image.png",
  mime: "image/png",
  width: 1,
  height: 1,
  bytes: new Uint8Array([137, 80, 78, 71]).buffer,
});
function fixture() {
  let current = true;
  let generation = 1;
  const uploadAttachment = vi.fn(async (request: RemoteRunnerUploadRequest) => ({
    created: true,
    attachment: {
      id: request.attachmentId,
      runnerId: "runner",
      name: request.name,
      mediaType: request.mediaType,
      bytes: 4,
      width: 1,
      height: 1,
      sha256: "a".repeat(64),
      createdAt: "2026-09-13T00:00:00.000Z",
    },
  }));
  const gateway = { uploadAttachment } as unknown as RemoteRunnerGateway;
  const store = new RemoteAttachmentStore({
    getGateway: () => gateway,
    resolveOwner: () => ({ ...owner, generation }),
    ownerIsCurrent: (candidate) =>
      current && candidate.generation === generation && candidate.ownerId === "lease",
  });
  return {
    store,
    uploadAttachment,
    replaceOwner: () => {
      generation++;
    },
    expire: () => {
      current = false;
    },
  };
}
async function request(store: RemoteAttachmentStore) {
  const staged = await store.stageAgentAttachmentBytes(input());
  return { attachmentOwner: owner, attachments: [{ kind: "staged" as const, ...staged }] };
}
describe("RemoteAttachmentStore", () => {
  it("copies bytes and reuses one upload for concurrent resolution and retries", async () => {
    const { store, uploadAttachment } = fixture();
    const source = input();
    const staged = await store.stageAgentAttachmentBytes(source);
    new Uint8Array(source.bytes).fill(0);
    const turn = { attachmentOwner: owner, attachments: [{ kind: "staged" as const, ...staged }] };
    const [a, b] = await Promise.all([
      store.resolve(turn, "server"),
      store.resolve(turn, "server"),
    ]);
    expect(a).toEqual(b);
    expect(await store.resolve(turn, "server")).toEqual(a);
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    expect(uploadAttachment.mock.calls[0]![0].base64).toBe("iVBORw==");
  });
  it("rejects foreign ownership and metadata before uploading", async () => {
    const { store, uploadAttachment } = fixture();
    const turn = await request(store);
    await expect(
      store.resolve({ ...turn, attachmentOwner: { ...owner, generation: 2 } }, "server"),
    ).rejects.toThrow("no longer matches");
    await expect(
      store.resolve(
        { ...turn, attachments: [{ ...turn.attachments[0]!, name: "other.png" }] },
        "server",
      ),
    ).rejects.toThrow("no longer matches");
    await expect(
      store.resolve({ ...turn, attachmentOwner: { ...owner, workspaceId: "other" } }, "server"),
    ).rejects.toThrow("no longer matches");
    expect(uploadAttachment).not.toHaveBeenCalled();
  });
  it("refuses a prior generation's stage even when its replacement is current", async () => {
    const { store, uploadAttachment, replaceOwner } = fixture();
    const turn = await request(store);
    replaceOwner();
    await expect(
      store.resolve({ ...turn, attachmentOwner: { ...owner, generation: 2 } }, "server"),
    ).rejects.toThrow("no longer matches");
    expect(uploadAttachment).not.toHaveBeenCalled();
  });
  it("rejects a late upload after owner replacement", async () => {
    const { store, uploadAttachment, expire } = fixture();
    const original = uploadAttachment.getMockImplementation()!;
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    uploadAttachment.mockImplementation(async (r) => {
      await wait;
      return original(r);
    });
    const pending = store.resolve(await request(store), "server");
    expire();
    finish();
    await expect(pending).rejects.toThrow("owner changed");
  });
  it("clear revokes an in-flight stage even with an unchanged owner", async () => {
    const { store, uploadAttachment } = fixture();
    const original = uploadAttachment.getMockImplementation()!;
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    uploadAttachment.mockImplementation(async (r) => {
      await wait;
      return original(r);
    });
    const pending = store.resolve(await request(store), "server");
    store.clear();
    finish();
    await expect(pending).rejects.toThrow("owner changed");
  });
  it("retains the upload ID after an uncertain failure", async () => {
    const { store, uploadAttachment } = fixture();
    const turn = await request(store);
    uploadAttachment.mockRejectedValueOnce(new Error("Disconnected"));
    await expect(store.resolve(turn, "server")).rejects.toThrow("Disconnected");
    await store.resolve(turn, "server");
    expect(uploadAttachment.mock.calls[0]![0]).toEqual(uploadAttachment.mock.calls[1]![0]);
  });
  it("rejects mismatched server metadata", async () => {
    const { store, uploadAttachment } = fixture();
    const original = uploadAttachment.getMockImplementation()!;
    uploadAttachment.mockImplementation(async (r) => {
      const response = await original(r);
      return { ...response, attachment: { ...response.attachment, width: 2 } };
    });
    await expect(store.resolve(await request(store), "server")).rejects.toThrow("does not match");
  });
  it("enforces image, path, count, dimension and memory boundaries", async () => {
    const { store, uploadAttachment } = fixture();
    for (const change of [
      { mime: "image/gif" as const },
      { name: "../x.png" },
      { width: 8193 },
      { bytes: new ArrayBuffer(5 * 1024 * 1024 + 1) },
    ])
      await expect(store.stageAgentAttachmentBytes({ ...input(), ...change })).rejects.toThrow();
    await expect(
      store.stageAgentAttachmentFromPath({
        workspaceId: "workspace",
        kind: "image",
        name: "x.png",
        mime: "image/png",
        path: "/tmp/x.png",
      }),
    ).rejects.toThrow("local file paths");
    const turn = await request(store);
    await expect(
      store.resolve({ ...turn, attachments: Array(9).fill(turn.attachments[0]) }, "server"),
    ).rejects.toThrow();
    await expect(
      store.resolve({ ...turn, attachments: [...turn.attachments, ...turn.attachments] }, "server"),
    ).rejects.toThrow("unique");
    expect(uploadAttachment).not.toHaveBeenCalled();
    store.clear();
    for (let i = 0; i < 8; i++)
      await store.stageAgentAttachmentBytes({
        ...input(),
        bytes: new ArrayBuffer(5 * 1024 * 1024),
      });
    await expect(store.stageAgentAttachmentBytes(input())).rejects.toThrow("full");
  });
  it("only the staging workspace can release bytes", async () => {
    const { store } = fixture();
    const turn = await request(store);
    const attachmentId = turn.attachments[0]!.attachmentId;
    await store.releaseAgentAttachment({ workspaceId: "other", attachmentId });
    await expect(store.resolve(turn, "server")).resolves.toHaveLength(1);
    await store.releaseAgentAttachment({ workspaceId: owner.workspaceId, attachmentId });
    await expect(store.resolve(turn, "server")).rejects.toThrow("no longer matches");
  });
});

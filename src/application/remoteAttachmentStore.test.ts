import { describe, expect, it, vi } from "vitest";
import { RemoteAttachmentStore } from "./remoteAttachmentStore";
import type { RemoteRunnerGateway, RemoteRunnerUploadRequest } from "../domain/remoteRunner";
import type { StageAgentAttachmentBytesRequest } from "./agentAttachmentPorts";
import type { AgentAttachmentEncoderPort } from "./agentAttachmentEncoderPort";

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
function fixture(customEncoder?: AgentAttachmentEncoderPort | null) {
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
  const encode = vi.fn(async (bytes: Uint8Array<ArrayBuffer>) =>
    btoa(String.fromCharCode(...bytes)),
  );
  const store = new RemoteAttachmentStore({
    getGateway: () => gateway,
    resolveOwner: () => ({ ...owner, generation }),
    ownerIsCurrent: (candidate) =>
      current && candidate.generation === generation && candidate.ownerId === "lease",
    encoder: customEncoder === undefined ? { encode } : customEncoder,
  });
  return {
    store,
    uploadAttachment,
    encode,
    currentOwner: () => ({ ...owner, generation }),
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
  it("settles shared failed uploads and shares one subsequent retry with the same ID", async () => {
    const { store, uploadAttachment, encode } = fixture();
    const turn = await request(store);
    uploadAttachment.mockRejectedValueOnce(new Error("Disconnected"));
    const failed = await Promise.allSettled([
      store.resolve(turn, "server"),
      store.resolve(turn, "server"),
    ]);
    expect(failed.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(uploadAttachment).toHaveBeenCalledOnce();
    const completed = await Promise.all([
      store.resolve(turn, "server"),
      store.resolve(turn, "server"),
    ]);
    expect(completed[0]).toEqual(completed[1]);
    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(encode).toHaveBeenCalledTimes(2);
    expect(uploadAttachment.mock.calls[0]![0].attachmentId).toBe(
      uploadAttachment.mock.calls[1]![0].attachmentId,
    );
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
    await vi.waitFor(() => expect(uploadAttachment).toHaveBeenCalledOnce());
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
    await vi.waitFor(() => expect(uploadAttachment).toHaveBeenCalledOnce());
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
      store.inspectAgentAttachmentCandidate({ workspaceId: "workspace", path: "/tmp/x.png" }),
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

  it("shares asynchronous encoding and never dispatches while encoding is pending", async () => {
    let finish!: (encoded: string) => void;
    const encode = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const { store, uploadAttachment } = fixture({ encode });
    const turn = await request(store);
    const first = store.resolve(turn, "server");
    const second = store.resolve(turn, "server");
    expect(encode).toHaveBeenCalledOnce();
    expect(uploadAttachment).not.toHaveBeenCalled();
    finish("iVBORw==");
    expect(await first).toEqual(await second);
    expect(uploadAttachment).toHaveBeenCalledOnce();
  });

  it.each(["replace", "clear", "release"] as const)(
    "rejects encoding settlement after %s without uploading",
    async (change) => {
      let finish!: (encoded: string) => void;
      let signal!: AbortSignal;
      const encode = vi.fn((_bytes: Uint8Array<ArrayBuffer>, capturedSignal: AbortSignal) => {
        signal = capturedSignal;
        return new Promise<string>((resolve) => (finish = resolve));
      });
      const { store, uploadAttachment, replaceOwner } = fixture({ encode });
      const turn = await request(store);
      const pending = store.resolve(turn, "server");
      if (change === "replace") replaceOwner();
      if (change === "clear") store.clear();
      if (change === "release")
        await store.releaseAgentAttachment({
          workspaceId: owner.workspaceId,
          attachmentId: turn.attachments[0]!.attachmentId,
        });
      expect(signal.aborted).toBe(change !== "replace");
      finish("iVBORw==");
      await expect(pending).rejects.toThrow("owner changed");
      expect(uploadAttachment).not.toHaveBeenCalled();
    },
  );

  it("retries encoding failure with the same upload ID and retained bytes", async () => {
    const encode = vi
      .fn<AgentAttachmentEncoderPort["encode"]>()
      .mockRejectedValueOnce(new Error("Encoding failed"))
      .mockResolvedValue("iVBORw==");
    const { store, uploadAttachment } = fixture({ encode });
    const turn = await request(store);
    await expect(store.resolve(turn, "server")).rejects.toThrow("Encoding failed");
    expect(uploadAttachment).not.toHaveBeenCalled();
    await store.resolve(turn, "server");
    expect(encode).toHaveBeenCalledTimes(2);
    expect(encode.mock.calls[0]![0]).toEqual(encode.mock.calls[1]![0]);
    uploadAttachment.mockRejectedValueOnce(new Error("Disconnected"));
    const next = await request(store);
    await expect(store.resolve(next, "server")).rejects.toThrow("Disconnected");
    await store.resolve(next, "server");
    expect(uploadAttachment.mock.calls[1]![0].attachmentId).toBe(
      uploadAttachment.mock.calls[2]![0].attachmentId,
    );
  });

  it("rejects an A B A encoding lease while allowing the replacement owner's own image", async () => {
    let finishOld!: (encoded: string) => void;
    const encode = vi
      .fn<AgentAttachmentEncoderPort["encode"]>()
      .mockImplementationOnce(() => new Promise<string>((resolve) => (finishOld = resolve)))
      .mockResolvedValue("iVBORw==");
    const { store, uploadAttachment, replaceOwner, currentOwner } = fixture({ encode });
    const old = store.resolve(await request(store), "server");
    replaceOwner();
    replaceOwner();
    const staged = await store.stageAgentAttachmentBytes(input());
    const replacement = await store.resolve(
      { attachmentOwner: currentOwner(), attachments: [{ kind: "staged", ...staged }] },
      "server",
    );
    expect(replacement).toHaveLength(1);
    finishOld("iVBORw==");
    await expect(old).rejects.toThrow("owner changed");
    expect(uploadAttachment).toHaveBeenCalledOnce();
    expect(encode).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the asynchronous encoder is unavailable", async () => {
    const { store, uploadAttachment } = fixture(null);
    await expect(store.resolve(await request(store), "server")).rejects.toThrow(
      "encoding is unavailable",
    );
    expect(uploadAttachment).not.toHaveBeenCalled();
  });
});

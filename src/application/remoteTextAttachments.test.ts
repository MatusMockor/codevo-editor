import { describe, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerUploadRequest } from "../domain/remoteRunner";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import { RemoteAttachmentStore } from "./remoteAttachmentStore";

const owner = {
  projectRootKey: "remote:server:runner:p",
  workspaceId: "w",
  ownerId: "o",
  generation: 1,
};
const metadata = {
  id: "12345678-1234-4234-8234-123456789012",
  runnerId: "runner",
  name: "pasted-text.txt",
  mediaType: "text/plain" as const,
  bytes: 4,
  sha256: "a".repeat(64),
  createdAt: "2026-09-21T00:00:00.000Z",
};
function fixture(supported = true) {
  let current = true;
  const getRunner = vi.fn(async () => ({
    protocolVersion: 1,
    runnerId: "runner",
    name: "Runner",
    capabilities: { taskExecution: true, eventReplay: true, textAttachments: supported },
  }));
  const uploadAttachment = vi.fn(async (r: RemoteRunnerUploadRequest) => ({
    created: true,
    attachment: { ...metadata, id: r.attachmentId, bytes: atob(r.base64).length },
  }));
  const gateway = { getRunner, uploadAttachment } as unknown as RemoteRunnerGateway;
  const store = new RemoteAttachmentStore({
    getGateway: () => gateway,
    resolveOwner: () => owner,
    ownerIsCurrent: () => current,
  });
  const stage = (bytes = new TextEncoder().encode("text").buffer) =>
    store.stageAgentAttachmentBytes({
      workspaceId: "w",
      kind: "file",
      name: "pasted-text.txt",
      mime: null,
      width: null,
      height: null,
      bytes,
    });
  return {
    store,
    stage,
    getRunner,
    uploadAttachment,
    expire: () => {
      current = false;
    },
  };
}
describe("remote pasted text files", () => {
  it("uploads full UTF8 content as a file and reuses upload on retry", async () => {
    const f = fixture();
    const staged = await f.stage(new TextEncoder().encode("🙂".repeat(10_000)).buffer);
    const request = {
      attachmentOwner: owner,
      attachments: [{ kind: "staged" as const, ...staged }],
    };
    await f.store.resolve(request, "server");
    await f.store.resolve(request, "server");
    expect(f.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(f.uploadAttachment.mock.calls[0]![0].mediaType).toBe("text/plain");
    expect(atob(f.uploadAttachment.mock.calls[0]![0].base64)).toHaveLength(40_000);
  });
  it("refuses old runners before uploading and retains draft bytes", async () => {
    const f = fixture(false);
    await expect(f.stage()).rejects.toThrow("Update this server");
    expect(f.uploadAttachment).not.toHaveBeenCalled();
  });
  it("rejects stale ownership after capability check", async () => {
    const f = fixture();
    const staged = await f.stage();
    const original = f.getRunner.getMockImplementation()!;
    f.getRunner.mockImplementation(async () => {
      const result = await original();
      f.expire();
      return result;
    });
    await expect(
      f.store.resolve(
        { attachmentOwner: owner, attachments: [{ kind: "staged", ...staged }] },
        "server",
      ),
    ).rejects.toThrow("owner changed");
    expect(f.uploadAttachment).not.toHaveBeenCalled();
  });
  it("retains an immutable copy while the server capability check is pending", async () => {
    const f = fixture();
    const bytes = new TextEncoder().encode("text");
    const pending = f.stage(bytes.buffer);
    bytes.fill(0);
    const staged = await pending;
    await f.store.resolve(
      { attachmentOwner: owner, attachments: [{ kind: "staged", ...staged }] },
      "server",
    );
    expect(atob(f.uploadAttachment.mock.calls[0]![0].base64)).toBe("text");
  });
  it("rejects stale staging after the capability check", async () => {
    const f = fixture();
    const original = f.getRunner.getMockImplementation()!;
    f.getRunner.mockImplementation(async () => {
      const result = await original();
      f.expire();
      return result;
    });
    await expect(f.stage()).rejects.toThrow("owner changed");
    expect(f.uploadAttachment).not.toHaveBeenCalled();
  });
  it("rejects invalid UTF8, NUL and oversized text before retaining it", async () => {
    const f = fixture();
    for (const bytes of [
      new Uint8Array([255]),
      new Uint8Array([0]),
      new Uint8Array(5 * 1024 * 1024 + 1),
    ])
      await expect(f.stage(bytes.buffer)).rejects.toThrow();
    await expect(f.stage()).resolves.toMatchObject({ bytes: 4, mime: null });
  });
  it("keeps file and image metadata variants closed", () => {
    expect(() => validateRemoteRunnerValue("getAttachment", "response", metadata)).not.toThrow();
    for (const bad of [
      { ...metadata, width: 1 },
      { ...metadata, mediaType: "application/pdf" },
      { ...metadata, bytes: 5 * 1024 * 1024 + 1 },
      { ...metadata, mediaType: "image/png" },
    ])
      expect(() => validateRemoteRunnerValue("getAttachment", "response", bad)).toThrow();
  });
});

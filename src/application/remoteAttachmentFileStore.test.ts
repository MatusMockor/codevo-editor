import { describe, expect, it, vi } from "vitest";
import type {
  RemoteRunnerDescriptor,
  RemoteRunnerGateway,
  RemoteRunnerUploadFileRequest,
} from "../domain/remoteRunner";
import {
  REMOTE_FILE_ATTACHMENTS_UNSUPPORTED_REFUSAL,
  REMOTE_FILE_UPLOAD_CHANGED_ERROR,
  REMOTE_FILE_UPLOAD_MISMATCH_ERROR,
  REMOTE_FILE_UPLOAD_STORAGE_FULL_ERROR,
} from "../domain/remoteRunnerFileAttachment";
import type { AgentAttachmentFileSourcePort } from "./agentAttachmentFileSourcePort";
import {
  REMOTE_FILE_ATTACHMENT_OWNER_CHANGED,
  REMOTE_FILE_ATTACHMENTS_DISCONNECTED,
  REMOTE_FILE_ATTACHMENTS_UNAVAILABLE,
} from "./remoteAttachmentFileTransfer";
import { RemoteAttachmentStore } from "./remoteAttachmentStore";
import type { AgentAttachmentOwner } from "./useAgentComposerAttachments";

const PROJECT = "remote:server:runner:project";
const MIB = 1024 * 1024;
const SOURCE_IDS = Array.from(
  { length: 40 },
  (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
);

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type Capabilities = RemoteRunnerDescriptor["capabilities"];
type UploadResponse = Awaited<ReturnType<NonNullable<RemoteRunnerGateway["uploadAttachmentFile"]>>>;

function storedFile(request: RemoteRunnerUploadFileRequest, bytes: number): UploadResponse {
  return {
    created: true,
    attachment: {
      id: request.attachmentId,
      runnerId: "runner",
      name: request.name,
      kind: "file",
      mediaType: "application/pdf",
      bytes,
      sha256: "a".repeat(64),
      createdAt: "2026-10-13T00:00:00.000Z",
    },
  };
}

function fixture(
  capabilities: Capabilities = { taskExecution: true, eventReplay: true, fileAttachments: true },
) {
  let generation = 1;
  let connected = true;
  let sourceIndex = 0;
  let stagedBytes = 2048;
  let runnerId = "runner";
  let respond: (request: RemoteRunnerUploadFileRequest) => Promise<UploadResponse> = async (
    request,
  ) => storedFile(request, stagedBytes);
  const getRunner = vi.fn(async () => ({
    protocolVersion: 1 as const,
    runnerId,
    name: "Runner",
    capabilities,
  }));
  const uploadAttachmentFile = vi.fn((request: RemoteRunnerUploadFileRequest) => respond(request));
  const cancelAttachmentUpload = vi.fn(async () => undefined);
  const uploadAttachment = vi.fn();
  const createGateway = () =>
    ({
      getRunner,
      uploadAttachment,
      uploadAttachmentFile,
      cancelAttachmentUpload,
    }) as unknown as RemoteRunnerGateway;
  let gateway: RemoteRunnerGateway | null = createGateway();
  const stage = vi.fn(async (path: string) => ({
    sourceId: SOURCE_IDS[sourceIndex++ % SOURCE_IDS.length]!,
    name: path.split("/").pop() ?? "",
    bytes: stagedBytes,
  }));
  const release = vi.fn(async () => undefined);
  const fileSource: AgentAttachmentFileSourcePort = { stage, release };
  const currentOwner = (): AgentAttachmentOwner => ({
    projectRootKey: PROJECT,
    workspaceId: PROJECT,
    ownerId: "lease",
    generation,
  });
  const store = new RemoteAttachmentStore({
    getGateway: () => gateway,
    resolveOwner: () => currentOwner(),
    ownerIsCurrent: (candidate) => connected && candidate.generation === generation,
    ownerIsRetained: (candidate) => candidate.generation === generation,
    encoder: { encode: async (bytes) => btoa(String.fromCharCode(...bytes)) },
  });
  const stageFile = (path = "/Users/dev/report.pdf") =>
    store.stageAgentAttachmentFile({ workspaceId: PROJECT, path, fileSource });
  const turn = async (path?: string) => {
    const owner = currentOwner();
    const staged = await stageFile(path);
    return {
      staged,
      request: { attachmentOwner: owner, attachments: [{ kind: "staged" as const, ...staged }] },
    };
  };
  return {
    store,
    stageFile,
    turn,
    stage,
    release,
    getRunner,
    uploadAttachment,
    uploadAttachmentFile,
    cancelAttachmentUpload,
    currentOwner,
    setStagedBytes: (bytes: number) => {
      stagedBytes = bytes;
    },
    setRunnerId: (id: string) => {
      runnerId = id;
    },
    respondWith: (next: typeof respond) => {
      respond = next;
    },
    disconnect: () => {
      connected = false;
    },
    reconnect: () => {
      connected = true;
    },
    replaceOwner: () => {
      generation += 1;
    },
    replaceGateway: () => {
      gateway = createGateway();
    },
  };
}

describe("remote path-backed attachment staging", () => {
  it("stages a native source after the exact runner announced file attachments", async () => {
    const f = fixture();
    const staged = await f.stageFile("/Users/dev/report.pdf");
    expect(staged).toEqual({
      attachmentId: expect.stringMatching(/^[0-9a-f]{32}$/),
      name: "report.pdf",
      mime: null,
      bytes: 2048,
      width: null,
      height: null,
      promptLineBytesMax: 0,
    });
    expect(Object.values(staged)).not.toContain(SOURCE_IDS[0]);
    expect(f.getRunner).toHaveBeenCalledWith({ serverId: "server" });
    expect(f.stage).toHaveBeenCalledWith("/Users/dev/report.pdf");
    expect(f.getRunner.mock.invocationCallOrder[0]).toBeLessThan(
      f.stage.mock.invocationCallOrder[0]!,
    );
    expect(f.uploadAttachmentFile).not.toHaveBeenCalled();
  });

  it.each([
    ["an old runner without the capability key", { taskExecution: true, eventReplay: true }],
    [
      "a runner that disabled file attachments",
      { taskExecution: true, eventReplay: true, fileAttachments: false },
    ],
  ] as const)("refuses %s before touching the file", async (_label, capabilities) => {
    const f = fixture(capabilities);
    await expect(f.stageFile()).rejects.toThrow(REMOTE_FILE_ATTACHMENTS_UNSUPPORTED_REFUSAL);
    expect(f.stage).not.toHaveBeenCalled();
  });

  it("refuses a server that now hosts another runner", async () => {
    const f = fixture();
    f.setRunnerId("other-runner");
    await expect(f.stageFile()).rejects.toThrow(REMOTE_FILE_ATTACHMENTS_UNSUPPORTED_REFUSAL);
    expect(f.stage).not.toHaveBeenCalled();
  });

  it("asks no capability and stages nothing while the server is disconnected", async () => {
    const f = fixture();
    f.disconnect();
    await expect(f.stageFile()).rejects.toThrow(REMOTE_FILE_ATTACHMENTS_DISCONNECTED);
    expect(f.getRunner).not.toHaveBeenCalled();
    expect(f.stage).not.toHaveBeenCalled();
  });

  it("refuses a gateway that cannot stream files", async () => {
    const f = fixture();
    const legacy = { getRunner: f.getRunner } as unknown as RemoteRunnerGateway;
    const store = new RemoteAttachmentStore({
      getGateway: () => legacy,
      resolveOwner: () => f.currentOwner(),
      ownerIsCurrent: () => true,
      ownerIsRetained: () => true,
      encoder: null,
    });
    await expect(
      store.stageAgentAttachmentFile({
        workspaceId: PROJECT,
        path: "/Users/dev/report.pdf",
        fileSource: { stage: f.stage, release: f.release },
      }),
    ).rejects.toThrow(REMOTE_FILE_ATTACHMENTS_UNAVAILABLE);
    expect(f.getRunner).not.toHaveBeenCalled();
    expect(f.stage).not.toHaveBeenCalled();
  });

  it("releases the native source when ownership is replaced during native staging", async () => {
    const f = fixture();
    f.stage.mockImplementationOnce(async () => {
      f.replaceOwner();
      return { sourceId: SOURCE_IDS[7]!, name: "report.pdf", bytes: 10 };
    });
    await expect(f.stageFile()).rejects.toThrow(REMOTE_FILE_ATTACHMENT_OWNER_CHANGED);
    expect(f.release).toHaveBeenCalledWith(SOURCE_IDS[7]);
  });

  it("releases the native source when the gateway is replaced during native staging", async () => {
    const f = fixture();
    f.stage.mockImplementationOnce(async () => {
      f.replaceGateway();
      return { sourceId: SOURCE_IDS[8]!, name: "report.pdf", bytes: 10 };
    });
    await expect(f.stageFile()).rejects.toThrow(REMOTE_FILE_ATTACHMENT_OWNER_CHANGED);
    expect(f.release).toHaveBeenCalledWith(SOURCE_IDS[8]);
  });

  it("rejects ownership replaced during the capability check without staging", async () => {
    const f = fixture();
    f.getRunner.mockImplementationOnce(async () => {
      f.replaceOwner();
      return {
        protocolVersion: 1 as const,
        runnerId: "runner",
        name: "Runner",
        capabilities: { taskExecution: true, eventReplay: true, fileAttachments: true },
      };
    });
    await expect(f.stageFile()).rejects.toThrow(REMOTE_FILE_ATTACHMENT_OWNER_CHANGED);
    expect(f.stage).not.toHaveBeenCalled();
  });

  it.each([
    [0, "File is empty."],
    [50 * MIB + 1, "File is larger than 50 MiB."],
  ])("releases a native source reporting %i bytes", async (bytes, message) => {
    const f = fixture();
    f.setStagedBytes(bytes);
    await expect(f.stageFile()).rejects.toThrow(message);
    expect(f.release).toHaveBeenCalledWith(SOURCE_IDS[0]);
  });

  it("caps staged entries and never stages past the cap", async () => {
    const f = fixture();
    for (let index = 0; index < 32; index += 1) await f.stageFile(`/Users/dev/file-${index}.bin`);
    await expect(f.stageFile("/Users/dev/overflow.bin")).rejects.toThrow("staging is full");
    expect(f.stage).toHaveBeenCalledTimes(32);
    expect(f.release).not.toHaveBeenCalled();
  });

  it("keeps path-backed files out of the 40 MiB in-memory budget", async () => {
    const f = fixture();
    f.setStagedBytes(50 * MIB);
    await f.stageFile("/Users/dev/one.zip");
    await f.stageFile("/Users/dev/two.zip");
    const image = {
      workspaceId: PROJECT,
      kind: "image" as const,
      name: "shot.png",
      mime: "image/png" as const,
      width: 1,
      height: 1,
      bytes: new Uint8Array(5 * MIB).buffer,
    };
    for (let index = 0; index < 8; index += 1)
      await expect(f.store.stageAgentAttachmentBytes(image)).resolves.toMatchObject({
        bytes: 5 * MIB,
      });
    await expect(f.store.stageAgentAttachmentBytes(image)).rejects.toThrow("staging is full");
  });

  it("frees the native source when the draft is released, exactly once", async () => {
    const f = fixture();
    const staged = await f.stageFile();
    await f.store.releaseAgentAttachment({
      workspaceId: PROJECT,
      attachmentId: staged.attachmentId,
    });
    await f.store.releaseAgentAttachment({
      workspaceId: PROJECT,
      attachmentId: staged.attachmentId,
    });
    expect(f.release.mock.calls).toEqual([[SOURCE_IDS[0]]]);
  });

  it("ignores a release from another workspace", async () => {
    const f = fixture();
    const staged = await f.stageFile();
    await f.store.releaseAgentAttachment({
      workspaceId: "other",
      attachmentId: staged.attachmentId,
    });
    expect(f.release).not.toHaveBeenCalled();
  });

  it("frees every native source when the store is cleared", async () => {
    const f = fixture();
    await f.stageFile("/Users/dev/a.pdf");
    await f.stageFile("/Users/dev/b.pdf");
    f.store.clear();
    expect(f.release.mock.calls).toEqual([[SOURCE_IDS[0]], [SOURCE_IDS[1]]]);
  });

  it("sanitizes a native name into an uploadable one", async () => {
    const f = fixture();
    f.stage.mockResolvedValueOnce({ sourceId: SOURCE_IDS[3]!, name: 'q"uote\u0007.txt', bytes: 3 });
    await expect(f.stageFile()).resolves.toMatchObject({ name: "q'uote.txt", bytes: 3 });
  });
});

describe("remote path-backed attachment upload", () => {
  it("streams the native source by id and returns one attachment part", async () => {
    const f = fixture();
    const { request } = await f.turn();
    const parts = await f.store.resolve(request, "server");
    const sent = f.uploadAttachmentFile.mock.calls[0]![0];
    expect(sent).toEqual({
      serverId: "server",
      attachmentId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/),
      sourceId: SOURCE_IDS[0],
      name: "report.pdf",
    });
    expect(parts).toEqual([{ type: "attachment", attachmentId: sent.attachmentId }]);
    expect(f.uploadAttachment).not.toHaveBeenCalled();
    expect(f.cancelAttachmentUpload).not.toHaveBeenCalled();
  });

  it("does not upload again for a second or concurrent resolve", async () => {
    const f = fixture();
    const { request } = await f.turn();
    const [first, second] = await Promise.all([
      f.store.resolve(request, "server"),
      f.store.resolve(request, "server"),
    ]);
    const third = await f.store.resolve(request, "server");
    expect(first).toEqual(second);
    expect(third).toEqual(first);
    expect(f.uploadAttachmentFile).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an old runner", { taskExecution: true, eventReplay: true }],
    ["a disabled capability", { taskExecution: true, eventReplay: true, fileAttachments: false }],
  ] as const)("refuses %s again at send time", async (_label, downgraded) => {
    const f = fixture();
    const { request } = await f.turn();
    f.getRunner.mockResolvedValueOnce({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Runner",
      capabilities: downgraded,
    });
    await expect(f.store.resolve(request, "server")).rejects.toThrow(
      REMOTE_FILE_ATTACHMENTS_UNSUPPORTED_REFUSAL,
    );
    expect(f.uploadAttachmentFile).not.toHaveBeenCalled();
  });

  it("refuses at send time when the server now hosts another runner", async () => {
    const f = fixture();
    const { request } = await f.turn();
    f.setRunnerId("other-runner");
    await expect(f.store.resolve(request, "server")).rejects.toThrow(
      REMOTE_FILE_ATTACHMENTS_UNSUPPORTED_REFUSAL,
    );
    expect(f.uploadAttachmentFile).not.toHaveBeenCalled();
  });

  it.each([
    ["id", { id: "99999999-9999-4999-8999-999999999999" }, REMOTE_FILE_UPLOAD_MISMATCH_ERROR],
    ["name", { name: "other.pdf" }, REMOTE_FILE_UPLOAD_MISMATCH_ERROR],
    ["bytes", { bytes: 2049 }, REMOTE_FILE_UPLOAD_MISMATCH_ERROR],
    ["runnerId", { runnerId: "other-runner" }, REMOTE_FILE_UPLOAD_MISMATCH_ERROR],
    ["kind", { kind: "image" }, "Invalid remote runner uploadAttachmentFile response."],
    ["media type", { mediaType: "Application/PDF" }, "Invalid remote runner uploadAttachmentFile"],
    ["extra key", { width: 1 }, "Invalid remote runner uploadAttachmentFile response."],
  ])("yields no part when the stored %s differs", async (_field, override, message) => {
    const f = fixture();
    const { request } = await f.turn();
    f.respondWith(async (sent) => {
      const stored = storedFile(sent, 2048);
      return { ...stored, attachment: { ...stored.attachment, ...override } } as UploadResponse;
    });
    await expect(f.store.resolve(request, "server")).rejects.toThrow(message);
  });

  it("rejects a legacy text attachment returned for a file upload", async () => {
    const f = fixture();
    const { request } = await f.turn();
    f.respondWith(async (sent) => ({
      created: true,
      attachment: {
        id: sent.attachmentId,
        runnerId: "runner",
        name: sent.name,
        mediaType: "text/plain",
        bytes: 2048,
        sha256: "a".repeat(64),
        createdAt: "2026-10-13T00:00:00.000Z",
      },
    }));
    await expect(f.store.resolve(request, "server")).rejects.toThrow(
      "Invalid remote runner uploadAttachmentFile response.",
    );
  });

  it("cancels the stream and yields no part when the owner changes during upload", async () => {
    const f = fixture();
    const { request } = await f.turn();
    const pending = deferred<UploadResponse>();
    f.respondWith(() => pending.promise);
    const resolving = f.store.resolve(request, "server");
    await vi.waitFor(() => expect(f.uploadAttachmentFile).toHaveBeenCalledTimes(1));
    const sent = f.uploadAttachmentFile.mock.calls[0]![0];
    f.replaceOwner();
    pending.resolve(storedFile(sent, 2048));
    await expect(resolving).rejects.toThrow(REMOTE_FILE_ATTACHMENT_OWNER_CHANGED);
    expect(f.cancelAttachmentUpload.mock.calls).toEqual([
      [{ serverId: "server", attachmentId: sent.attachmentId }],
    ]);
  });

  it("cancels a stream proactively once its server disconnects", async () => {
    const f = fixture();
    const { request } = await f.turn();
    const pending = deferred<UploadResponse>();
    f.respondWith(() => pending.promise);
    const resolving = f.store.resolve(request, "server");
    await vi.waitFor(() => expect(f.uploadAttachmentFile).toHaveBeenCalledTimes(1));
    const sent = f.uploadAttachmentFile.mock.calls[0]![0];
    f.store.cancelStaleUploads();
    expect(f.cancelAttachmentUpload).not.toHaveBeenCalled();
    f.disconnect();
    f.store.cancelStaleUploads();
    f.store.cancelStaleUploads();
    expect(f.cancelAttachmentUpload.mock.calls).toEqual([
      [{ serverId: "server", attachmentId: sent.attachmentId }],
    ]);
    pending.reject("Attachment upload was cancelled.");
    await expect(resolving).rejects.toThrow(REMOTE_FILE_ATTACHMENT_OWNER_CHANGED);
    expect(f.cancelAttachmentUpload).toHaveBeenCalledTimes(1);
  });

  it("uploads again with the same id after a disconnect interrupted the first stream", async () => {
    const f = fixture();
    const { request } = await f.turn();
    const pending = deferred<UploadResponse>();
    f.respondWith(() => pending.promise);
    const resolving = f.store.resolve(request, "server");
    await vi.waitFor(() => expect(f.uploadAttachmentFile).toHaveBeenCalledTimes(1));
    f.disconnect();
    pending.reject("Attachment upload was cancelled.");
    await expect(resolving).rejects.toThrow(REMOTE_FILE_ATTACHMENT_OWNER_CHANGED);
    f.reconnect();
    f.respondWith(async (sent) => storedFile(sent, 2048));
    const parts = await f.store.resolve(request, "server");
    expect(f.uploadAttachmentFile).toHaveBeenCalledTimes(2);
    expect(f.uploadAttachmentFile.mock.calls[1]![0]).toEqual(
      f.uploadAttachmentFile.mock.calls[0]![0],
    );
    expect(parts).toHaveLength(1);
  });

  it("yields no part when the gateway is replaced during upload", async () => {
    const f = fixture();
    const { request } = await f.turn();
    const pending = deferred<UploadResponse>();
    f.respondWith(() => pending.promise);
    const resolving = f.store.resolve(request, "server");
    await vi.waitFor(() => expect(f.uploadAttachmentFile).toHaveBeenCalledTimes(1));
    const sent = f.uploadAttachmentFile.mock.calls[0]![0];
    f.replaceGateway();
    f.store.cancelStaleUploads();
    pending.resolve(storedFile(sent, 2048));
    await expect(resolving).rejects.toThrow(REMOTE_FILE_ATTACHMENT_OWNER_CHANGED);
    expect(f.cancelAttachmentUpload).toHaveBeenCalledTimes(1);
  });

  it("cancels the stream and frees the source when the draft is released during upload", async () => {
    const f = fixture();
    const { staged, request } = await f.turn();
    const pending = deferred<UploadResponse>();
    f.respondWith(() => pending.promise);
    const resolving = f.store.resolve(request, "server");
    await vi.waitFor(() => expect(f.uploadAttachmentFile).toHaveBeenCalledTimes(1));
    const sent = f.uploadAttachmentFile.mock.calls[0]![0];
    await f.store.releaseAgentAttachment({
      workspaceId: PROJECT,
      attachmentId: staged.attachmentId,
    });
    expect(f.cancelAttachmentUpload).toHaveBeenCalledWith({
      serverId: "server",
      attachmentId: sent.attachmentId,
    });
    expect(f.release).toHaveBeenCalledWith(SOURCE_IDS[0]);
    pending.resolve(storedFile(sent, 2048));
    await expect(resolving).rejects.toThrow(REMOTE_FILE_ATTACHMENT_OWNER_CHANGED);
    expect(f.cancelAttachmentUpload).toHaveBeenCalledTimes(1);
    await expect(f.store.resolve(request, "server")).rejects.toThrow("no longer matches");
  });

  it("cancels every in-flight stream when the store is cleared", async () => {
    const f = fixture();
    const { request } = await f.turn();
    const pending = deferred<UploadResponse>();
    f.respondWith(() => pending.promise);
    const resolving = f.store.resolve(request, "server");
    await vi.waitFor(() => expect(f.uploadAttachmentFile).toHaveBeenCalledTimes(1));
    f.store.clear();
    expect(f.cancelAttachmentUpload).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledWith(SOURCE_IDS[0]);
    pending.reject("Attachment upload was cancelled.");
    await expect(resolving).rejects.toThrow(REMOTE_FILE_ATTACHMENT_OWNER_CHANGED);
  });

  it("never yields a part across workspace A to B to A", async () => {
    const f = fixture();
    const { request } = await f.turn();
    const pending = deferred<UploadResponse>();
    f.respondWith(() => pending.promise);
    const resolving = f.store.resolve(request, "server");
    await vi.waitFor(() => expect(f.uploadAttachmentFile).toHaveBeenCalledTimes(1));
    const sent = f.uploadAttachmentFile.mock.calls[0]![0];
    f.replaceOwner();
    f.replaceOwner();
    pending.resolve(storedFile(sent, 2048));
    await expect(resolving).rejects.toThrow(REMOTE_FILE_ATTACHMENT_OWNER_CHANGED);
    await expect(
      f.store.resolve({ ...request, attachmentOwner: f.currentOwner() }, "server"),
    ).rejects.toThrow("no longer matches");
    await expect(f.store.resolve(request, "server")).rejects.toThrow("owner changed");
    expect(f.uploadAttachmentFile).toHaveBeenCalledTimes(1);
  });

  it("refuses to send a staged file to another server", async () => {
    const f = fixture();
    const { request } = await f.turn();
    await expect(f.store.resolve(request, "other")).rejects.toThrow("belongs to another server");
    expect(f.getRunner).toHaveBeenCalledTimes(1);
    expect(f.uploadAttachmentFile).not.toHaveBeenCalled();
  });

  it.each([
    REMOTE_FILE_UPLOAD_CHANGED_ERROR,
    REMOTE_FILE_UPLOAD_STORAGE_FULL_ERROR,
    "File is larger than 50 MiB.",
    "Runner request failed (HTTP 503).",
  ])("surfaces the native upload failure %s and allows a retry", async (message) => {
    const f = fixture();
    const { request } = await f.turn();
    f.respondWith(() => Promise.reject(message));
    const failed = f.store.resolve(request, "server");
    await expect(failed).rejects.toBeInstanceOf(Error);
    await expect(failed).rejects.toThrow(message);
    expect(f.cancelAttachmentUpload).not.toHaveBeenCalled();
    f.respondWith(async (sent) => storedFile(sent, 2048));
    await expect(f.store.resolve(request, "server")).resolves.toHaveLength(1);
  });

  it("replaces an unpresentable native failure with a bounded one", async () => {
    const f = fixture();
    const { request } = await f.turn();
    f.respondWith(() => Promise.reject(`bad\u0000${"x".repeat(2000)}`));
    await expect(f.store.resolve(request, "server")).rejects.toThrow(
      "The file could not be uploaded to the server.",
    );
  });

  it("sends a staged file together with a pasted image through their own uploads", async () => {
    const f = fixture();
    const owner = f.currentOwner();
    const file = await f.stageFile();
    const image = await f.store.stageAgentAttachmentBytes({
      workspaceId: PROJECT,
      kind: "image",
      name: "shot.png",
      mime: "image/png",
      width: 1,
      height: 1,
      bytes: new Uint8Array([137, 80, 78, 71]).buffer,
    });
    f.uploadAttachment.mockImplementation(async (sent: { attachmentId: string; name: string }) => ({
      created: true,
      attachment: {
        id: sent.attachmentId,
        runnerId: "runner",
        name: sent.name,
        mediaType: "image/png",
        bytes: 4,
        width: 1,
        height: 1,
        sha256: "a".repeat(64),
        createdAt: "2026-10-13T00:00:00.000Z",
      },
    }));
    const parts = await f.store.resolve(
      {
        attachmentOwner: owner,
        attachments: [
          { kind: "staged", ...image },
          { kind: "staged", ...file },
        ],
      },
      "server",
    );
    expect(parts).toHaveLength(2);
    expect(f.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(f.uploadAttachmentFile).toHaveBeenCalledTimes(1);
  });

  it("uploads images to an old runner without asking for the file capability", async () => {
    const f = fixture({ taskExecution: true, eventReplay: true });
    const image = await f.store.stageAgentAttachmentBytes({
      workspaceId: PROJECT,
      kind: "image",
      name: "shot.png",
      mime: "image/png",
      width: 1,
      height: 1,
      bytes: new Uint8Array([137, 80, 78, 71]).buffer,
    });
    f.uploadAttachment.mockImplementation(async (sent: { attachmentId: string; name: string }) => ({
      created: true,
      attachment: {
        id: sent.attachmentId,
        runnerId: "runner",
        name: sent.name,
        mediaType: "image/png",
        bytes: 4,
        width: 1,
        height: 1,
        sha256: "a".repeat(64),
        createdAt: "2026-10-13T00:00:00.000Z",
      },
    }));
    const parts = await f.store.resolve(
      { attachmentOwner: f.currentOwner(), attachments: [{ kind: "staged", ...image }] },
      "server",
    );
    expect(parts).toHaveLength(1);
    expect(f.getRunner).not.toHaveBeenCalled();
  });
});

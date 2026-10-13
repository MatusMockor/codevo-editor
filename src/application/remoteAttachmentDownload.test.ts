import { describe, expect, it, vi } from "vitest";
import type {
  RemoteRunnerAttachment,
  RemoteRunnerAttachmentDownload,
  RemoteRunnerDownloadAttachmentRequest,
  RemoteRunnerGateway,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import {
  REMOTE_FILE_DOWNLOAD_MISMATCH_ERROR,
  REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR,
  REMOTE_FILE_DOWNLOAD_WRITE_ERROR,
} from "../domain/remoteRunnerFileAttachment";
import { remoteAgentThreadKey } from "./remoteAgentProjection";
import {
  AgentAttachmentDownloadError,
  downloadRemoteAttachment,
  LOCAL_ATTACHMENT_DOWNLOAD_REFUSAL,
  refuseLocalAttachmentDownload,
  REMOTE_ATTACHMENT_DOWNLOAD_BUSY,
  REMOTE_ATTACHMENT_DOWNLOAD_FAILED,
  REMOTE_ATTACHMENT_DOWNLOAD_SUPERSEDED,
  REMOTE_ATTACHMENT_DOWNLOAD_UNAVAILABLE,
} from "./remoteAttachmentDownload";
import {
  loadRemoteTaskAttachments,
  readRemoteAttachment,
  remoteAttachmentImageMime,
  remoteAttachmentRecovery,
  RemoteAttachmentUnavailableError,
  type RemoteAttachmentRegistry,
} from "./remoteAttachmentHistory";
import type { AgentAttachmentOwner } from "./useAgentComposerAttachments";

const id = "11111111-1111-4111-8111-111111111111";
const MIB = 1024 * 1024;
const task: RemoteRunnerTask = {
  id: "22222222-2222-4222-8222-222222222222",
  sequence: 1,
  runnerId: "runner",
  provider: "claude",
  status: "succeeded",
  projectId: "project",
  parts: [{ type: "attachment", attachmentId: id }],
  createdAt: "2026-10-13T00:00:00.000Z",
};
const file: RemoteRunnerAttachment = {
  id,
  runnerId: "runner",
  name: "report.pdf",
  kind: "file",
  mediaType: "application/pdf",
  bytes: 45 * MIB,
  sha256: "b".repeat(64),
  createdAt: task.createdAt,
};
const image: RemoteRunnerAttachment = {
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

function fixture(stored: RemoteRunnerAttachment = file) {
  let currentOwner: AgentAttachmentOwner = {
    projectRootKey: "remote:server:runner:project",
    workspaceId: "remote:server:runner:project",
    ownerId: "lease",
    generation: 1,
  };
  let gatewayCurrent = true;
  let server: string | null = "server";
  const registry: RemoteAttachmentRegistry = new Map();
  const getAttachment = vi.fn(async (): Promise<RemoteRunnerAttachment> => stored);
  const readAttachment = vi.fn(async () => ({
    mediaType: "image/png" as const,
    base64: "iVBORw==",
  }));
  const downloadAttachment = vi.fn(
    async (
      _request: RemoteRunnerDownloadAttachmentRequest,
    ): Promise<RemoteRunnerAttachmentDownload> => ({ status: "saved" }),
  );
  const gateway = {
    getAttachment,
    readAttachment,
    downloadAttachment,
  } as unknown as RemoteRunnerGateway;
  const request = {
    workspaceId: currentOwner.workspaceId,
    attachmentId: id.replace(/-/g, ""),
    threadId: remoteAgentThreadKey("server", "runner", task.id),
  };
  const authority = {
    gateway,
    ownerIsCurrent: (candidate: AgentAttachmentOwner) =>
      candidate.generation === currentOwner.generation &&
      candidate.ownerId === currentOwner.ownerId,
    resolveServer: () => server,
    isGatewayCurrent: () => gatewayCurrent,
    isWorkspaceConnected: () => true,
  };
  return {
    registry,
    request,
    authority,
    getAttachment,
    readAttachment,
    downloadAttachment,
    load: () => loadRemoteTaskAttachments(registry, task, "server", currentOwner, authority),
    download: (override: Partial<typeof request> = {}) =>
      downloadRemoteAttachment(registry, { ...request, ...override }, authority),
    replaceOwner: () => {
      currentOwner = { ...currentOwner, generation: currentOwner.generation + 1 };
    },
    replaceGateway: () => {
      gatewayCurrent = false;
    },
    moveThread: (next: string | null) => {
      server = next;
    },
  };
}

describe("remote file attachments in history", () => {
  it("projects a file-kind attachment as a downloadable remote file", async () => {
    const f = fixture();
    const loaded = await f.load();
    expect(loaded).toEqual({
      attachments: [
        {
          kind: "file",
          attachmentId: id.replace(/-/g, ""),
          name: "report.pdf",
          bytes: 45 * MIB,
          remote: { serverId: "server", attachmentId: id },
        },
      ],
      discovered: [],
    });
  });

  it.each(["image/png", "image/jpeg", "text/plain"])(
    "never treats a file that declares %s as an image",
    async (mediaType) => {
      const f = fixture({ ...file, mediaType, name: "claims-to-be.png" });
      const { attachments } = await f.load();
      expect(attachments).toEqual([
        {
          kind: "file",
          attachmentId: id.replace(/-/g, ""),
          name: "claims-to-be.png",
          bytes: 45 * MIB,
          remote: { serverId: "server", attachmentId: id },
        },
      ]);
      expect(remoteAttachmentImageMime(f.registry, f.request)).toBeNull();
    },
  );

  it("still reports the mime of a legacy image", async () => {
    const f = fixture(image);
    await f.load();
    expect(remoteAttachmentImageMime(f.registry, f.request)).toBe("image/png");
  });

  it("refuses to read a file-kind attachment into webview memory", async () => {
    const f = fixture({ ...file, mediaType: "image/png", bytes: 4 });
    await f.load();
    const refused = readRemoteAttachment(f.registry, f.request, f.authority);
    await expect(refused).rejects.toBeInstanceOf(RemoteAttachmentUnavailableError);
    await expect(refused).rejects.toMatchObject({ reason: "notImage" });
    expect(f.readAttachment).not.toHaveBeenCalled();
    expect(remoteAttachmentRecovery("notImage")).toBe("never");
  });

  it("keeps the 5 MiB bound for legacy attachments and 50 MiB for files", async () => {
    const oversizedImage = fixture({ ...image, bytes: 5 * MIB + 1 } as RemoteRunnerAttachment);
    expect(await oversizedImage.load()).toEqual({ attachments: [], discovered: ["loadFailed"] });
    const largestFile = fixture({ ...file, bytes: 50 * MIB });
    expect((await largestFile.load()).attachments).toHaveLength(1);
    const oversizedFile = fixture({ ...file, bytes: 50 * MIB + 1 });
    expect(await oversizedFile.load()).toEqual({ attachments: [], discovered: ["loadFailed"] });
  });

  it.each([
    ["an unknown kind", { ...file, kind: "folder" }],
    ["a width on a file", { ...file, width: 1 }],
    ["an invalid media type", { ...file, mediaType: "PDF" }],
    ["an unknown key", { ...file, storedPath: "/srv/blob" }],
  ])("fails closed on metadata with %s", async (_label, metadata) => {
    const f = fixture(metadata as unknown as RemoteRunnerAttachment);
    expect(await f.load()).toEqual({ attachments: [], discovered: ["loadFailed"] });
  });
});

describe("remote attachment download", () => {
  it("downloads the exact registered attachment and reports it saved", async () => {
    const f = fixture();
    await f.load();
    await expect(f.download()).resolves.toBe("saved");
    expect(f.downloadAttachment.mock.calls).toEqual([
      [
        {
          serverId: "server",
          attachmentId: id,
          name: "report.pdf",
          bytes: 45 * MIB,
          sha256: "b".repeat(64),
        },
      ],
    ]);
  });

  it("reports a cancelled save dialog without failing", async () => {
    const f = fixture();
    await f.load();
    f.downloadAttachment.mockResolvedValue({ status: "cancelled" });
    await expect(f.download()).resolves.toBe("cancelled");
  });

  it("downloads a legacy image through the same native command", async () => {
    const f = fixture(image);
    await f.load();
    await expect(f.download()).resolves.toBe("saved");
    expect(f.downloadAttachment).toHaveBeenCalledWith({
      serverId: "server",
      attachmentId: id,
      name: "shot.png",
      bytes: 4,
      sha256: "a".repeat(64),
    });
  });

  it.each([
    ["an attachment that was never loaded", (f: ReturnType<typeof fixture>) => f.registry.clear()],
    ["a replaced owner", (f: ReturnType<typeof fixture>) => f.replaceOwner()],
    ["a replaced gateway", (f: ReturnType<typeof fixture>) => f.replaceGateway()],
    ["a thread on another server", (f: ReturnType<typeof fixture>) => f.moveThread("other")],
    ["a thread without a server", (f: ReturnType<typeof fixture>) => f.moveThread(null)],
  ])("refuses %s before asking the server", async (_label, revoke) => {
    const f = fixture();
    await f.load();
    revoke(f);
    const refused = f.download();
    await expect(refused).rejects.toBeInstanceOf(AgentAttachmentDownloadError);
    await expect(refused).rejects.not.toThrow(/image/i);
    expect(f.downloadAttachment).not.toHaveBeenCalled();
  });

  it("refuses another conversation and another workspace", async () => {
    const f = fixture();
    await f.load();
    await expect(
      f.download({ threadId: remoteAgentThreadKey("server", "runner", id) }),
    ).rejects.toThrow("This attachment does not belong to this conversation.");
    await expect(f.download({ workspaceId: "remote:server:runner:other" })).rejects.toThrow(
      "still loading",
    );
    expect(f.downloadAttachment).not.toHaveBeenCalled();
  });

  it("says so when this gateway cannot download", async () => {
    const f = fixture();
    await f.load();
    const legacy = { getAttachment: f.getAttachment } as unknown as RemoteRunnerGateway;
    await expect(
      downloadRemoteAttachment(f.registry, f.request, { ...f.authority, gateway: legacy }),
    ).rejects.toThrow(REMOTE_ATTACHMENT_DOWNLOAD_UNAVAILABLE);
  });

  it.each([
    ["Runner request failed (HTTP 404).", REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR],
    [REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR, REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR],
    [REMOTE_FILE_DOWNLOAD_MISMATCH_ERROR, REMOTE_FILE_DOWNLOAD_MISMATCH_ERROR],
    [REMOTE_FILE_DOWNLOAD_WRITE_ERROR, REMOTE_FILE_DOWNLOAD_WRITE_ERROR],
    ["Runner request failed (HTTP 503).", REMOTE_ATTACHMENT_DOWNLOAD_BUSY],
    ["Remote runner server is not connected.", "Remote runner server is not connected."],
    [`bad\u0000${"x".repeat(2000)}`, REMOTE_ATTACHMENT_DOWNLOAD_FAILED],
    ["", REMOTE_ATTACHMENT_DOWNLOAD_FAILED],
  ])("maps the native failure %j to a presentable error", async (native, presented) => {
    const f = fixture();
    await f.load();
    f.downloadAttachment.mockRejectedValue(native);
    const refused = f.download();
    await expect(refused).rejects.toBeInstanceOf(AgentAttachmentDownloadError);
    await expect(refused).rejects.toThrow(presented);
  });

  it("maps an authoritative 404 rejection to the not-stored message", async () => {
    const f = fixture();
    await f.load();
    f.downloadAttachment.mockRejectedValue(
      new RemoteRunnerRequestRejectedError("Runner request failed (HTTP 404)."),
    );
    await expect(f.download()).rejects.toThrow(REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR);
  });

  it.each([
    ["the owner is replaced", (f: ReturnType<typeof fixture>) => f.replaceOwner()],
    ["the gateway is replaced", (f: ReturnType<typeof fixture>) => f.replaceGateway()],
    ["the registry entry is evicted", (f: ReturnType<typeof fixture>) => f.registry.clear()],
    ["the thread moves servers", (f: ReturnType<typeof fixture>) => f.moveThread("other")],
  ])("reports no result when %s after the await", async (_label, revoke) => {
    const f = fixture();
    await f.load();
    const pending = deferred<RemoteRunnerAttachmentDownload>();
    f.downloadAttachment.mockReturnValue(pending.promise);
    const downloading = f.download();
    revoke(f);
    pending.resolve({ status: "saved" });
    await expect(downloading).rejects.toThrow(REMOTE_ATTACHMENT_DOWNLOAD_SUPERSEDED);
  });

  it("reports the superseded owner rather than a late native failure", async () => {
    const f = fixture();
    await f.load();
    const pending = deferred<RemoteRunnerAttachmentDownload>();
    f.downloadAttachment.mockReturnValue(pending.promise);
    const downloading = f.download();
    f.replaceOwner();
    pending.reject(REMOTE_FILE_DOWNLOAD_WRITE_ERROR);
    await expect(downloading).rejects.toThrow(REMOTE_ATTACHMENT_DOWNLOAD_SUPERSEDED);
  });

  it("fails closed on a malformed native result", async () => {
    const f = fixture();
    await f.load();
    f.downloadAttachment.mockResolvedValue({ status: "partial" } as never);
    await expect(f.download()).rejects.toThrow(REMOTE_ATTACHMENT_DOWNLOAD_FAILED);
  });

  it("rejects a download for a local attachment truthfully", async () => {
    const refused = refuseLocalAttachmentDownload();
    await expect(refused).rejects.toBeInstanceOf(AgentAttachmentDownloadError);
    await expect(refused).rejects.toThrow(LOCAL_ATTACHMENT_DOWNLOAD_REFUSAL);
  });
});

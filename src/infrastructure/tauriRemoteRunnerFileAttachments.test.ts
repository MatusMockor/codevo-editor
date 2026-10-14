import { describe, expect, it, vi } from "vitest";
import { isRemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import { REMOTE_FILE_UPLOAD_MISMATCH_ERROR } from "../domain/remoteRunnerFileAttachment";
import { TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";

const id = "12345678-1234-4234-8234-123456789abc";
const sourceId = "87654321-4321-4321-8321-cba987654321";
const file = {
  id,
  runnerId: "runner",
  name: "report.pdf",
  bytes: 2048,
  sha256: "a".repeat(64),
  createdAt: "2026-10-13T00:00:00.000Z",
  kind: "file",
  mediaType: "application/pdf",
};
const upload = { serverId: "linux", attachmentId: id, sourceId, name: "report.pdf" };
const download = {
  serverId: "linux",
  attachmentId: id,
  name: "report.pdf",
  bytes: 2048,
  sha256: "a".repeat(64),
};

describe("TauriRemoteRunnerGateway file attachments", () => {
  it("uploads a staged native source by id without any content in the request", async () => {
    const response = { attachment: file, created: true };
    const invoke = vi.fn().mockResolvedValue(response);
    const gateway = new TauriRemoteRunnerGateway(invoke);
    expect(await gateway.uploadAttachmentFile(upload)).toEqual(response);
    expect(invoke.mock.calls).toEqual([
      ["remote_runner_upload_attachment_file", { request: upload }],
    ]);
  });

  it.each([
    ["a local path", { ...upload, path: "/Users/dev/report.pdf" }],
    ["a non-uuid source", { ...upload, sourceId: "source" }],
    ["a separator in the name", { ...upload, name: "a/b.pdf" }],
    ["a bad server id", { ...upload, serverId: "a b" }],
  ])("rejects an upload request with %s before IPC", async (_label, request) => {
    const invoke = vi.fn();
    const gateway = new TauriRemoteRunnerGateway(invoke);
    const refused = gateway.uploadAttachmentFile(request);
    await expect(refused).rejects.toThrow("Invalid remote runner uploadAttachmentFile request.");
    await expect(refused).rejects.toSatisfy(isRemoteRunnerRequestRejectedError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["a legacy image", { ...file, kind: undefined, mediaType: "image/png", width: 1, height: 1 }],
    ["a legacy text file", { ...file, kind: undefined, mediaType: "text/plain" }],
    ["an unknown key", { ...file, path: "/srv/blob" }],
    ["a bad media type", { ...file, mediaType: "PDF" }],
    ["an oversized file", { ...file, bytes: 52_428_801 }],
  ])("rejects an upload response carrying %s", async (_label, attachment) => {
    const invoke = vi.fn().mockResolvedValue({
      attachment: JSON.parse(JSON.stringify(attachment)),
      created: true,
    });
    const gateway = new TauriRemoteRunnerGateway(invoke);
    await expect(gateway.uploadAttachmentFile(upload)).rejects.toThrow(
      "Invalid remote runner uploadAttachmentFile response.",
    );
  });

  it.each([
    ["another id", { ...file, id: "99999999-9999-4999-8999-999999999999" }],
    ["another name", { ...file, name: "other.pdf" }],
  ])("rejects an upload response for %s", async (_label, attachment) => {
    const invoke = vi.fn().mockResolvedValue({ attachment, created: true });
    const gateway = new TauriRemoteRunnerGateway(invoke);
    await expect(gateway.uploadAttachmentFile(upload)).rejects.toThrow(
      REMOTE_FILE_UPLOAD_MISMATCH_ERROR,
    );
  });

  it("passes native upload failures through unchanged", async () => {
    const invoke = vi.fn().mockRejectedValue("The attached file changed. Attach it again.");
    const gateway = new TauriRemoteRunnerGateway(invoke);
    await expect(gateway.uploadAttachmentFile(upload)).rejects.toBe(
      "The attached file changed. Attach it again.",
    );
  });

  it("cancels an upload by server and attachment only", async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const gateway = new TauriRemoteRunnerGateway(invoke);
    const request = { serverId: "linux", attachmentId: id };
    await expect(gateway.cancelAttachmentUpload(request)).resolves.toBeUndefined();
    expect(invoke.mock.calls).toEqual([["remote_runner_cancel_attachment_upload", { request }]]);
  });

  it("rejects a malformed cancel request and a non-empty cancel response", async () => {
    const invoke = vi.fn().mockResolvedValue({ cancelled: true });
    const gateway = new TauriRemoteRunnerGateway(invoke);
    await expect(
      gateway.cancelAttachmentUpload({ serverId: "linux", attachmentId: "nope" }),
    ).rejects.toThrow("Invalid remote runner cancelAttachmentUpload request.");
    expect(invoke).not.toHaveBeenCalled();
    await expect(
      gateway.cancelAttachmentUpload({ serverId: "linux", attachmentId: id }),
    ).rejects.toThrow("Invalid remote runner cancelAttachmentUpload response.");
  });

  it.each(["saved", "cancelled"] as const)("returns the %s download status", async (status) => {
    const invoke = vi.fn().mockResolvedValue({ status });
    const gateway = new TauriRemoteRunnerGateway(invoke);
    expect(await gateway.downloadAttachment(download)).toEqual({ status });
    expect(invoke.mock.calls).toEqual([
      ["remote_runner_download_attachment", { request: download }],
    ]);
  });

  it.each([
    ["a destination path", { ...download, path: "/Users/dev/Downloads/report.pdf" }],
    ["an oversized length", { ...download, bytes: 52_428_801 }],
    ["a malformed hash", { ...download, sha256: "z".repeat(64) }],
    ["a malformed attachment id", { ...download, attachmentId: "../x" }],
  ])("rejects a download request with %s before IPC", async (_label, request) => {
    const invoke = vi.fn();
    const gateway = new TauriRemoteRunnerGateway(invoke);
    await expect(gateway.downloadAttachment(request)).rejects.toThrow(
      "Invalid remote runner downloadAttachment request.",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([{ status: "failed" }, { status: "saved", path: "/tmp/report.pdf" }, null, "saved"])(
    "rejects the download response %j",
    async (response) => {
      const invoke = vi.fn().mockResolvedValue(response);
      const gateway = new TauriRemoteRunnerGateway(invoke);
      await expect(gateway.downloadAttachment(download)).rejects.toThrow(
        "Invalid remote runner downloadAttachment response.",
      );
    },
  );

  it("classifies a missing attachment as an authoritative rejection", async () => {
    const invoke = vi.fn().mockRejectedValue("Runner request failed (HTTP 404).");
    const gateway = new TauriRemoteRunnerGateway(invoke);
    await expect(gateway.downloadAttachment(download)).rejects.toSatisfy(
      isRemoteRunnerRequestRejectedError,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  RemoteAttachmentUnavailableError,
  type RemoteAttachmentUnavailableReason,
} from "./remoteAttachmentHistory";
import {
  forgetRemoteAttachmentRetries,
  MAX_REMOTE_ATTACHMENT_RETRIES,
  recordRemoteAttachmentFailure,
  recoverRemoteAttachmentRetries,
  settleRemoteAttachmentRetry,
  type RemoteAttachmentRetries,
} from "./remoteAttachmentRetry";

const request = { workspaceId: "workspace", threadId: "thread", attachmentId: "image" };
const failure = (reason: RemoteAttachmentUnavailableReason) =>
  new RemoteAttachmentUnavailableError(reason);
const blocked = (reason: RemoteAttachmentUnavailableReason | null) => () => reason;
const recoveredWorkspaces = (
  retries: RemoteAttachmentRetries,
  reason: RemoteAttachmentUnavailableReason | null,
) => recoverRemoteAttachmentRetries(retries, blocked(reason)).map((item) => item.workspaceId);

describe("remote attachment retry tracking", () => {
  it("retries a not-connected or not-loaded read as soon as it becomes readable", () => {
    for (const reason of ["notConnected", "notLoaded"] as const) {
      const retries: RemoteAttachmentRetries = new Map();
      recordRemoteAttachmentFailure(retries, request, failure(reason));
      expect(recoveredWorkspaces(retries, reason)).toEqual([]);
      expect(retries.size).toBe(1);
      expect(recoverRemoteAttachmentRetries(retries, blocked(null))).toEqual([request]);
      expect(retries.size).toBe(0);
      expect(recoveredWorkspaces(retries, null)).toEqual([]);
    }
  });
  it("retries a failed read only after an outage was observed and ended", () => {
    const failures = [
      failure("readFailed"),
      failure("notStored"),
      failure("busy"),
      new Error("Runner request failed (HTTP 503)."),
    ];
    for (const error of failures) {
      const retries: RemoteAttachmentRetries = new Map();
      recordRemoteAttachmentFailure(retries, request, error);
      expect(recoveredWorkspaces(retries, null)).toEqual([]);
      expect(retries.size).toBe(1);
      expect(recoveredWorkspaces(retries, "notConnected")).toEqual([]);
      expect(recoveredWorkspaces(retries, null)).toEqual(["workspace"]);
      expect(retries.size).toBe(0);
    }
  });
  it("does not treat a settled load failure as an observed outage", () => {
    const retries: RemoteAttachmentRetries = new Map();
    recordRemoteAttachmentFailure(retries, request, failure("readFailed"));
    expect(recoveredWorkspaces(retries, "loadFailed")).toEqual([]);
    expect(recoveredWorkspaces(retries, null)).toEqual([]);
    expect(retries.size).toBe(1);
  });
  it("never retries reads that failed closed", () => {
    const retries: RemoteAttachmentRetries = new Map();
    recordRemoteAttachmentFailure(retries, request, failure("foreign"));
    recordRemoteAttachmentFailure(retries, request, failure("unsupported"));
    expect(retries.size).toBe(0);
    recordRemoteAttachmentFailure(retries, request, failure("notConnected"));
    expect(recoveredWorkspaces(retries, "foreign")).toEqual([]);
    expect(retries.size).toBe(0);
  });
  it("forgets a read that later succeeded or whose workspace was released", () => {
    const retries: RemoteAttachmentRetries = new Map();
    recordRemoteAttachmentFailure(retries, request, failure("readFailed"));
    settleRemoteAttachmentRetry(retries, request);
    expect(retries.size).toBe(0);
    recordRemoteAttachmentFailure(retries, request, failure("notConnected"));
    recordRemoteAttachmentFailure(
      retries,
      { ...request, workspaceId: "other" },
      failure("notConnected"),
    );
    forgetRemoteAttachmentRetries(retries, new Set(["workspace"]));
    expect(recoveredWorkspaces(retries, null)).toEqual(["other"]);
  });
  it("keeps a bounded number of pending retries and evicts the oldest first", () => {
    const retries: RemoteAttachmentRetries = new Map();
    for (let index = 0; index <= MAX_REMOTE_ATTACHMENT_RETRIES; index += 1)
      recordRemoteAttachmentFailure(
        retries,
        { ...request, workspaceId: `workspace-${index}` },
        failure("notConnected"),
      );
    expect(retries.size).toBe(MAX_REMOTE_ATTACHMENT_RETRIES);
    const recovered = recoveredWorkspaces(retries, null);
    expect(recovered).not.toContain("workspace-0");
    expect(recovered).toContain(`workspace-${MAX_REMOTE_ATTACHMENT_RETRIES}`);
  });
});

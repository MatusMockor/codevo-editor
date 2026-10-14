import { describe, expect, it, vi } from "vitest";
import {
  MAX_AGENT_ATTACHMENT_DOWNLOADS,
  createAgentAttachmentDownloadStore,
  type AgentAttachmentDownloadAdmission,
  type AgentAttachmentDownloadLease,
} from "./agentAttachmentDownloadStore";

function leaseOf(admission: AgentAttachmentDownloadAdmission): AgentAttachmentDownloadLease {
  expect(admission.kind).toBe("started");
  return (admission as Extract<AgentAttachmentDownloadAdmission, { kind: "started" }>).lease;
}

describe("agent attachment download store", () => {
  it("keys a running download by thread and attachment", () => {
    const store = createAgentAttachmentDownloadStore();
    const lease = leaseOf(store.begin("thread-a", "file-1"));

    expect(store.has("thread-a", "file-1")).toBe(true);
    expect(store.has("thread-b", "file-1")).toBe(false);
    expect(store.has("thread-a", "file-2")).toBe(false);
    expect(lease).toEqual({ threadId: "thread-a", attachmentId: "file-1" });
  });

  it("does not confuse ids that only match once joined", () => {
    const store = createAgentAttachmentDownloadStore();
    store.begin("a", "b,c");

    expect(store.has("a,b", "c")).toBe(false);
    expect(store.begin("a,b", "c").kind).toBe("started");
  });

  it("refuses a repeated start of the same download until it settles", () => {
    const store = createAgentAttachmentDownloadStore();
    const lease = leaseOf(store.begin("thread-a", "file-1"));

    expect(store.begin("thread-a", "file-1")).toEqual({ kind: "duplicate" });
    expect(store.settle(lease)).toBe(true);
    expect(store.has("thread-a", "file-1")).toBe(false);
    expect(store.begin("thread-a", "file-1").kind).toBe("started");
  });

  it("bounds the running downloads and frees a slot on settle", () => {
    const store = createAgentAttachmentDownloadStore();
    const leases = Array.from({ length: MAX_AGENT_ATTACHMENT_DOWNLOADS }, (_, index) =>
      leaseOf(store.begin("thread-a", `file-${index}`)),
    );

    expect(store.begin("thread-a", "one-too-many")).toEqual({ kind: "full" });
    expect(store.has("thread-a", "one-too-many")).toBe(false);
    expect(store.settle(leases[0]!)).toBe(true);
    expect(store.begin("thread-a", "one-too-many").kind).toBe("started");
  });

  it("ignores a settlement whose lease was cleared or replaced", () => {
    const store = createAgentAttachmentDownloadStore();
    const first = leaseOf(store.begin("thread-a", "file-1"));
    store.clear();
    const second = leaseOf(store.begin("thread-a", "file-1"));

    expect(store.settle(first)).toBe(false);
    expect(store.has("thread-a", "file-1")).toBe(true);
    expect(store.settle(second)).toBe(true);
    expect(store.settle(second)).toBe(false);
  });

  it("notifies subscribers only when the running set changes", () => {
    const store = createAgentAttachmentDownloadStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.clear();
    expect(listener).toHaveBeenCalledTimes(0);
    const lease = leaseOf(store.begin("thread-a", "file-1"));
    expect(listener).toHaveBeenCalledTimes(1);
    store.begin("thread-a", "file-1");
    expect(listener).toHaveBeenCalledTimes(1);
    store.settle(lease);
    expect(listener).toHaveBeenCalledTimes(2);
    store.settle(lease);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.begin("thread-a", "file-2");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

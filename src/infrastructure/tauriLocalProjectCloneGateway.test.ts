import { describe, expect, it, vi } from "vitest";
import {
  TauriLocalProjectCloneGateway,
  type LocalProjectCloneCommand,
} from "./tauriLocalProjectCloneGateway";

const cloneId = "01234567-89ab-4cde-8fab-0123456789ab";
const request = {
  idempotencyKey: cloneId,
  url: "https://github.com/acme/repo.git",
  name: "repo",
  parentPath: "/Users/dev",
};
const snapshot = { cloneId, status: "running", path: "/Users/dev/repo", error: null };

describe("TauriLocalProjectCloneGateway", () => {
  it("uses semantic commands and the exact closed request wrapper", async () => {
    const invoke = vi.fn<LocalProjectCloneCommand>().mockResolvedValue(snapshot);
    const gateway = new TauriLocalProjectCloneGateway(invoke);
    await expect(gateway.start(request)).resolves.toEqual(snapshot);
    await expect(gateway.get({ cloneId })).resolves.toEqual(snapshot);
    await expect(gateway.cancel({ cloneId })).resolves.toEqual(snapshot);
    expect(invoke.mock.calls).toEqual([
      ["local_clone_project", { request }],
      ["local_get_project_clone", { request: { cloneId } }],
      ["local_cancel_project_clone", { request: { cloneId } }],
    ]);
  });
  it("rejects invalid outgoing requests before invoking", async () => {
    const invoke = vi.fn<LocalProjectCloneCommand>();
    const gateway = new TauriLocalProjectCloneGateway(invoke);
    await expect(gateway.start({ ...request, name: "../escape" })).rejects.toThrow();
    await expect(gateway.get({ cloneId: "bad" })).rejects.toThrow();
    await expect(gateway.cancel({ cloneId: "bad" })).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(["start", "get", "cancel"] as const)("rejects foreign %s snapshots", async (method) => {
    const invoke = vi
      .fn<LocalProjectCloneCommand>()
      .mockResolvedValue({ ...snapshot, cloneId: "11234567-89ab-4cde-8fab-0123456789ab" });
    const gateway = new TauriLocalProjectCloneGateway(invoke);
    await expect(
      method === "start" ? gateway.start(request) : gateway[method]({ cloneId }),
    ).rejects.toThrow("another job");
  });
  it("fails closed on unknown response fields and propagates transport errors", async () => {
    const invoke = vi
      .fn<LocalProjectCloneCommand>()
      .mockResolvedValueOnce({ ...snapshot, secret: "no" })
      .mockRejectedValueOnce(new Error("offline"));
    const gateway = new TauriLocalProjectCloneGateway(invoke);
    await expect(gateway.get({ cloneId })).rejects.toThrow("contract");
    await expect(gateway.get({ cloneId })).rejects.toThrow("offline");
  });
});

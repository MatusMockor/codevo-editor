import { describe, expect, it, vi } from "vitest";
import { TauriRemoteRepositoryIdentityGateway } from "./tauriRemoteRepositoryIdentityGateway";

const request = { serverId: "server", runnerId: "runner", projectId: "project" };
describe("remote repository grouping identity", () => {
  it("sends exact authority and returns only a sanitized identity", async () => {
    const invoke = vi.fn().mockResolvedValue({ repositoryKey: "github.com/org/repo" });
    expect(await new TauriRemoteRepositoryIdentityGateway(invoke).discover(request)).toBe(
      "github.com/org/repo",
    );
    expect(invoke).toHaveBeenCalledWith("remote_runner_repository_identity", { request });
  });
  it("accepts unsupported-server and absent-origin null", async () => {
    const invoke = vi.fn().mockResolvedValue({ repositoryKey: null });
    expect(await new TauriRemoteRepositoryIdentityGateway(invoke).discover(request)).toBeNull();
  });
  it.each(["example.com:22/Org/repo", "example.com:443/Org/repo", "github.com/org/repo"])(
    "preserves canonical key %s",
    async (key) => {
      expect(
        await new TauriRemoteRepositoryIdentityGateway(
          vi.fn().mockResolvedValue({ repositoryKey: key }),
        ).discover(request),
      ).toBe(key);
    },
  );
  it.each([
    { repositoryKey: "https://user:secret@example.com/repo" },
    { repositoryKey: "example.com/repo?token=secret" },
    { repositoryKey: "example.com/../repo" },
    { repositoryKey: "github.com/UPPER/repo" },
    { repositoryKey: null, url: "secret" },
    {},
    [],
    null,
  ])("rejects unsafe or noncanonical wire response %#", async (response) => {
    await expect(
      new TauriRemoteRepositoryIdentityGateway(vi.fn().mockResolvedValue(response)).discover(
        request,
      ),
    ).rejects.toThrow("Invalid remote repository identity response");
  });
  it("rejects path injection before invocation", async () => {
    const invoke = vi.fn();
    await expect(
      new TauriRemoteRepositoryIdentityGateway(invoke).discover({
        ...request,
        projectId: "../other",
      }),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("does not hide permission or connection failures", async () => {
    await expect(
      new TauriRemoteRepositoryIdentityGateway(
        vi.fn().mockRejectedValue(new Error("offline")),
      ).discover(request),
    ).rejects.toThrow("offline");
  });
});

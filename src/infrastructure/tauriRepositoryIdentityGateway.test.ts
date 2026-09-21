import { describe, expect, it, vi } from "vitest";
import { TauriRepositoryIdentityGateway } from "./tauriRepositoryIdentityGateway";

describe("repository identity gateway", () => {
  it("validates request and sanitized native response", async () => {
    const invoke = vi.fn().mockResolvedValue("git.example.com:443/Org/Repo.git");
    const gateway = new TauriRepositoryIdentityGateway(invoke, () => true);
    await expect(gateway.discover("/project")).resolves.toBe("git.example.com:443/Org/Repo.git");
    expect(invoke).toHaveBeenCalledWith("get_repository_identity", { rootPath: "/project" });
    await expect(gateway.discover("a\0b")).rejects.toThrow("Invalid project path");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed native data without reflecting credentials", async () => {
    for (const result of [
      {},
      "token@github.com/org/repo",
      "github.com/org/repo?token=x",
      "github.com/org/../repo",
    ]) {
      await expect(
        new TauriRepositoryIdentityGateway(vi.fn().mockResolvedValue(result), () => true).discover(
          "/project",
        ),
      ).rejects.toThrow("Invalid repository identity");
    }
  });
  it("supports unavailable runtime and no origin", async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    await expect(
      new TauriRepositoryIdentityGateway(invoke, () => false).discover("/project"),
    ).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    await expect(
      new TauriRepositoryIdentityGateway(invoke, () => true).discover("/project"),
    ).resolves.toBeNull();
  });
});

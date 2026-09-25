import { describe, expect, it, vi } from "vitest";
import { WorkspaceTrustPromptCoordinator } from "./workspaceTrustPrompt";

const request = {
  rootPath: "/Users/dev/code/app",
  label: "app",
  origin: { kind: "local" as const },
};

describe("WorkspaceTrustPromptCoordinator", () => {
  it("resolves notNow immediately when no host is mounted", async () => {
    await expect(new WorkspaceTrustPromptCoordinator().request(request)).resolves.toBe("notNow");
  });

  it("publishes one request and settles it exactly once", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    const release = prompt.acquireHostLease();
    const listener = vi.fn();
    prompt.subscribe(listener);
    const decision = prompt.request(request);
    const active = prompt.getSnapshot();
    expect(active).toEqual(request);
    expect(active).not.toBeNull();
    const settled = active as NonNullable<typeof active>;
    prompt.resolve(settled, "trust");
    prompt.resolve(settled, "notNow");
    await expect(decision).resolves.toBe("trust");
    expect(prompt.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    release();
  });

  it("ignores a resolution for a request that is not the active one", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    prompt.acquireHostLease();
    const decision = prompt.request(request);
    prompt.resolve({ ...request }, "trust");
    expect(prompt.getSnapshot()).toEqual(request);
    const active = prompt.getSnapshot();
    expect(active).not.toBeNull();
    prompt.resolve(active as NonNullable<typeof active>, "notNow");
    await expect(decision).resolves.toBe("notNow");
  });

  it("supersedes an older request instead of queueing it", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    prompt.acquireHostLease();
    const first = prompt.request(request);
    const second = prompt.request({
      ...request,
      rootPath: "/Users/dev/code/other",
      label: "other",
    });
    await expect(first).resolves.toBe("notNow");
    const active = prompt.getSnapshot();
    expect(active?.label).toBe("other");
    prompt.resolve(active as NonNullable<typeof active>, "trust");
    await expect(second).resolves.toBe("trust");
  });

  it("dismisses on workspace scope change and when the last host unmounts", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    const release = prompt.acquireHostLease();
    prompt.setWorkspaceScope("ws-a");
    const scoped = prompt.request(request);
    prompt.setWorkspaceScope("ws-b");
    await expect(scoped).resolves.toBe("notNow");
    const hosted = prompt.request(request);
    release();
    await expect(hosted).resolves.toBe("notNow");
  });

  it("never lets a prompt opened in A survive A -> B -> A", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    prompt.acquireHostLease();
    prompt.setWorkspaceScope("ws-a");
    const stale = prompt.request(request);
    const staleRequest = prompt.getSnapshot();
    prompt.setWorkspaceScope("ws-b");
    prompt.setWorkspaceScope("ws-a");
    expect(prompt.getSnapshot()).toBeNull();
    prompt.resolve(staleRequest as NonNullable<typeof staleRequest>, "trust");
    await expect(stale).resolves.toBe("notNow");
  });

  it("rejects unbounded or relative requests", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    prompt.acquireHostLease();
    await expect(prompt.request({ ...request, rootPath: "relative" })).rejects.toThrow(RangeError);
    await expect(prompt.request({ ...request, label: "x".repeat(257) })).rejects.toThrow(
      RangeError,
    );
    await expect(
      prompt.request({
        ...request,
        origin: { kind: "clone", host: "h".repeat(300), path: "a/b".repeat(80) },
      }),
    ).rejects.toThrow(RangeError);
    expect(prompt.getSnapshot()).toBeNull();
  });
});

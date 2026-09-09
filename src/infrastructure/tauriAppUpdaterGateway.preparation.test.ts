import { describe, expect, it, vi } from "vitest";
import { TauriAppUpdaterGateway } from "./tauriAppUpdaterGateway";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function fixture() {
  const update = {
    currentVersion: "1.0.0",
    version: "2.0.0",
    download: vi.fn(async (): Promise<void> => undefined),
    install: vi.fn(async (): Promise<void> => undefined),
    close: vi.fn(async (): Promise<void> => undefined),
  };
  const bridge = {
    check: vi.fn(async (): Promise<unknown> => update),
    getInstallMode: vi.fn(async (): Promise<unknown> => "prepareBeforeRestart"),
    relaunch: vi.fn(async (): Promise<void> => undefined),
  };
  const gateway = new TauriAppUpdaterGateway(bridge, "1.0.0");
  return { update, bridge, gateway };
}

async function revision(gateway: TauriAppUpdaterGateway) {
  const result = await gateway.check();
  if (result.kind !== "available" && result.kind !== "readyToRestart") throw new Error("No update");
  return result.candidate.candidateRevision;
}

describe("prepared application updates", () => {
  it("installs before Later and preserves restart readiness through disposal and recheck", async () => {
    const { update, bridge, gateway } = fixture();
    const rev = await revision(gateway);
    await expect(gateway.download(rev)).resolves.toBe("readyToRestart");
    expect(update.install).toHaveBeenCalledOnce();
    expect(bridge.relaunch).not.toHaveBeenCalled();
    await gateway.dispose();
    const next = await gateway.check();
    expect(next.kind).toBe("readyToRestart");
    expect(bridge.check).toHaveBeenCalledOnce();
    if (next.kind !== "readyToRestart") throw new Error("No prepared update");
    await gateway.installAndRestart(next.candidate.candidateRevision);
    expect(update.download).toHaveBeenCalledOnce();
    expect(update.install).toHaveBeenCalledOnce();
    expect(bridge.relaunch).toHaveBeenCalledOnce();
  });

  it("a newly launched process reads the already installed version", async () => {
    const { update, gateway } = fixture();
    let diskVersion = "1.0.0";
    update.install.mockImplementation(async () => {
      diskVersion = update.version;
    });
    await gateway.download(await revision(gateway));
    await gateway.dispose();
    const next = new TauriAppUpdaterGateway(
      {
        check: async () => (diskVersion === "2.0.0" ? null : update),
        relaunch: async () => undefined,
      },
      diskVersion,
    );
    await expect(next.check()).resolves.toEqual({ kind: "upToDate", currentVersion: "2.0.0" });
  });

  it.each(["close", "relaunch"] as const)(
    "keeps the installed commit when %s fails",
    async (failure) => {
      const { update, bridge, gateway } = fixture();
      const rev = await revision(gateway);
      if (failure === "close") {
        update.close.mockRejectedValueOnce(new Error("close failed"));
        await expect(gateway.download(rev)).resolves.toBe("readyToRestart");
      } else {
        await gateway.download(rev);
        bridge.relaunch.mockRejectedValueOnce(new Error("relaunch failed"));
        await expect(gateway.installAndRestart(rev)).rejects.toThrow("relaunch failed");
      }
      const fresh = await revision(gateway);
      await gateway.installAndRestart(fresh);
      expect(update.install).toHaveBeenCalledOnce();
      expect(update.download).toHaveBeenCalledOnce();
    },
  );

  it("waits for shared resource cleanup before relaunching", async () => {
    const { update, bridge, gateway } = fixture();
    update.close.mockRejectedValueOnce(new Error("first close failed"));
    await gateway.download(await revision(gateway));
    const pending = deferred();
    update.close.mockImplementation(() => pending.promise);
    const disposal = gateway.dispose();
    const restart = gateway.installAndRestart(await revision(gateway));
    await Promise.resolve();
    expect(bridge.relaunch).not.toHaveBeenCalled();
    pending.resolve();
    await disposal;
    await restart;
    expect(update.close).toHaveBeenCalledTimes(2);
    expect(bridge.relaunch).toHaveBeenCalledOnce();
  });

  it("does not install a download disposed before settlement", async () => {
    const { update, gateway } = fixture();
    const pending = deferred();
    update.download.mockImplementation(() => pending.promise);
    const download = gateway.download(await revision(gateway));
    await gateway.dispose();
    pending.resolve();
    await expect(download).rejects.toThrow("no longer current");
    expect(update.install).not.toHaveBeenCalled();
  });

  it("waits for an in-flight installation before checking and keeps its commit after disposal", async () => {
    const { update, bridge, gateway } = fixture();
    const pending = deferred();
    update.install.mockImplementation(() => pending.promise);
    const download = gateway.download(await revision(gateway));
    await vi.waitFor(() => expect(update.install).toHaveBeenCalledOnce());
    const check = gateway.check();
    expect(bridge.check).toHaveBeenCalledOnce();
    await gateway.dispose();
    pending.resolve();
    await expect(download).rejects.toThrow("no longer current");
    await expect(check).rejects.toThrow("stale");
    expect((await gateway.check()).kind).toBe("readyToRestart");
    expect(bridge.check).toHaveBeenCalledOnce();
    expect(bridge.relaunch).not.toHaveBeenCalled();
  });

  it("rechecks a successful in-flight installation without replacing it", async () => {
    const { update, bridge, gateway } = fixture();
    const pending = deferred();
    update.install.mockImplementation(() => pending.promise);
    const download = gateway.download(await revision(gateway));
    await vi.waitFor(() => expect(update.install).toHaveBeenCalledOnce());
    const check = gateway.check();
    pending.resolve();
    await expect(download).rejects.toThrow("no longer current");
    expect((await check).kind).toBe("readyToRestart");
    expect(bridge.check).toHaveBeenCalledOnce();
  });

  it("gives the newest concurrent check authority while an installation settles", async () => {
    const { update, bridge, gateway } = fixture();
    const pending = deferred();
    update.install.mockImplementation(() => pending.promise);
    const download = gateway.download(await revision(gateway));
    await vi.waitFor(() => expect(update.install).toHaveBeenCalledOnce());
    const firstCheck = gateway.check();
    const latestCheck = gateway.check();
    pending.resolve();
    await expect(download).rejects.toThrow("no longer current");
    await expect(firstCheck).rejects.toThrow("stale");
    await expect(latestCheck).resolves.toMatchObject({ kind: "readyToRestart" });
    expect(bridge.check).toHaveBeenCalledOnce();
  });

  it("does not claim restart readiness after a failed install", async () => {
    const { update, gateway } = fixture();
    update.install.mockRejectedValueOnce(new Error("install failed"));
    await expect(gateway.download(await revision(gateway))).rejects.toThrow("install failed");
    expect((await gateway.check()).kind).toBe("available");
  });

  it("rejects duplicate downloads and restarts while native operations are active", async () => {
    const { update, bridge, gateway } = fixture();
    const pending = deferred();
    update.download.mockImplementation(() => pending.promise);
    const rev = await revision(gateway);
    const download = gateway.download(rev);
    await expect(gateway.download(rev)).rejects.toThrow("already active");
    await expect(gateway.installAndRestart(rev)).rejects.toThrow("already active");
    pending.resolve();
    await download;
    const restarting = deferred();
    bridge.relaunch.mockImplementation(() => restarting.promise);
    const restart = gateway.installAndRestart(rev);
    await vi.waitFor(() => expect(bridge.relaunch).toHaveBeenCalledOnce());
    await expect(gateway.installAndRestart(rev)).rejects.toThrow("already active");
    await expect(gateway.check()).rejects.toThrow("already active");
    restarting.resolve();
    await restart;
  });

  it.each([undefined, null, "macos", {}, 1])(
    "rejects malformed native install mode %s",
    async (mode) => {
      const { bridge, gateway } = fixture();
      bridge.getInstallMode.mockResolvedValue(mode);
      await expect(gateway.check()).rejects.toThrow("Invalid application update install mode");
      expect(bridge.check).not.toHaveBeenCalled();
    },
  );

  it("preserves download-only behavior on platforms that install during restart", async () => {
    const { update, bridge, gateway } = fixture();
    bridge.getInstallMode.mockResolvedValue("installOnRestart");
    await expect(gateway.download(await revision(gateway))).resolves.toBe("readyToInstall");
    expect(update.install).not.toHaveBeenCalled();
  });
});

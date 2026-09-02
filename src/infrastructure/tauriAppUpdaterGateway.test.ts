import { describe, expect, it, vi } from "vitest";
import {
  parseTauriUpdaterBridgeUpdate,
  TauriAppUpdaterGateway,
  type TauriUpdaterBridgeUpdate,
} from "./tauriAppUpdaterGateway";

const latestManifest = {
  version: "0.2.0",
  notes: "Beta update",
  pub_date: "2026-08-29T12:00:00Z",
  platforms: {
    "darwin-aarch64": {
      signature: "fixture-signature",
      url: "http://127.0.0.1:43121/Codevo.app.tar.gz",
    },
  },
} as const;

describe("TauriAppUpdaterGateway", () => {
  it("checks a strict fake latest.json without downloading", async () => {
    const download = vi.fn(async () => undefined);
    const install = vi.fn(async () => undefined);
    const update = updateFromManifest(latestManifest, download, install);
    const check = vi.fn(async () => update);
    const gateway = new TauriAppUpdaterGateway(
      {
        check,
        relaunch: vi.fn(async () => undefined),
      },
      "0.1.0",
    );

    await expect(gateway.check()).resolves.toEqual({
      kind: "available",
      candidate: {
        candidateRevision: 1,
        currentVersion: "0.1.0",
        version: "0.2.0",
        date: latestManifest.pub_date,
        notes: latestManifest.notes,
      },
    });
    expect(check).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it("downloads and installs only through separate explicit intents", async () => {
    const calls: string[] = [];
    const update = updateFromManifest(
      latestManifest,
      async () => {
        calls.push("download");
      },
      async () => {
        calls.push("install");
      },
    );
    const gateway = new TauriAppUpdaterGateway(
      {
        check: async () => update,
        relaunch: async () => {
          calls.push("relaunch");
        },
      },
      "0.1.0",
    );
    const result = await gateway.check();
    if (result.kind !== "available") throw new Error("Expected an update candidate.");

    await gateway.download(result.candidate.candidateRevision);
    expect(calls).toEqual(["download"]);
    await gateway.installAndRestart(result.candidate.candidateRevision);
    expect(calls).toEqual(["download", "install", "relaunch"]);
    expect(update.close).toHaveBeenCalledOnce();
  });

  it("uses package version authority when no update is available", async () => {
    const gateway = new TauriAppUpdaterGateway(
      { check: async () => null, relaunch: async () => undefined },
      "0.2.0-beta.1",
    );
    await expect(gateway.check()).resolves.toEqual({
      kind: "upToDate",
      currentVersion: "0.2.0-beta.1",
    });
  });

  it("rejects stale candidate work after a concurrent check replaces authority", async () => {
    let settleDownload!: () => void;
    const first = updateFromManifest(
      latestManifest,
      () =>
        new Promise<void>((resolve) => {
          settleDownload = resolve;
        }),
      async () => undefined,
    );
    const second = updateFromManifest(
      { ...latestManifest, version: "0.3.0" },
      async () => undefined,
      async () => undefined,
    );
    const check = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const gateway = new TauriAppUpdaterGateway(
      {
        check,
        relaunch: async () => undefined,
      },
      "0.1.0",
    );
    const result = await gateway.check();
    if (result.kind !== "available") throw new Error("Expected an update candidate.");
    const pending = gateway.download(result.candidate.candidateRevision);
    await gateway.check();
    settleDownload();

    await expect(pending).rejects.toThrow("no longer current");
  });

  it("fails closed for malformed or oversized updater responses", () => {
    expect(() => parseTauriUpdaterBridgeUpdate({ version: "0.2.0" })).toThrow("currentVersion");
    expect(() =>
      parseTauriUpdaterBridgeUpdate({
        currentVersion: "0.1.0",
        version: "x".repeat(65),
        download: async () => undefined,
        install: async () => undefined,
      }),
    ).toThrow("version");
  });

  it("closes a native resource when later metadata validation fails", async () => {
    const close = vi.fn(async () => undefined);
    const gateway = new TauriAppUpdaterGateway(
      {
        check: async () => ({
          currentVersion: "0.1.0",
          version: "x".repeat(65),
          download: async () => undefined,
          install: async () => undefined,
          close,
        }),
        relaunch: async () => undefined,
      },
      "0.1.0",
    );
    await expect(gateway.check()).rejects.toThrow("version");
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes replaced, disposed, and version-mismatched resources", async () => {
    const first = updateFromManifest(
      latestManifest,
      async () => undefined,
      async () => undefined,
    );
    const second = updateFromManifest(
      { ...latestManifest, version: "0.3.0" },
      async () => undefined,
      async () => undefined,
    );
    const gateway = new TauriAppUpdaterGateway(
      {
        check: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
        relaunch: async () => undefined,
      },
      "0.1.0",
    );
    await gateway.check();
    await gateway.check();
    expect(first.close).toHaveBeenCalledOnce();
    await gateway.dispose();
    expect(second.close).toHaveBeenCalledOnce();

    const mismatch = { ...second, currentVersion: "9.9.9", close: vi.fn(async () => undefined) };
    const mismatchGateway = new TauriAppUpdaterGateway(
      { check: async () => mismatch, relaunch: async () => undefined },
      "0.1.0",
    );
    await expect(mismatchGateway.check()).rejects.toThrow("does not match");
    expect(mismatch.close).toHaveBeenCalledOnce();
  });

  it("retains a candidate when native close fails so release can be retried", async () => {
    const baseUpdate = updateFromManifest(
      latestManifest,
      async () => undefined,
      async () => undefined,
    );
    const close = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("close failed"))
      .mockResolvedValueOnce(undefined);
    const update = { ...baseUpdate, close };
    const gateway = new TauriAppUpdaterGateway(
      { check: async () => update, relaunch: async () => undefined },
      "0.1.0",
    );
    await gateway.check();

    await expect(gateway.dispose()).rejects.toThrow("close failed");
    await expect(gateway.dispose()).resolves.toBeUndefined();
    expect(update.close).toHaveBeenCalledTimes(2);
  });

  it("closes a late update resource after a newer check owns the gateway", async () => {
    let settleFirst!: (update: TauriUpdaterBridgeUpdate) => void;
    const staleUpdate = updateFromManifest(
      latestManifest,
      async () => undefined,
      async () => undefined,
    );
    const gateway = new TauriAppUpdaterGateway(
      {
        check: vi
          .fn()
          .mockImplementationOnce(
            () =>
              new Promise<TauriUpdaterBridgeUpdate>((resolve) => {
                settleFirst = resolve;
              }),
          )
          .mockResolvedValueOnce(null),
        relaunch: async () => undefined,
      },
      "0.1.0",
    );
    const staleCheck = gateway.check();
    await expect(gateway.check()).resolves.toEqual({
      kind: "upToDate",
      currentVersion: "0.1.0",
    });
    settleFirst(staleUpdate);
    await expect(staleCheck).rejects.toThrow("stale");
    expect(staleUpdate.close).toHaveBeenCalledOnce();
  });

  it("defers disposal until an active download settles", async () => {
    let settleDownload!: () => void;
    const update = updateFromManifest(
      latestManifest,
      () => new Promise<void>((resolve) => (settleDownload = resolve)),
      async () => undefined,
    );
    const gateway = new TauriAppUpdaterGateway(
      { check: async () => update, relaunch: async () => undefined },
      "0.1.0",
    );
    const result = await gateway.check();
    if (result.kind !== "available") throw new Error("Expected an update candidate.");
    const pendingDownload = gateway.download(result.candidate.candidateRevision);
    await gateway.dispose();
    expect(update.close).not.toHaveBeenCalled();
    settleDownload();
    await expect(pendingDownload).rejects.toThrow("no longer current");
    expect(update.close).toHaveBeenCalledOnce();
  });

  it("closes but does not relaunch an installed update after owner disposal", async () => {
    let settleInstall!: () => void;
    const relaunch = vi.fn(async () => undefined);
    const update = updateFromManifest(
      latestManifest,
      async () => undefined,
      () => new Promise<void>((resolve) => (settleInstall = resolve)),
    );
    const gateway = new TauriAppUpdaterGateway({ check: async () => update, relaunch }, "0.1.0");
    const result = await gateway.check();
    if (result.kind !== "available") throw new Error("Expected an update candidate.");
    await gateway.download(result.candidate.candidateRevision);
    const pendingInstall = gateway.installAndRestart(result.candidate.candidateRevision);
    await gateway.dispose();
    expect(update.close).not.toHaveBeenCalled();
    settleInstall();
    await expect(pendingInstall).rejects.toThrow("no longer current");
    expect(update.close).toHaveBeenCalledOnce();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("normalizes package version authority before comparison and projection", async () => {
    const update = updateFromManifest(
      latestManifest,
      async () => undefined,
      async () => undefined,
    );
    const gateway = new TauriAppUpdaterGateway(
      { check: async () => update, relaunch: async () => undefined },
      " 0.1.0 ",
    );
    const result = await gateway.check();
    expect(result.kind === "available" ? result.candidate.currentVersion : null).toBe("0.1.0");
  });
});

function updateFromManifest(
  manifest: typeof latestManifest | (Omit<typeof latestManifest, "version"> & { version: string }),
  download: () => Promise<void>,
  install: () => Promise<void>,
): TauriUpdaterBridgeUpdate {
  if (Object.keys(manifest).sort().join(",") !== "notes,platforms,pub_date,version") {
    throw new TypeError("Invalid latest.json fixture.");
  }
  const platform = manifest.platforms["darwin-aarch64"];
  if (!platform.signature || !platform.url.startsWith("http://127.0.0.1:")) {
    throw new TypeError("Invalid latest.json platform fixture.");
  }
  return {
    currentVersion: "0.1.0",
    version: manifest.version,
    date: manifest.pub_date,
    body: manifest.notes,
    download,
    install,
    close: vi.fn(async () => undefined),
  };
}

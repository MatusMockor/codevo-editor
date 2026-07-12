import { describe, expect, it } from "vitest";
import type { WorkspaceSettings } from "../domain/settings";
import { createWorkspaceSettingsSaveCoordinator } from "./workspaceSettingsSaveCoordinator";

describe("workspace settings save coordinator", () => {
  it("serializes saves and keeps the latest successful settings committed", async () => {
    const coordinator = createWorkspaceSettingsSaveCoordinator();
    const baseline = settings(false);
    const first = settings(true);
    const latest = settings(true);
    const firstWrite = deferred<void>();
    const latestWrite = deferred<void>();
    const starts: string[] = [];

    const firstSave = coordinator.save(ROOT, baseline, first, async () => {
      starts.push("first");
      await firstWrite.promise;
    });
    const latestSave = coordinator.save(ROOT, baseline, latest, async () => {
      starts.push("latest");
      await latestWrite.promise;
    });
    await Promise.resolve();

    expect(starts).toEqual(["first"]);
    expect(coordinator.waitForIdle(ROOT)).not.toBeNull();

    firstWrite.resolve();
    await firstSave;
    await Promise.resolve();

    expect(starts).toEqual(["first", "latest"]);

    latestWrite.resolve();
    await latestSave;

    expect(coordinator.committed(ROOT)).toBe(latest);
    expect(coordinator.waitForIdle(ROOT)).toBeNull();
  });

  it("retains the last committed baseline when overlapping saves both fail", async () => {
    const coordinator = createWorkspaceSettingsSaveCoordinator();
    const baseline = settings(false);
    const firstWrite = deferred<void>();
    const latestWrite = deferred<void>();

    const firstSave = coordinator.save(ROOT, baseline, settings(true), () =>
      firstWrite.promise,
    );
    const latestSave = coordinator.save(ROOT, baseline, settings(true), () =>
      latestWrite.promise,
    );
    await Promise.resolve();

    firstWrite.reject(new Error("first failed"));
    await expect(firstSave).rejects.toThrow("first failed");
    await Promise.resolve();

    latestWrite.reject(new Error("latest failed"));
    await expect(latestSave).rejects.toThrow("latest failed");

    expect(coordinator.committed(ROOT)).toBe(baseline);
  });
});

const ROOT = "/workspace";

function settings(validation: boolean): WorkspaceSettings {
  return {
    javaScriptTypeScriptValidation: validation,
  } as WorkspaceSettings;
}

function deferred<T>(): {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
} {
  let rejectPromise: (error: unknown) => void = () => undefined;
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });
  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

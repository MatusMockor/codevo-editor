import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSettings } from "../domain/settings";
import {
  createWorkspaceSettingsSaveCoordinator,
  WORKSPACE_SETTINGS_NAVIGATION_SAVE_DEBOUNCE_MS,
} from "./workspaceSettingsSaveCoordinator";

describe("workspace settings save coordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

    const firstSave = coordinator.save(ROOT, baseline, settings(true), () => firstWrite.promise);
    const latestSave = coordinator.save(ROOT, baseline, settings(true), () => latestWrite.promise);
    await Promise.resolve();

    firstWrite.reject(new Error("first failed"));
    await expect(firstSave).rejects.toThrow("first failed");
    await Promise.resolve();

    latestWrite.reject(new Error("latest failed"));
    await expect(latestSave).rejects.toThrow("latest failed");

    expect(coordinator.committed(ROOT)).toBe(baseline);
  });

  it("trailing-debounces navigation saves and flushes only the latest task", async () => {
    vi.useFakeTimers();
    const coordinator = createWorkspaceSettingsSaveCoordinator();
    const calls: string[] = [];

    coordinator.scheduleNavigationSave(ROOT, async () => {
      calls.push("first");
    });
    coordinator.scheduleNavigationSave(ROOT, async () => {
      calls.push("latest");
    });

    await vi.advanceTimersByTimeAsync(WORKSPACE_SETTINGS_NAVIGATION_SAVE_DEBOUNCE_MS - 1);
    expect(calls).toEqual([]);
    await coordinator.flushNavigationSave(ROOT);

    expect(calls).toEqual(["latest"]);
    await vi.advanceTimersByTimeAsync(WORKSPACE_SETTINGS_NAVIGATION_SAVE_DEBOUNCE_MS);
    expect(calls).toEqual(["latest"]);
  });

  it("does not resolve a flush before its scheduled write completes", async () => {
    const coordinator = createWorkspaceSettingsSaveCoordinator();
    const write = deferred<void>();
    let settled = false;

    coordinator.scheduleNavigationSave(ROOT, () => write.promise);
    const flush = coordinator.flushNavigationSave(ROOT).then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(coordinator.hasScheduledNavigationSave(ROOT)).toBe(true);
    const secondFlush = coordinator.flushNavigationSave(ROOT);
    write.resolve();
    await Promise.all([flush, secondFlush]);
    expect(settled).toBe(true);
    expect(coordinator.hasScheduledNavigationSave(ROOT)).toBe(false);
  });

  it("cancels pending navigation work without running it", async () => {
    vi.useFakeTimers();
    const coordinator = createWorkspaceSettingsSaveCoordinator();
    const task = vi.fn(async () => undefined);

    expect(coordinator.hasScheduledNavigationSave(ROOT)).toBe(false);
    expect(coordinator.cancelNavigationSave(ROOT)).toBe(false);
    coordinator.scheduleNavigationSave(ROOT, task);
    expect(coordinator.cancelNavigationSave(ROOT)).toBe(true);
    expect(coordinator.hasScheduledNavigationSave(ROOT)).toBe(false);

    await vi.advanceTimersByTimeAsync(WORKSPACE_SETTINGS_NAVIGATION_SAVE_DEBOUNCE_MS);
    expect(task).not.toHaveBeenCalled();
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

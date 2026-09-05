import { describe, expect, it } from "vitest";
import {
  appUpdateToastGroupKey,
  isSkippedAppUpdateVersion,
  initialAppUpdaterState,
  normalizeAppUpdaterSkippedVersion,
  presentAppUpdateToast,
  reduceAppUpdaterState,
  type AppUpdateCandidate,
  type AppUpdaterState,
} from "./appUpdater";

const candidate: AppUpdateCandidate = {
  candidateRevision: 3,
  currentVersion: "0.1.0",
  version: "0.2.0",
  date: "2026-08-29T12:00:00Z",
  notes: "Beta update",
};

describe("app updater reducer", () => {
  it("models check, download, and explicit install as closed states", () => {
    const checking = reduceAppUpdaterState(initialAppUpdaterState("0.1.0"), {
      kind: "checkStarted",
      generation: 1,
    });
    const available = reduceAppUpdaterState(checking, {
      kind: "checkSettled",
      generation: 1,
      result: { kind: "available", candidate },
    });
    const downloading = reduceAppUpdaterState(available, {
      kind: "downloadStarted",
      generation: 2,
    });
    const ready = reduceAppUpdaterState(downloading, {
      kind: "downloadSettled",
      generation: 2,
    });
    const installing = reduceAppUpdaterState(ready, {
      kind: "installStarted",
      generation: 3,
    });

    expect(available.kind).toBe("available");
    expect(downloading.kind).toBe("downloading");
    expect(ready.kind).toBe("readyToInstall");
    expect(installing.kind).toBe("installing");
  });

  it("drops stale settlements after a newer check owns the state", () => {
    const first = reduceAppUpdaterState(initialAppUpdaterState("0.1.0"), {
      kind: "checkStarted",
      generation: 1,
    });
    const second = reduceAppUpdaterState(first, { kind: "checkStarted", generation: 2 });

    expect(
      reduceAppUpdaterState(second, {
        kind: "checkSettled",
        generation: 1,
        result: { kind: "available", candidate },
      }),
    ).toEqual(second);
  });

  it("bounds errors and rejects invalid current versions", () => {
    expect(() => initialAppUpdaterState(" ")).toThrow("Invalid application version");
    const checking = reduceAppUpdaterState(initialAppUpdaterState("0.1.0"), {
      kind: "checkStarted",
      generation: 1,
    });
    const failed = reduceAppUpdaterState(checking, {
      kind: "failed",
      generation: 1,
      operation: "check",
      message: "x".repeat(1_000),
    });

    expect(failed.kind).toBe("failed");
    expect(failed.kind === "failed" ? failed.message.length : 0).toBe(512);
  });

  it("normalizes persisted skip versions and suppresses only an exact release", () => {
    expect(normalizeAppUpdaterSkippedVersion(" 0.2.0 ")).toBe("0.2.0");
    expect(normalizeAppUpdaterSkippedVersion("x".repeat(65))).toBeNull();
    expect(normalizeAppUpdaterSkippedVersion("0.2.0\nignored")).toBeNull();
    expect(isSkippedAppUpdateVersion(candidate, "0.2.0")).toBe(true);
    expect(isSkippedAppUpdateVersion(candidate, "0.3.0")).toBe(false);
  });
});

describe("app update toast presentation", () => {
  const release = {
    currentVersion: "0.1.0",
    version: "0.2.0",
    date: "2026-08-29",
    notes: "Beta update",
  } as const;

  it("stays silent while idle, checking, up to date, or after a failed check", () => {
    const silent: AppUpdaterState[] = [
      { kind: "idle", currentVersion: "0.1.0" },
      { kind: "checking", currentVersion: "0.1.0", generation: 1 },
      { kind: "upToDate", currentVersion: "0.1.0" },
      {
        kind: "failed",
        currentVersion: "0.1.0",
        operation: "check",
        message: "Unable to check.",
        release: null,
      },
      {
        kind: "failed",
        currentVersion: "0.1.0",
        operation: "check",
        message: "Unable to check.",
        release,
      },
    ];

    for (const state of silent) {
      expect(presentAppUpdateToast(state)).toBeNull();
    }
  });

  it("projects every release-bearing state into a bounded toast", () => {
    expect(presentAppUpdateToast({ ...release, kind: "available" })).toEqual({
      kind: "available",
      version: "0.2.0",
      currentVersion: "0.1.0",
      date: "2026-08-29",
    });
    expect(presentAppUpdateToast({ ...release, kind: "downloading", generation: 2 })).toEqual({
      kind: "downloading",
      version: "0.2.0",
    });
    expect(presentAppUpdateToast({ ...release, kind: "readyToInstall" })).toEqual({
      kind: "readyToInstall",
      version: "0.2.0",
    });
    expect(presentAppUpdateToast({ ...release, kind: "installing", generation: 3 })).toEqual({
      kind: "installing",
      version: "0.2.0",
    });
    expect(
      presentAppUpdateToast({
        kind: "failed",
        currentVersion: "0.1.0",
        operation: "download",
        message: "Unable to download the application update.",
        release,
      }),
    ).toEqual({
      kind: "failed",
      version: "0.2.0",
      operation: "download",
      message: "Unable to download the application update.",
    });
  });

  it("keeps one toast identity across the download lifecycle of a release", () => {
    const available = appUpdateToastGroupKey({
      kind: "available",
      version: "0.2.0",
      currentVersion: "0.1.0",
      date: null,
    });
    expect(appUpdateToastGroupKey({ kind: "readyToInstall", version: "0.2.0" })).toBe(available);
    expect(appUpdateToastGroupKey({ kind: "readyToInstall", version: "0.3.0" })).not.toBe(
      available,
    );
  });
});

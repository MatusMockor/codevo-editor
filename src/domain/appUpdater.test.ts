import { describe, expect, it } from "vitest";
import {
  initialAppUpdaterState,
  reduceAppUpdaterState,
  type AppUpdateCandidate,
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
});

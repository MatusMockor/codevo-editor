import { describe, expect, it } from "vitest";
import {
  appUpdateCheckFailureMessage,
  appUpdateCheckFailureReason,
  canStartManualAppUpdateCheck,
  manualAppUpdateCheckBlockedReason,
  manualAppUpdateCheckOutcome,
  type AppUpdateCheckFailureReason,
} from "./appUpdateCheck";
import type { AppUpdaterState } from "./appUpdater";

const RELEASE = {
  currentVersion: "0.1.0",
  version: "0.2.0",
  date: null,
  notesSpan: { kind: "single", notes: null },
} as const;

describe("app update check policy", () => {
  it("accepts only the closed backend failure codes and hides every other detail", () => {
    expect(appUpdateCheckFailureReason("timeout")).toBe("timeout");
    expect(appUpdateCheckFailureReason("offline")).toBe("offline");
    expect(appUpdateCheckFailureReason("invalidRelease")).toBe("invalidRelease");
    expect(appUpdateCheckFailureReason("unavailable")).toBe("unavailable");
    expect(appUpdateCheckFailureReason("https://secret.example/latest.json")).toBe("unavailable");
    expect(appUpdateCheckFailureReason(new Error("timeout"))).toBe("unavailable");
    expect(appUpdateCheckFailureReason({ kind: "timeout" })).toBe("unavailable");
    expect(appUpdateCheckFailureReason(undefined)).toBe("unavailable");
  });

  it("names the failure reason in fixed Codevo copy", () => {
    expect(appUpdateCheckFailureMessage("timeout")).toBe(
      "Unable to check for Codevo updates: the update server did not respond in time.",
    );
    expect(appUpdateCheckFailureMessage("offline")).toBe(
      "Unable to check for Codevo updates: the update server could not be reached.",
    );
    expect(appUpdateCheckFailureMessage("invalidRelease")).toBe(
      "Unable to check for Codevo updates: the published release could not be read.",
    );
    expect(appUpdateCheckFailureMessage("unavailable")).toBe("Unable to check for Codevo updates.");
  });

  it("gives every failure reason a short label that fits the rail and keeps the full message", () => {
    const labels: ReadonlyArray<readonly [AppUpdateCheckFailureReason, string]> = [
      ["timeout", "Update server timed out"],
      ["offline", "Update server unreachable"],
      ["invalidRelease", "Release unreadable"],
      ["unavailable", "Update check failed"],
    ];
    for (const [reason, label] of labels) {
      const message = appUpdateCheckFailureMessage(reason);
      expect(
        manualAppUpdateCheckOutcome({
          kind: "failed",
          currentVersion: "0.1.0",
          operation: "check",
          message,
          release: null,
        }),
      ).toEqual({ kind: "failed", label, title: message });
      expect(label.length).toBeLessThanOrEqual(26);
    }
    expect(
      manualAppUpdateCheckOutcome({
        kind: "failed",
        currentVersion: "0.1.0",
        operation: "check",
        message: "Something unexpected",
        release: null,
      }),
    ).toEqual({ kind: "failed", label: "Update check failed", title: "Something unexpected" });
  });

  it("explains why a manual check is blocked by a release flow in progress", () => {
    expect(manualAppUpdateCheckBlockedReason({ kind: "idle", currentVersion: "0.1.0" })).toBeNull();
    expect(
      manualAppUpdateCheckBlockedReason({
        kind: "checking",
        currentVersion: "0.1.0",
        generation: 1,
      }),
    ).toBeNull();
    expect(manualAppUpdateCheckBlockedReason({ ...RELEASE, kind: "available" })).toBe(
      "Codevo 0.2.0 is already available.",
    );
    expect(
      manualAppUpdateCheckBlockedReason({ ...RELEASE, kind: "downloading", generation: 1 }),
    ).toBe("Codevo 0.2.0 is being prepared.");
    expect(manualAppUpdateCheckBlockedReason({ ...RELEASE, kind: "readyToInstall" })).toBe(
      "Codevo 0.2.0 is ready to install.",
    );
    expect(manualAppUpdateCheckBlockedReason({ ...RELEASE, kind: "readyToRestart" })).toBe(
      "Codevo 0.2.0 is ready to restart.",
    );
    expect(
      manualAppUpdateCheckBlockedReason({
        ...RELEASE,
        kind: "readyToRestartOutdated",
        supersededBy: { version: "0.3.0", date: null },
      }),
    ).toBe("Codevo 0.2.0 is ready to restart.");
    expect(
      manualAppUpdateCheckBlockedReason({ ...RELEASE, kind: "installing", generation: 2 }),
    ).toBe("Codevo 0.2.0 is installing.");
  });

  it("starts a manual check only when no release flow is already in progress", () => {
    const states: ReadonlyArray<readonly [AppUpdaterState, boolean]> = [
      [{ kind: "idle", currentVersion: "0.1.0" }, true],
      [{ kind: "upToDate", currentVersion: "0.1.0" }, true],
      [
        {
          kind: "failed",
          currentVersion: "0.1.0",
          operation: "check",
          message: "x",
          release: null,
        },
        true,
      ],
      [{ kind: "checking", currentVersion: "0.1.0", generation: 1 }, false],
      [{ ...RELEASE, kind: "available" }, false],
      [{ ...RELEASE, kind: "downloading", generation: 2 }, false],
      [{ ...RELEASE, kind: "readyToInstall" }, false],
      [{ ...RELEASE, kind: "readyToRestart" }, false],
      [
        {
          ...RELEASE,
          kind: "readyToRestartOutdated",
          supersededBy: { version: "0.3.0", date: null },
        },
        false,
      ],
      [{ ...RELEASE, kind: "installing", generation: 3 }, false],
    ];

    for (const [state, expected] of states) {
      expect(canStartManualAppUpdateCheck(state), state.kind).toBe(expected);
    }
  });

  it("reports a manual check outcome truthfully and leaves an available release to the toast", () => {
    expect(manualAppUpdateCheckOutcome({ kind: "idle", currentVersion: "0.1.0" })).toEqual({
      kind: "pending",
    });
    expect(
      manualAppUpdateCheckOutcome({ kind: "checking", currentVersion: "0.1.0", generation: 1 }),
    ).toEqual({ kind: "pending" });
    expect(manualAppUpdateCheckOutcome({ kind: "upToDate", currentVersion: "0.1.0" })).toEqual({
      kind: "upToDate",
      label: "Codevo is up to date",
      title: "Codevo 0.1.0 is the latest release.",
    });
    expect(manualAppUpdateCheckOutcome({ ...RELEASE, kind: "available" })).toEqual({
      kind: "release",
    });
    expect(
      manualAppUpdateCheckOutcome({
        kind: "failed",
        currentVersion: "0.1.0",
        operation: "check",
        message: "Unable to check for Codevo updates: the update server did not respond in time.",
        release: null,
      }),
    ).toEqual({
      kind: "failed",
      label: "Update server timed out",
      title: "Unable to check for Codevo updates: the update server did not respond in time.",
    });
    expect(
      manualAppUpdateCheckOutcome({
        kind: "failed",
        currentVersion: "0.1.0",
        operation: "download",
        message: "Unable to prepare the application update.",
        release: RELEASE,
      }),
    ).toEqual({ kind: "release" });
  });
});

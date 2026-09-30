import type { AppUpdaterState } from "./appUpdater";

export type AppUpdateCheckFailureReason = "timeout" | "offline" | "invalidRelease" | "unavailable";

export type ManualAppUpdateCheckOutcome =
  | { readonly kind: "pending" }
  | { readonly kind: "upToDate"; readonly label: string; readonly title: string }
  | { readonly kind: "release" }
  | { readonly kind: "failed"; readonly label: string; readonly title: string };

const FAILURE_REASONS: ReadonlyArray<AppUpdateCheckFailureReason> = [
  "timeout",
  "offline",
  "invalidRelease",
  "unavailable",
];

export function appUpdateCheckFailureReason(error: unknown): AppUpdateCheckFailureReason {
  switch (error) {
    case "timeout":
    case "offline":
    case "invalidRelease":
      return error;
    default:
      return "unavailable";
  }
}

export function appUpdateCheckFailureMessage(reason: AppUpdateCheckFailureReason): string {
  switch (reason) {
    case "timeout":
      return "Unable to check for Codevo updates: the update server did not respond in time.";
    case "offline":
      return "Unable to check for Codevo updates: the update server could not be reached.";
    case "invalidRelease":
      return "Unable to check for Codevo updates: the published release could not be read.";
    case "unavailable":
      return "Unable to check for Codevo updates.";
    default:
      return unsupportedReason(reason);
  }
}

export function appUpdateCheckFailureLabel(reason: AppUpdateCheckFailureReason): string {
  switch (reason) {
    case "timeout":
      return "Update server timed out";
    case "offline":
      return "Update server unreachable";
    case "invalidRelease":
      return "Release unreadable";
    case "unavailable":
      return "Update check failed";
    default:
      return unsupportedReason(reason);
  }
}

export function manualAppUpdateCheckBlockedReason(state: AppUpdaterState): string | null {
  switch (state.kind) {
    case "idle":
    case "checking":
    case "upToDate":
    case "failed":
      return null;
    case "available":
      return `Codevo ${state.version} is already available.`;
    case "downloading":
      return `Codevo ${state.version} is being prepared.`;
    case "readyToInstall":
      return `Codevo ${state.version} is ready to install.`;
    case "readyToRestart":
    case "readyToRestartOutdated":
      return `Codevo ${state.version} is ready to restart.`;
    case "installing":
      return `Codevo ${state.version} is installing.`;
    default:
      return unsupportedState(state);
  }
}

export function canStartManualAppUpdateCheck(state: AppUpdaterState): boolean {
  switch (state.kind) {
    case "idle":
    case "upToDate":
    case "failed":
      return true;
    case "checking":
    case "available":
    case "downloading":
    case "readyToInstall":
    case "readyToRestart":
    case "readyToRestartOutdated":
    case "installing":
      return false;
    default:
      return unsupportedState(state);
  }
}

export function manualAppUpdateCheckOutcome(state: AppUpdaterState): ManualAppUpdateCheckOutcome {
  switch (state.kind) {
    case "idle":
    case "checking":
      return { kind: "pending" };
    case "upToDate":
      return {
        kind: "upToDate",
        label: "Codevo is up to date",
        title: `Codevo ${state.currentVersion} is the latest release.`,
      };
    case "failed":
      if (state.operation !== "check") return { kind: "release" };
      return {
        kind: "failed",
        label: appUpdateCheckFailureLabel(failureReasonOfMessage(state.message)),
        title: state.message,
      };
    case "available":
    case "downloading":
    case "readyToInstall":
    case "readyToRestart":
    case "readyToRestartOutdated":
    case "installing":
      return { kind: "release" };
    default:
      return unsupportedState(state);
  }
}

function failureReasonOfMessage(message: string): AppUpdateCheckFailureReason {
  const reason = FAILURE_REASONS.find(
    (candidate) => appUpdateCheckFailureMessage(candidate) === message,
  );
  return reason ?? "unavailable";
}

function unsupportedReason(reason: never): never {
  throw new TypeError(`Unsupported application update check failure: ${String(reason)}`);
}

function unsupportedState(state: never): never {
  throw new TypeError(`Unsupported application updater state: ${String(state)}`);
}

export const MAX_APP_UPDATE_VERSION_LENGTH = 64;
export const MAX_APP_UPDATE_DATE_LENGTH = 128;
export const MAX_APP_UPDATE_NOTES_LENGTH = 4_096;
export const MAX_APP_UPDATE_ERROR_LENGTH = 512;

export interface AppUpdateCandidate {
  readonly candidateRevision: number;
  readonly currentVersion: string;
  readonly version: string;
  readonly date: string | null;
  readonly notes: string | null;
}

export type AppUpdateCheckResult =
  | { readonly kind: "upToDate"; readonly currentVersion: string }
  | { readonly kind: "available"; readonly candidate: AppUpdateCandidate };

export interface AppUpdaterGateway {
  check(): Promise<AppUpdateCheckResult>;
  download(candidateRevision: number): Promise<void>;
  installAndRestart(candidateRevision: number): Promise<void>;
  dispose(): Promise<void>;
}

export interface AppUpdaterPreferencesGateway {
  loadSkippedVersion(): Promise<string | null>;
}

export type AppUpdaterOperation = "check" | "download" | "installAndRestart";

export type AppUpdaterState =
  | { readonly kind: "idle"; readonly currentVersion: string }
  | { readonly kind: "checking"; readonly currentVersion: string; readonly generation: number }
  | { readonly kind: "upToDate"; readonly currentVersion: string }
  | (AppUpdaterReleasePresentation & { readonly kind: "available" })
  | (AppUpdaterReleasePresentation & {
      readonly kind: "downloading";
      readonly generation: number;
    })
  | (AppUpdaterReleasePresentation & { readonly kind: "readyToInstall" })
  | (AppUpdaterReleasePresentation & {
      readonly kind: "installing";
      readonly generation: number;
    })
  | {
      readonly kind: "failed";
      readonly currentVersion: string;
      readonly operation: AppUpdaterOperation;
      readonly message: string;
      readonly release: AppUpdaterReleasePresentation | null;
    };

interface AppUpdaterReleasePresentation {
  readonly currentVersion: string;
  readonly version: string;
  readonly date: string | null;
  readonly notes: string | null;
}

export type AppUpdaterAction =
  | { readonly kind: "checkStarted"; readonly generation: number }
  | {
      readonly kind: "checkSettled";
      readonly generation: number;
      readonly result: AppUpdateCheckResult;
    }
  | { readonly kind: "downloadStarted"; readonly generation: number }
  | { readonly kind: "downloadSettled"; readonly generation: number }
  | { readonly kind: "installStarted"; readonly generation: number }
  | { readonly kind: "dismissed" }
  | {
      readonly kind: "failed";
      readonly generation: number;
      readonly operation: AppUpdaterOperation;
      readonly message: string;
    }
  | { readonly kind: "reset"; readonly currentVersion: string };

export function initialAppUpdaterState(currentVersion: string): AppUpdaterState {
  return { kind: "idle", currentVersion: boundedVersion(currentVersion) };
}

export function reduceAppUpdaterState(
  state: AppUpdaterState,
  action: AppUpdaterAction,
): AppUpdaterState {
  switch (action.kind) {
    case "checkStarted":
      return {
        kind: "checking",
        currentVersion: state.currentVersion,
        generation: action.generation,
      };
    case "checkSettled":
      if (!matchesGeneration(state, action.generation, "checking")) return state;
      if (action.result.kind === "upToDate") {
        return { kind: "upToDate", currentVersion: action.result.currentVersion };
      }
      return availableState(action.result.candidate);
    case "downloadStarted":
      if (state.kind !== "available") return state;
      return { ...state, kind: "downloading", generation: action.generation };
    case "downloadSettled":
      if (state.kind !== "downloading") return state;
      if (state.generation !== action.generation) return state;
      return {
        kind: "readyToInstall",
        currentVersion: state.currentVersion,
        version: state.version,
        date: state.date,
        notes: state.notes,
      };
    case "installStarted":
      if (state.kind !== "readyToInstall") return state;
      return { ...state, kind: "installing", generation: action.generation };
    case "dismissed":
      return initialAppUpdaterState(state.currentVersion);
    case "failed":
      if (!matchesPendingGeneration(state, action.generation)) return state;
      return {
        kind: "failed",
        currentVersion: state.currentVersion,
        operation: action.operation,
        message: boundedError(action.message),
        release:
          state.kind === "downloading" || state.kind === "installing"
            ? releasePresentation(state)
            : null,
      };
    case "reset":
      return initialAppUpdaterState(action.currentVersion);
  }
}

export type AppUpdateToastPresentation =
  | {
      readonly kind: "available";
      readonly version: string;
      readonly currentVersion: string;
      readonly date: string | null;
    }
  | { readonly kind: "downloading"; readonly version: string }
  | { readonly kind: "readyToInstall"; readonly version: string }
  | { readonly kind: "installing"; readonly version: string }
  | {
      readonly kind: "failed";
      readonly version: string;
      readonly operation: Exclude<AppUpdaterOperation, "check">;
      readonly message: string;
    };

export function presentAppUpdateToast(state: AppUpdaterState): AppUpdateToastPresentation | null {
  switch (state.kind) {
    case "idle":
    case "checking":
    case "upToDate":
      return null;
    case "available":
      return {
        kind: "available",
        version: state.version,
        currentVersion: state.currentVersion,
        date: state.date,
      };
    case "downloading":
      return { kind: "downloading", version: state.version };
    case "readyToInstall":
      return { kind: "readyToInstall", version: state.version };
    case "installing":
      return { kind: "installing", version: state.version };
    case "failed":
      if (state.release === null) return null;
      if (state.operation === "check") return null;
      return {
        kind: "failed",
        version: state.release.version,
        operation: state.operation,
        message: state.message,
      };
  }
}

export function appUpdateToastGroupKey(presentation: AppUpdateToastPresentation): string {
  return JSON.stringify(["app-update", presentation.version]);
}

export function appUpdateToastTitle(presentation: AppUpdateToastPresentation): string {
  switch (presentation.kind) {
    case "available":
    case "readyToInstall":
      return `Update Available: Codevo v${presentation.version}`;
    case "downloading":
      return "Downloading update";
    case "installing":
      return "Installing update";
    case "failed":
      return "Application update failed";
  }
}

function releasePresentation(state: AppUpdaterReleasePresentation): AppUpdaterReleasePresentation {
  return {
    currentVersion: state.currentVersion,
    version: state.version,
    date: state.date,
    notes: state.notes,
  };
}

export function normalizeAppUpdaterSkippedVersion(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_APP_UPDATE_VERSION_LENGTH) return null;
  if (/\p{Cc}/u.test(normalized)) return null;
  return normalized;
}

export function isSkippedAppUpdateVersion(
  candidate: Pick<AppUpdateCandidate, "version">,
  skippedVersion: string | null,
): boolean {
  return normalizeAppUpdaterSkippedVersion(skippedVersion) === candidate.version;
}

function availableState(candidate: AppUpdateCandidate): AppUpdaterState {
  return {
    kind: "available",
    currentVersion: candidate.currentVersion,
    version: candidate.version,
    date: candidate.date,
    notes: candidate.notes,
  };
}

function matchesPendingGeneration(state: AppUpdaterState, generation: number): boolean {
  if (state.kind === "checking") return state.generation === generation;
  if (state.kind === "downloading") return state.generation === generation;
  if (state.kind === "installing") return state.generation === generation;
  return false;
}

function matchesGeneration(
  state: AppUpdaterState,
  generation: number,
  kind: "checking" | "downloading",
): boolean {
  if (state.kind !== kind) return false;
  return state.generation === generation;
}

function boundedVersion(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_APP_UPDATE_VERSION_LENGTH) {
    throw new TypeError("Invalid application version.");
  }
  return normalized;
}

function boundedError(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) return "The update operation failed.";
  return normalized.slice(0, MAX_APP_UPDATE_ERROR_LENGTH);
}

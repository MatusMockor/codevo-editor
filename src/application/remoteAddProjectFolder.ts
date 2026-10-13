import {
  isRemoteProjectName,
  isRemoteProjectRegistrationPath,
  REMOTE_PROJECT_NAME_CHARS,
  remoteProjectNameFromPath,
  type RemoteProjectRegistrationInput,
  type RemoteProjectRegistrationRejection,
} from "../domain/remoteProjectRegistration";

export type RemoteAddProjectFolderFailure =
  | Readonly<{ kind: "runnerOutdated" }>
  | Readonly<{ kind: "runnerUnreachable" }>
  | Readonly<{ kind: "projectMissing" }>
  | Readonly<{ kind: "unknown" }>;

type ChosenFolder = Readonly<{ path: string; name: string }>;

export type RemoteAddProjectFolderState =
  | Readonly<{ phase: "browsing"; path: string | null }>
  | (ChosenFolder & Readonly<{ phase: "naming" }>)
  | (ChosenFolder & Readonly<{ phase: "ready" }>)
  | (ChosenFolder & Readonly<{ phase: "submitting"; submission: number }>)
  | (ChosenFolder & Readonly<{ phase: "rejected"; reason: RemoteProjectRegistrationRejection }>)
  | (ChosenFolder & Readonly<{ phase: "failed"; failure: RemoteAddProjectFolderFailure }>);

export type RemoteAddProjectFolderAction =
  | Readonly<{ kind: "chooseFolder"; path: string }>
  | Readonly<{ kind: "setName"; value: string }>
  | Readonly<{ kind: "back" }>
  | Readonly<{ kind: "submitStarted"; submission: number }>
  | Readonly<{
      kind: "submitRejected";
      submission: number;
      reason: RemoteProjectRegistrationRejection;
    }>
  | Readonly<{
      kind: "submitFailed";
      submission: number;
      failure: RemoteAddProjectFolderFailure;
    }>;

export const INITIAL_REMOTE_ADD_PROJECT_FOLDER: RemoteAddProjectFolderState = Object.freeze({
  phase: "browsing",
  path: null,
});

export function reduceRemoteAddProjectFolder(
  state: RemoteAddProjectFolderState,
  action: RemoteAddProjectFolderAction,
): RemoteAddProjectFolderState {
  switch (action.kind) {
    case "chooseFolder":
      return chooseFolder(state, action.path);
    case "setName":
      return setName(state, action.value);
    case "back":
      return goBack(state);
    case "submitStarted":
      return startSubmit(state, action.submission);
    case "submitRejected":
      if (!remoteAddProjectFolderAwaits(state, action.submission)) return state;
      return { phase: "rejected", path: state.path, name: state.name, reason: action.reason };
    case "submitFailed":
      if (!remoteAddProjectFolderAwaits(state, action.submission)) return state;
      return { phase: "failed", path: state.path, name: state.name, failure: action.failure };
    default:
      return unsupportedAction(action);
  }
}

export function remoteAddProjectFolderInput(
  state: RemoteAddProjectFolderState,
): RemoteProjectRegistrationInput | null {
  switch (state.phase) {
    case "browsing":
    case "naming":
    case "submitting":
      return null;
    case "rejected":
      if (state.reason === "name_taken") return null;
      return { path: state.path, name: state.name };
    case "ready":
    case "failed":
      return { path: state.path, name: state.name };
    default:
      return unsupportedState(state);
  }
}

export function remoteAddProjectFolderNameError(
  state: RemoteAddProjectFolderState,
): "invalid" | "taken" | null {
  if (state.phase === "naming") return "invalid";
  if (state.phase === "rejected" && state.reason === "name_taken") return "taken";
  return null;
}

function chooseFolder(
  state: RemoteAddProjectFolderState,
  path: string,
): RemoteAddProjectFolderState {
  if (state.phase !== "browsing") return state;
  if (!isRemoteProjectRegistrationPath(path)) return state;
  return named(path, remoteProjectNameFromPath(path));
}

function setName(state: RemoteAddProjectFolderState, value: string): RemoteAddProjectFolderState {
  if (state.phase === "browsing" || state.phase === "submitting") return state;
  return named(state.path, value.slice(0, REMOTE_PROJECT_NAME_CHARS));
}

function goBack(state: RemoteAddProjectFolderState): RemoteAddProjectFolderState {
  if (state.phase === "browsing" || state.phase === "submitting") return state;
  return { phase: "browsing", path: state.path };
}

function startSubmit(
  state: RemoteAddProjectFolderState,
  submission: number,
): RemoteAddProjectFolderState {
  const input = remoteAddProjectFolderInput(state);
  if (input === null) return state;
  return { phase: "submitting", path: input.path, name: input.name, submission };
}

function named(path: string, name: string): RemoteAddProjectFolderState {
  if (isRemoteProjectName(name)) return { phase: "ready", path, name };
  return { phase: "naming", path, name };
}

export function remoteAddProjectFolderAwaits(
  state: RemoteAddProjectFolderState,
  submission: number,
): state is Extract<RemoteAddProjectFolderState, { phase: "submitting" }> {
  return state.phase === "submitting" && state.submission === submission;
}

function unsupportedAction(action: never): never {
  throw new TypeError(`Unsupported server folder action: ${JSON.stringify(action)}.`);
}

function unsupportedState(state: never): never {
  throw new TypeError(`Unsupported server folder state: ${JSON.stringify(state)}.`);
}

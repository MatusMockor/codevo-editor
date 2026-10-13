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

export type RemoteFolderProjectSupport = "unknown" | "supported" | "unsupported";

export type RemoteRunnerFolderProjectSupport = Exclude<RemoteFolderProjectSupport, "unknown">;

type ChosenFolder = Readonly<{
  path: string;
  name: string;
  folderProjects: RemoteFolderProjectSupport;
}>;

export type RemoteAddProjectFolderState =
  | Readonly<{
      phase: "browsing";
      path: string | null;
      folderProjects: RemoteFolderProjectSupport;
    }>
  | (ChosenFolder & Readonly<{ phase: "naming" }>)
  | (ChosenFolder & Readonly<{ phase: "ready" }>)
  | (ChosenFolder & Readonly<{ phase: "submitting"; submission: number }>)
  | (ChosenFolder & Readonly<{ phase: "rejected"; reason: RemoteProjectRegistrationRejection }>)
  | (ChosenFolder & Readonly<{ phase: "failed"; failure: RemoteAddProjectFolderFailure }>);

export type RemoteAddProjectFolderAction =
  | Readonly<{ kind: "chooseFolder"; path: string }>
  | Readonly<{ kind: "setName"; value: string }>
  | Readonly<{ kind: "back" }>
  | Readonly<{ kind: "runnerDescribed"; folderProjects: RemoteRunnerFolderProjectSupport }>
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
  folderProjects: "unknown",
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
    case "runnerDescribed":
      return describeRunner(state, action.folderProjects);
    case "submitStarted":
      return startSubmit(state, action.submission);
    case "submitRejected":
      if (!remoteAddProjectFolderAwaits(state, action.submission)) return state;
      return { ...chosen(state), phase: "rejected", reason: action.reason };
    case "submitFailed":
      if (!remoteAddProjectFolderAwaits(state, action.submission)) return state;
      return { ...chosen(state), phase: "failed", failure: action.failure };
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
  return named({
    path,
    name: remoteProjectNameFromPath(path),
    folderProjects: state.folderProjects,
  });
}

function setName(state: RemoteAddProjectFolderState, value: string): RemoteAddProjectFolderState {
  if (state.phase === "browsing" || state.phase === "submitting") return state;
  return named({ ...chosen(state), name: value.slice(0, REMOTE_PROJECT_NAME_CHARS) });
}

function goBack(state: RemoteAddProjectFolderState): RemoteAddProjectFolderState {
  if (state.phase === "browsing" || state.phase === "submitting") return state;
  return { phase: "browsing", path: state.path, folderProjects: state.folderProjects };
}

function describeRunner(
  state: RemoteAddProjectFolderState,
  folderProjects: RemoteRunnerFolderProjectSupport,
): RemoteAddProjectFolderState {
  if (state.folderProjects === folderProjects) return state;
  return { ...state, folderProjects };
}

function startSubmit(
  state: RemoteAddProjectFolderState,
  submission: number,
): RemoteAddProjectFolderState {
  const input = remoteAddProjectFolderInput(state);
  if (input === null) return state;
  return {
    phase: "submitting",
    path: input.path,
    name: input.name,
    folderProjects: state.folderProjects,
    submission,
  };
}

function named(folder: ChosenFolder): RemoteAddProjectFolderState {
  if (isRemoteProjectName(folder.name)) return { ...folder, phase: "ready" };
  return { ...folder, phase: "naming" };
}

function chosen(folder: ChosenFolder): ChosenFolder {
  return { path: folder.path, name: folder.name, folderProjects: folder.folderProjects };
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

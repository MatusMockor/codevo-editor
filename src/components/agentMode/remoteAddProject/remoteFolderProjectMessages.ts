import type {
  RemoteAddProjectFolderFailure,
  RemoteAddProjectFolderState,
} from "../../../application/remoteAddProjectFolder";
import { remoteAddProjectFolderNameError } from "../../../application/remoteAddProjectFolder";
import type { RemoteProjectRegistrationRejection } from "../../../domain/remoteProjectRegistration";
import { remoteAddProjectNameErrorMessage } from "./remoteAddProjectMessages";

export const REMOTE_FOLDER_PROJECT_TITLE = "Existing folder on server";

export function remoteFolderProjectNameMessage(folder: RemoteAddProjectFolderState): string | null {
  const error = remoteAddProjectFolderNameError(folder);
  if (error === null) return null;
  if (error === "taken") return rejectionMessage("name_taken");
  return remoteAddProjectNameErrorMessage("invalid");
}

export function remoteFolderProjectMessage(folder: RemoteAddProjectFolderState): string | null {
  if (folder.phase === "failed") return failureMessage(folder.failure);
  if (folder.phase !== "rejected" || folder.reason === "name_taken") return null;
  return rejectionMessage(folder.reason);
}

export function remoteFolderProjectPrimaryLabel(folder: RemoteAddProjectFolderState): string {
  if (folder.phase === "submitting") return "Adding project…";
  return "Add project";
}

function rejectionMessage(reason: RemoteProjectRegistrationRejection): string {
  switch (reason) {
    case "not_git_root":
      return "This folder is not the root of a Git repository. Choose the repository's top-level folder.";
    case "name_taken":
      return "A project with this name already exists on this server.";
    case "limit_reached":
      return "This server already has the maximum number of projects.";
    case "not_allowed":
      return "This folder cannot be added as a project.";
    default:
      return unsupportedRejection(reason);
  }
}

function failureMessage(failure: RemoteAddProjectFolderFailure): string {
  switch (failure.kind) {
    case "runnerOutdated":
      return "This server's runner does not support adding existing folders yet. Update the runner.";
    case "runnerUnreachable":
      return "Could not reach this server's runner. Try again.";
    case "projectMissing":
      return "The folder was added, but the project is not in this server's list yet. Close this dialog and open it from the server projects.";
    case "unknown":
      return "Could not add this folder. Try again.";
    default:
      return unsupportedFailure(failure);
  }
}

function unsupportedRejection(reason: never): never {
  throw new TypeError(`Unsupported registration rejection: ${String(reason)}.`);
}

function unsupportedFailure(failure: never): never {
  throw new TypeError(`Unsupported server folder failure: ${JSON.stringify(failure)}.`);
}

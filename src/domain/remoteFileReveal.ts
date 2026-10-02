import {
  RemoteSurfaceNotFoundError,
  RemoteSurfaceNotRegularFileError,
  type RemoteFileContent,
} from "./remoteRunnerSurfaces";

export interface RemoteFileRevealTarget {
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
}

export type RemoteFileRevealOutcome =
  | "opened"
  | "notFound"
  | "notRegularFile"
  | "unreadable"
  | "failed"
  | "unsavedChanges"
  | "saveInProgress"
  | "superseded";

export type RemoteFileRevealSettlement = RemoteFileRevealOutcome | "filesUnavailable";

export function remoteFileParentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  if (separator < 0) return "";
  return path.slice(0, separator);
}

export function remoteFileContentOutcome(content: RemoteFileContent): RemoteFileRevealOutcome {
  if (content.unavailableReason === null) return "opened";
  return "unreadable";
}

export function remoteFileReadFailureOutcome(reason: unknown): RemoteFileRevealOutcome {
  if (reason instanceof RemoteSurfaceNotFoundError) return "notFound";
  if (reason instanceof RemoteSurfaceNotRegularFileError) return "notRegularFile";
  return "failed";
}

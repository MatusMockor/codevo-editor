export const REMOTE_PROJECT_KINDS = ["repository", "folder"] as const;
export type RemoteProjectKind = (typeof REMOTE_PROJECT_KINDS)[number];

export function isRemoteProjectKind(value: unknown): value is RemoteProjectKind {
  return REMOTE_PROJECT_KINDS.some((kind) => kind === value);
}

export function remoteProjectKindOf(
  project: Readonly<{ kind?: RemoteProjectKind }>,
): RemoteProjectKind {
  return project.kind ?? "repository";
}

export function isRemoteFolderProject(project: Readonly<{ kind?: RemoteProjectKind }>): boolean {
  return remoteProjectKindOf(project) === "folder";
}

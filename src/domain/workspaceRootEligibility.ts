import { normalizedWorkspaceRootKey } from "./workspaceRootKey";

export type WorkspacePathCase = "sensitive" | "insensitive";

export interface WorkspaceHomeReference {
  readonly path: string | null;
  readonly pathCase: WorkspacePathCase;
}

export const UNKNOWN_WORKSPACE_HOME: WorkspaceHomeReference = {
  path: null,
  pathCase: "insensitive",
};

export type WorkspaceRootRefusalReason = "home" | "filesystemRoot" | "homeAncestor";

export type WorkspaceRootEligibility =
  | { readonly kind: "eligible" }
  | { readonly kind: "refused"; readonly reason: WorkspaceRootRefusalReason };

export const WORKSPACE_ROOT_HOME_REFUSAL = "Choose a project folder, not your home folder.";
export const WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL =
  "Choose a project folder, not the root of the disk.";
export const WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL =
  "Choose a project folder, not a folder that contains your home folder.";

const ELIGIBLE: WorkspaceRootEligibility = { kind: "eligible" };
const WINDOWS_DRIVE_SEGMENT = /^[A-Za-z]:$/;

export function workspaceRootEligibility(
  rootPath: string,
  home: WorkspaceHomeReference,
): WorkspaceRootEligibility {
  const root = pathSegments(rootPath, home.pathCase);
  if (isFilesystemRoot(root)) return { kind: "refused", reason: "filesystemRoot" };
  if (home.path === null) return ELIGIBLE;

  const homeSegments = pathSegments(home.path, home.pathCase);
  if (isFilesystemRoot(homeSegments)) return ELIGIBLE;
  if (!isSegmentPrefix(root, homeSegments)) return ELIGIBLE;
  if (root.length === homeSegments.length) return { kind: "refused", reason: "home" };

  return { kind: "refused", reason: "homeAncestor" };
}

export function isEligibleWorkspaceRoot(rootPath: string, home: WorkspaceHomeReference): boolean {
  return workspaceRootEligibility(rootPath, home).kind === "eligible";
}

export function workspaceRootRefusalMessage(reason: WorkspaceRootRefusalReason): string {
  switch (reason) {
    case "home":
      return WORKSPACE_ROOT_HOME_REFUSAL;
    case "filesystemRoot":
      return WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL;
    case "homeAncestor":
      return WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL;
    default: {
      const unsupported: never = reason;
      return unsupported;
    }
  }
}

function pathSegments(path: string, pathCase: WorkspacePathCase): ReadonlyArray<string> {
  const key = foldPathCase(normalizedWorkspaceRootKey(path.trim()).split("\\").join("/"), pathCase);
  const segments: string[] = [];
  for (const segment of key.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments;
}

function foldPathCase(path: string, pathCase: WorkspacePathCase): string {
  switch (pathCase) {
    case "sensitive":
      return path;
    case "insensitive":
      return path.toLowerCase();
    default: {
      const unsupported: never = pathCase;
      return unsupported;
    }
  }
}

function isFilesystemRoot(segments: ReadonlyArray<string>): boolean {
  if (segments.length === 0) return true;
  return segments.length === 1 && WINDOWS_DRIVE_SEGMENT.test(segments[0] ?? "");
}

function isSegmentPrefix(candidate: ReadonlyArray<string>, path: ReadonlyArray<string>): boolean {
  if (candidate.length > path.length) return false;
  return candidate.every((segment, index) => segment === path[index]);
}

import { isCloneFolderName, type RepositoryIdentity } from "./repositoryCloneUrl";
import {
  workspaceRootEligibility,
  workspaceRootRefusalMessage,
  type WorkspaceHomeReference,
} from "./workspaceRootEligibility";

export const DEFAULT_CLONE_PARENT_NAME = "code";
const FALLBACK_FOLDER_NAME = "repository";
const MAX_FOLDER_NAME_CHARS = 64;
const MAX_PATH_BYTES = 4096;
const encoder = new TextEncoder();

export type CloneDestination =
  | Readonly<{ kind: "ok"; path: string; parentPath: string; name: string }>
  | Readonly<{ kind: "invalid" }>;

const INVALID: CloneDestination = Object.freeze({ kind: "invalid" });

export function defaultCloneParentPath(home: string, lastParent: string | null): string {
  return lastParent ?? joinClonePath(home, DEFAULT_CLONE_PARENT_NAME);
}

export function isDefaultCloneParent(parentPath: string, home: string | null): boolean {
  if (home === null) return false;
  return trimTrailingSlash(parentPath) === joinClonePath(home, DEFAULT_CLONE_PARENT_NAME);
}

export function suggestCloneFolderName(identity: RepositoryIdentity): string {
  const last = identity.path.split("/").pop() ?? "";
  const cleaned = last
    .replace(/\.git$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, MAX_FOLDER_NAME_CHARS);
  return isCloneFolderName(cleaned) ? cleaned : FALLBACK_FOLDER_NAME;
}

export function joinClonePath(parent: string, name: string): string {
  const base = trimTrailingSlash(parent);
  return base === "/" ? `/${name}` : `${base}/${name}`;
}

export function abbreviateHomePath(absolute: string, home: string | null): string {
  if (home === null) return absolute;
  const root = trimTrailingSlash(home);
  if (absolute === root) return "~";
  if (absolute.startsWith(`${root}/`)) return `~${absolute.slice(root.length)}`;
  return absolute;
}

export function expandHomePath(display: string, home: string | null): string | null {
  const value = display.trim();
  if (value.startsWith("/")) return value;
  if (home === null) return null;
  if (value === "~") return trimTrailingSlash(home);
  if (value.startsWith("~/")) return `${trimTrailingSlash(home)}${value.slice(1)}`;
  return null;
}

export function resolveCloneDestination(display: string, home: string | null): CloneDestination {
  const expanded = expandHomePath(display, home);
  if (expanded === null) return INVALID;
  const path = trimTrailingSlash(expanded);
  if (path === "/" || encoder.encode(path).byteLength > MAX_PATH_BYTES) return INVALID;
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return INVALID;
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  if (!isCloneFolderName(name)) return INVALID;
  return { kind: "ok", path, parentPath: slash === 0 ? "/" : path.slice(0, slash), name };
}

export function cloneDestinationRefusal(path: string, home: WorkspaceHomeReference): string | null {
  const eligibility = workspaceRootEligibility(path, home);
  if (eligibility.kind === "eligible") return null;
  return workspaceRootRefusalMessage(eligibility.reason);
}

function trimTrailingSlash(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

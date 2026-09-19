import { isRepositoryHost, type RepositoryInfo } from "./repositoryLookup";

export type CloneProtocol = "ssh" | "https";

export type RepositoryIdentity = Readonly<{ host: string; path: string }>;

export const CLONE_FOLDER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const CLONE_BRANCH_NAME_CHARS = 255;

const CLONE_BRANCH_FORBIDDEN_PATTERN = /[\u0000- \u007f~^:?*[\\]/u;
const CLONE_BRANCH_FORBIDDEN_SEQUENCES = ["..", "@{", "//"] as const;

const CLONE_URL_CHARS = 2048;
const CLONE_URL_ASCII_PATTERN = /^[\x00-\x7f]*$/;
const CLONE_URL_USERNAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
const CLONE_URL_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const CLONE_URL_PORT_PATTERN = /^[0-9]+$/;

type CloneUrlParts = Readonly<{
  authority: string;
  path: string;
  requiresUser: boolean;
  allowsPort: boolean;
}>;

export function parseRepositoryCloneUrl(value: string): RepositoryIdentity | null {
  if (value.length > CLONE_URL_CHARS) return null;
  if (!CLONE_URL_ASCII_PATTERN.test(value)) return null;
  const parts = splitCloneUrl(value);
  if (parts === null) return null;
  const authority = parts.requiresUser ? authorityAfterUser(parts.authority) : parts.authority;
  if (authority === null) return null;
  const host = parts.allowsPort ? hostWithoutPort(authority) : authority;
  if (host === null) return null;
  if (!isRepositoryHost(host)) return null;
  if (!isCloneUrlPath(parts.path)) return null;
  return Object.freeze({ host: host.toLowerCase(), path: identityPath(parts.path) });
}

export function cloneUrlFor(info: RepositoryInfo, protocol: CloneProtocol): string | null {
  const url = cloneUrlCandidate(info, protocol);
  if (url === null) return null;
  if (parseRepositoryCloneUrl(url) === null) return null;
  if (!matchesProtocol(url, protocol)) return null;
  return url;
}

export function cloneFolderName(identity: RepositoryIdentity): string | null {
  const segments = identity.path.split("/");
  const last = segments[segments.length - 1] ?? "";
  if (!isCloneFolderName(last)) return null;
  return last;
}

export function isCloneFolderName(value: string): boolean {
  return CLONE_FOLDER_NAME_PATTERN.test(value);
}

export function isCloneBranchName(value: string): boolean {
  if (value.length === 0 || value.length > CLONE_BRANCH_NAME_CHARS) return false;
  if (value === "@") return false;
  if (value.startsWith("-") || value.startsWith("/")) return false;
  if (value.endsWith("/") || value.endsWith(".")) return false;
  if (CLONE_BRANCH_FORBIDDEN_SEQUENCES.some((sequence) => value.includes(sequence))) return false;
  if (CLONE_BRANCH_FORBIDDEN_PATTERN.test(value)) return false;
  return value.split("/").every(isCloneBranchSegment);
}

function isCloneBranchSegment(segment: string): boolean {
  return !segment.startsWith(".") && !segment.endsWith(".lock");
}

function cloneUrlCandidate(info: RepositoryInfo, protocol: CloneProtocol): string | null {
  switch (protocol) {
    case "ssh":
      return info.sshUrl;
    case "https":
      return info.httpsUrl;
    default:
      return unsupportedCloneProtocol(protocol);
  }
}

function matchesProtocol(url: string, protocol: CloneProtocol): boolean {
  if (protocol === "https") return url.startsWith("https://");
  return !url.startsWith("https://");
}

function splitCloneUrl(value: string): CloneUrlParts | null {
  if (value.startsWith("https://")) {
    const split = splitOnce(value.slice("https://".length), "/");
    if (split === null) return null;
    return { authority: split[0], path: split[1], requiresUser: false, allowsPort: false };
  }
  if (value.startsWith("ssh://")) {
    const split = splitOnce(value.slice("ssh://".length), "/");
    if (split === null) return null;
    return { authority: split[0], path: split[1], requiresUser: true, allowsPort: true };
  }
  const split = splitOnce(value, ":");
  if (split === null) return null;
  return { authority: split[0], path: split[1], requiresUser: true, allowsPort: false };
}

function splitOnce(value: string, separator: string): readonly [string, string] | null {
  const index = value.indexOf(separator);
  if (index < 0) return null;
  return [value.slice(0, index), value.slice(index + separator.length)];
}

function authorityAfterUser(authority: string): string | null {
  const split = splitOnce(authority, "@");
  if (split === null) return null;
  if (!CLONE_URL_USERNAME_PATTERN.test(split[0])) return null;
  return split[1];
}

function hostWithoutPort(authority: string): string | null {
  const split = splitOnce(authority, ":");
  if (split === null) return authority;
  if (!isCloneUrlPort(split[1])) return null;
  return split[0];
}

function isCloneUrlPort(port: string): boolean {
  if (port.length === 0 || port.length > 5) return false;
  if (!CLONE_URL_PORT_PATTERN.test(port)) return false;
  const value = Number(port);
  return value > 0 && value <= 65535;
}

function isCloneUrlPath(path: string): boolean {
  if (path.length === 0) return false;
  if (!CLONE_URL_PATH_PATTERN.test(path)) return false;
  return path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function identityPath(path: string): string {
  if (!path.endsWith(".git")) return path;
  const trimmed = path.slice(0, -".git".length);
  if (trimmed.length === 0 || trimmed.endsWith("/")) return path;
  return trimmed;
}

function unsupportedCloneProtocol(protocol: never): never {
  throw new TypeError(`Unsupported clone protocol: ${String(protocol)}.`);
}

export const MAX_AGENT_LINK_NOTICE_PATH_CHARS = 96;
export const MAX_AGENT_LINK_NOTICE_PLACE_CHARS = 48;

export type AgentLocalFileOpenOutcome = "opened" | "notFound" | "unreadable" | "failed";

export type AgentLocalFileLinkFailureKind =
  Exclude<AgentLocalFileOpenOutcome, "opened"> | "outsideProject" | "remoteThread";

export interface AgentLocalFileLinkPlace {
  readonly kind: "project" | "worktree";
  readonly label: string | null;
}

export interface AgentLocalFileLinkFailure {
  readonly kind: AgentLocalFileLinkFailureKind;
  readonly path: string;
  readonly place: AgentLocalFileLinkPlace | null;
}

export function agentLocalFileLinkFailure(
  kind: AgentLocalFileLinkFailureKind,
  path: string,
  place: AgentLocalFileLinkPlace | null,
): AgentLocalFileLinkFailure {
  return {
    kind,
    path: boundedMiddle(path, MAX_AGENT_LINK_NOTICE_PATH_CHARS),
    place: place === null ? null : boundedPlace(place),
  };
}

export function agentLocalFileLinkPlace(
  kind: AgentLocalFileLinkPlace["kind"],
  root: string,
): AgentLocalFileLinkPlace {
  return { kind, label: agentPathBaseName(root) };
}

export function agentLocalFileLinkFailureMessage(failure: AgentLocalFileLinkFailure): string {
  const { path } = failure;
  const place = placeText(failure.place);
  switch (failure.kind) {
    case "notFound":
      return `${path} isn't in ${place}.`;
    case "outsideProject":
      return `${path} is outside ${place}, so it wasn't opened.`;
    case "unreadable":
      return `${path} exists but couldn't be read.`;
    case "failed":
      return `${path} couldn't be opened.`;
    case "remoteThread":
      return "File links are not available for remote threads.";
    default:
      return unsupportedFailure(failure.kind);
  }
}

export function agentLocalFileLinkDisplayPath(
  rawPath: string,
  resolvedPath: string | null,
  root: string | null,
): string {
  if (resolvedPath === null || root === null) return rawPath;
  if (!resolvedPath.startsWith(`${root}/`)) return rawPath;
  return resolvedPath.slice(root.length + 1);
}

export function agentPathBaseName(root: string): string | null {
  const trimmed = root.replace(/\/+$/, "");
  const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return name === "" ? null : name;
}

function placeText(place: AgentLocalFileLinkPlace | null): string {
  if (place === null) return "this project";
  if (place.label === null) return `this ${place.kind}`;
  return `this ${place.kind} (${place.label})`;
}

function boundedPlace(place: AgentLocalFileLinkPlace): AgentLocalFileLinkPlace {
  if (place.label === null) return place;
  return { kind: place.kind, label: boundedMiddle(place.label, MAX_AGENT_LINK_NOTICE_PLACE_CHARS) };
}

function boundedMiddle(value: string, max: number): string {
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - tail).join("")}`;
}

function unsupportedFailure(kind: never): never {
  throw new Error(`Unsupported local file link failure: ${String(kind)}`);
}

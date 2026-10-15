export const MAX_AGENT_LINK_NOTICE_PATH_CHARS = 96;
export const MAX_AGENT_LINK_NOTICE_PLACE_CHARS = 48;
export const MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES = 10 * 1_024 * 1_024;

const OUTSIDE_LINKED_FILE_LIMIT = `${MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES / (1_024 * 1_024)} MB`;

export type AgentOutsideFileRefusal =
  | "doesNotExist"
  | "folder"
  | "specialFile"
  | "tooLarge"
  | "notText"
  | "notLocal"
  | "otherProject"
  | "busy";

export type AgentLocalFileOpenOutcome =
  "opened" | "superseded" | "notFound" | "unreadable" | "failed" | AgentOutsideFileRefusal;

export type AgentLocalFileLinkFailureKind =
  | Exclude<AgentLocalFileOpenOutcome, "opened" | "superseded">
  | "outsideProject"
  | "serverAbsolutePath"
  | "checkoutFolder"
  | "notRegularFile"
  | "filesUnavailable";

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
    case "doesNotExist":
      return `${path} doesn't exist.`;
    case "folder":
      return `${path} is a folder, not a file.`;
    case "specialFile":
      return `${path} isn't a regular file, so it wasn't opened.`;
    case "tooLarge":
      return `${path} is larger than ${OUTSIDE_LINKED_FILE_LIMIT}, so it wasn't opened.`;
    case "notText":
      return `${path} isn't a text file, so it wasn't opened.`;
    case "notLocal":
      return `${path} is on a network or offloaded volume, so it wasn't opened.`;
    case "otherProject":
      return `${path} belongs to another open project, so it wasn't opened here.`;
    case "busy":
      return `Another linked file is still being read, so ${path} wasn't opened. Try again.`;
    case "serverAbsolutePath":
      return `Server threads can only open files inside ${place}, so ${path} wasn't opened.`;
    case "checkoutFolder":
      return `${path} is the folder of ${place}, not a file.`;
    case "notRegularFile":
      return `${path} isn't a regular text file on the server.`;
    case "filesUnavailable":
      return `Server files aren't available for this thread right now, so ${path} wasn't opened.`;
    default:
      return unsupportedFailure(failure.kind);
  }
}

export function agentLocalFileLinkFailureRemembered(kind: AgentLocalFileLinkFailureKind): boolean {
  switch (kind) {
    case "notFound":
    case "outsideProject":
    case "unreadable":
    case "failed":
    case "doesNotExist":
    case "folder":
    case "specialFile":
    case "tooLarge":
    case "notText":
    case "notLocal":
    case "otherProject":
    case "serverAbsolutePath":
    case "checkoutFolder":
    case "notRegularFile":
      return true;
    case "busy":
    case "filesUnavailable":
      return false;
    default:
      return unsupportedFailure(kind);
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

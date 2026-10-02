export const MAX_AGENT_LINK_NOTICE_PATH_CHARS = 96;
export const MAX_AGENT_LINK_NOTICE_PLACE_CHARS = 48;

export type AgentLocalFileOpenOutcome = "opened" | "notFound" | "unreadable" | "failed";

export type AgentLocalFileLinkFailureKind =
  | Exclude<AgentLocalFileOpenOutcome, "opened">
  | "outsideProject"
  | "serverAbsolutePath"
  | "checkoutFolder"
  | "notRegularFile"
  | "unsavedChanges"
  | "saveInProgress"
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
    case "serverAbsolutePath":
      return `Server threads can only open files inside ${place}, so ${path} wasn't opened.`;
    case "checkoutFolder":
      return `${path} is the folder of ${place}, not a file.`;
    case "notRegularFile":
      return `${path} isn't a regular text file on the server.`;
    case "unsavedChanges":
      return `Save or discard your unsaved server file edits before opening ${path}.`;
    case "saveInProgress":
      return `Wait for the server file save to finish before opening ${path}.`;
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
    case "serverAbsolutePath":
    case "checkoutFolder":
    case "notRegularFile":
      return true;
    case "unsavedChanges":
    case "saveInProgress":
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

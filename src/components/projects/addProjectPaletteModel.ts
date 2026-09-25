import type {
  RepositoryHostStatus,
  RepositoryHostStatuses,
} from "../../application/useRepositoryHostStatus";
import { abbreviateHomePath, expandHomePath } from "../../domain/cloneDestination";
import { carriesCredentials, looksLikeCloneSource } from "../../domain/cloneRepositoryInput";
import { recentFolderAge, type RecentFolderEntry } from "../../domain/recentFolders";
import {
  workspaceRootEligibility,
  workspaceRootRefusalMessage,
  type WorkspacePathCase,
} from "../../domain/workspaceRootEligibility";

export type AddProjectSourceId =
  "folder" | "gitUrl" | "github" | "gitlab" | "serverProject" | "serverClone";
export type AddProjectEnvironment = "local" | "remote";
export type AddProjectChip = Readonly<{ tone: "ok" | "warn"; label: string }>;
export type AddProjectSourceItem = Readonly<{
  kind: "source";
  key: string;
  id: AddProjectSourceId;
  title: string;
  description: string;
  shortcut: string | null;
  chip: AddProjectChip | null;
  disabledReason: string | null;
}>;
export type AddProjectPaletteItem =
  | AddProjectSourceItem
  | Readonly<{
      kind: "recent";
      key: string;
      path: string;
      title: string;
      description: string;
      age: string | null;
    }>
  | Readonly<{ kind: "openPath"; key: string; path: string; title: string; description: string }>
  | Readonly<{ kind: "refusedPath"; key: string; title: string; description: string }>
  | Readonly<{ kind: "cloneUrl"; key: string; url: string; title: string; description: string }>;
export type AddProjectPaletteGroup = Readonly<{
  label: string;
  items: readonly AddProjectPaletteItem[];
}>;
export type AddProjectPaletteInput = Readonly<{
  query: string;
  environment: AddProjectEnvironment;
  hosts: RepositoryHostStatuses;
  recent: readonly RecentFolderEntry[];
  home: string | null;
  nowMs: number;
  cloneAvailable: boolean;
}>;

type SourceFields = Omit<AddProjectSourceItem, "kind" | "key">;
type HostState = Readonly<{ chip: AddProjectChip | null; disabledReason: string | null }>;

const NO_CLONE = "Cloning is not available on this computer.";
const CREDENTIALS_DESCRIPTION = "URL with credentials - rejected";
const HOME_PATH_CASE: WorkspacePathCase = "insensitive";
const CONNECTED: AddProjectChip = { tone: "ok", label: "Connected" };
const SIGN_IN: AddProjectChip = { tone: "warn", label: "Sign in required" };
const SETUP: AddProjectChip = { tone: "warn", label: "Setup required" };

export function addProjectPaletteGroups(
  input: AddProjectPaletteInput,
): readonly AddProjectPaletteGroup[] {
  const query = input.query.trim();
  const direct = directItem(query, input);
  if (direct !== null)
    return [{ label: direct.kind === "cloneUrl" ? "Clone" : "Folder", items: [direct] }];
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (item: AddProjectPaletteItem) =>
    tokens.every((token) => `${item.title} ${item.description}`.toLowerCase().includes(token));
  const sources = (input.environment === "remote" ? serverSources() : localSources(input)).filter(
    matches,
  );
  const recent = input.environment === "remote" ? [] : recentItems(input).filter(matches);
  return [
    ...(sources.length === 0 ? [] : [{ label: "Sources", items: sources }]),
    ...(recent.length === 0 ? [] : [{ label: "Recent", items: recent }]),
  ];
}

export function pastedCloneUrl(
  input: Pick<AddProjectPaletteInput, "query" | "environment" | "home" | "cloneAvailable">,
): string | null {
  const direct = directItem(input.query.trim(), input);
  return direct?.kind === "cloneUrl" ? direct.url : null;
}

function directItem(
  query: string,
  input: Pick<AddProjectPaletteInput, "environment" | "home" | "cloneAvailable">,
): AddProjectPaletteItem | null {
  if (input.environment !== "local") return null;
  if (input.cloneAvailable && looksLikeCloneSource(query))
    return {
      kind: "cloneUrl",
      key: carriesCredentials(query) ? "clone:credentials" : `clone:${query}`,
      url: query,
      title: "Clone repository",
      description: carriesCredentials(query) ? CREDENTIALS_DESCRIPTION : query,
    };
  if (!query.startsWith("/") && !query.startsWith("~")) return null;
  const path = expandHomePath(query, input.home);
  if (path === null) return null;
  const title = `Open ${abbreviateHomePath(path, input.home)}`;
  const eligibility = workspaceRootEligibility(path, {
    path: input.home,
    pathCase: HOME_PATH_CASE,
  });
  if (eligibility.kind === "refused")
    return {
      kind: "refusedPath",
      key: `refused:${path}`,
      title,
      description: workspaceRootRefusalMessage(eligibility.reason),
    };
  return {
    kind: "openPath",
    key: `path:${path}`,
    path,
    title,
    description: "Add this folder as a project",
  };
}

function recentItems(input: AddProjectPaletteInput): AddProjectPaletteItem[] {
  return input.recent.map((entry) => ({
    kind: "recent",
    key: `recent:${entry.path}`,
    path: entry.path,
    title: entry.label,
    description: abbreviateHomePath(entry.path, input.home),
    age: recentFolderAge(entry.openedAtMs, input.nowMs),
  }));
}

function localSources(
  input: Pick<AddProjectPaletteInput, "hosts" | "cloneAvailable">,
): AddProjectPaletteItem[] {
  const clone = (item: SourceFields) =>
    source({ ...item, disabledReason: input.cloneAvailable ? item.disabledReason : NO_CLONE });
  return [
    source({
      id: "folder",
      title: "Open folder",
      description: "Browse a folder on disk",
      shortcut: "⌘O",
      chip: null,
      disabledReason: null,
    }),
    clone({
      id: "gitUrl",
      title: "Git URL",
      description: "Clone from an HTTPS or SSH URL",
      shortcut: null,
      chip: null,
      disabledReason: null,
    }),
    clone({
      id: "github",
      title: "GitHub repository",
      description: "Clone owner/repo",
      shortcut: null,
      chip: githubChip(input.hosts.github),
      disabledReason: null,
    }),
    clone({
      id: "gitlab",
      title: "GitLab repository",
      description: "Clone group/project",
      shortcut: null,
      ...gitlabState(input.hosts.gitlab),
    }),
  ];
}

function serverSources(): AddProjectPaletteItem[] {
  return [
    source({
      id: "serverProject",
      title: "Open server project",
      description: "Pick a folder on this server",
      shortcut: null,
      chip: null,
      disabledReason: null,
    }),
    source({
      id: "serverClone",
      title: "Clone repository",
      description: "Clone on this server",
      shortcut: null,
      chip: null,
      disabledReason: null,
    }),
  ];
}

function source(item: SourceFields): AddProjectSourceItem {
  return { kind: "source", key: `source:${item.id}`, ...item };
}

function githubChip(status: RepositoryHostStatus): AddProjectChip | null {
  if (status.kind === "ready") return CONNECTED;
  if (status.kind === "signedOut") return SIGN_IN;
  return null;
}

function gitlabState(status: RepositoryHostStatus): HostState {
  switch (status.kind) {
    case "ready":
      return { chip: CONNECTED, disabledReason: null };
    case "signedOut":
      return { chip: SIGN_IN, disabledReason: "Run glab auth login on This computer." };
    case "missing":
      return { chip: SETUP, disabledReason: "Install glab on This computer, then sign in." };
    case "checking":
      return { chip: null, disabledReason: "Checking GitLab…" };
    case "unavailable":
      return { chip: null, disabledReason: "GitLab is not available right now." };
    default:
      return unsupportedStatus(status);
  }
}

function unsupportedStatus(status: never): never {
  throw new TypeError(`Unsupported repository host status: ${JSON.stringify(status)}.`);
}

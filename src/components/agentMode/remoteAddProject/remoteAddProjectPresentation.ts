import type {
  RemoteAddProjectCandidate,
  RemoteAddProjectServerProject,
  RemoteAddProjectSourceAvailability,
  RemoteAddProjectStep,
} from "../../../application/useRemoteAddProject";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { RemoteRunnerCloneJob } from "../../../domain/remoteRunner";
import { cloneUrlFor, type CloneProtocol } from "../../../domain/repositoryCloneUrl";
import type { RemoteProjectSourceKind, RepositoryProvider } from "../../../domain/repositoryLookup";
import {
  remoteAddProjectPathHint,
  remoteAddProjectProviderLabel,
  remoteAddProjectSourceDescription,
  remoteAddProjectSourceReason,
  remoteAddProjectSourceTitle,
  remoteAddProjectVisibilityLabel,
} from "./remoteAddProjectMessages";

export const MAX_REMOTE_ADD_PROJECT_ROWS = 200;
export const MAX_REMOTE_ADD_PROJECT_MESSAGE_CHARS = 200;
export const REMOTE_ADD_PROJECT_SOURCE_ORDER = [
  "serverProject",
  "gitUrl",
  "github",
  "gitlab",
] as const satisfies readonly RemoteProjectSourceKind[];
export const REMOTE_ADD_PROJECT_PROTOCOLS = [
  "ssh",
  "https",
] as const satisfies readonly CloneProtocol[];

const NO_SERVER_PROJECTS: readonly RemoteAddProjectServerProject[] = Object.freeze([]);

export type RemoteAddProjectSourceRow = Readonly<{
  kind: RemoteProjectSourceKind;
  title: string;
  description: string;
  availability: RemoteAddProjectSourceAvailability;
  reason: string | null;
}>;

export type RemoteAddProjectCandidateView = Readonly<{
  provider: RepositoryProvider | null;
  title: string;
  host: string;
  visibility: string;
  defaultBranch: string | null;
}>;

export type RemoteAddProjectProtocolOption = Readonly<{
  protocol: CloneProtocol;
  label: string;
  available: boolean;
}>;

export function remoteAddProjectSourceRows(
  availability: Readonly<Record<RemoteProjectSourceKind, RemoteAddProjectSourceAvailability>>,
): readonly RemoteAddProjectSourceRow[] {
  return REMOTE_ADD_PROJECT_SOURCE_ORDER.map((kind) => {
    const state = availability[kind];
    return {
      kind,
      title: remoteAddProjectSourceTitle(kind),
      description: remoteAddProjectSourceDescription(kind),
      availability: state,
      reason:
        state.status === "unavailable" ? remoteAddProjectSourceReason(kind, state.reason) : null,
    };
  });
}

export function remoteAddProjectPlaceholder(step: RemoteAddProjectStep): string {
  switch (step.kind) {
    case "sources":
      return "Filter sources";
    case "serverProjects":
      return "Filter server projects";
    case "urlEntry":
      return "Enter Git clone URL";
    case "repository":
      return `Enter ${remoteAddProjectProviderLabel(step.provider)} repository (${remoteAddProjectPathHint(step.provider)})`;
    case "confirm":
      return "Folder name";
    default:
      return unsupportedRemoteAddProjectStep(step);
  }
}

export function remoteAddProjectStepTitle(step: RemoteAddProjectStep): string {
  switch (step.kind) {
    case "sources":
      return "Add project";
    case "serverProjects":
      return "Server projects";
    case "urlEntry":
      return "Git URL";
    case "repository":
      return `${remoteAddProjectProviderLabel(step.provider)} repository`;
    case "confirm":
      return "Confirm clone";
    default:
      return unsupportedRemoteAddProjectStep(step);
  }
}

export function remoteAddProjectPrimaryLabel(step: RemoteAddProjectStep): string {
  switch (step.kind) {
    case "sources":
      return "Continue";
    case "serverProjects":
      return "Open project";
    case "urlEntry":
      return "Continue";
    case "repository":
      return "Look up";
    case "confirm":
      return "Clone on server";
    default:
      return unsupportedRemoteAddProjectStep(step);
  }
}

export function remoteAddProjectEnterHint(step: RemoteAddProjectStep): string {
  switch (step.kind) {
    case "sources":
      return "select";
    case "serverProjects":
      return "open";
    case "urlEntry":
      return "continue";
    case "repository":
      return "look up";
    case "confirm":
      return "clone";
    default:
      return unsupportedRemoteAddProjectStep(step);
  }
}

export function remoteAddProjectMaxEntryChars(step: RemoteAddProjectStep): number {
  if (step.kind === "repository") return 255;
  if (step.kind === "urlEntry") return 2048;
  return 120;
}

export function remoteAddProjectCandidateView(
  candidate: RemoteAddProjectCandidate,
): RemoteAddProjectCandidateView {
  if (candidate.kind === "url")
    return {
      provider: null,
      title: candidate.identity.path,
      host: candidate.identity.host,
      visibility: remoteAddProjectVisibilityLabel("unknown"),
      defaultBranch: null,
    };
  return {
    provider: candidate.repository.provider,
    title: candidate.repository.fullPath,
    host: candidate.repository.host,
    visibility: remoteAddProjectVisibilityLabel(candidate.repository.visibility),
    defaultBranch: candidate.repository.defaultBranch,
  };
}

export function remoteAddProjectProtocolOptions(
  candidate: RemoteAddProjectCandidate,
): readonly RemoteAddProjectProtocolOption[] {
  return REMOTE_ADD_PROJECT_PROTOCOLS.map((protocol) => ({
    protocol,
    label: protocol === "ssh" ? "SSH" : "HTTPS",
    available: protocolAvailable(candidate, protocol),
  }));
}

export function remoteAddProjectHttpsWarning(
  candidate: RemoteAddProjectCandidate,
  protocol: CloneProtocol,
): string | null {
  if (protocol !== "https") return null;
  if (!protocolAvailable(candidate, "https")) return null;
  if (candidate.kind === "repository" && candidate.repository.visibility === "public") return null;
  return "The server clones over HTTPS anonymously, so a repository that is not public fails.";
}

export function remoteAddProjectCloneActive(status: RemoteRunnerCloneJob["status"]): boolean {
  return status === "queued" || status === "running";
}

export function remoteAddProjectRowClassName(active: boolean): string {
  const base = "quick-open-result agent-remote-add-project__row";
  if (!active) return base;
  return `${base} active`;
}

export function remoteAddProjectBoundedText(value: string): string {
  return value.slice(0, MAX_REMOTE_ADD_PROJECT_MESSAGE_CHARS);
}

export function remoteAddProjectServerProjects(
  projects: readonly AgentProjectDescriptor[],
  serverId: string | null,
): readonly RemoteAddProjectServerProject[] {
  if (serverId === null) return NO_SERVER_PROJECTS;
  const prefix = `remote:${encodeURIComponent(serverId)}:`;
  return projects
    .filter(
      (project) =>
        project.rootKey.startsWith(prefix) &&
        project.trust === "trusted" &&
        project.origin !== "closed-tab-live-tasks",
    )
    .map((project) => ({ key: project.rootKey, label: project.label }));
}

export function unsupportedRemoteAddProjectStep(step: never): never {
  throw new TypeError(`Unsupported add-project step: ${JSON.stringify(step)}.`);
}

function protocolAvailable(candidate: RemoteAddProjectCandidate, protocol: CloneProtocol): boolean {
  if (candidate.kind === "repository") return cloneUrlFor(candidate.repository, protocol) !== null;
  if (protocol === "https") return candidate.url.startsWith("https://");
  return !candidate.url.startsWith("https://");
}

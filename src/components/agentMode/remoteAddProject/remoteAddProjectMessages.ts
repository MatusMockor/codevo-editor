import type {
  RemoteAddProjectLookupState,
  RemoteAddProjectSourceAvailability,
} from "../../../application/useRemoteAddProject";
import type { RemoteRunnerCloneJob } from "../../../domain/remoteRunner";
import type {
  RemoteProjectSourceKind,
  RepositoryProvider,
  RepositoryVisibility,
} from "../../../domain/repositoryLookup";

export type RemoteAddProjectEntrySource = "gitUrl" | RepositoryProvider;

export type RemoteAddProjectMessage = Readonly<{ message: string; remedy: string | null }>;

export type RemoteAddProjectUnavailableReason = Extract<
  RemoteAddProjectSourceAvailability,
  { status: "unavailable" }
>["reason"];

export function remoteAddProjectLookupMessage(
  lookup: RemoteAddProjectLookupState,
  source: RemoteAddProjectEntrySource,
): RemoteAddProjectMessage | null {
  if (lookup.status === "idle" || lookup.status === "pending") return null;
  if (lookup.status === "rejectedInput") return rejectedInputMessage(lookup.reason, source);
  return settledMessage(lookup.outcome, source);
}

export function remoteAddProjectEntryHint(source: RemoteAddProjectEntrySource): string {
  if (source === "gitUrl")
    return "Press Enter to continue. A URL carrying credentials is rejected.";
  return `Press Enter to look up one exact ${remoteAddProjectPathHint(source)} on the selected server's CLI account.`;
}

export function remoteAddProjectProviderLabel(provider: RepositoryProvider): string {
  if (provider === "gitlab") return "GitLab";
  return "GitHub";
}

export function remoteAddProjectPathHint(provider: RepositoryProvider): string {
  if (provider === "gitlab") return "group/project";
  return "owner/repo";
}

export function remoteAddProjectSourceTitle(kind: RemoteProjectSourceKind): string {
  switch (kind) {
    case "serverProject":
      return "Server project";
    case "gitUrl":
      return "Git URL";
    case "github":
      return "GitHub repository";
    case "gitlab":
      return "GitLab repository";
    default:
      return unsupportedSource(kind);
  }
}

export function remoteAddProjectSourceDescription(kind: RemoteProjectSourceKind): string {
  switch (kind) {
    case "serverProject":
      return "Open a project that already exists on this server";
    case "gitUrl":
      return "Clone from a Git clone URL";
    case "github":
      return "Search GitHub repositories";
    case "gitlab":
      return "Search GitLab repositories";
    default:
      return unsupportedSource(kind);
  }
}

export function remoteAddProjectSourceReason(
  kind: RemoteProjectSourceKind,
  reason: RemoteAddProjectUnavailableReason,
): string {
  switch (reason) {
    case "cliMissing":
      return `${sourceCliName(kind)} was not found on the selected server. ${installHint(kind)}`;
    case "notAuthenticated":
      return `${sourceCliName(kind)} is not logged in to any host. ${signInHint(kind)}`;
    case "hostsFailed":
      return `${sourceCliName(kind)} host check did not finish.`;
    case "cloningUnsupported":
      return "This server cannot clone repositories.";
    case "lookupUnavailable":
      return "Repository lookup is unavailable in this build.";
    case "probeFailed":
      return "Could not reach this server. Try again.";
    default:
      return unsupportedAvailability(reason);
  }
}

export function remoteAddProjectSourceRetryable(
  reason: RemoteAddProjectUnavailableReason,
): boolean {
  switch (reason) {
    case "probeFailed":
    case "hostsFailed":
    case "notAuthenticated":
    case "cliMissing":
      return true;
    case "cloningUnsupported":
    case "lookupUnavailable":
      return false;
    default:
      return unsupportedAvailability(reason);
  }
}

export const REMOTE_ADD_PROJECT_HOSTS_TRUNCATED = "Some hosts are not shown.";

export function remoteAddProjectVisibilityLabel(visibility: RepositoryVisibility): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "private":
      return "Private";
    case "internal":
      return "Internal";
    case "unknown":
      return "Visibility unknown";
    default:
      return unsupportedVisibility(visibility);
  }
}

export function remoteAddProjectNameErrorMessage(error: "invalid" | "taken"): string {
  if (error === "taken") return "A project with this folder name is already on the server.";
  return "Use letters or digits first, then letters, digits, hyphen or underscore, up to 64 characters.";
}

export function remoteAddProjectBranchErrorMessage(): string {
  return "Use a Git branch name, for example main or release/2026.04. Leave it empty for the server default.";
}

export function remoteAddProjectCloneStatusText(
  status: RemoteRunnerCloneJob["status"],
  environment: "local" | "remote" = "remote",
): string {
  switch (status) {
    case "queued":
      return environment === "local" ? "Queued on this computer" : "Queued on the server";
    case "running":
      return environment === "local" ? "Cloning on this computer" : "Cloning on the server";
    case "succeeded":
      return "Clone finished";
    case "failed":
      return "Clone failed";
    case "interrupted":
      return "Clone interrupted";
    case "cancelled":
      return "Clone cancelled";
    default:
      return unsupportedCloneStatus(status);
  }
}

function rejectedInputMessage(
  reason: "invalidPath" | "invalidUrl",
  source: RemoteAddProjectEntrySource,
): RemoteAddProjectMessage {
  if (reason === "invalidUrl")
    return {
      message: "That is not a clone URL this editor accepts.",
      remedy:
        "Use git@host:group/project.git or https://host/group/project.git without credentials.",
    };
  return {
    message: `Enter the repository as ${remoteAddProjectPathHint(entryProvider(source))}.`,
    remedy: null,
  };
}

function settledMessage(
  outcome: Extract<RemoteAddProjectLookupState, { status: "settled" }>["outcome"],
  source: RemoteAddProjectEntrySource,
): RemoteAddProjectMessage {
  switch (outcome.status) {
    case "notFound":
      return {
        message: "That repository was not found.",
        remedy: `Access through the selected server's ${cliName(source)} account is required.`,
      };
    case "cliMissing":
      return { message: `${cliName(source)} was not found on the selected server.`, remedy: null };
    case "notAuthenticated":
      return {
        message: `${cliName(source)} is not logged in to that host.`,
        remedy: signInHint(source),
      };
    case "noCloneUrl":
      return {
        message: "This host returned no usable clone URL. Use a Git URL instead.",
        remedy: null,
      };
    case "hostNotAllowed":
      return { message: "That host is not available for lookup.", remedy: null };
    case "timedOut":
      return { message: "The lookup timed out.", remedy: null };
    case "rateLimited":
      return {
        message: "The provider rate limit was reached.",
        remedy: retryRemedy(outcome.retryAfterSeconds),
      };
    case "failed":
      return { message: failureMessage(outcome.reason), remedy: null };
    default:
      return unsupportedOutcome(outcome);
  }
}

function retryRemedy(retryAfterSeconds: number | null): string | null {
  if (retryAfterSeconds === null) return null;
  return `Try again in ${retryAfterSeconds} seconds.`;
}

function failureMessage(
  reason: "network" | "invalidOutput" | "outputTooLarge" | "busy" | "unknown",
): string {
  switch (reason) {
    case "network":
      return "The lookup could not reach the network.";
    case "invalidOutput":
      return "The CLI returned a response this editor cannot read.";
    case "outputTooLarge":
      return "The CLI response was too large to read.";
    case "busy":
      return "Another lookup is still running.";
    case "unknown":
      return "The lookup failed.";
    default:
      return unsupportedFailure(reason);
  }
}

function entryProvider(source: RemoteAddProjectEntrySource): RepositoryProvider {
  if (source === "gitUrl") return "github";
  return source;
}

function cliName(source: RemoteAddProjectEntrySource): string {
  if (source === "gitlab") return "The GitLab CLI (glab)";
  if (source === "github") return "The GitHub CLI (gh)";
  return "The repository CLI";
}

function cliCommand(kind: RemoteProjectSourceKind): string | null {
  if (kind === "github") return "gh";
  if (kind === "gitlab") return "glab";
  return null;
}

function signInHint(kind: RemoteProjectSourceKind): string {
  const command = cliCommand(kind);
  if (command === null) return "Sign in to the CLI in a terminal, then retry.";
  return `Run \`${command} auth login\` in a terminal, then retry.`;
}

function installHint(kind: RemoteProjectSourceKind): string {
  const command = cliCommand(kind);
  if (command === null) return "Install the CLI, then retry.";
  return `Install \`${command}\`, then retry.`;
}

function sourceCliName(kind: RemoteProjectSourceKind): string {
  if (kind === "github") return "The GitHub CLI (gh)";
  if (kind === "gitlab") return "The GitLab CLI (glab)";
  return "The repository CLI";
}

function unsupportedSource(kind: never): never {
  throw new TypeError(`Unsupported add-project source: ${String(kind)}.`);
}

function unsupportedAvailability(reason: never): never {
  throw new TypeError(`Unsupported source availability: ${String(reason)}.`);
}

function unsupportedVisibility(visibility: never): never {
  throw new TypeError(`Unsupported repository visibility: ${String(visibility)}.`);
}

function unsupportedCloneStatus(status: never): never {
  throw new TypeError(`Unsupported clone status: ${String(status)}.`);
}

function unsupportedFailure(reason: never): never {
  throw new TypeError(`Unsupported lookup failure: ${String(reason)}.`);
}

function unsupportedOutcome(outcome: never): never {
  throw new TypeError(`Unsupported lookup outcome: ${JSON.stringify(outcome)}.`);
}

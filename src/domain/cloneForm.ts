import {
  abbreviateHomePath,
  cloneDestinationRefusal,
  defaultCloneParentPath,
  expandHomePath,
  isDefaultCloneParent,
  joinClonePath,
  resolveCloneDestination,
  suggestCloneFolderName,
} from "./cloneDestination";
import { resolveCloneRepositoryInput, type CloneRepositoryInput } from "./cloneRepositoryInput";
import type { LocalProjectCloneRequest } from "./localProjectClone";
import { isCloneBranchName } from "./repositoryCloneUrl";
import type { WorkspacePathCase } from "./workspaceRootEligibility";

export type CloneFormInput = Readonly<{
  url: string;
  destination: string;
  destinationEdited: boolean;
  branch: string;
  urlTouched: boolean;
}>;
export type CloneDestinationProbe =
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "checking" }>
  | Readonly<{ kind: "free" }>
  | Readonly<{ kind: "exists" }>
  | Readonly<{ kind: "project"; rootPath: string }>;
export type CloneFormContext = Readonly<{
  home: string | null;
  homePathCase?: WorkspacePathCase;
  shorthandHost: string | null;
  lastParent: string | null;
  probe: CloneDestinationProbe;
}>;
export type CloneRepositoryCard =
  | Readonly<{ kind: "empty"; title: string; detail: string }>
  | Readonly<{ kind: "ok"; title: string; detail: string; glyph: "github" | "gitlab" | "gitUrl" }>
  | Readonly<{ kind: "bad"; title: string; detail: string }>;
export type CloneFormRequest = Omit<LocalProjectCloneRequest, "idempotencyKey">;
export type CloneFormState = Readonly<{
  repository: CloneRepositoryCard;
  destination: string;
  destinationTarget: DestinationTarget | null;
  destinationError: string | null;
  existingProjectRoot: string | null;
  branchError: string | null;
  request: CloneFormRequest | null;
  source: Readonly<{ host: string; path: string }> | null;
}>;

type ResolvedCloneInput = Extract<CloneRepositoryInput, { kind: "ok" }>;
type DestinationTarget = Readonly<{ parentPath: string; name: string }>;

const EMPTY_CARD: CloneRepositoryCard = {
  kind: "empty",
  title: "Paste an HTTPS or SSH repository URL",
  detail: "or owner/repo for GitHub. A URL carrying credentials is rejected.",
};
const DESTINATION_INVALID = "Enter an absolute destination path with a valid folder name.";
const DEFAULT_HOME_PATH_CASE: WorkspacePathCase = "insensitive";

export function evaluateCloneForm(
  input: CloneFormInput,
  context: CloneFormContext,
): CloneFormState {
  const repository = resolveCloneRepositoryInput(input.url, context.shorthandHost);
  const card = repositoryCard(repository, input.urlTouched);
  const branch = input.branch.trim();
  const branchProblem = branchError(branch);
  if (repository.kind !== "ok")
    return {
      repository: card,
      destination: input.destinationEdited ? input.destination : "",
      destinationTarget: null,
      destinationError: null,
      existingProjectRoot: null,
      branchError: branchProblem,
      request: null,
      source: null,
    };
  const destination = input.destinationEdited
    ? input.destination
    : suggestedDestination(repository, context);
  const refusal = destinationRefusal(destination, context);
  const target = refusal === null ? destinationTarget(destination, context.home) : null;
  const destinationError =
    refusal ?? (target === null ? DESTINATION_INVALID : probeMessage(context.probe, destination));
  const request =
    target !== null &&
    destinationError === null &&
    branchProblem === null &&
    context.probe.kind !== "checking"
      ? cloneRequest(repository, target, branch, context.home)
      : null;
  return {
    repository: card,
    destination,
    destinationTarget: target,
    destinationError,
    existingProjectRoot:
      target !== null && context.probe.kind === "project" ? context.probe.rootPath : null,
    branchError: branchProblem,
    request,
    source: { host: repository.identity.host, path: repository.identity.path },
  };
}

function destinationTarget(destination: string, home: string | null): DestinationTarget | null {
  const target = resolveCloneDestination(destination, home);
  if (target.kind === "invalid") return null;
  return { parentPath: target.parentPath, name: target.name };
}

function destinationRefusal(destination: string, context: CloneFormContext): string | null {
  const expanded = expandHomePath(destination, context.home);
  if (expanded === null) return null;
  return cloneDestinationRefusal(expanded, {
    path: context.home,
    pathCase: context.homePathCase ?? DEFAULT_HOME_PATH_CASE,
  });
}

function cloneRequest(
  repository: ResolvedCloneInput,
  target: DestinationTarget,
  branch: string,
  home: string | null,
): CloneFormRequest {
  return {
    url: repository.url,
    name: target.name,
    parentPath: target.parentPath,
    ...(branch === "" ? {} : { branch }),
    ...(isDefaultCloneParent(target.parentPath, home) ? { ensureParent: true as const } : {}),
  };
}

function suggestedDestination(repository: ResolvedCloneInput, context: CloneFormContext): string {
  if (context.home === null) return "";
  const parent = defaultCloneParentPath(context.home, context.lastParent);
  return abbreviateHomePath(
    joinClonePath(parent, suggestCloneFolderName(repository.identity)),
    context.home,
  );
}

function probeMessage(probe: CloneDestinationProbe, destination: string): string | null {
  switch (probe.kind) {
    case "exists":
      return `${destination} already exists. Choose another folder name.`;
    case "project":
      return `${destination} is already a project.`;
    case "unknown":
    case "checking":
    case "free":
      return null;
    default:
      return unsupportedProbe(probe);
  }
}

function branchError(branch: string): string | null {
  const value = branch.trim();
  if (value === "" || isCloneBranchName(value)) return null;
  return "Not a valid branch name.";
}

function repositoryCard(repository: CloneRepositoryInput, touched: boolean): CloneRepositoryCard {
  switch (repository.kind) {
    case "ok":
      return {
        kind: "ok",
        title: repository.identity.path,
        detail: `${repository.identity.host} · ${transportLabel(repository)}`,
        glyph: glyphFor(repository.identity.host),
      };
    case "credentials":
      return {
        kind: "bad",
        title: "A URL carrying credentials is rejected",
        detail: "Remove the token and sign in with gh auth login instead.",
      };
    case "invalid":
      if (!touched) return EMPTY_CARD;
      return {
        kind: "bad",
        title: "That is not a clone URL Codevo accepts",
        detail: "Use https://host/owner/repo.git or git@host:owner/repo.git",
      };
    case "empty":
      return EMPTY_CARD;
    default:
      return unsupportedInput(repository);
  }
}

function transportLabel(repository: ResolvedCloneInput): string {
  if (repository.shorthand) return "GitHub shorthand";
  return repository.transport === "ssh" ? "SSH" : "HTTPS";
}

function glyphFor(host: string): "github" | "gitlab" | "gitUrl" {
  if (host === "github.com") return "github";
  if (host.includes("gitlab")) return "gitlab";
  return "gitUrl";
}

function unsupportedProbe(probe: never): never {
  throw new TypeError(`Unsupported destination probe: ${JSON.stringify(probe)}.`);
}

function unsupportedInput(input: never): never {
  throw new TypeError(`Unsupported clone input: ${JSON.stringify(input)}.`);
}

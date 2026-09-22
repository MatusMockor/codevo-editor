import {
  cloneFolderName,
  cloneUrlFor,
  isCloneBranchName,
  isCloneFolderName,
  parseRepositoryCloneUrl,
  type CloneProtocol,
  type RepositoryIdentity,
} from "../domain/repositoryCloneUrl";
import {
  parseRepositoryPath,
  type RemoteProjectSourceKind,
  type RepositoryHost,
  type RepositoryInfo,
  type RepositoryLookupRequest,
  type RepositoryProvider,
} from "../domain/repositoryLookup";

export const REMOTE_ADD_PROJECT_ERROR_CHARS = 200;
export const REMOTE_ADD_PROJECT_ENTRY_CHARS = 2048;

export const REMOTE_ADD_PROJECT_FALLBACK_HOSTS = {
  github: "github.com",
  gitlab: "gitlab.com",
} as const satisfies Readonly<Record<RepositoryProvider, string>>;

export type RemoteAddProjectServerProject = Readonly<{ key: string; label: string }>;

export type RemoteAddProjectUnavailableReason =
  | "cliMissing"
  | "notAuthenticated"
  | "hostsFailed"
  | "cloningUnsupported"
  | "lookupUnavailable"
  | "probeFailed";

export type RemoteAddProjectSourceAvailability =
  | Readonly<{ status: "ready" }>
  | Readonly<{ status: "checking" }>
  | Readonly<{ status: "unavailable"; reason: RemoteAddProjectUnavailableReason }>;

export type RemoteAddProjectCandidate =
  | Readonly<{ kind: "repository"; repository: RepositoryInfo }>
  | Readonly<{ kind: "url"; url: string; identity: RepositoryIdentity }>;

export type RemoteAddProjectLookupFailure =
  | Readonly<{
      status:
        | "notFound"
        | "cliMissing"
        | "notAuthenticated"
        | "hostNotAllowed"
        | "timedOut"
        | "noCloneUrl";
    }>
  | Readonly<{ status: "rateLimited"; retryAfterSeconds: number | null }>
  | Readonly<{
      status: "failed";
      reason: "network" | "invalidOutput" | "outputTooLarge" | "busy" | "unknown";
    }>;

export type RemoteAddProjectLookupOutcome =
  Readonly<{ status: "ok"; repository: RepositoryInfo }> | RemoteAddProjectLookupFailure;

export type RemoteAddProjectLookupState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "pending"; request: RepositoryLookupRequest }>
  | Readonly<{ status: "rejectedInput"; reason: "invalidPath" | "invalidUrl" }>
  | Readonly<{ status: "settled"; outcome: RemoteAddProjectLookupFailure }>;

export type RemoteAddProjectStep =
  | Readonly<{ kind: "sources" }>
  | Readonly<{ kind: "serverProjects" }>
  | Readonly<{ kind: "urlEntry"; entry: string; lookup: RemoteAddProjectLookupState }>
  | Readonly<{
      kind: "repository";
      provider: RepositoryProvider;
      host: string;
      hosts: readonly RepositoryHost[];
      hostsTruncated: boolean;
      entry: string;
      lookup: RemoteAddProjectLookupState;
    }>
  | Readonly<{
      kind: "confirm";
      candidate: RemoteAddProjectCandidate;
      name: string;
      branch: string;
      protocol: CloneProtocol;
      nameError: "invalid" | "taken" | null;
      branchError: "invalid" | null;
      existingProjectKey: string | null;
      submitError: string | null;
      submitting: boolean;
    }>;

export type RemoteAddProjectRepositoryStep = Extract<RemoteAddProjectStep, { kind: "repository" }>;
export type RemoteAddProjectConfirmStep = Extract<RemoteAddProjectStep, { kind: "confirm" }>;

export type RemoteAddProjectState = Readonly<{
  open: boolean;
  step: RemoteAddProjectStep;
  previous: RemoteAddProjectStep | null;
}>;

export type RemoteAddProjectContext = Readonly<{
  serverProjects: readonly RemoteAddProjectServerProject[];
  hosts: Readonly<Record<RepositoryProvider, readonly RepositoryHost[]>>;
  hostsTruncated: Readonly<Record<RepositoryProvider, boolean>>;
  availability: Readonly<Record<RemoteProjectSourceKind, RemoteAddProjectSourceAvailability>>;
}>;

export type RemoteAddProjectEntryPlan =
  | Readonly<{ kind: "candidate"; candidate: RemoteAddProjectCandidate }>
  | Readonly<{ kind: "lookup"; request: RepositoryLookupRequest }>
  | Readonly<{ kind: "rejected"; reason: "invalidPath" | "invalidUrl" }>
  | Readonly<{ kind: "ignored" }>;

export type RemoteAddProjectAction =
  | Readonly<{ kind: "open" }>
  | Readonly<{ kind: "close" }>
  | Readonly<{ kind: "back" }>
  | Readonly<{ kind: "chooseSource"; source: RemoteProjectSourceKind }>
  | Readonly<{ kind: "useGitUrl" }>
  | Readonly<{ kind: "chooseHost"; host: string }>
  | Readonly<{ kind: "chooseRepository"; repository: RepositoryInfo }>
  | Readonly<{ kind: "submitEntry"; raw: string }>
  | Readonly<{ kind: "lookupSettled"; outcome: RemoteAddProjectLookupOutcome }>
  | Readonly<{ kind: "setName"; value: string }>
  | Readonly<{ kind: "setBranch"; value: string }>
  | Readonly<{ kind: "setProtocol"; value: CloneProtocol }>
  | Readonly<{ kind: "submitStarted" }>
  | Readonly<{ kind: "submitFailed"; error: string; nameConflict: boolean }>
  | Readonly<{ kind: "submitted" }>
  | Readonly<{ kind: "syncContext" }>;

const IDLE_LOOKUP: RemoteAddProjectLookupState = Object.freeze({ status: "idle" });
const SOURCES_STEP: RemoteAddProjectStep = Object.freeze({ kind: "sources" });
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;

export const INITIAL_REMOTE_ADD_PROJECT_STATE: RemoteAddProjectState = Object.freeze({
  open: false,
  step: SOURCES_STEP,
  previous: null,
});

export function reduceRemoteAddProject(
  state: RemoteAddProjectState,
  action: RemoteAddProjectAction,
  context: RemoteAddProjectContext,
): RemoteAddProjectState {
  switch (action.kind) {
    case "open":
      return { open: true, step: SOURCES_STEP, previous: null };
    case "close":
      if (isSubmitting(state)) return state;
      return INITIAL_REMOTE_ADD_PROJECT_STATE;
    case "submitted":
      return INITIAL_REMOTE_ADD_PROJECT_STATE;
    case "back":
      return goBack(state);
    case "chooseSource":
      return chooseSource(state, action.source, context);
    case "useGitUrl":
      return useGitUrl(state, context);
    case "chooseRepository": {
      const repository = action.repository;
      if (!state.open || (state.step.kind !== "repository" && state.step.kind !== "sources"))
        return state;
      if (state.step.kind === "repository" && state.step.provider !== repository.provider)
        return state;
      if (!hasCloneUrl(repository)) return state;
      // The picker owns its refreshed host snapshot and filters the selected result.
      // The source menu's earlier snapshot must not veto a newly authenticated host.
      return enterConfirm(state, { kind: "repository", repository }, context);
    }
    case "chooseHost":
      return chooseHost(state, action.host, context);
    case "submitEntry":
      return applyEntryPlan(
        state,
        planRemoteAddProjectEntry(state.step, action.raw, context),
        action.raw,
        context,
      );
    case "lookupSettled":
      return settleLookup(state, action.outcome, context);
    case "setName":
      return setName(state, action.value, context);
    case "setBranch":
      return setBranch(state, action.value);
    case "setProtocol":
      return setProtocol(state, action.value);
    case "submitStarted":
      return startSubmit(state);
    case "submitFailed":
      return failSubmit(state, action.error, action.nameConflict);
    case "syncContext":
      return syncContext(state, context);
    default:
      return unsupportedAction(action);
  }
}

export function planRemoteAddProjectEntry(
  step: RemoteAddProjectStep,
  raw: string,
  context: RemoteAddProjectContext,
): RemoteAddProjectEntryPlan {
  const trimmed = raw.trim();
  if (step.kind === "urlEntry") {
    if (!isSourceReady(context, "gitUrl")) return { kind: "ignored" };
    const identity = parseRepositoryCloneUrl(trimmed);
    if (identity === null) return { kind: "rejected", reason: "invalidUrl" };
    return { kind: "candidate", candidate: { kind: "url", url: trimmed, identity } };
  }
  if (step.kind !== "repository") return { kind: "ignored" };
  if (!isSourceReady(context, step.provider)) return { kind: "ignored" };
  const identity = parseRepositoryCloneUrl(trimmed);
  if (identity !== null) {
    if (!isSourceReady(context, "gitUrl")) return { kind: "ignored" };
    return { kind: "candidate", candidate: { kind: "url", url: trimmed, identity } };
  }
  if (!isKnownHost(context, step.provider, step.host)) return { kind: "ignored" };
  const path = parseRepositoryPath(step.provider, trimmed);
  if (path === null) return { kind: "rejected", reason: "invalidPath" };
  const request: RepositoryLookupRequest = { provider: step.provider, host: step.host, path };
  if (repeatsPendingRequest(step.lookup, request)) return { kind: "ignored" };
  return { kind: "lookup", request };
}

export function remoteAddProjectCloneUrl(
  candidate: RemoteAddProjectCandidate,
  protocol: CloneProtocol,
): string | null {
  switch (candidate.kind) {
    case "url":
      if (urlProtocol(candidate.url) !== protocol) return null;
      return candidate.url;
    case "repository":
      return cloneUrlFor(candidate.repository, protocol);
    default:
      return unsupportedCandidate(candidate);
  }
}

export function remoteAddProjectIdentity(candidate: RemoteAddProjectCandidate): RepositoryIdentity {
  switch (candidate.kind) {
    case "url":
      return candidate.identity;
    case "repository":
      return { host: candidate.repository.host, path: candidate.repository.fullPath };
    default:
      return unsupportedCandidate(candidate);
  }
}

export function boundedRemoteAddProjectError(value: string): string {
  const text = value.replace(CONTROL_CHARACTERS, " ").trim();
  if (text.length === 0) return "Could not clone the repository.";
  return text.slice(0, REMOTE_ADD_PROJECT_ERROR_CHARS);
}

function goBack(state: RemoteAddProjectState): RemoteAddProjectState {
  if (isSubmitting(state)) return state;
  if (state.step.kind === "sources") return state;
  if (state.step.kind === "confirm") {
    return { open: state.open, step: state.previous ?? SOURCES_STEP, previous: null };
  }
  return { open: state.open, step: SOURCES_STEP, previous: null };
}

function chooseSource(
  state: RemoteAddProjectState,
  source: RemoteProjectSourceKind,
  context: RemoteAddProjectContext,
): RemoteAddProjectState {
  if (!state.open) return state;
  if (state.step.kind !== "sources") return state;
  if (!isSourceReady(context, source)) return state;
  switch (source) {
    case "serverProject":
      return { open: true, step: { kind: "serverProjects" }, previous: null };
    case "gitUrl":
      return { open: true, step: urlEntryStep(""), previous: null };
    case "github":
    case "gitlab":
      return { open: true, step: repositoryStep(source, context, null, ""), previous: null };
    default:
      return unsupportedSource(source);
  }
}

function useGitUrl(
  state: RemoteAddProjectState,
  context: RemoteAddProjectContext,
): RemoteAddProjectState {
  const step = state.step;
  if (!state.open) return state;
  if (step.kind !== "repository" && step.kind !== "urlEntry") return state;
  if (!isSourceReady(context, "gitUrl")) return state;
  return { open: true, step: urlEntryStep(""), previous: null };
}

function chooseHost(
  state: RemoteAddProjectState,
  host: string,
  context: RemoteAddProjectContext,
): RemoteAddProjectState {
  const step = state.step;
  if (step.kind !== "repository") return state;
  if (step.host === host) return state;
  if (!isKnownHost(context, step.provider, host)) return state;
  return { ...state, step: { ...step, host, lookup: IDLE_LOOKUP } };
}

function applyEntryPlan(
  state: RemoteAddProjectState,
  plan: RemoteAddProjectEntryPlan,
  raw: string,
  context: RemoteAddProjectContext,
): RemoteAddProjectState {
  if (!state.open) return state;
  const remembered = withEntry(state, raw);
  switch (plan.kind) {
    case "ignored":
      return state;
    case "rejected":
      return withLookup(remembered, { status: "rejectedInput", reason: plan.reason });
    case "lookup":
      return withLookup(remembered, { status: "pending", request: plan.request });
    case "candidate":
      return enterConfirm(remembered, plan.candidate, context);
    default:
      return unsupportedPlan(plan);
  }
}

function withEntry(state: RemoteAddProjectState, raw: string): RemoteAddProjectState {
  const step = state.step;
  const entry = raw.slice(0, REMOTE_ADD_PROJECT_ENTRY_CHARS);
  if (step.kind === "urlEntry") return { ...state, step: { ...step, entry } };
  if (step.kind === "repository") return { ...state, step: { ...step, entry } };
  return state;
}

function withLookup(
  state: RemoteAddProjectState,
  lookup: RemoteAddProjectLookupState,
): RemoteAddProjectState {
  const step = state.step;
  if (step.kind === "urlEntry") return { ...state, step: { ...step, lookup } };
  if (step.kind === "repository") return { ...state, step: { ...step, lookup } };
  return state;
}

function settleLookup(
  state: RemoteAddProjectState,
  outcome: RemoteAddProjectLookupOutcome,
  context: RemoteAddProjectContext,
): RemoteAddProjectState {
  const step = state.step;
  if (step.kind !== "repository" && step.kind !== "urlEntry") return state;
  if (step.lookup.status !== "pending") return state;
  if (outcome.status !== "ok") return withLookup(state, { status: "settled", outcome });
  if (!matchesRequestedRepository(step, outcome.repository)) {
    return withLookup(state, {
      status: "settled",
      outcome: { status: "failed", reason: "invalidOutput" },
    });
  }
  if (!hasCloneUrl(outcome.repository)) {
    return withLookup(state, { status: "settled", outcome: { status: "noCloneUrl" } });
  }
  return enterConfirm(state, { kind: "repository", repository: outcome.repository }, context);
}

function hasCloneUrl(repository: RepositoryInfo): boolean {
  return cloneUrlFor(repository, "ssh") !== null || cloneUrlFor(repository, "https") !== null;
}

function repeatsPendingRequest(
  lookup: RemoteAddProjectLookupState,
  request: RepositoryLookupRequest,
): boolean {
  if (lookup.status !== "pending") return false;
  return (
    lookup.request.provider === request.provider &&
    lookup.request.host === request.host &&
    lookup.request.path === request.path
  );
}

function matchesRequestedRepository(
  step: RemoteAddProjectStep,
  repository: RepositoryInfo,
): boolean {
  if (step.kind !== "repository") return false;
  return repository.provider === step.provider && repository.host === step.host;
}

function enterConfirm(
  state: RemoteAddProjectState,
  candidate: RemoteAddProjectCandidate,
  context: RemoteAddProjectContext,
): RemoteAddProjectState {
  const name = cloneFolderName(remoteAddProjectIdentity(candidate)) ?? "";
  return {
    open: state.open,
    previous: entryStep(state.step),
    step: {
      kind: "confirm",
      candidate,
      name,
      branch: "",
      protocol: defaultProtocol(candidate),
      nameError: nameErrorFor(name),
      branchError: null,
      existingProjectKey: existingProjectKey(name, context),
      submitError: null,
      submitting: false,
    },
  };
}

function entryStep(step: RemoteAddProjectStep): RemoteAddProjectStep | null {
  if (step.kind === "repository") return { ...step, lookup: IDLE_LOOKUP };
  if (step.kind === "urlEntry") return { ...step, lookup: IDLE_LOOKUP };
  return null;
}

function setName(
  state: RemoteAddProjectState,
  value: string,
  context: RemoteAddProjectContext,
): RemoteAddProjectState {
  const step = state.step;
  if (step.kind !== "confirm") return state;
  if (step.submitting) return state;
  return {
    ...state,
    step: {
      ...step,
      name: value,
      nameError: nameErrorFor(value),
      existingProjectKey: existingProjectKey(value, context),
      submitError: null,
    },
  };
}

function setBranch(state: RemoteAddProjectState, value: string): RemoteAddProjectState {
  const step = state.step;
  if (step.kind !== "confirm") return state;
  if (step.submitting) return state;
  return {
    ...state,
    step: { ...step, branch: value, branchError: branchErrorFor(value), submitError: null },
  };
}

function setProtocol(state: RemoteAddProjectState, value: CloneProtocol): RemoteAddProjectState {
  const step = state.step;
  if (step.kind !== "confirm") return state;
  if (step.submitting) return state;
  if (step.protocol === value) return state;
  if (remoteAddProjectCloneUrl(step.candidate, value) === null) return state;
  return { ...state, step: { ...step, protocol: value, submitError: null } };
}

function startSubmit(state: RemoteAddProjectState): RemoteAddProjectState {
  const step = state.step;
  if (step.kind !== "confirm") return state;
  if (step.submitting) return state;
  if (step.nameError !== null || step.branchError !== null) return state;
  return { ...state, step: { ...step, submitting: true, submitError: null } };
}

function failSubmit(
  state: RemoteAddProjectState,
  error: string,
  nameConflict: boolean,
): RemoteAddProjectState {
  const step = state.step;
  if (step.kind !== "confirm") return state;
  if (nameConflict) {
    return {
      ...state,
      step: { ...step, submitting: false, nameError: "taken", submitError: null },
    };
  }
  return {
    ...state,
    step: { ...step, submitting: false, submitError: boundedRemoteAddProjectError(error) },
  };
}

function syncContext(
  state: RemoteAddProjectState,
  context: RemoteAddProjectContext,
): RemoteAddProjectState {
  const step = state.step;
  if (step.kind === "confirm") {
    const key = existingProjectKey(step.name, context);
    if (key === step.existingProjectKey) return state;
    return { ...state, step: { ...step, existingProjectKey: key } };
  }
  if (step.kind !== "repository") return state;
  const hosts = context.hosts[step.provider];
  const truncated = context.hostsTruncated[step.provider];
  if (hosts === step.hosts && truncated === step.hostsTruncated) return state;
  const next = repositoryStep(step.provider, context, step.host, step.entry);
  if (next.host !== step.host) return { ...state, step: next };
  return { ...state, step: { ...next, lookup: step.lookup } };
}

function urlEntryStep(entry: string): RemoteAddProjectStep {
  return { kind: "urlEntry", entry, lookup: IDLE_LOOKUP };
}

function repositoryStep(
  provider: RepositoryProvider,
  context: RemoteAddProjectContext,
  preferred: string | null,
  entry: string,
): RemoteAddProjectRepositoryStep {
  const hosts = context.hosts[provider];
  return {
    kind: "repository",
    provider,
    host: chooseDefaultHost(provider, hosts, preferred),
    hosts,
    hostsTruncated: context.hostsTruncated[provider],
    entry,
    lookup: IDLE_LOOKUP,
  };
}

function chooseDefaultHost(
  provider: RepositoryProvider,
  hosts: readonly RepositoryHost[],
  preferred: string | null,
): string {
  if (preferred !== null && hosts.some((host) => host.host === preferred)) return preferred;
  const authenticated = hosts.find((host) => host.auth === "authenticated");
  if (authenticated !== undefined) return authenticated.host;
  const first = hosts[0];
  if (first !== undefined) return first.host;
  return REMOTE_ADD_PROJECT_FALLBACK_HOSTS[provider];
}

function defaultProtocol(candidate: RemoteAddProjectCandidate): CloneProtocol {
  switch (candidate.kind) {
    case "url":
      return urlProtocol(candidate.url);
    case "repository":
      if (candidate.repository.sshUrl !== null) return "ssh";
      return "https";
    default:
      return unsupportedCandidate(candidate);
  }
}

function urlProtocol(url: string): CloneProtocol {
  if (url.startsWith("https://")) return "https";
  return "ssh";
}

function nameErrorFor(value: string): "invalid" | null {
  if (isCloneFolderName(value)) return null;
  return "invalid";
}

function branchErrorFor(value: string): "invalid" | null {
  const branch = value.trim();
  if (branch.length === 0) return null;
  if (isCloneBranchName(branch)) return null;
  return "invalid";
}

function existingProjectKey(name: string, context: RemoteAddProjectContext): string | null {
  const match = context.serverProjects.find((project) => project.label === name);
  if (match === undefined) return null;
  return match.key;
}

function isSubmitting(state: RemoteAddProjectState): boolean {
  return state.step.kind === "confirm" && state.step.submitting;
}

function isSourceReady(context: RemoteAddProjectContext, source: RemoteProjectSourceKind): boolean {
  return context.availability[source].status === "ready";
}

function isKnownHost(
  context: RemoteAddProjectContext,
  provider: RepositoryProvider,
  host: string,
): boolean {
  return context.hosts[provider].some(
    (candidate) => candidate.host === host && candidate.auth === "authenticated",
  );
}

function unsupportedAction(action: never): never {
  throw new TypeError(`Unsupported remote add-project action: ${String(action)}.`);
}

function unsupportedSource(source: never): never {
  throw new TypeError(`Unsupported remote project source: ${String(source)}.`);
}

function unsupportedPlan(plan: never): never {
  throw new TypeError(`Unsupported remote add-project entry plan: ${String(plan)}.`);
}

function unsupportedCandidate(candidate: never): never {
  throw new TypeError(`Unsupported remote add-project candidate: ${String(candidate)}.`);
}

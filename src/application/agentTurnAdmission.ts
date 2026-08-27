import type { AgentProjectDescriptor } from "../domain/agentProject";
import {
  agentLaunchIsDangerous,
  agentLaunchMatchesProvider,
  type AgentLaunchOptions,
} from "../domain/agentLaunch";
import {
  MAX_AGENT_TASK_PROMPT_BYTES,
  mintAgentTaskId,
  type AgentCliKind,
} from "../domain/agentTask";
import { runningTurn, type AgentThread, type AgentThreadsState } from "../domain/agentThread";
import {
  normalizeAgentCliKind,
  normalizeAgentCliPath,
  normalizeMaxConcurrentAgentTasks,
} from "../domain/agentSettings";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  failure,
  isCurrentTaskLaunchAuthority,
  projectByOwnerId,
  projectByRootKey,
  taskLaunchAuthority,
  type AgentProjectLaunchIdentity,
  type AgentTaskLaunchAuthority,
  warning,
} from "./agentProjectAuthority";
import type {
  AgentFollowUpRequest,
  AgentTasksNotice,
  AgentThreadStartRequest,
  AgentThreadStoreSurface,
} from "./agentThreadPorts";
import type { InPlacePreflight } from "./useAgentIsolationPreview";
import {
  decideAgentProviderAdmission,
  isCurrentAgentProviderAdmissionAuthority,
  type AgentProviderAdmissionAuthority,
  type AgentProviderAdmissionAuthorityReader,
  type ReadyAgentProviderAdmissionAuthority,
} from "./agentProviderAdmissionAuthority";

export interface AgentTurnAdmissionDependencies {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly store: AgentThreadStoreSurface;
  readonly getAgentCliPath: () => string | null;
  readonly getAgentCliKind: () => AgentCliKind;
  readonly getAgentProviderAdmissionAuthority: AgentProviderAdmissionAuthorityReader;
  readonly getMaxConcurrentAgentTasks: () => number;
  readonly isWorktreeMissing: (threadId: string) => boolean;
  readonly ensureProjectLease?: (projectRootKey: string) => Promise<boolean>;
  readonly launchIdentityForProject: (projectRootKey: string) => AgentProjectLaunchIdentity | null;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly now?: () => number;
  readonly createEntropyHex4?: () => string;
}

type AdmissionDependencies = AgentTurnAdmissionDependencies;

const LEASE_REFUSED_NOTICE =
  "This project could not be protected from tab close, so the agent was not started.";
export const LAUNCH_PROVIDER_MISMATCH_NOTICE =
  "The selected model or mode belongs to a different provider.";
export const DANGEROUS_LAUNCH_UNCONFIRMED_NOTICE =
  "Confirm running without permission checks before starting this agent.";
const UTF8_ENCODER = new TextEncoder();

export function agentPromptByteLength(prompt: string): number {
  return UTF8_ENCODER.encode(prompt).byteLength;
}

export function countRunningTurns(state: AgentThreadsState): number {
  let live = 0;
  for (const thread of state.threads.values()) {
    if (runningTurn(thread) !== null) live += 1;
  }
  return live;
}

export function countRunningTurnsInRepository(
  state: AgentThreadsState,
  repositoryRoot: string,
): number {
  let live = 0;
  for (const thread of state.threads.values()) {
    if (thread.owner.repositoryRoot !== repositoryRoot) continue;
    if (runningTurn(thread) !== null) live += 1;
  }
  return live;
}

export interface AdmittedStart {
  readonly project: AgentProjectDescriptor;
  readonly authority: AgentTaskLaunchAuthority;
  readonly prompt: string;
  readonly agentCliPath: string;
  readonly agentCliKind: AgentCliKind;
  readonly providerAuthority: ReadyAgentProviderAdmissionAuthority;
  readonly launch: AgentLaunchOptions;
}

export function admitStart(
  deps: AdmissionDependencies,
  request: AgentThreadStartRequest,
): AdmittedStart | null {
  if (deps.projects.length === 0) {
    deps.setNotice(warning("Open a workspace before starting an agent."));
    return null;
  }
  const project = projectByRootKey(deps.projects, request.projectRootKey);
  if (
    project === undefined ||
    !project.repositories.some((repository) => repository.repositoryRoot === request.repositoryRoot)
  ) {
    deps.setNotice(warning("Select a repository from this workspace."));
    return null;
  }
  if (project.origin === "closed-tab-live-tasks") {
    deps.setNotice(warning("This project is being released, so a new agent cannot start in it."));
    return null;
  }
  if (project.origin !== "active-tab" && request.isolation === "in-place") {
    deps.setNotice(warning("In-place agents can run only in the active project. Use a worktree."));
    return null;
  }
  const prompt = admitPrompt(deps, request.prompt);
  if (prompt === null) return null;
  const agentCliKind = normalizeAgentCliKind(request.launch.provider);
  const launch = admitLaunch(deps, request, agentCliKind);
  if (launch === null) return null;
  const providerAdmission = admitCapacity(deps, agentCliKind);
  if (providerAdmission === null) return null;
  const launchIdentity = deps.launchIdentityForProject(project.rootKey);
  if (launchIdentity === null) {
    deps.setNotice(warning("This project is not registered, so an agent cannot start in it."));
    return null;
  }
  return {
    project,
    authority: taskLaunchAuthority(project, launchIdentity),
    prompt,
    agentCliPath: providerAdmission.cliPath,
    agentCliKind,
    providerAuthority: providerAdmission,
    launch,
  };
}

export interface AdmittedFollowUp {
  readonly thread: AgentThread;
  readonly authority: AgentTaskLaunchAuthority;
  readonly projectRoot: string;
  readonly prompt: string;
  readonly agentCliPath: string;
  readonly providerAuthority: ReadyAgentProviderAdmissionAuthority;
  readonly sessionId: string;
  readonly launch: AgentLaunchOptions;
}

export function admitFollowUp(
  deps: AdmissionDependencies,
  request: AgentFollowUpRequest,
  inFlightThreads: ReadonlySet<string>,
): AdmittedFollowUp | null {
  const thread = deps.store.state.threads.get(request.threadId);
  if (thread === undefined) {
    deps.setNotice(warning("This thread is no longer available."));
    return null;
  }
  if (thread.archived) {
    deps.setNotice(warning("This thread is archived. Start a new thread."));
    return null;
  }
  if (runningTurn(thread) !== null || inFlightThreads.has(thread.threadId)) {
    deps.setNotice(warning("This thread is still running. Wait for the turn to finish."));
    return null;
  }
  const project =
    projectByOwnerId(deps.projects, thread.owner.ownerId) ??
    projectByRootKey(deps.projects, thread.owner.rootKey);
  const launchIdentity =
    project === undefined ? null : deps.launchIdentityForProject(project.rootKey);
  if (
    project === undefined ||
    launchIdentity === null ||
    launchIdentity.workspaceId !== thread.owner.ownerId ||
    project.rootKey !== thread.owner.rootKey ||
    project.origin === "closed-tab-live-tasks" ||
    !project.repositories.some(
      (repository) => repository.repositoryRoot === thread.owner.repositoryRoot,
    )
  ) {
    deps.setNotice(warning("This thread's project is no longer open, so it cannot continue."));
    return null;
  }
  const prompt = admitPrompt(deps, request.prompt);
  if (prompt === null) return null;
  const launch = admitLaunch(deps, request, thread.provider.kind);
  if (launch === null) return null;
  const providerAdmission = admitCapacity(deps, thread.provider.kind);
  if (providerAdmission === null) return null;
  if (thread.provider.sessionId === null) {
    deps.setNotice(warning("This thread has no resumable session; start a new thread."));
    return null;
  }
  if (deps.isWorktreeMissing(thread.threadId)) {
    deps.setNotice(warning("The worktree for this thread no longer exists."));
    return null;
  }
  return {
    thread,
    authority: taskLaunchAuthority(project, launchIdentity),
    projectRoot: project.rootPath,
    prompt,
    agentCliPath: providerAdmission.cliPath,
    providerAuthority: providerAdmission,
    sessionId: thread.provider.sessionId,
    launch,
  };
}

interface LaunchRequest {
  readonly launch: AgentLaunchOptions;
  readonly dangerousLaunchConfirmed?: boolean;
}

function admitLaunch(
  deps: AdmissionDependencies,
  request: LaunchRequest,
  provider: AgentCliKind,
): AgentLaunchOptions | null {
  const launch = request.launch;
  if (!agentLaunchMatchesProvider(launch, provider)) {
    deps.setNotice(failure(LAUNCH_PROVIDER_MISMATCH_NOTICE));
    return null;
  }
  if (agentLaunchIsDangerous(launch) && request.dangerousLaunchConfirmed !== true) {
    deps.setNotice(warning(DANGEROUS_LAUNCH_UNCONFIRMED_NOTICE));
    return null;
  }
  return launch;
}

function admitPrompt(deps: AdmissionDependencies, raw: string): string | null {
  const prompt = raw.trim();
  if (prompt === "") {
    deps.setNotice(warning("Write a prompt before starting an agent."));
    return null;
  }
  if (agentPromptByteLength(prompt) > MAX_AGENT_TASK_PROMPT_BYTES) {
    deps.setNotice(warning("The prompt is too long. Shorten it and try again."));
    return null;
  }
  return prompt;
}

function admitCapacity(
  deps: AdmissionDependencies,
  provider: AgentCliKind,
): ReadyAgentProviderAdmissionAuthority | null {
  const limit = normalizeMaxConcurrentAgentTasks(deps.getMaxConcurrentAgentTasks());
  if (countRunningTurns(deps.store.state) >= limit) {
    deps.setNotice(
      warning("The concurrent agent limit is reached. Stop a running agent or raise the limit."),
    );
    return null;
  }
  const authority = readProviderAdmissionAuthority(deps, provider);
  if (authority.provider !== provider) {
    deps.setNotice(failure(LAUNCH_PROVIDER_MISMATCH_NOTICE));
    return null;
  }
  const decision = decideAgentProviderAdmission(authority);
  if (decision.kind === "rejected") {
    deps.setNotice(warning(decision.message));
    return null;
  }
  const agentCliPath = normalizeAgentCliPath(decision.authority.cliPath);
  if (agentCliPath === null) {
    deps.setNotice({
      kind: "warning",
      message: "No agent CLI is configured. Set the agent CLI path in settings.",
      action: "configure-agent-cli",
    });
    return null;
  }
  return { ...decision.authority, cliPath: agentCliPath };
}

export function providerAdmissionIsCurrent(
  deps: AdmissionDependencies,
  captured: ReadyAgentProviderAdmissionAuthority,
): boolean {
  const read = (provider: AgentCliKind): AgentProviderAdmissionAuthority =>
    readProviderAdmissionAuthority(deps, provider);
  return isCurrentAgentProviderAdmissionAuthority(read, captured);
}

function readProviderAdmissionAuthority(
  deps: AdmissionDependencies,
  provider: AgentCliKind,
): AgentProviderAdmissionAuthority {
  return deps.getAgentProviderAdmissionAuthority(provider);
}

export async function ensureLease(
  deps: AdmissionDependencies,
  dependenciesRef: { readonly current: AdmissionDependencies },
  mountedRef: { readonly current: boolean },
  project: AgentProjectDescriptor,
  authority: AgentTaskLaunchAuthority,
  repositoryRoot: string,
  additionalAuthorityIsCurrent?: () => boolean,
): Promise<boolean> {
  const ensureProjectLease = deps.ensureProjectLease;
  if (project.leaseToken !== null || ensureProjectLease === undefined) return true;
  const leased = await attempt(() => ensureProjectLease(project.rootKey));
  if (!isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot))
    return false;
  if (additionalAuthorityIsCurrent !== undefined && !additionalAuthorityIsCurrent()) return false;
  if (!leased.ok) deps.reportError(AGENT_TASKS_SOURCE, leased.error);
  if (leased.ok && leased.value) return true;
  deps.setNotice(failure(LEASE_REFUSED_NOTICE));
  return false;
}

export function reportPreflight(deps: AdmissionDependencies, preflight: InPlacePreflight): boolean {
  switch (preflight.kind) {
    case "ok":
      return true;
    case "owner-lost":
    case "superseded":
      return false;
    case "status-failed":
      deps.reportError(AGENT_TASKS_SOURCE, preflight.error);
      deps.setNotice(
        warning(
          "The repository status could not be refreshed, so an in-place agent was not started.",
        ),
      );
      return false;
    case "unsafe":
      deps.setNotice(warning(`Running in place is unsafe: ${preflight.label}.`));
      return false;
    default:
      return unsupportedPreflight(preflight);
  }
}
export function usedTurnIds(state: AgentThreadsState): Iterable<string> {
  const ids: string[] = [];
  for (const thread of state.threads.values()) {
    for (const turn of thread.turns) ids.push(turn.turnId);
  }
  return ids;
}

export function mintUnusedId(
  deps: AdmissionDependencies,
  used: ReadonlySet<string>,
): string | null {
  const now = deps.now ?? Date.now;
  const entropy = deps.createEntropyHex4 ?? defaultEntropyHex4;
  for (let round = 0; round < 8; round += 1) {
    const id = mintAgentTaskId(now(), entropy());
    if (!used.has(id)) return id;
  }
  return null;
}

function defaultEntropyHex4(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function unsupportedPreflight(preflight: never): never {
  throw new TypeError(`Unsupported in-place preflight: ${JSON.stringify(preflight)}.`);
}

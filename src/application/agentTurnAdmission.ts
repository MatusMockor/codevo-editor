import { agentProjectOwnsLaunchRoot, type AgentProjectDescriptor } from "../domain/agentProject";
import {
  agentLaunchIsDangerous,
  agentLaunchMatchesProvider,
  type AgentLaunchOptions,
} from "../domain/agentLaunch";
import {
  MAX_AGENT_STEERS_PER_TURN,
  MAX_AGENT_TASK_PROMPT_BYTES,
  mintAgentTaskId,
  type AgentCliKind,
} from "../domain/agentTask";
import { MAX_AGENT_ATTACHMENT_PATH_BYTES } from "../domain/agentAttachment";
import {
  agentTurnAcceptsSteerBytes,
  runningTurn,
  steerCount,
  type AgentThread,
  type AgentThreadsState,
  type AgentTurn,
} from "../domain/agentThread";
import { isRemoteAgentIdentity } from "./remoteAgentSurface";
import { admitStoredAgentLaunch } from "../domain/agentStoredLaunch";
import { agentResumePlan, type AgentResumePlan } from "../domain/agentSessionIdentity";
import { normalizeAgentCliKind, normalizeMaxConcurrentAgentTasks } from "../domain/agentSettings";
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
  AgentSteerRequest,
  AgentTasksNotice,
  AgentThreadStartRequest,
  AgentThreadStoreSurface,
  AgentTurnAttachmentIntent,
  AgentTurnAttachmentRequest,
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
  readonly getAgentCliKind: () => AgentCliKind;
  readonly getAgentProviderAdmissionAuthority: AgentProviderAdmissionAuthorityReader;
  readonly getMaxConcurrentAgentTasks: () => number;
  readonly isWorktreeMissing: (threadId: string) => boolean;
  readonly ensureProjectLease?: (projectRootKey: string) => Promise<boolean>;
  readonly ensureProjectLaunchIdentity?: (
    projectRootKey: string,
  ) => Promise<AgentProjectLaunchIdentity | null>;
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
export const AGENT_THREAD_RUNNING_NOTICE =
  "This thread is still running. Wait for the turn to finish.";
export const AGENT_THREAD_NOT_RUNNING_NOTICE =
  "This turn already finished. Send the message as a new turn.";
export const AGENT_THREAD_STEER_LIMIT_NOTICE =
  "This turn already carries the maximum number of messages. Wait for it to finish.";
export const AGENT_THREAD_STEER_IN_FLIGHT_NOTICE =
  "This thread is already sending a message. Wait for it to arrive.";
export const AGENT_THREAD_PROJECT_CLOSED_NOTICE =
  "This thread's project is no longer open, so it cannot continue.";
export const AGENT_THREAD_TURN_FULL_NOTICE =
  "This turn is full. Wait for it to finish, then send your message.";
export const AGENT_THREAD_STARTING_NOTICE = "The agent is still starting. Try again in a moment.";
export const AGENT_THREAD_ARCHIVED_NOTICE =
  "This thread is archived. Unarchive it from the thread menu to continue.";
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
  if (project === undefined || !agentProjectOwnsLaunchRoot(project, request.repositoryRoot)) {
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
  const prompt = admitPrompt(deps, request.prompt, hasAttachments(request));
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
    agentCliKind,
    providerAuthority: providerAdmission,
    launch,
  };
}

export interface AdmittedFollowUp {
  readonly thread: AgentThread;
  readonly previousOwnerId: string;
  readonly authority: AgentTaskLaunchAuthority;
  readonly projectRoot: string;
  readonly prompt: string;
  readonly providerAuthority: ReadyAgentProviderAdmissionAuthority;
  readonly resumePlan: AgentResumePlan;
  readonly launch: AgentLaunchOptions;
}

export function admitFollowUp(
  deps: AdmissionDependencies,
  request: AgentFollowUpRequest,
  inFlightThreads: ReadonlySet<string>,
  resumePlanOf: (thread: AgentThread) => AgentResumePlan = (thread) =>
    agentResumePlan(thread.provider.sessionId, null),
): AdmittedFollowUp | null {
  const thread = deps.store.state.threads.get(request.threadId);
  if (thread === undefined) {
    deps.setNotice(warning("This thread is no longer available."));
    return null;
  }
  if (thread.archived) {
    deps.setNotice(warning(AGENT_THREAD_ARCHIVED_NOTICE));
    return null;
  }
  if (runningTurn(thread) !== null || inFlightThreads.has(thread.threadId)) {
    deps.setNotice(warning(AGENT_THREAD_RUNNING_NOTICE));
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
    project.rootKey !== thread.owner.rootKey ||
    project.origin === "closed-tab-live-tasks"
  ) {
    deps.setNotice(warning(AGENT_THREAD_PROJECT_CLOSED_NOTICE));
    return null;
  }
  const prompt = admitPrompt(deps, request.prompt, hasAttachments(request));
  if (prompt === null) return null;
  const launch = admitLaunch(deps, request, thread.provider.kind);
  if (launch === null) return null;
  const providerAdmission = admitCapacity(deps, thread.provider.kind);
  if (providerAdmission === null) return null;
  if (deps.isWorktreeMissing(thread.threadId)) {
    deps.setNotice(warning("The worktree for this thread no longer exists."));
    return null;
  }
  const reboundThread =
    thread.owner.ownerId === launchIdentity.workspaceId
      ? thread
      : {
          ...thread,
          owner: { ...thread.owner, ownerId: launchIdentity.workspaceId },
        };
  return {
    thread: reboundThread,
    previousOwnerId: thread.owner.ownerId,
    authority: taskLaunchAuthority(project, launchIdentity),
    projectRoot: project.rootPath,
    prompt,
    providerAuthority: providerAdmission,
    resumePlan: resumePlanOf(thread),
    launch,
  };
}

export interface AdmittedSteer {
  readonly thread: AgentThread;
  readonly turn: AgentTurn;
  readonly authority: AgentTaskLaunchAuthority;
  readonly prompt: string;
}

export function agentThreadIsSteerable(thread: AgentThread): boolean {
  if (isRemoteAgentIdentity(thread.threadId)) return false;
  if (thread.archived) return false;
  const turn = runningTurn(thread);
  if (turn === null) return false;
  return (
    turn.launch?.provider === "claudeCode" ||
    (turn.launch?.provider === "codex" && turn.codexTransport === "appServer")
  );
}

export function agentThreadAcceptsQueuedMessage(thread: AgentThread): boolean {
  return !thread.archived && runningTurn(thread)?.launch != null;
}

export function admitSteer(
  deps: AdmissionDependencies,
  request: AgentSteerRequest,
  inFlightThreads: ReadonlySet<string>,
): AdmittedSteer | null {
  const thread = deps.store.state.threads.get(request.threadId);
  if (thread === undefined) {
    deps.setNotice(warning("This thread is no longer available."));
    return null;
  }
  if (thread.archived) {
    deps.setNotice(warning(AGENT_THREAD_ARCHIVED_NOTICE));
    return null;
  }
  const turn = runningTurn(thread);
  if (turn === null) {
    deps.setNotice(warning(AGENT_THREAD_NOT_RUNNING_NOTICE));
    return null;
  }
  if (request.delivery !== "queued" && !agentThreadIsSteerable(thread)) {
    deps.setNotice(warning(AGENT_THREAD_RUNNING_NOTICE));
    return null;
  }
  if (inFlightThreads.has(thread.threadId)) {
    deps.setNotice(warning(AGENT_THREAD_STEER_IN_FLIGHT_NOTICE));
    return null;
  }
  if (request.delivery !== "queued" && turn.status.kind === "pending") {
    deps.setNotice(warning(AGENT_THREAD_STARTING_NOTICE));
    return null;
  }
  if (request.delivery !== "queued" && steerCount(turn) >= MAX_AGENT_STEERS_PER_TURN) {
    deps.setNotice(warning(AGENT_THREAD_STEER_LIMIT_NOTICE));
    return null;
  }
  const authority = steerAuthority(deps, thread);
  if (authority === null) {
    deps.setNotice(warning(AGENT_THREAD_PROJECT_CLOSED_NOTICE));
    return null;
  }
  const prompt = admitPrompt(deps, request.prompt, hasAttachments(request));
  if (prompt === null) return null;
  if (
    request.delivery !== "queued" &&
    !agentTurnAcceptsSteerBytes(turn, steerMessageByteBudget(prompt, request))
  ) {
    deps.setNotice(warning(AGENT_THREAD_TURN_FULL_NOTICE));
    return null;
  }
  return { thread, turn, authority, prompt };
}

function steerMessageByteBudget(prompt: string, request: AgentSteerRequest): number {
  return (request.attachments ?? []).reduce(
    (total, intent) => total + attachmentIntentByteBudget(intent),
    agentPromptByteLength(prompt),
  );
}

function attachmentIntentByteBudget(intent: AgentTurnAttachmentIntent): number {
  if (intent.kind === "reference") {
    return agentPromptByteLength(intent.name) + agentPromptByteLength(intent.path);
  }
  return agentPromptByteLength(intent.name) + MAX_AGENT_ATTACHMENT_PATH_BYTES;
}

function steerAuthority(
  deps: AdmissionDependencies,
  thread: AgentThread,
): AgentTaskLaunchAuthority | null {
  const project =
    projectByOwnerId(deps.projects, thread.owner.ownerId) ??
    projectByRootKey(deps.projects, thread.owner.rootKey);
  if (project === undefined) return null;
  if (project.rootKey !== thread.owner.rootKey) return null;
  if (project.origin === "closed-tab-live-tasks") return null;
  const launchIdentity = deps.launchIdentityForProject(project.rootKey);
  if (launchIdentity === null) return null;
  if (launchIdentity.workspaceId !== thread.owner.ownerId) return null;
  return taskLaunchAuthority(project, launchIdentity);
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
  if (!agentLaunchMatchesProvider(request.launch, provider)) {
    deps.setNotice(failure(LAUNCH_PROVIDER_MISMATCH_NOTICE));
    return null;
  }
  const confirmed = request.dangerousLaunchConfirmed === true;
  const admitted = admitStoredAgentLaunch(request.launch, confirmed);
  if (
    admitted.kind === "needsConfirmation" ||
    (agentLaunchIsDangerous(admitted.launch) && !confirmed)
  ) {
    deps.setNotice(warning(DANGEROUS_LAUNCH_UNCONFIRMED_NOTICE));
    return null;
  }
  return admitted.launch;
}

function hasAttachments(request: AgentTurnAttachmentRequest): boolean {
  return (request.attachments ?? []).length > 0;
}

function admitPrompt(deps: AdmissionDependencies, raw: string, allowEmpty: boolean): string | null {
  const prompt = raw.trim();
  if (prompt === "" && !allowEmpty) {
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
      warning(
        "The shared parallel thread limit is reached. Wait for a thread to finish or stop one.",
      ),
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
  return decision.authority;
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
  deps: Pick<AdmissionDependencies, "now" | "createEntropyHex4">,
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

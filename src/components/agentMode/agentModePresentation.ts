import type {
  AgentProjectDescriptor,
  AgentProjectOrigin,
  AgentProjectTrust,
} from "../../domain/agentProject";
import type {
  AgentCliKind,
  AgentIsolationDefault,
  AgentTaskIsolation,
  AgentTaskOutputStream,
  InPlaceDispatchUnsafeReason,
} from "../../domain/agentTask";
import {
  UNTITLED_AGENT_THREAD_TITLE,
  runningTurn,
  type AgentThread,
  type AgentThreadAttention,
  type AgentThreadLifecycle,
  type AgentTurn,
  type AgentTurnEvent,
  type AgentTurnStatus,
} from "../../domain/agentThread";
import {
  MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES,
  agentShipStatus,
  type AgentShipAvailability,
  type AgentShipFailure,
  type AgentShipIntegrationMode,
  type AgentShipState,
} from "../../domain/agentShip";
import type { GitChangeStatus, GitChangedFile, GitFileDiff } from "../../domain/git";
import type { GitShipStatus } from "../../domain/gitIntegration";
import { gitRepositoryDisplayName } from "../../domain/gitRepositoryMapping";
import { localHistoryRelativeTime } from "../../domain/localHistory";
import { detectLanguage } from "../../domain/workspace";
import type {
  AgentTaskChangeSummary,
  AgentTaskFileDiff,
  AgentThreadView,
  OrphanedWorktreeView,
} from "../../application/agentThreadPorts";

export const MAX_RENDERED_EVENTS_PER_TURN = 200;

export const DETACHED_AGENT_PROJECT_ROOT_KEY = "agent-project:detached";
export const DETACHED_AGENT_PROJECT_LABEL = "Removed projects";

export type AgentThreadTone = "running" | "queued" | "done" | "failed" | "stopped" | "archived";

export type AgentProjectGroupKind = "project" | "detached";

export interface AgentRepositoryGroup {
  readonly repositoryRoot: string;
  readonly label: string;
  readonly repositoryResolved: boolean;
  readonly threads: ReadonlyArray<AgentThreadView>;
  readonly archived: ReadonlyArray<AgentThreadView>;
  readonly orphans: ReadonlyArray<OrphanedWorktreeView>;
  readonly liveCount: number;
}

export interface AgentProjectGroup {
  readonly projectRootKey: string;
  readonly kind: AgentProjectGroupKind;
  readonly label: string;
  readonly rootPath: string | null;
  readonly trust: AgentProjectTrust;
  readonly origin: AgentProjectOrigin;
  readonly singleRepo: boolean;
  readonly repos: ReadonlyArray<AgentRepositoryGroup>;
  readonly liveCount: number;
}

export interface AgentToolOutcome {
  readonly outputSummary: string;
  readonly isError: boolean;
}

export interface AgentSubagentSummary {
  readonly total: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
}

export type AgentTurnItem =
  | {
      readonly kind: "assistantText";
      readonly key: string;
      readonly paragraphs: ReadonlyArray<string>;
    }
  | { readonly kind: "reasoning"; readonly key: string; readonly text: string }
  | {
      readonly kind: "tool";
      readonly key: string;
      readonly name: string;
      readonly inputSummary: string;
      readonly outcome: AgentToolOutcome | null;
    }
  | {
      readonly kind: "result";
      readonly key: string;
      readonly text: string;
      readonly isError: boolean;
    }
  | { readonly kind: "error"; readonly key: string; readonly message: string };

export interface AgentRawLine {
  readonly key: string;
  readonly stream: AgentTaskOutputStream;
  readonly raw: string;
}

export interface AgentTurnProjection {
  readonly items: ReadonlyArray<AgentTurnItem>;
  readonly rawLines: ReadonlyArray<AgentRawLine>;
  readonly hiddenCount: number;
}

const UTF8_ENCODER = new TextEncoder();
const PARAGRAPH_SEPARATOR = /\n{2,}/;

export function agentPromptByteLength(prompt: string): number {
  return UTF8_ENCODER.encode(prompt).byteLength;
}

export function agentThreadLifecycleLabel(lifecycle: AgentThreadLifecycle): string {
  switch (lifecycle) {
    case "running":
      return "Running";
    case "settled":
      return "Idle";
    case "archived":
      return "Archived";
    default:
      return unsupportedLifecycle(lifecycle);
  }
}

export function agentTurnStatusLabel(status: AgentTurnStatus): string {
  switch (status.kind) {
    case "pending":
      return "Queued";
    case "running":
      return "Running";
    case "exited":
      return status.exitCode === 0 ? "Finished" : `Exited ${status.exitCode}`;
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "interrupted":
      return "Interrupted";
    default:
      return unsupportedTurnStatus(status);
  }
}

export function agentThreadTone(
  lifecycle: AgentThreadLifecycle,
  lastTurnStatus: AgentTurnStatus | null,
): AgentThreadTone {
  if (lifecycle === "archived") return "archived";
  if (lastTurnStatus === null) return "queued";
  if (lifecycle === "running") return lastTurnStatus.kind === "pending" ? "queued" : "running";
  return settledTone(lastTurnStatus);
}

function settledTone(status: AgentTurnStatus): AgentThreadTone {
  switch (status.kind) {
    case "pending":
      return "queued";
    case "running":
      return "running";
    case "exited":
      return status.exitCode === 0 ? "done" : "failed";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    case "interrupted":
      return "stopped";
    default:
      return unsupportedTurnStatus(status);
  }
}

export function lastAgentTurn(thread: AgentThread): AgentTurn | null {
  return thread.turns[thread.turns.length - 1] ?? null;
}

export function lastAgentTurnStatus(thread: AgentThread): AgentTurnStatus | null {
  return lastAgentTurn(thread)?.status ?? null;
}

export function agentThreadDisplayTitle(thread: AgentThread): string {
  const title = thread.title.trim();
  if (title === "") return UNTITLED_AGENT_THREAD_TITLE;
  return title;
}

export function agentRunningTurnCount(thread: AgentThread): number {
  return runningTurn(thread) === null ? 0 : 1;
}

export interface AgentFollowUpContext {
  readonly agentCliKind: AgentCliKind;
  readonly agentCliConfigured: boolean;
  readonly liveTaskCount: number;
  readonly maxConcurrentAgentTasks: number;
}

export function agentCliKindLabel(kind: AgentCliKind): string {
  switch (kind) {
    case "claudeCode":
      return "Claude Code";
    case "codex":
      return "Codex";
    default:
      return unsupportedCliKind(kind);
  }
}

export function agentFollowUpBlockedReason(
  view: AgentThreadView,
  context: AgentFollowUpContext,
): string | null {
  if (view.thread.archived) {
    return "This thread is archived. Start a new thread to continue.";
  }
  if (view.worktreeMissing) {
    return "The worktree for this thread no longer exists.";
  }
  if (view.lifecycle === "running") {
    return "This thread is still running. Wait for the turn to finish.";
  }
  if (view.projectOrigin === "closed-tab-live-tasks") {
    return "This thread's project is being released, so it cannot continue.";
  }
  if (view.thread.provider.kind !== context.agentCliKind) {
    return `This thread was started with ${agentCliKindLabel(view.thread.provider.kind)}; start a new thread.`;
  }
  if (view.thread.provider.sessionId === null) {
    return "This thread has no resumable session; start a new thread.";
  }
  if (!context.agentCliConfigured) {
    return "No agent CLI is configured. Set the agent CLI path in settings.";
  }
  if (context.liveTaskCount >= context.maxConcurrentAgentTasks) {
    return "The concurrent agent limit is reached. Stop a running agent or raise the limit.";
  }
  return null;
}

export function agentTurnProjection(events: ReadonlyArray<AgentTurnEvent>): AgentTurnProjection {
  const hiddenCount = Math.max(0, events.length - MAX_RENDERED_EVENTS_PER_TURN);
  const calls = toolCallIndex(events);
  const visibleAssistantText = new Set(
    events
      .slice(hiddenCount)
      .filter(
        (event): event is Extract<AgentTurnEvent, { kind: "assistantText" }> =>
          event.kind === "assistantText",
      )
      .map((event) => normalizedAgentResponse(event.text)),
  );
  const items: AgentTurnItem[] = [];
  const rawLines: AgentRawLine[] = [];
  const toolItemByToolId = new Map<string, number>();

  for (let offset = hiddenCount; offset < events.length; offset += 1) {
    const event = events[offset];
    if (event === undefined) continue;
    if (
      event.kind === "result" &&
      !event.isError &&
      visibleAssistantText.has(normalizedAgentResponse(event.text))
    ) {
      continue;
    }
    const key = `e${offset}`;
    appendTurnItem({ calls, event, items, key, rawLines, toolItemByToolId });
  }

  return { items, rawLines, hiddenCount };
}

function normalizedAgentResponse(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function agentTurnSubagentSummary(
  events: ReadonlyArray<AgentTurnEvent>,
): AgentSubagentSummary | null {
  const results = new Map<string, boolean>();
  for (const event of events) {
    if (event.kind === "toolResult" && !results.has(event.toolId)) {
      results.set(event.toolId, event.isError);
    }
  }

  const seen = new Set<string>();
  let running = 0;
  let completed = 0;
  let failed = 0;
  for (const event of events) {
    if (event.kind !== "toolCall" || !isSubagentSpawnTool(event.name) || seen.has(event.toolId)) {
      continue;
    }
    seen.add(event.toolId);
    const result = results.get(event.toolId);
    if (result === undefined) running += 1;
    else if (result) failed += 1;
    else completed += 1;
  }

  const total = running + completed + failed;
  return total === 0 ? null : { total, running, completed, failed };
}

function isSubagentSpawnTool(name: string): boolean {
  return name === "Task" || name === "Agent" || name === "SpawnAgent" || name === "spawn_agent";
}

interface TurnItemAppend {
  readonly calls: ReadonlyMap<string, AgentToolCallSummary>;
  readonly event: AgentTurnEvent;
  readonly items: AgentTurnItem[];
  readonly key: string;
  readonly rawLines: AgentRawLine[];
  readonly toolItemByToolId: Map<string, number>;
}

function appendTurnItem({
  calls,
  event,
  items,
  key,
  rawLines,
  toolItemByToolId,
}: TurnItemAppend): void {
  if (event.kind === "assistantText") {
    items.push({ kind: "assistantText", key, paragraphs: paragraphsOf(event.text) });
    return;
  }
  if (event.kind === "reasoning") {
    items.push({ kind: "reasoning", key, text: event.text });
    return;
  }
  if (event.kind === "toolCall") {
    toolItemByToolId.set(event.toolId, items.length);
    items.push({
      kind: "tool",
      key,
      name: event.name,
      inputSummary: event.inputSummary,
      outcome: null,
    });
    return;
  }
  if (event.kind === "toolResult") {
    attachToolResult({ calls, event, items, key, toolItemByToolId });
    return;
  }
  if (event.kind === "result") {
    items.push({ kind: "result", key, text: event.text, isError: event.isError });
    return;
  }
  if (event.kind === "error") {
    items.push({ kind: "error", key, message: event.message });
    return;
  }
  rawLines.push({ key, stream: event.stream, raw: event.raw });
}

interface ToolResultAttach {
  readonly calls: ReadonlyMap<string, AgentToolCallSummary>;
  readonly event: Extract<AgentTurnEvent, { kind: "toolResult" }>;
  readonly items: AgentTurnItem[];
  readonly key: string;
  readonly toolItemByToolId: Map<string, number>;
}

function attachToolResult({ calls, event, items, key, toolItemByToolId }: ToolResultAttach): void {
  const outcome: AgentToolOutcome = {
    outputSummary: event.outputSummary,
    isError: event.isError,
  };
  const index = toolItemByToolId.get(event.toolId);
  const pending = index === undefined ? undefined : items[index];
  if (index !== undefined && pending !== undefined && pending.kind === "tool") {
    items[index] = { ...pending, outcome };
    toolItemByToolId.delete(event.toolId);
    return;
  }
  const call = calls.get(event.toolId);
  items.push({
    kind: "tool",
    key,
    name: call?.name ?? "tool",
    inputSummary: call?.inputSummary ?? "",
    outcome,
  });
}

interface AgentToolCallSummary {
  readonly name: string;
  readonly inputSummary: string;
}

function toolCallIndex(
  events: ReadonlyArray<AgentTurnEvent>,
): ReadonlyMap<string, AgentToolCallSummary> {
  const calls = new Map<string, AgentToolCallSummary>();
  for (const event of events) {
    if (event.kind !== "toolCall") continue;
    if (calls.has(event.toolId)) continue;
    calls.set(event.toolId, { name: event.name, inputSummary: event.inputSummary });
  }
  return calls;
}

function paragraphsOf(text: string): ReadonlyArray<string> {
  const paragraphs = text
    .split(PARAGRAPH_SEPARATOR)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  if (paragraphs.length === 0) return [];
  return paragraphs;
}

export function agentThreadTimeLabel(startedAtEpochMs: number, now: number): string {
  return localHistoryRelativeTime(startedAtEpochMs, now);
}

export function agentIsolationBadgeLabel(isolation: AgentTaskIsolation): string {
  switch (isolation) {
    case "worktree":
      return "Worktree";
    case "in-place":
      return "In place";
    default:
      return unsupportedIsolation(isolation);
  }
}

export function agentIsolationBadgeReason(isolation: AgentTaskIsolation): string {
  switch (isolation) {
    case "worktree":
      return "The agent works in a dedicated Git worktree, so your checkout stays untouched.";
    case "in-place":
      return "The agent works directly in your checkout of this repository.";
    default:
      return unsupportedIsolation(isolation);
  }
}

export function inPlaceGuardReasonLabel(reason: InPlaceDispatchUnsafeReason): string {
  switch (reason) {
    case "agent-active":
      return "another agent is already running in this repository";
    case "dirty-tree":
      return "the working tree has uncommitted changes";
    case "dirty-editors":
      return "unsaved editors belong to this repository";
    case "status-unknown":
      return "the repository status is unknown";
    default:
      return unsupportedGuardReason(reason);
  }
}

export function agentIsolationReasonLabel(recommended: AgentIsolationDefault): string {
  if (recommended.kind === "in-place") {
    return "The repository is clean, so the agent can work directly in it.";
  }
  switch (recommended.reason) {
    case "policy":
      return "Agents start in an isolated worktree by default.";
    case "agent-active":
      return "Another agent is already running in this repository.";
    case "parallel-dispatch":
      return "Several agents are being started at once.";
    case "status-unknown":
      return "The repository status is unknown.";
    case "dirty-tree":
      return "The working tree has uncommitted changes.";
    case "dirty-editors":
      return "This repository has unsaved editors.";
    default:
      return unsupportedIsolationReason(recommended.reason);
  }
}

export function agentChangeStatusLetter(status: GitChangeStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "conflicted":
      return "C";
    case "deleted":
      return "D";
    case "modified":
      return "M";
    case "renamed":
      return "R";
    case "untracked":
      return "U";
    default:
      return unsupportedChangeStatus(status);
  }
}

export function agentProjectTrustNotice(trust: AgentProjectTrust): string | null {
  switch (trust) {
    case "trusted":
      return null;
    case "untrusted":
      return "This project is not trusted, so agents cannot start here.";
    case "unknown":
      return "This project's trust could not be read, so agents cannot start here.";
    default:
      return unsupportedTrust(trust);
  }
}

export function agentProjectWorktreeOnly(origin: AgentProjectOrigin): boolean {
  switch (origin) {
    case "active-tab":
      return false;
    case "background-tab":
      return true;
    case "closed-tab-live-tasks":
      return true;
    default:
      return unsupportedOrigin(origin);
  }
}

export function agentProjectWorktreeOnlyReason(origin: AgentProjectOrigin): string | null {
  switch (origin) {
    case "active-tab":
      return null;
    case "background-tab":
      return "This project is not the active tab, so the agent only runs in an isolated worktree.";
    case "closed-tab-live-tasks":
      return "This project's tab is closed, so the agent only runs in an isolated worktree.";
    default:
      return unsupportedOrigin(origin);
  }
}

export function agentProjectGroups(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  threads: ReadonlyArray<AgentThreadView>,
  orphans: ReadonlyArray<OrphanedWorktreeView>,
): ReadonlyArray<AgentProjectGroup> {
  const threadsByOwner = indexThreadsByOwner(threads);
  const orphansByRepository = indexOrphansByRepository(orphans);
  const claimedRepositoryRoots = new Set<string>();
  const claimedProjectRootKeys = new Set<string>();
  const claimedOwnerIds = new Set<string>();
  const knownOwnerIds = new Set(projects.map((project) => project.ownerId));
  const groups: AgentProjectGroup[] = [];

  for (const project of projects) {
    if (claimedProjectRootKeys.has(project.rootKey)) {
      continue;
    }
    claimedProjectRootKeys.add(project.rootKey);
    const ownsThreads = !claimedOwnerIds.has(project.ownerId);
    claimedOwnerIds.add(project.ownerId);
    const projectThreads = ownsThreads ? (threadsByOwner.get(project.ownerId) ?? []) : [];
    groups.push(
      buildProjectGroup(project, projectThreads, orphansByRepository, claimedRepositoryRoots),
    );
  }

  const detachedThreadsByRepository = indexDetachedThreadsByRepository(threads, knownOwnerIds);
  const detachedRoots = new Set(detachedThreadsByRepository.keys());
  for (const repositoryRoot of orphansByRepository.keys()) {
    if (claimedRepositoryRoots.has(repositoryRoot)) continue;
    detachedRoots.add(repositoryRoot);
  }
  const orderedDetachedRoots = [...detachedRoots].sort();

  if (orderedDetachedRoots.length === 0) {
    return groups;
  }

  const detachedRepos = orderedDetachedRoots.map((root) =>
    buildGroup(
      root,
      root,
      detachedThreadsByRepository.get(root) ?? [],
      claimedRepositoryRoots.has(root) ? [] : (orphansByRepository.get(root) ?? []),
      false,
    ),
  );

  return [
    ...groups,
    {
      projectRootKey: DETACHED_AGENT_PROJECT_ROOT_KEY,
      kind: "detached",
      label: DETACHED_AGENT_PROJECT_LABEL,
      rootPath: null,
      trust: "unknown",
      origin: "closed-tab-live-tasks",
      singleRepo: false,
      repos: detachedRepos,
      liveCount: totalLiveCount(detachedRepos),
    },
  ];
}

function buildProjectGroup(
  project: AgentProjectDescriptor,
  projectThreads: ReadonlyArray<AgentThreadView>,
  orphansByRepository: ReadonlyMap<string, ReadonlyArray<OrphanedWorktreeView>>,
  claimedRepositoryRoots: Set<string>,
): AgentProjectGroup {
  const repositories = project.repositories.filter(
    (repository) => !claimedRepositoryRoots.has(repository.repositoryRoot),
  );
  for (const repository of repositories) {
    claimedRepositoryRoots.add(repository.repositoryRoot);
  }

  const ownedRoots = new Set(repositories.map((repository) => repository.repositoryRoot));
  const projectThreadsByRepository = indexThreadsByRepository(projectThreads);
  const repos = repositories.map((repository) =>
    buildGroup(
      repository.repositoryRoot,
      gitRepositoryDisplayName(repository.mapping.rootRelativePath, project.rootPath),
      projectThreadsByRepository.get(repository.repositoryRoot) ?? [],
      orphansByRepository.get(repository.repositoryRoot) ?? [],
      true,
    ),
  );

  const strayRoots = [
    ...new Set([...projectThreadsByRepository.keys()].filter((root) => !ownedRoots.has(root))),
  ].sort();
  const strayRepos = strayRoots.map((root) =>
    buildGroup(
      root,
      strayRepositoryLabel(root, project.rootPath),
      projectThreadsByRepository.get(root) ?? [],
      [],
      false,
    ),
  );

  const repoGroups = [...repos, ...strayRepos];
  return {
    projectRootKey: project.rootKey,
    kind: "project",
    label: project.label,
    rootPath: project.rootPath,
    trust: project.trust,
    origin: project.origin,
    singleRepo:
      strayRepos.length === 0 &&
      repositories.length === 1 &&
      repositories[0]?.mapping.rootRelativePath === "",
    repos: repoGroups,
    liveCount: totalLiveCount(repoGroups),
  };
}

function indexThreadsByOwner(
  threads: ReadonlyArray<AgentThreadView>,
): ReadonlyMap<string, ReadonlyArray<AgentThreadView>> {
  return immutableArrayIndex(threads, (view) => view.thread.owner.ownerId);
}

function indexThreadsByRepository(
  threads: ReadonlyArray<AgentThreadView>,
): ReadonlyMap<string, ReadonlyArray<AgentThreadView>> {
  return immutableArrayIndex(threads, (view) => view.thread.owner.repositoryRoot);
}

function indexOrphansByRepository(
  orphans: ReadonlyArray<OrphanedWorktreeView>,
): ReadonlyMap<string, ReadonlyArray<OrphanedWorktreeView>> {
  return immutableArrayIndex(orphans, (orphan) => orphan.repositoryRoot);
}

function indexDetachedThreadsByRepository(
  threads: ReadonlyArray<AgentThreadView>,
  knownOwnerIds: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlyArray<AgentThreadView>> {
  const detached: AgentThreadView[] = [];
  for (const view of threads) {
    if (knownOwnerIds.has(view.thread.owner.ownerId)) continue;
    detached.push(view);
  }
  return indexThreadsByRepository(detached);
}

function immutableArrayIndex<TValue>(
  values: ReadonlyArray<TValue>,
  keyOf: (value: TValue) => string,
): ReadonlyMap<string, ReadonlyArray<TValue>> {
  const mutable = new Map<string, TValue[]>();
  for (const value of values) {
    const key = keyOf(value);
    const indexed = mutable.get(key);
    if (indexed !== undefined) {
      indexed.push(value);
      continue;
    }
    mutable.set(key, [value]);
  }
  return new Map([...mutable].map(([key, indexed]) => [key, Object.freeze(indexed)]));
}

function strayRepositoryLabel(repositoryRoot: string, projectRootPath: string): string {
  if (repositoryRoot === projectRootPath) {
    return gitRepositoryDisplayName("", projectRootPath);
  }
  if (repositoryRoot.startsWith(`${projectRootPath}/`)) {
    return repositoryRoot.slice(projectRootPath.length + 1);
  }
  return repositoryRoot;
}

function totalLiveCount(repos: ReadonlyArray<AgentRepositoryGroup>): number {
  return repos.reduce((total, repo) => total + repo.liveCount, 0);
}

function buildGroup(
  repositoryRoot: string,
  label: string,
  threads: ReadonlyArray<AgentThreadView>,
  orphans: ReadonlyArray<OrphanedWorktreeView>,
  repositoryResolved: boolean,
): AgentRepositoryGroup {
  const active = orderAgentThreadRows(threads.filter((view) => view.lifecycle !== "archived"));
  const archived = threads.filter((view) => view.lifecycle === "archived");

  return {
    repositoryRoot,
    label,
    repositoryResolved,
    threads: active,
    archived,
    orphans,
    liveCount: active.filter((view) => view.lifecycle === "running").length,
  };
}

const ATTENTION_BAND_ORDER: Readonly<Record<AgentThreadAttention, number>> = {
  running: 0,
  attention: 1,
  settled: 2,
  archived: 3,
};

export function orderAgentThreadRows(
  threads: ReadonlyArray<AgentThreadView>,
): ReadonlyArray<AgentThreadView> {
  return [...threads].sort(compareAgentThreadRows);
}

function compareAgentThreadRows(left: AgentThreadView, right: AgentThreadView): number {
  const band = ATTENTION_BAND_ORDER[left.attention] - ATTENTION_BAND_ORDER[right.attention];
  if (band !== 0) return band;
  const pin = pinRank(left) - pinRank(right);
  if (pin !== 0) return pin;
  const recency = right.thread.updatedAtEpochMs - left.thread.updatedAtEpochMs;
  if (recency !== 0) return recency;
  return compareThreadIds(left.thread.threadId, right.thread.threadId);
}

function compareThreadIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function pinRank(view: AgentThreadView): number {
  return view.thread.pinned ? 0 : 1;
}

export function agentAttentionCount(threads: ReadonlyArray<AgentThreadView>): number {
  return threads.filter((view) => view.attention === "attention").length;
}

export function formatAgentPromptBytes(value: number): string {
  return value.toLocaleString("en-US").replace(/,/g, "\u202f");
}

export const MAX_RENDERED_SHIP_CONFLICT_FILES = 12;

export const AGENT_SHIP_BLOCKED_RUNNING = "Stop the agent first.";
export const AGENT_SHIP_BLOCKED_NO_WORKTREE = "The worktree no longer exists.";
export const AGENT_SHIP_BLOCKED_NOTHING_TO_COMMIT = "Nothing to commit.";
export const AGENT_SHIP_BLOCKED_COMMIT_FIRST = "Commit before pushing.";
export const AGENT_SHIP_BLOCKED_NO_REMOTE = "No remote is configured for this repository.";
export const AGENT_SHIP_BLOCKED_PRIMARY_DIRTY = "The main checkout has uncommitted changes.";
export const AGENT_SHIP_BLOCKED_PRIMARY_DETACHED = "The main checkout is detached.";
export const AGENT_SHIP_BLOCKED_NOT_FAST_FORWARDABLE =
  "The branch is behind the main checkout; use Merge instead of Fast-forward.";
export const AGENT_SHIP_BLOCKED_IN_PLACE = "In-place threads have nothing to integrate.";
export const AGENT_SHIP_BLOCKED_IN_PLACE_WORKTREE = "In-place threads have no worktree to remove.";
export const AGENT_SHIP_BLOCKED_DELETE_BRANCH = "Integrate the branch before deleting it.";
export const AGENT_SHIP_BLOCKED_NOTHING_TO_INTEGRATE = "The branch has no commits to integrate.";
export const AGENT_SHIP_BLOCKED_EMPTY_MESSAGE = "Write a commit message first.";
export const AGENT_SHIP_BLOCKED_LONG_MESSAGE = "The commit message is too long.";
export const AGENT_SHIP_AUTHORITY_LOST =
  "The project changed while the step was running, so nothing was published.";

const AVAILABLE: AgentShipAvailability = { kind: "available" };

export interface AgentShipAvailabilityMap {
  readonly commit: AgentShipAvailability;
  readonly push: AgentShipAvailability;
  readonly fastForward: AgentShipAvailability;
  readonly merge: AgentShipAvailability;
  readonly removeWorktree: AgentShipAvailability;
  readonly deleteBranch: AgentShipAvailability;
}

export function agentShipStepLabel(state: AgentShipState): string | null {
  switch (state.kind) {
    case "idle":
      return state.loadingStatus ? "Reading the branch status…" : null;
    case "committing":
      return "Committing the worktree changes…";
    case "pushing":
      return "Pushing the branch…";
    case "integrating":
      return state.mode === "fastForward"
        ? "Fast-forwarding the main checkout…"
        : "Merging into the main checkout…";
    case "removingWorktree":
      return state.deleteBranch
        ? "Removing the worktree and its branch…"
        : "Removing the worktree…";
    default:
      return null;
  }
}

export function agentShipFailureLabel(failure: AgentShipFailure): string {
  if (isAuthorityLostFailure(failure)) return AGENT_SHIP_AUTHORITY_LOST;
  switch (failure.step) {
    case "commit":
      return failure.reason === "nothingToCommit"
        ? AGENT_SHIP_BLOCKED_NOTHING_TO_COMMIT
        : failure.message;
    case "push":
      return agentShipPushFailureLabel(failure.reason, failure.message);
    case "integrate":
      return agentShipIntegrateFailureLabel(failure);
    case "removeWorktree":
      return failure.reason === "branchNotMerged"
        ? "The branch was not merged, so it was kept."
        : failure.message;
    default:
      return unsupportedShipFailureStep(failure);
  }
}

export function agentShipFailureStepLabel(failure: AgentShipFailure): string {
  switch (failure.step) {
    case "commit":
      return "commit failed";
    case "push":
      return "push failed";
    case "integrate":
      return "integration failed";
    case "removeWorktree":
      return "cleanup failed";
    default:
      return unsupportedShipFailureStep(failure);
  }
}

export function agentShipRetryLabel(failure: AgentShipFailure): string {
  switch (failure.step) {
    case "commit":
      return "Retry commit";
    case "push":
      return "Retry push";
    case "integrate":
      return "Retry integrate";
    case "removeWorktree":
      return "Retry removal";
    default:
      return unsupportedShipFailureStep(failure);
  }
}

export const AGENT_SHIP_ABORT_FAILED_GUIDANCE =
  "Resolve the merge in the Git panel, then refresh the branch status.";
export const AGENT_SHIP_BRANCH_KEPT_GUIDANCE =
  "The worktree is already removed. Delete the branch in the Git panel if you no longer need it.";

export interface AgentShipFailureActions {
  readonly retryLabel: string | null;
  readonly guidance: string | null;
}

export function agentShipFailureActions(failure: AgentShipFailure): AgentShipFailureActions {
  if (isAbortFailedIntegration(failure)) {
    return { retryLabel: null, guidance: AGENT_SHIP_ABORT_FAILED_GUIDANCE };
  }
  if (isBranchKeptRemoval(failure)) {
    return { retryLabel: null, guidance: AGENT_SHIP_BRANCH_KEPT_GUIDANCE };
  }
  return { retryLabel: agentShipRetryLabel(failure), guidance: null };
}

function isAbortFailedIntegration(failure: AgentShipFailure): boolean {
  if (failure.step !== "integrate") return false;
  if (!("outcome" in failure)) return false;
  return failure.outcome.kind === "abortFailed";
}

function isBranchKeptRemoval(failure: AgentShipFailure): boolean {
  if (failure.step !== "removeWorktree") return false;
  if (!("reason" in failure)) return false;
  return failure.reason === "branchNotMerged";
}

export interface AgentShipConflictProjection {
  readonly files: ReadonlyArray<string>;
  readonly hiddenCount: number;
  readonly truncated: boolean;
}

const NO_CONFLICTS: AgentShipConflictProjection = {
  files: [],
  hiddenCount: 0,
  truncated: false,
};

export function agentShipConflictFiles(failure: AgentShipFailure): AgentShipConflictProjection {
  if (isAuthorityLostFailure(failure) || failure.step !== "integrate") return NO_CONFLICTS;
  if (!("outcome" in failure)) return NO_CONFLICTS;
  if (failure.outcome.kind !== "conflicted") return NO_CONFLICTS;
  const all = failure.outcome.files;
  const files = all.slice(0, MAX_RENDERED_SHIP_CONFLICT_FILES);
  return { files, hiddenCount: all.length - files.length, truncated: failure.outcome.truncated };
}

export function compareHostLabel(url: string): string | null {
  const host = compareUrlHost(url);
  switch (host) {
    case "github.com":
      return "GitHub";
    case "gitlab.com":
      return "GitLab";
    case "bitbucket.org":
      return "Bitbucket";
    default:
      return null;
  }
}

export function agentShipBranchLabel(state: AgentShipState): string | null {
  const status = agentShipStatus(state);
  if (status !== null) return status.worktree.branch;
  if (state.kind === "pushed") return state.receipt.branch;
  return null;
}

export function agentShipRelationLabel(status: GitShipStatus): string {
  const primary = status.primary.branch ?? "detached HEAD";
  return `${status.relation.aheadOfPrimary} ahead · ${status.relation.behindPrimary} behind ${primary}`;
}

export function agentShipRemoteLabel(status: GitShipStatus): string {
  if (status.remote === null) return "No remote";
  const upstream = status.remote.upstream;
  if (upstream === null) return `${status.remote.name} · no upstream`;
  return `${status.remote.name} · ${upstream.ahead} ahead · ${upstream.behind} behind`;
}

export function agentWorktreeRemovalLabel(view: AgentThreadView): string | null {
  const removedState = view.ship.kind === "worktreeRemoved" ? view.ship : null;
  const branchDeleted = removedState?.branchDeleted ?? view.thread.integration?.branchDeleted;
  if (!view.worktreeRemoved && removedState === null && branchDeleted !== true) return null;
  if (branchDeleted !== true) return "The worktree was removed. Its local branch was kept.";
  if (view.thread.integration?.pushed === null || view.thread.integration === null) {
    return "The worktree and its local branch were removed.";
  }
  return "The worktree and its local branch were removed. The remote branch was kept.";
}

export function agentShipDefaultCommitMessage(thread: AgentThread): string {
  return truncateUtf8(agentThreadDisplayTitle(thread), MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES);
}

export function agentShipDefaultIntegrationMode(
  status: GitShipStatus | null,
): AgentShipIntegrationMode {
  if (status === null) return "merge";
  return status.relation.fastForwardable ? "fastForward" : "merge";
}

export function agentShipCommitMessageAvailability(message: string): AgentShipAvailability {
  if (message.trim() === "") return blocked(AGENT_SHIP_BLOCKED_EMPTY_MESSAGE);
  if (agentPromptByteLength(message) > MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES) {
    return blocked(AGENT_SHIP_BLOCKED_LONG_MESSAGE);
  }
  return AVAILABLE;
}

export function agentShipAvailability(view: AgentThreadView): AgentShipAvailabilityMap {
  const gate = agentShipGate(view);
  const worktree = view.thread.target.isolation === "worktree";
  const status = agentShipStatus(view.ship);
  return {
    commit: gate ?? commitAvailability(status),
    push: gate ?? pushAvailability(status),
    fastForward: gate ?? integrateAvailability(worktree, status, "fastForward"),
    merge: gate ?? integrateAvailability(worktree, status, "merge"),
    removeWorktree: gate ?? (worktree ? AVAILABLE : blocked(AGENT_SHIP_BLOCKED_IN_PLACE_WORKTREE)),
    deleteBranch:
      view.ship.kind === "integrated" ? AVAILABLE : blocked(AGENT_SHIP_BLOCKED_DELETE_BRANCH),
  };
}

export function agentShipStatusUnread(view: AgentThreadView): boolean {
  if (view.lifecycle !== "settled") return false;
  if (view.thread.target.isolation !== "worktree") return false;
  if (view.worktreeMissing || view.worktreeRemoved) return false;
  if (view.ship.kind === "worktreeRemoved") return false;
  return agentShipStatus(view.ship) === null;
}

export function agentChangeOpenAvailability(
  view: AgentThreadView,
  change: GitChangedFile,
): AgentShipAvailability {
  if (change.status === "deleted") return blocked("This file was deleted in the worktree.");
  return view.editorAvailability;
}

function agentShipGate(view: AgentThreadView): AgentShipAvailability | null {
  if (view.lifecycle === "running") return blocked(AGENT_SHIP_BLOCKED_RUNNING);
  const gone = view.worktreeMissing || view.worktreeRemoved || view.ship.kind === "worktreeRemoved";
  if (gone) return blocked(AGENT_SHIP_BLOCKED_NO_WORKTREE);
  const busyLabel = agentShipStepLabel(view.ship);
  if (busyLabel !== null) return blocked(busyLabel);
  return null;
}

function commitAvailability(status: GitShipStatus | null): AgentShipAvailability {
  if (status === null) return AVAILABLE;
  if (status.worktree.dirty) return AVAILABLE;
  return blocked(AGENT_SHIP_BLOCKED_NOTHING_TO_COMMIT);
}

function pushAvailability(status: GitShipStatus | null): AgentShipAvailability {
  if (status === null) return AVAILABLE;
  if (status.remote === null) return blocked(AGENT_SHIP_BLOCKED_NO_REMOTE);
  if (status.relation.aheadOfPrimary === 0 && status.worktree.dirty) {
    return blocked(AGENT_SHIP_BLOCKED_COMMIT_FIRST);
  }
  return AVAILABLE;
}

function integrateAvailability(
  worktree: boolean,
  status: GitShipStatus | null,
  mode: AgentShipIntegrationMode,
): AgentShipAvailability {
  if (!worktree) return blocked(AGENT_SHIP_BLOCKED_IN_PLACE);
  if (status === null) return AVAILABLE;
  if (status.primary.branch === null) return blocked(AGENT_SHIP_BLOCKED_PRIMARY_DETACHED);
  if (status.primary.dirty) return blocked(AGENT_SHIP_BLOCKED_PRIMARY_DIRTY);
  if (status.relation.aheadOfPrimary === 0) {
    return blocked(AGENT_SHIP_BLOCKED_NOTHING_TO_INTEGRATE);
  }
  if (mode === "fastForward" && !status.relation.fastForwardable) {
    return blocked(AGENT_SHIP_BLOCKED_NOT_FAST_FORWARDABLE);
  }
  return AVAILABLE;
}

function agentShipPushFailureLabel(
  reason: "noRemote" | "rejected" | "authRequired" | "gitError",
  message: string,
): string {
  switch (reason) {
    case "noRemote":
      return AGENT_SHIP_BLOCKED_NO_REMOTE;
    case "rejected":
      return "The remote branch has newer commits. Pull them in the Git panel, then retry.";
    case "authRequired":
      return "Git could not authenticate. Configure a credential helper or SSH key, then retry.";
    case "gitError":
      return message;
    default:
      return unsupportedPushFailureReason(reason);
  }
}

function agentShipIntegrateFailureLabel(
  failure: Extract<AgentShipFailure, { step: "integrate" }>,
): string {
  if ("outcome" in failure) return agentShipIntegrationFailureLabel(failure.outcome);
  return `Integration failed: ${failure.message}`;
}

function agentShipIntegrationFailureLabel(
  outcome: Extract<AgentShipFailure, { step: "integrate"; outcome: unknown }>["outcome"],
): string {
  switch (outcome.kind) {
    case "conflicted":
      return "The merge conflicted and was aborted. The main checkout is unchanged.";
    case "primaryDirty":
      return AGENT_SHIP_BLOCKED_PRIMARY_DIRTY;
    case "primaryDetached":
      return AGENT_SHIP_BLOCKED_PRIMARY_DETACHED;
    case "staleExpectation":
      return "The branches moved since the status was read. Refresh the status, then retry.";
    case "notFastForward":
      return "A fast-forward is no longer possible. Use a merge commit instead.";
    case "abortFailed":
      return `The main checkout is in a conflicted merge. Resolve it in the Git panel. ${outcome.message}`;
    default:
      return unsupportedIntegrationOutcome(outcome);
  }
}

function compareUrlHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (agentPromptByteLength(value) <= maxBytes) return value;
  let truncated = value;
  while (truncated.length > 0 && agentPromptByteLength(truncated) > maxBytes) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

function blocked(reason: string): AgentShipAvailability {
  return { kind: "blocked", reason };
}

function isAuthorityLostFailure(
  failure: AgentShipFailure,
): failure is Extract<AgentShipFailure, { reason: "authorityLost" }> {
  return "reason" in failure && failure.reason === "authorityLost";
}

function unsupportedShipFailureStep(failure: never): never {
  throw new TypeError(`Unsupported agent ship failure: ${JSON.stringify(failure)}.`);
}

function unsupportedPushFailureReason(reason: never): never {
  throw new TypeError(`Unsupported agent ship push failure reason: ${String(reason)}.`);
}

function unsupportedIntegrationOutcome(outcome: never): never {
  throw new TypeError(`Unsupported git integration outcome: ${JSON.stringify(outcome)}.`);
}

function unsupportedCliKind(kind: never): never {
  throw new TypeError(`Unsupported agent CLI kind: ${String(kind)}.`);
}

function unsupportedTrust(trust: never): never {
  throw new TypeError(`Unsupported agent project trust: ${String(trust)}.`);
}

function unsupportedOrigin(origin: never): never {
  throw new TypeError(`Unsupported agent project origin: ${String(origin)}.`);
}

function unsupportedLifecycle(lifecycle: never): never {
  throw new TypeError(`Unsupported agent thread lifecycle: ${String(lifecycle)}.`);
}

function unsupportedTurnStatus(status: never): never {
  throw new TypeError(`Unsupported agent turn status: ${JSON.stringify(status)}.`);
}

function unsupportedIsolation(isolation: never): never {
  throw new TypeError(`Unsupported agent task isolation: ${String(isolation)}.`);
}

function unsupportedIsolationReason(reason: never): never {
  throw new TypeError(`Unsupported agent isolation reason: ${String(reason)}.`);
}

function unsupportedGuardReason(reason: never): never {
  throw new TypeError(`Unsupported in-place guard reason: ${String(reason)}.`);
}

function unsupportedChangeStatus(status: never): never {
  throw new TypeError(`Unsupported Git change status: ${String(status)}.`);
}

export function agentSurfaceTargetPath(view: AgentThreadView): string {
  return view.thread.target.worktreePath ?? view.thread.owner.repositoryRoot;
}

export function agentSurfaceTargetGone(view: AgentThreadView): boolean {
  return view.worktreeMissing || view.worktreeRemoved || view.ship.kind === "worktreeRemoved";
}

export function agentChangedFilesCueLabel(summary: AgentTaskChangeSummary): string | null {
  if (summary.loading || summary.error !== null) return null;
  const count = summary.files.length;
  if (count === 0) return null;
  const suffix = summary.truncated ? "+" : "";
  if (count === 1 && !summary.truncated) return "1 file changed";
  return `${count}${suffix} files changed`;
}

export function agentFileDiffToGitFileDiff(
  diff: AgentTaskFileDiff,
  change: GitChangedFile,
): GitFileDiff {
  return {
    change,
    language: detectLanguage(change.path),
    originalContent: diff.original.text,
    modifiedContent: diff.modified.text,
    previewUnavailableReason: diff.unavailableReason,
  };
}

export function agentFileDiffTruncated(diff: AgentTaskFileDiff): boolean {
  return diff.original.truncated || diff.modified.truncated;
}

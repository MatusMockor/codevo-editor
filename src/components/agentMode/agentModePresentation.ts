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
  type AgentThreadLifecycle,
  type AgentTurn,
  type AgentTurnEvent,
  type AgentTurnStatus,
} from "../../domain/agentThread";
import type { GitChangeStatus } from "../../domain/git";
import { gitRepositoryDisplayName } from "../../domain/gitRepositoryMapping";
import { localHistoryRelativeTime } from "../../domain/localHistory";
import type { AgentThreadView, OrphanedWorktreeView } from "../../application/agentThreadPorts";

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
  const items: AgentTurnItem[] = [];
  const rawLines: AgentRawLine[] = [];
  const toolItemByToolId = new Map<string, number>();

  for (let offset = hiddenCount; offset < events.length; offset += 1) {
    const event = events[offset];
    if (event === undefined) continue;
    const key = `e${offset}`;
    appendTurnItem({ calls, event, items, key, rawLines, toolItemByToolId });
  }

  return { items, rawLines, hiddenCount };
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
      return "This workspace always isolates agents in a worktree.";
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

export function agentProjectOriginBadge(origin: AgentProjectOrigin): string | null {
  switch (origin) {
    case "active-tab":
      return null;
    case "background-tab":
      return "Background";
    case "closed-tab-live-tasks":
      return "Tab closed";
    default:
      return unsupportedOrigin(origin);
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
    const projectThreads = ownsThreads
      ? threads.filter((view) => view.thread.owner.ownerId === project.ownerId)
      : [];
    groups.push(buildProjectGroup(project, projectThreads, orphans, claimedRepositoryRoots));
  }

  const detachedThreads = threads.filter((view) => !knownOwnerIds.has(view.thread.owner.ownerId));
  const detachedOrphans = orphans.filter(
    (orphan) => !claimedRepositoryRoots.has(orphan.repositoryRoot),
  );
  const detachedRoots = [
    ...new Set([
      ...detachedThreads.map((view) => view.thread.owner.repositoryRoot),
      ...detachedOrphans.map((orphan) => orphan.repositoryRoot),
    ]),
  ].sort();

  if (detachedRoots.length === 0) {
    return groups;
  }

  const detachedRepos = detachedRoots.map((root) =>
    buildGroup(
      root,
      root,
      detachedThreads.filter((view) => view.thread.owner.repositoryRoot === root),
      detachedOrphans.filter((orphan) => orphan.repositoryRoot === root),
      false,
    ),
  );

  return [
    ...groups,
    {
      projectRootKey: DETACHED_AGENT_PROJECT_ROOT_KEY,
      kind: "detached",
      label: DETACHED_AGENT_PROJECT_LABEL,
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
  orphans: ReadonlyArray<OrphanedWorktreeView>,
  claimedRepositoryRoots: Set<string>,
): AgentProjectGroup {
  const repositories = project.repositories.filter(
    (repository) => !claimedRepositoryRoots.has(repository.repositoryRoot),
  );
  for (const repository of repositories) {
    claimedRepositoryRoots.add(repository.repositoryRoot);
  }

  const ownedRoots = new Set(repositories.map((repository) => repository.repositoryRoot));
  const repos = repositories.map((repository) =>
    buildGroup(
      repository.repositoryRoot,
      gitRepositoryDisplayName(repository.mapping.rootRelativePath, project.rootPath),
      projectThreads.filter(
        (view) => view.thread.owner.repositoryRoot === repository.repositoryRoot,
      ),
      orphans.filter((orphan) => orphan.repositoryRoot === repository.repositoryRoot),
      true,
    ),
  );

  const strayRoots = [
    ...new Set(
      projectThreads
        .map((view) => view.thread.owner.repositoryRoot)
        .filter((root) => !ownedRoots.has(root)),
    ),
  ].sort();
  const strayRepos = strayRoots.map((root) =>
    buildGroup(
      root,
      strayRepositoryLabel(root, project.rootPath),
      projectThreads.filter((view) => view.thread.owner.repositoryRoot === root),
      [],
      false,
    ),
  );

  const repoGroups = [...repos, ...strayRepos];
  return {
    projectRootKey: project.rootKey,
    kind: "project",
    label: project.label,
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
  const active = orderPinnedThreadsFirst(threads.filter((view) => view.lifecycle !== "archived"));
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

export function orderPinnedThreadsFirst(
  threads: ReadonlyArray<AgentThreadView>,
): ReadonlyArray<AgentThreadView> {
  if (!threads.some((view) => view.thread.pinned)) {
    return threads;
  }
  return [...threads].sort((left, right) => pinRank(left) - pinRank(right));
}

function pinRank(view: AgentThreadView): number {
  return view.thread.pinned ? 0 : 1;
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

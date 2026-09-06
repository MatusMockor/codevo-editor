import type { AgentThreadView } from "../../application/agentThreadPorts";
import type {
  AgentProviderManagementSurface,
  AgentProviderManagementView,
} from "../../application/useAgentProviderManagement";
import type { AgentProjectOrigin, AgentProjectTrust } from "../../domain/agentProject";
import type {
  AgentProviderHealthState,
  AgentProviderInstaller,
  AgentProviderPolicyRegistrationState,
  AgentProviderUpdateState,
} from "../../domain/agentProviderHealth";
import type { AgentCliKind, AgentTaskIsolation } from "../../domain/agentTask";
import type { AgentThreadSearchMatch } from "../../domain/agentThreadSearch";
import {
  runningTurn,
  type AgentThread,
  type AgentThreadExternalOrigin,
  type AgentTurnStatus,
} from "../../domain/agentThread";
import type { ExternalAgentSessionSummary } from "../../domain/externalAgentSession";
import { providerUpdateResultPresentation } from "../settings/agentProviderUpdatePresentation";
import {
  agentShipBranchLabel,
  agentThreadDisplayTitle,
  type AgentProjectGroup,
} from "./agentModePresentation";

export const ARCHIVED_PAGE_COUNT = 20;
export const THREAD_JUMP_HINT_SHOW_DELAY_MS = 200;
export const MAX_AGENT_THREAD_JUMP_SLOTS = 9;
export const NO_PROJECT_SCOPE_LABEL = "No project";

export type AgentRowStatus =
  | { readonly kind: "working"; readonly startedAtEpochMs: number }
  | { readonly kind: "failed" }
  | { readonly kind: "stopped" }
  | { readonly kind: "done" }
  | { readonly kind: "none" };

export type AgentRowVariant = "card" | "slim";

export interface AgentRailScope {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
}

export interface AgentRailScopeEntry {
  readonly value: string;
  readonly label: string;
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
  readonly repositoryResolved: boolean;
  readonly trust: AgentProjectTrust;
  readonly origin: AgentProjectOrigin;
  readonly rootPath: string | null;
  readonly repositoryCount: number;
}

export type AgentProjectMenuCommand =
  "trust" | "close" | "release" | "reveal" | "copyPath" | "terminalSessions";

export interface AgentProjectMenuTarget {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
  readonly rootPath: string | null;
}

export interface AgentProjectMenuEntry {
  readonly id: string;
  readonly label: string;
  readonly command: AgentProjectMenuCommand;
  readonly disabled: boolean;
}

export interface AgentRailSections {
  readonly pinned: ReadonlyArray<AgentThreadView>;
  readonly active: ReadonlyArray<AgentThreadView>;
  readonly archived: ReadonlyArray<AgentThreadView>;
  readonly hiddenArchivedCount: number;
}

export interface AgentThreadRevealRequest {
  readonly query: string;
  readonly turnId: string;
  readonly eventIndex: number | null;
  readonly start: number;
  readonly end: number;
}

export type AgentThreadCopyDetail = "path" | "branch" | "threadId";

export type AgentThreadMenuCommand =
  | { readonly kind: "newThread" }
  | { readonly kind: "togglePin" }
  | { readonly kind: "rename"; readonly title: string }
  | { readonly kind: "markUnread" }
  | { readonly kind: "copy"; readonly detail: AgentThreadCopyDetail }
  | { readonly kind: "stop" }
  | { readonly kind: "archive" }
  | { readonly kind: "delete" };

export type AgentThreadMenuIcon =
  | "newThread"
  | "pin"
  | "unpin"
  | "rename"
  | "markUnread"
  | "copyPath"
  | "copyBranch"
  | "copyThreadId"
  | "stop"
  | "archive"
  | "delete";

export type AgentThreadMenuEntry =
  | { readonly kind: "separator"; readonly id: string }
  | {
      readonly kind: "item";
      readonly id: string;
      readonly label: string;
      readonly icon: AgentThreadMenuIcon;
      readonly disabled: boolean;
      readonly destructive: boolean;
      readonly command: AgentThreadMenuCommand | "rename";
    };

export interface AgentThreadMenuContext {
  readonly branch: string | null;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly running: boolean;
}

export function agentThreadMenuEntries(
  props: AgentThreadMenuContext,
): ReadonlyArray<AgentThreadMenuEntry> {
  const target = props.branch === null ? "New thread" : `New thread on ${props.branch}`;
  const entries: AgentThreadMenuEntry[] = [
    menuItem("new", target, "newThread", { kind: "newThread" }),
    menuItem("pin", props.pinned ? "Unpin" : "Pin", props.pinned ? "unpin" : "pin", {
      kind: "togglePin",
    }),
    { kind: "separator", id: "s1" },
    menuItem("rename", "Rename", "rename", "rename"),
    menuItem("unread", "Mark unread", "markUnread", { kind: "markUnread" }),
    { kind: "separator", id: "s2" },
    menuItem("copy-path", "Copy path", "copyPath", { kind: "copy", detail: "path" }),
    menuItem("copy-branch", "Copy branch", "copyBranch", { kind: "copy", detail: "branch" }),
    menuItem("copy-id", "Copy thread ID", "copyThreadId", { kind: "copy", detail: "threadId" }),
    { kind: "separator", id: "s3" },
  ];
  if (props.running) entries.push(menuItem("stop", "Stop", "stop", { kind: "stop" }));
  if (!props.archived)
    entries.push(menuItem("archive", "Archive", "archive", { kind: "archive" }, props.running));
  entries.push(menuItem("delete", "Delete", "delete", { kind: "delete" }, false, true));
  return entries;
}

function menuItem(
  id: string,
  label: string,
  icon: AgentThreadMenuIcon,
  command: AgentThreadMenuCommand | "rename",
  disabled = false,
  destructive = false,
): AgentThreadMenuEntry {
  return { kind: "item", id, label, icon, command, disabled, destructive };
}

export function agentRowStatus(view: AgentThreadView): AgentRowStatus {
  const running = runningTurn(view.thread);
  if (running !== null) return { kind: "working", startedAtEpochMs: running.startedAtEpochMs };
  const last = lastTurnStatus(view.thread);
  if (last !== null && isFailedTurnStatus(last)) return { kind: "failed" };
  if (last !== null && isStoppedTurnStatus(last)) return { kind: "stopped" };
  if (view.unread && !view.thread.archived) return { kind: "done" };
  return { kind: "none" };
}

export function agentRowRecedes(
  view: AgentThreadView,
  status: AgentRowStatus,
  on: boolean,
): boolean {
  if (on) return false;
  if (view.unread) return false;
  return status.kind === "none" || status.kind === "working";
}

export function agentRowVariant(view: AgentThreadView): AgentRowVariant {
  return view.thread.archived ? "slim" : "card";
}

export function agentRailSections(
  views: ReadonlyArray<AgentThreadView>,
  scope: AgentRailScope | null,
  archivedExpanded: boolean,
  archivedShown: number,
): AgentRailSections {
  const scoped = views.filter((view) => scopeIncludes(scope, view));
  const pinned = scoped.filter((view) => view.thread.pinned && !view.thread.archived);
  const active = scoped.filter((view) => !view.thread.pinned && !view.thread.archived);
  const archived = scoped.filter((view) => view.thread.archived);
  pinned.sort(compareByRecency);
  active.sort(compareByRecency);
  archived.sort(compareByRecency);

  if (!archivedExpanded) {
    return { pinned, active, archived: [], hiddenArchivedCount: archived.length };
  }

  const shown = Math.min(Math.max(archivedShown, 0), archived.length);
  return {
    pinned,
    active,
    archived: archived.slice(0, shown),
    hiddenArchivedCount: archived.length - shown,
  };
}

export function agentRailScopeEntries(
  groups: ReadonlyArray<AgentProjectGroup>,
): ReadonlyArray<AgentRailScopeEntry> {
  const entries: AgentRailScopeEntry[] = [];

  for (const group of groups) {
    if (group.kind !== "project") continue;
    const repo = group.repos[0];
    if (repo === undefined) continue;
    entries.push({
      value: agentRailScopeValue(group.projectRootKey),
      label: group.label,
      projectRootKey: group.projectRootKey,
      repositoryRoot: repo.repositoryRoot,
      repositoryResolved: repo.repositoryResolved,
      trust: group.trust,
      origin: group.origin,
      rootPath: group.rootPath,
      repositoryCount: group.repos.length,
    });
  }

  return entries;
}

export function agentRailScopeValue(projectRootKey: string): string {
  return projectRootKey;
}

export function agentRailScopeEntryValue(scope: AgentRailScope | null): string {
  if (scope === null) return "";
  return agentRailScopeValue(scope.projectRootKey);
}

export function agentRailScopeFromEntry(entry: AgentRailScopeEntry): AgentRailScope {
  return { projectRootKey: entry.projectRootKey, repositoryRoot: entry.repositoryRoot };
}

export function agentRailScopeEntryFor(
  entries: ReadonlyArray<AgentRailScopeEntry>,
  projectRootKey: string,
): AgentRailScopeEntry | null {
  return entries.find((candidate) => candidate.projectRootKey === projectRootKey) ?? null;
}

export function agentRailDefaultScopeEntry(
  entries: ReadonlyArray<AgentRailScopeEntry>,
  selectedProjectRootKey: string | null,
): AgentRailScopeEntry | null {
  if (selectedProjectRootKey !== null) {
    const owning = agentRailScopeEntryFor(entries, selectedProjectRootKey);
    if (owning !== null) return owning;
  }
  return entries[0] ?? null;
}

export function agentRailNeighbourScopeEntry(
  previousOrder: ReadonlyArray<string>,
  entries: ReadonlyArray<AgentRailScopeEntry>,
  goneProjectRootKey: string,
): AgentRailScopeEntry | null {
  const index = previousOrder.indexOf(goneProjectRootKey);
  if (index === -1) return null;
  const forward = previousOrder.slice(index + 1);
  const backward = [...previousOrder.slice(0, index)].reverse();
  for (const projectRootKey of [...forward, ...backward]) {
    const surviving = agentRailScopeEntryFor(entries, projectRootKey);
    if (surviving !== null) return surviving;
  }
  return null;
}

export function agentRailScopeOrder(
  entries: ReadonlyArray<AgentRailScopeEntry>,
): ReadonlyArray<string> {
  return entries.map((entry) => entry.projectRootKey);
}

export function sameAgentRailScopeOrder(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function agentRailScopeLabel(
  scope: AgentRailScope | null,
  entries: ReadonlyArray<AgentRailScopeEntry>,
): string {
  if (scope === null) return NO_PROJECT_SCOPE_LABEL;
  const entry = agentRailScopeEntryFor(entries, scope.projectRootKey);
  return entry?.label ?? NO_PROJECT_SCOPE_LABEL;
}

function scopeIncludes(scope: AgentRailScope | null, view: AgentThreadView): boolean {
  if (scope === null) return false;
  return view.thread.owner.rootKey === scope.projectRootKey;
}

function compareByRecency(left: AgentThreadView, right: AgentThreadView): number {
  if (left.thread.updatedAtEpochMs !== right.thread.updatedAtEpochMs) {
    return right.thread.updatedAtEpochMs - left.thread.updatedAtEpochMs;
  }
  if (left.thread.threadId < right.thread.threadId) return -1;
  if (left.thread.threadId > right.thread.threadId) return 1;
  return 0;
}

function lastTurnStatus(thread: AgentThread): AgentTurnStatus | null {
  const last = thread.turns[thread.turns.length - 1];
  if (last === undefined) return null;
  return last.status;
}

function isFailedTurnStatus(status: AgentTurnStatus): boolean {
  if (status.kind === "failed") return true;
  return status.kind === "exited" && status.exitCode !== 0;
}

function isStoppedTurnStatus(status: AgentTurnStatus): boolean {
  return status.kind === "stopped" || status.kind === "interrupted";
}

export interface AgentRailScopeState {
  readonly label: string;
  readonly action: "trust" | "release" | null;
}

export type AgentRailEmptyState =
  | { readonly kind: "noProjects" }
  | { readonly kind: "noScope" }
  | { readonly kind: "noThreads"; readonly scopeLabel: string }
  | null;

export function agentRailViews(
  groups: ReadonlyArray<AgentProjectGroup>,
): ReadonlyArray<AgentThreadView> {
  const views: AgentThreadView[] = [];
  for (const group of groups) {
    for (const repo of group.repos) {
      views.push(...repo.threads, ...repo.archived);
    }
  }
  return views;
}

export function agentRailOrphanCount(
  groups: ReadonlyArray<AgentProjectGroup>,
  scope: AgentRailScope | null,
): number {
  if (scope === null) return 0;
  let count = 0;
  for (const group of groups) {
    if (group.projectRootKey !== scope.projectRootKey) continue;
    for (const repo of group.repos) {
      count += repo.orphans.length;
    }
  }
  return count;
}

export function agentRailEmptyState(
  groups: ReadonlyArray<AgentProjectGroup>,
  sections: AgentRailSections,
  scope: AgentRailScope | null,
  entries: ReadonlyArray<AgentRailScopeEntry>,
): AgentRailEmptyState {
  if (groups.length === 0) return { kind: "noProjects" };
  const total =
    sections.pinned.length +
    sections.active.length +
    sections.archived.length +
    sections.hiddenArchivedCount;
  if (total > 0) return null;
  if (scope === null) return { kind: "noScope" };
  return { kind: "noThreads", scopeLabel: agentRailScopeLabel(scope, entries) };
}

export function agentRailDetachedThreadCount(groups: ReadonlyArray<AgentProjectGroup>): number {
  let count = 0;
  for (const group of groups) {
    if (group.kind === "project") continue;
    for (const repo of group.repos) {
      count += repo.threads.length + repo.archived.length;
    }
  }
  return count;
}

export function agentRailScopeState(entry: AgentRailScopeEntry | null): AgentRailScopeState | null {
  if (entry === null) return null;
  if (entry.trust !== "trusted") return { label: "Untrusted", action: "trust" };
  if (entry.origin === "background-tab") return { label: "Background", action: null };
  if (entry.origin === "closed-tab-live-tasks") return { label: "Tab closed", action: "release" };
  return null;
}

export function agentProjectMenuTarget(entry: AgentRailScopeEntry): AgentProjectMenuTarget {
  return {
    projectRootKey: entry.projectRootKey,
    repositoryRoot: entry.repositoryRoot,
    rootPath: entry.rootPath,
  };
}

export function agentProjectClosable(entry: AgentRailScopeEntry): boolean {
  return entry.origin !== "closed-tab-live-tasks" && entry.rootPath !== null;
}

export function agentProjectCloseLabel(entry: AgentRailScopeEntry): string {
  return `Close project ${entry.label}`;
}

export function agentProjectMenuEntries(
  entry: AgentRailScopeEntry,
): ReadonlyArray<AgentProjectMenuEntry> {
  const entries: AgentProjectMenuEntry[] = [];
  if (entry.trust !== "trusted") {
    entries.push(projectMenuEntry("trust", "Trust project", "trust", false));
  }
  if (entry.origin === "closed-tab-live-tasks" && entry.rootPath !== null) {
    entries.push(projectMenuEntry("release", "Release project", "release", false));
  }
  if (agentProjectClosable(entry)) {
    entries.push(projectMenuEntry("close", "Close project", "close", false));
  }
  entries.push(
    projectMenuEntry("terminal-sessions", "Terminal sessions…", "terminalSessions", !usable(entry)),
  );
  if (entry.rootPath === null) return entries;
  entries.push(projectMenuEntry("reveal", "Reveal in Finder", "reveal", false));
  entries.push(projectMenuEntry("copy-path", "Copy path", "copyPath", false));
  return entries;
}

export function agentProjectRepositoryCountLabel(entry: AgentRailScopeEntry): string | null {
  if (entry.repositoryCount <= 1) return null;
  return `${entry.repositoryCount} repos`;
}

function projectMenuEntry(
  id: string,
  label: string,
  command: AgentProjectMenuCommand,
  disabled: boolean,
): AgentProjectMenuEntry {
  return { id, label, command, disabled };
}

export function agentRailNewThreadTarget(
  scope: AgentRailScope | null,
  entries: ReadonlyArray<AgentRailScopeEntry>,
): AgentRailScope | null {
  if (scope === null) return null;
  const entry = agentRailScopeEntryFor(entries, scope.projectRootKey);
  if (!usable(entry)) return null;
  return { projectRootKey: scope.projectRootKey, repositoryRoot: scope.repositoryRoot };
}

export function agentProjectTerminalSessionsTarget(
  project: AgentRailScope | null,
  entries: ReadonlyArray<AgentRailScopeEntry>,
): AgentRailScope | null {
  if (project === null) return null;
  const entry = agentRailScopeEntryFor(entries, project.projectRootKey);
  if (entry === null || !usable(entry)) return null;
  return {
    projectRootKey: project.projectRootKey,
    repositoryRoot:
      project.repositoryRoot === entry.rootPath ? entry.repositoryRoot : project.repositoryRoot,
  };
}

function usable(entry: AgentRailScopeEntry | null): boolean {
  if (entry === null) return false;
  return entry.trust === "trusted" && entry.origin !== "closed-tab-live-tasks";
}

export function agentJumpSlots(sections: AgentRailSections): ReadonlyMap<string, number> {
  const slots = new Map<string, number>();
  const ordered = [...sections.pinned, ...sections.active];
  if (ordered.length < 2) return slots;
  for (const [index, view] of ordered.entries()) {
    if (index >= MAX_AGENT_THREAD_JUMP_SLOTS) break;
    slots.set(view.thread.threadId, index + 1);
  }
  return slots;
}

export function agentCompactTimeLabel(epochMs: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - epochMs) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 52) return `${weeks}w`;
  return `${Math.floor(days / 365)}y`;
}

export function agentWorkingDurationLabel(startedAtEpochMs: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAtEpochMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

export function agentRowStatusLabel(status: AgentRowStatus): string | null {
  switch (status.kind) {
    case "working":
      return "Working";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "done":
      return "Done";
    case "none":
      return null;
    default:
      return unsupportedRowStatus(status);
  }
}

export function agentProviderLabel(kind: AgentCliKind): string {
  switch (kind) {
    case "claudeCode":
      return "Claude Code";
    case "codex":
      return "Codex";
    default:
      return unsupportedProvider(kind);
  }
}

function unsupportedRowStatus(status: never): never {
  throw new TypeError(`Unsupported agent row status: ${String(status)}.`);
}

function unsupportedProvider(kind: never): never {
  throw new TypeError(`Unsupported agent provider: ${String(kind)}.`);
}

export function agentRailProjectLabels(
  groups: ReadonlyArray<AgentProjectGroup>,
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const group of groups) {
    for (const repo of group.repos) {
      labels.set(
        repo.repositoryRoot,
        group.singleRepo ? group.label : `${group.label} / ${repo.label}`,
      );
    }
  }
  return labels;
}

export interface AgentThreadRowModel {
  readonly project: string;
  readonly title: string;
  readonly branch: string;
  readonly filesLabel: string | null;
  readonly provider: AgentCliKind;
  readonly status: AgentRowStatus;
  readonly variant: AgentRowVariant;
  readonly recede: boolean;
}

export function agentThreadRowModel(
  view: AgentThreadView,
  on: boolean,
  projectLabel: string = view.repositoryLabel,
): AgentThreadRowModel {
  const status = agentRowStatus(view);
  const thread = view.thread;
  return {
    project: projectLabel,
    title: agentThreadDisplayTitle(thread),
    branch: agentShipBranchLabel(view.ship) ?? agentRowIsolationLabel(thread.target.isolation),
    filesLabel: agentRowFilesLabel(view),
    provider: thread.provider.kind,
    status,
    variant: agentRowVariant(view),
    recede: agentRowRecedes(view, status, on),
  };
}

export function agentRowProjectLabel(
  labels: ReadonlyMap<string, string>,
  view: AgentThreadView,
): string {
  return labels.get(view.thread.owner.repositoryRoot) ?? view.repositoryLabel;
}

function agentRowIsolationLabel(isolation: AgentTaskIsolation): string {
  return isolation === "worktree" ? "worktree" : "in place";
}

function agentRowFilesLabel(view: AgentThreadView): string | null {
  const summary = view.changeSummary;
  if (summary === null || summary.loading) return null;
  const count = summary.files.length;
  return count === 1 ? "1 file" : `${count} files`;
}

export function agentRowClassName(
  variant: AgentRowVariant,
  on: boolean,
  recede: boolean,
  status: AgentRowStatus,
  unread: boolean,
): string {
  const classes = ["agent-row", `agent-row--${variant}`];
  if (on) classes.push("agent-row--on");
  if (recede) classes.push("agent-row--recede");
  if (status.kind === "working") classes.push("agent-row--inflight");
  if (unread) classes.push("agent-row--unread");
  return classes.join(" ");
}

export const AGENT_IMPORTED_BADGE_LABEL = "Imported";

export function agentThreadImportedBadgeLabel(
  origin: AgentThreadExternalOrigin | null,
): string | null {
  if (origin === null) return null;
  return AGENT_IMPORTED_BADGE_LABEL;
}

export function agentExternalOriginNote(origin: AgentThreadExternalOrigin | null): string | null {
  if (origin === null) return null;
  return `Imported from terminal session ${origin.sessionId}`;
}

export function agentSessionTurnCountLabel(turnCount: number, turnCountExact: boolean): string {
  if (!turnCountExact) return `${turnCount}+ turns`;
  if (turnCount === 1) return "1 turn";
  return `${turnCount} turns`;
}

export function agentExternalSessionRowTitle(
  session: Pick<ExternalAgentSessionSummary, "firstPrompt" | "sessionId" | "title">,
): string {
  if (session.title !== "") return session.title;
  const promptLine = session.firstPrompt.split("\n", 1)[0]?.trim() ?? "";
  if (promptLine !== "") return promptLine;
  return session.sessionId;
}

export function agentExternalSessionsStatusNote(
  skipped: number,
  truncated: boolean,
  shownCount: number,
): string | null {
  const parts: string[] = [];
  if (skipped === 1) parts.push("1 automated or unreadable session hidden");
  if (skipped > 1) parts.push(`${skipped} automated or unreadable sessions hidden`);
  if (truncated) {
    parts.push(shownCount === 0 ? "session scan limited" : `showing the newest ${shownCount}`);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function agentThreadRevealForMatch(
  query: string,
  match: AgentThreadSearchMatch,
): AgentThreadRevealRequest | null {
  if (match.turnId === null) return null;
  return {
    query,
    turnId: match.turnId,
    eventIndex: match.eventIndex,
    start: match.segmentStart,
    end: match.segmentEnd,
  };
}

export type ProviderPillId = "busy" | "updated" | "failed" | "update" | "manual" | "register";
export type ProviderPillTone = "primary" | "success" | "danger";
export type ProviderPillGlyph = "spinner" | "check" | "update" | "manual" | "register" | "retry";

export type ProviderPillIntent =
  | { readonly kind: "update"; readonly version: string }
  | { readonly kind: "openSettings" }
  | { readonly kind: "register" }
  | { readonly kind: "none" };

export interface ProviderPillModel {
  readonly id: ProviderPillId;
  readonly tone: ProviderPillTone;
  readonly glyph: ProviderPillGlyph;
  readonly label: string;
  readonly name: string;
  readonly title: string | null;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly intent: ProviderPillIntent;
}

export interface ProviderFooterPillInput {
  readonly provider: AgentCliKind;
  readonly view: AgentProviderManagementView;
  readonly updatedVisible: boolean;
  readonly failedVersion: string | null;
  readonly dismissedVersion?: string | null;
}

export function providerUpdateSettledAtOffer(
  updateState: AgentProviderUpdateState,
  dismissedVersion: string | null,
  offeredVersion: string,
): boolean {
  if (updateState.kind === "alreadyCurrent" && updateState.offeredVersion === offeredVersion) {
    return true;
  }
  return dismissedVersion === offeredVersion;
}

export function providerFooterPillModels({
  dismissedVersion = null,
  failedVersion,
  provider,
  updatedVisible,
  view,
}: ProviderFooterPillInput): ReadonlyArray<ProviderPillModel> {
  const name = agentProviderLabel(provider);
  const updating = providerUpdating(view.updateState);
  const registering = view.policy.kind === "registering";
  const registered = view.policy.kind === "registered";
  const available =
    view.health.kind === "ready" && view.health.update.kind === "available"
      ? view.health.update
      : null;
  const busyLabel = providerBusyLabel(name, updating, registering);
  const manual =
    view.health.kind === "ready" &&
    view.health.update.kind === "manualUpdateAvailable" &&
    !updating;
  const newerOffer =
    available !== null && failedVersion !== null && available.availableVersion !== failedVersion;
  const failed =
    view.updateState.kind === "failed" && !manual && !newerOffer && !updateLanded(view.health);
  const settledAtOffer =
    available !== null &&
    providerUpdateSettledAtOffer(view.updateState, dismissedVersion, available.availableVersion);
  const offersUpdate = available !== null && registered && !updating && !failed && !settledAtOffer;
  const canRetryUpdate = available !== null && registered;
  const register = view.policy.kind === "unregistered" || view.policy.kind === "failed";
  const turnsLive = view.liveTurnCount > 0;
  const stopTurns = `Stop running ${name} turns first.`;
  const pills: ProviderPillModel[] = [];

  if (busyLabel !== null) {
    pills.push({
      id: "busy",
      tone: "primary",
      glyph: "spinner",
      label: busyLabel,
      name: busyLabel,
      title: null,
      busy: true,
      disabled: false,
      intent: { kind: "none" },
    });
  }
  if (updatedVisible) {
    pills.push({
      id: "updated",
      tone: "success",
      glyph: "check",
      label: `${name} updated`,
      name: `${name} updated`,
      title: updateResultTitle(view, available?.installer ?? null),
      busy: false,
      disabled: false,
      intent: { kind: "none" },
    });
  }
  if (failed) {
    const label = `${name} update failed · Retry`;
    const disabled = canRetryUpdate && turnsLive;
    pills.push({
      id: "failed",
      tone: "danger",
      glyph: "retry",
      label,
      name: `${label} — retry the ${name} update`,
      title: disabled ? stopTurns : updateResultTitle(view, available?.installer ?? null),
      busy: false,
      disabled,
      intent:
        canRetryUpdate && available !== null
          ? { kind: "update", version: available.availableVersion }
          : { kind: "openSettings" },
    });
  }
  if (offersUpdate && available !== null) {
    pills.push({
      id: "update",
      tone: "primary",
      glyph: "update",
      label: `Update ${name}`,
      name: `Update ${name} to ${available.availableVersion}`,
      title: turnsLive ? stopTurns : `Update to ${available.availableVersion}`,
      busy: false,
      disabled: turnsLive,
      intent: { kind: "update", version: available.availableVersion },
    });
  }
  if (manual && view.health.kind === "ready") {
    const label = `Update ${name} manually`;
    pills.push({
      id: "manual",
      tone: "primary",
      glyph: "manual",
      label,
      name: `${label} — view update instructions`,
      title: manualUpdateTitle(view.health),
      busy: false,
      disabled: false,
      intent: { kind: "openSettings" },
    });
  }
  if (register) {
    const label = `Register ${name} policy`;
    pills.push({
      id: "register",
      tone: "primary",
      glyph: "register",
      label,
      name: `${label} — retry registration`,
      title: providerFooterDetail(view.policy, view.health),
      busy: false,
      disabled: false,
      intent: { kind: "register" },
    });
  }

  return pills;
}

export function providerUpdating(state: AgentProviderUpdateState): boolean {
  return state.kind === "starting" || state.kind === "running";
}

export function providerAvailableVersion(health: AgentProviderHealthState): string | null {
  if (health.kind !== "ready") return null;
  if (health.update.kind !== "available") return null;
  return health.update.availableVersion;
}

export function providerSettingsTitle(
  management: AgentProviderManagementSurface,
  enabled: ReadonlyArray<AgentCliKind>,
): string {
  if (enabled.length === 0) return "Settings > Agents";
  const parts = enabled.map((provider) => {
    const view = management.providers[provider];
    return `${agentProviderLabel(provider)} ${providerFooterLabel(view.policy, view.health)}`;
  });
  return `Settings > Agents · ${parts.join(" · ")}`;
}

function updateLanded(health: AgentProviderHealthState): boolean {
  return health.kind === "ready" && health.update.kind === "current";
}

function updateResultTitle(
  view: AgentProviderManagementView,
  installer: AgentProviderInstaller | null,
): string | null {
  const result = providerUpdateResultPresentation(view.updateState, installer);
  if (result === null) return null;
  return result.message;
}

function manualUpdateTitle(
  health: Extract<AgentProviderHealthState, { readonly kind: "ready" }>,
): string {
  if (health.update.kind !== "manualUpdateAvailable") return readyDetail(health);
  return `Version ${health.update.availableVersion} is available; update with the original installer.`;
}

function providerBusyLabel(name: string, updating: boolean, registering: boolean): string | null {
  if (updating) return `Updating ${name}`;
  if (registering) return `Registering ${name}`;
  return null;
}

function providerFooterLabel(
  policy: AgentProviderPolicyRegistrationState,
  health: AgentProviderHealthState,
): string {
  const policyLabel = providerPolicyLabel(policy);
  if (policyLabel !== null) return policyLabel;
  switch (health.kind) {
    case "disabled":
      return "Disabled";
    case "notConfigured":
      return "Not configured";
    case "checking":
      return "Checking…";
    case "ready":
      if (health.update.kind === "available" || health.update.kind === "manualUpdateAvailable")
        return `v${health.update.availableVersion}`;
      if (health.installedVersion !== null) return `v${health.installedVersion}`;
      return "Ready";
    case "failed":
      return "Check failed";
    default:
      return unsupportedHealth(health);
  }
}

function providerPolicyLabel(policy: AgentProviderPolicyRegistrationState): string | null {
  switch (policy.kind) {
    case "unregistered":
      return "Not registered";
    case "registering":
      return "Registering…";
    case "registered":
      return null;
    case "failed":
      return "Registration failed";
    default:
      return unsupportedPolicy(policy);
  }
}

function providerFooterDetail(
  policy: AgentProviderPolicyRegistrationState,
  health: AgentProviderHealthState,
): string {
  switch (policy.kind) {
    case "unregistered":
      return "Provider policy is not registered";
    case "registering":
      return "Registering provider policy";
    case "failed":
      return `Provider policy registration failed: ${policy.reason}`;
    case "registered":
      break;
    default:
      return unsupportedPolicy(policy);
  }
  switch (health.kind) {
    case "disabled":
      return "Provider disabled";
    case "notConfigured":
      return "CLI path not configured";
    case "checking":
      return "Checking provider health";
    case "ready":
      return readyDetail(health);
    case "failed":
      return `Provider check failed: ${health.reason}`;
    default:
      return unsupportedHealth(health);
  }
}

function readyDetail(
  health: Extract<AgentProviderHealthState, { readonly kind: "ready" }>,
): string {
  if (health.update.kind === "available") {
    return `Update available: ${health.update.availableVersion}`;
  }
  if (health.update.kind === "manualUpdateAvailable") {
    return `Update available: ${health.update.availableVersion}. Update with the original installer.`;
  }
  if (health.update.kind === "unavailable")
    return "CLI update check unavailable. Open Settings for details.";
  if (health.update.kind === "checksDisabled")
    return "CLI update checks are disabled in the current policy.";
  if (health.auth.kind === "signedOut") return "Signed out";
  if (health.auth.kind === "unknown") return "Authentication unknown";
  if (health.auth.label !== null) return `Signed in: ${health.auth.label}`;
  return "Signed in";
}

function unsupportedHealth(health: never): never {
  throw new TypeError(`Unsupported provider health: ${String(health)}`);
}

function unsupportedPolicy(policy: never): never {
  throw new TypeError(`Unsupported provider policy: ${String(policy)}`);
}

import { useCallback, useEffect, useRef } from "react";
import { mapWithBoundedConcurrency } from "../../application/boundedConcurrency";
import { settleAgentThreadMutation } from "../../application/agentThreadMutationOutcome";
import type {
  AgentTasksNotice,
  AgentThreadMutationResult,
  AgentThreadsSurface,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import type { AgentThreadUndoRecorder } from "../../application/useAgentThreadUndo";
import {
  AGENT_THREAD_BULK_CONCURRENCY,
  agentThreadBulkOwnerKey,
  agentThreadBulkPlan,
  agentThreadBulkReport,
  type AgentThreadBulkAction,
  type AgentThreadBulkCandidate,
  type AgentThreadBulkCommand,
} from "../../domain/agentThreadBulkAction";
import { runningTurn } from "../../domain/agentThread";
import { agentTurnUiHalt } from "../../domain/agentTurnHaltRecord";
import {
  agentThreadSectionMoves,
  type AgentThreadSectionMove,
} from "../../domain/agentThreadOrganization";
import {
  agentThreadSectionUndoAction,
  type AgentThreadUndoAction,
} from "../../domain/agentThreadUndo";
import type { AgentProjectGroup } from "./agentModePresentation";
import type { AgentThreadCopyDetail, AgentThreadMenuCommand } from "./agentSidebarPresentation";
import {
  useAgentEndSessionCommand,
  type AgentEndSessionConfirmationView,
} from "./useAgentEndSessionCommand";
import type {
  AgentProjectMenuCommand,
  AgentProjectMenuTarget,
} from "./agentProjectMenuPresentation";

export const CLIPBOARD_UNAVAILABLE_NOTICE: AgentTasksNotice = {
  kind: "warning",
  message: "The clipboard is not available, nothing was copied.",
  action: null,
};
export const NOTHING_TO_COPY_NOTICE: AgentTasksNotice = {
  kind: "info",
  message: "This thread has nothing to copy for that detail.",
  action: null,
};
export const REVEAL_FAILED_NOTICE: AgentTasksNotice = {
  kind: "warning",
  message: "Unable to reveal that path in the file manager.",
  action: null,
};

export function staleSelectionNotice(action: AgentThreadBulkAction): AgentTasksNotice {
  return {
    kind: "warning",
    message: `The thread selection no longer belongs to this project, nothing was ${bulkPastTense(action)}.`,
    action: null,
  };
}

export type AgentMenuCommandSurface = Pick<
  AgentThreadsSurface,
  | "threads"
  | "togglePin"
  | "stop"
  | "endSession"
  | "inspectSessionBackground"
  | "archive"
  | "unarchive"
  | "remove"
  | "batchThreadMutations"
  | "renameThread"
  | "markThreadUnread"
  | "threadCopyDetail"
  | "updateThreadOrganization"
  | "reorderThread"
>;

export interface AgentThreadMenuCommandOptions {
  readonly agents: AgentMenuCommandSurface;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  revealPath(path: string): Promise<void>;
  reportNotice(notice: AgentTasksNotice): void;
  onTrustProject(projectRootKey: string): void;
  onCloseProject(rootPath: string): void;
  onReleaseProject(projectRootKey: string): void;
  onRenameProject(projectRootKey: string): void;
  onThreadRemoved(threadId: string): void;
  onOpenTerminalSessions(projectRootKey: string, repositoryRoot: string): void;
  startNewThread(projectRootKey: string, repositoryRoot: string): void;
  readonly undo?: AgentThreadUndoRecorder;
}

export interface AgentThreadMenuCommands {
  handleProjectCommand(target: AgentProjectMenuTarget, command: AgentProjectMenuCommand): void;
  handleThreadMenuCommand(threadId: string, command: AgentThreadMenuCommand): void;
  handleThreadBulkCommand(command: AgentThreadBulkCommand): void;
  readonly endSessionConfirmation: AgentEndSessionConfirmationView | null;
}

export function useAgentThreadMenuCommands({
  agents,
  groups,
  onCloseProject,
  onOpenTerminalSessions,
  onReleaseProject,
  onRenameProject,
  onThreadRemoved,
  onTrustProject,
  reportNotice,
  revealPath,
  startNewThread,
  undo,
}: AgentThreadMenuCommandOptions): AgentThreadMenuCommands {
  const threadViews = agents.threads;
  const endSession = useAgentEndSessionCommand(agents, reportNotice);
  const requestEndSession = endSession.request;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const remove = useCallback(
    async (threadId: string): Promise<boolean> => {
      const removed = await settleAgentThreadMutation(agents.remove(threadId));
      if (removed && mounted.current) onThreadRemoved(threadId);
      return removed;
    },
    [agents, onThreadRemoved],
  );

  const applyBulkAction = useCallback(
    (action: AgentThreadBulkAction, threadId: string): Promise<boolean> => {
      switch (action) {
        case "archive":
          return settleAgentThreadMutation(agents.archive(threadId));
        case "delete":
          return remove(threadId);
        default:
          return unsupportedBulkAction(action);
      }
    },
    [agents, remove],
  );

  const copyText = useCallback(
    (text: string) => {
      const clipboard = clipboardWriter();
      if (clipboard === null) {
        reportNotice(CLIPBOARD_UNAVAILABLE_NOTICE);
        return;
      }
      void clipboard(text).catch(() => reportNotice(CLIPBOARD_UNAVAILABLE_NOTICE));
    },
    [reportNotice],
  );

  const copyThreadDetail = useCallback(
    (threadId: string, detail: AgentThreadCopyDetail) => {
      const text = agents.threadCopyDetail(threadId, detail);
      if (text === null) {
        reportNotice(NOTHING_TO_COPY_NOTICE);
        return;
      }
      copyText(text);
    },
    [agents, copyText, reportNotice],
  );

  const handleProjectCommand = useCallback(
    (target: AgentProjectMenuTarget, command: AgentProjectMenuCommand) => {
      if (
        target.projectRootKey.startsWith("remote:") &&
        command !== "copyPath" &&
        command !== "rename"
      ) {
        reportNotice({
          kind: "info",
          message: "This project action is not available on the server yet.",
          action: null,
        });
        return;
      }
      switch (command) {
        case "trust":
          onTrustProject(target.projectRootKey);
          return;
        case "release":
          onReleaseProject(target.projectRootKey);
          return;
        case "close":
          if (target.rootPath !== null) onCloseProject(target.rootPath);
          return;
        case "rename":
          onRenameProject(target.projectRootKey);
          return;
        case "reveal":
          if (target.rootPath === null) return;
          void revealPath(target.rootPath).catch(() => reportNotice(REVEAL_FAILED_NOTICE));
          return;
        case "copyPath":
          if (target.rootPath === null) return;
          copyText(target.rootPath);
          return;
        case "terminalSessions":
          onOpenTerminalSessions(target.projectRootKey, target.repositoryRoot);
          return;
        default:
          return unsupportedProjectCommand(command);
      }
    },
    [
      copyText,
      onCloseProject,
      onOpenTerminalSessions,
      onReleaseProject,
      onRenameProject,
      onTrustProject,
      reportNotice,
      revealPath,
    ],
  );

  const undoable = useCallback(
    (
      threadId: string,
      action: AgentThreadUndoAction | null,
      run: () => AgentThreadMutationResult | void,
    ) => {
      if (undo === undefined || action === null) {
        void run();
        return;
      }
      const captured = undo.capture([threadId]);
      const result = run();
      if (result === false) return;
      if (result === undefined || result === true) {
        undo.offer(action, captured);
        return;
      }
      void settleAgentThreadMutation(result).then((applied) => {
        if (!applied || !mounted.current) return;
        undo.offer(action, captured);
      });
    },
    [undo],
  );

  const handleThreadMenuCommand = useCallback(
    (threadId: string, command: AgentThreadMenuCommand) => {
      switch (command.kind) {
        case "snooze":
          undoable(threadId, { kind: "snooze", until: command.until }, () =>
            agents.updateThreadOrganization?.(threadId, {
              snoozedUntil: command.until,
              settledAt: null,
            }),
          );
          return;
        case "unsnooze":
          agents.updateThreadOrganization?.(threadId, { snoozedUntil: null });
          return;
        case "settle":
          undoable(threadId, { kind: "settle" }, () =>
            agents.updateThreadOrganization?.(threadId, {
              settledAt: Date.now(),
              snoozedUntil: null,
            }),
          );
          return;
        case "restore":
          agents.updateThreadOrganization?.(threadId, { settledAt: null, snoozedUntil: null });
          return;
        case "moveToSection": {
          const view = threadViews.find((candidate) => candidate.thread.threadId === threadId);
          if (view === undefined) return;
          const moves = agentThreadSectionMoves(view.thread, command.section, Date.now());
          undoable(threadId, agentThreadSectionUndoAction(moves), () =>
            applySectionMoves(agents, threadId, moves),
          );
          return;
        }
        case "moveBefore":
        case "moveAfter":
          agents.reorderThread?.(
            threadId,
            command.targetThreadId,
            command.kind === "moveBefore" ? "before" : "after",
            ...(command.destination === undefined ? [] : [command.destination]),
          );
          return;
        case "togglePin":
          undoable(threadId, { kind: "unpin" }, () => agents.togglePin(threadId));
          return;
        case "stop":
          void agents.stop(threadId, agentTurnUiHalt("threadMenu"));
          return;
        case "endSession":
          requestEndSession(threadId);
          return;
        case "archive":
          undoable(threadId, { kind: "archive" }, () => agents.archive(threadId));
          return;
        case "unarchive":
          void agents.unarchive?.(threadId);
          return;
        case "delete":
          void remove(threadId);
          return;
        case "newThread": {
          const repositoryRoot = threadRepositoryRoot(threadViews, threadId);
          if (repositoryRoot === null) return;
          const projectRootKey = projectRootKeyForRepository(groups, repositoryRoot);
          if (projectRootKey === null) return;
          startNewThread(projectRootKey, repositoryRoot);
          return;
        }
        case "rename":
          agents.renameThread(threadId, command.title);
          return;
        case "markUnread":
          agents.markThreadUnread(threadId);
          return;
        case "copy":
          copyThreadDetail(threadId, command.detail);
          return;
        default:
          return unsupportedThreadMenuCommand(command);
      }
    },
    [
      agents,
      copyThreadDetail,
      groups,
      remove,
      requestEndSession,
      startNewThread,
      threadViews,
      undoable,
    ],
  );

  const handleThreadBulkCommand = useCallback(
    (command: AgentThreadBulkCommand) => {
      if (command.kind === "stale") {
        reportNotice(staleSelectionNotice(command.action));
        return;
      }
      const plan = agentThreadBulkPlan(command.request, agentThreadBulkCandidates(threadViews));
      const undoAction = bulkUndoAction(plan.action);
      const captured = undoAction === null ? null : (undo?.capture(plan.applyIds) ?? null);
      const run = () =>
        mapWithBoundedConcurrency(
          plan.applyIds,
          AGENT_THREAD_BULK_CONCURRENCY,
          async (threadId) => ({
            threadId,
            ok: await applyBulkAction(plan.action, threadId),
          }),
        );
      void (agents.batchThreadMutations?.(run) ?? run()).then((outcomes) => {
        if (!mounted.current) return;
        const failed = outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.threadId);
        const applied = outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.threadId);
        const undoOffered =
          undoAction !== null &&
          captured !== null &&
          (undo?.offer(undoAction, captured, applied) ?? false);
        if (undoOffered && failed.length === 0 && plan.skipped.length === 0) return;
        reportNotice({
          kind: failed.length === 0 ? "info" : "warning",
          message: agentThreadBulkReport(plan, failed),
          action: null,
        });
      });
    },
    [agents, applyBulkAction, reportNotice, threadViews, undo],
  );

  return {
    handleProjectCommand,
    handleThreadBulkCommand,
    handleThreadMenuCommand,
    endSessionConfirmation: endSession.confirmation,
  };
}

export function agentThreadBulkCandidates(
  views: ReadonlyArray<AgentThreadView>,
): ReadonlyArray<AgentThreadBulkCandidate> {
  return views.map((view) => ({
    threadId: view.thread.threadId,
    ownerKey: agentThreadBulkOwnerKey(view.thread.owner),
    running: runningTurn(view.thread) !== null,
    archived: view.thread.archived,
  }));
}

function clipboardWriter(): ((text: string) => Promise<void>) | null {
  if (typeof navigator === "undefined") return null;
  const clipboard: Clipboard | undefined = navigator.clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== "function") return null;
  return (text) => clipboard.writeText(text);
}

function threadRepositoryRoot(
  views: ReadonlyArray<AgentThreadView>,
  threadId: string,
): string | null {
  const view = views.find((candidate) => candidate.thread.threadId === threadId);
  return view?.thread.owner.repositoryRoot ?? null;
}

function projectRootKeyForRepository(
  groups: ReadonlyArray<AgentProjectGroup>,
  repositoryRoot: string,
): string | null {
  const group = groups.find((candidate) =>
    candidate.repos.some((repo) => repo.repositoryRoot === repositoryRoot),
  );
  return group?.projectRootKey ?? null;
}

function bulkPastTense(action: AgentThreadBulkAction): string {
  switch (action) {
    case "archive":
      return "archived";
    case "delete":
      return "deleted";
    default:
      return unsupportedBulkAction(action);
  }
}

function bulkUndoAction(action: AgentThreadBulkAction): AgentThreadUndoAction | null {
  switch (action) {
    case "archive":
      return { kind: "archive" };
    case "delete":
      return null;
    default:
      return unsupportedBulkAction(action);
  }
}

function unsupportedBulkAction(action: never): never {
  throw new TypeError(`Unsupported agent thread bulk action: ${String(action)}.`);
}

function unsupportedProjectCommand(command: never): never {
  throw new TypeError(`Unsupported agent project command: ${String(command)}.`);
}

function unsupportedThreadMenuCommand(command: never): never {
  throw new TypeError(`Unsupported agent thread menu command: ${JSON.stringify(command)}.`);
}

function applySectionMoves(
  agents: AgentMenuCommandSurface,
  threadId: string,
  moves: ReadonlyArray<AgentThreadSectionMove>,
): AgentThreadMutationResult | void {
  const results = moves.map((move) => applySectionMove(agents, threadId, move));
  if (results.length !== 1) return undefined;
  return results[0];
}

function applySectionMove(
  agents: AgentMenuCommandSurface,
  threadId: string,
  move: AgentThreadSectionMove,
): AgentThreadMutationResult | void {
  switch (move) {
    case "togglePin":
      return agents.togglePin(threadId);
    case "settle":
      return agents.updateThreadOrganization?.(threadId, {
        settledAt: Date.now(),
        snoozedUntil: null,
      });
    case "restore":
      return agents.updateThreadOrganization?.(threadId, { settledAt: null, snoozedUntil: null });
    case "unsnooze":
      return agents.updateThreadOrganization?.(threadId, { snoozedUntil: null });
    default:
      return unsupportedSectionMove(move);
  }
}

function unsupportedSectionMove(move: never): never {
  throw new TypeError(`Unsupported thread section move: ${String(move)}.`);
}
